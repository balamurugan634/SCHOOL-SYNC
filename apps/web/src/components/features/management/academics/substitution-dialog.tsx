'use client';

import { useAllSections } from '@/lib/client/academics';
import * as React from 'react';
import { z } from 'zod';
import { timetableSubstitutionCreateBody } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Select } from '@/components/ui/select';
import { FormDate, FormSelect, FormTextarea } from '@/components/ui/form';
import { weekdayName, sectionOptions, useStaffPicker } from '@/lib/client/options';
import { useCreateSubstitution, useTimetable } from '@/lib/client/timetable';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { fmtClock, fmtDate, todayIso } from '@/lib/format';
import { DialogButtons, FormBanner, ModalForm } from './form-shell';
import { isoWeekday, nextDateOnWeekday } from './timetable-helpers';

const schema = timetableSubstitutionCreateBody.extend({ slotId: z.uuid('Choose a lesson'), substituteStaffId: z.uuid('Choose a substitute'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date') });

export interface CoverPreset {
  sectionId: string;
  slotId: string;
  date?: string;
}

/**
 * Arrange a one-day cover. With a preset (from a lesson in the grid) only the date, substitute and reason are asked;
 * otherwise pick the class and the lesson first. The substitute and the covered teacher are notified by the API.
 */
export function SubstitutionDialog({ preset, onClose }: { preset?: CoverPreset; onClose: () => void }) {
  const create = useCreateSubstitution();
  const sections = useAllSections();
  const staff = useStaffPicker();
  const [sectionId, setSectionId] = React.useState(preset?.sectionId ?? '');
  const grid = useTimetable(sectionId || null);
  const form = useZodForm(schema, { defaultValues: { slotId: preset?.slotId ?? '', date: preset?.date ?? '', substituteStaffId: '', reason: '' } });
  const [err, setErr] = React.useState<string | null>(null);
  const slotId = form.watch('slotId');

  const lessons = React.useMemo(() => {
    const g = grid.data;
    if (!g) return [];
    const period = new Map(g.periods.map((p) => [p.id, p]));
    return g.slots
      .filter((s) => s.subjectId)
      .map((s) => ({ slot: s, period: period.get(s.periodId) }))
      .sort((a, b) => a.slot.dayOfWeek - b.slot.dayOfWeek || (a.period?.ordinal ?? 0) - (b.period?.ordinal ?? 0));
  }, [grid.data]);
  const chosen = lessons.find((l) => l.slot.id === slotId);

  // picking a lesson proposes the next date it happens
  React.useEffect(() => {
    if (chosen && !form.getValues('date')) form.setValue('date', nextDateOnWeekday(todayIso(), chosen.slot.dayOfWeek), { shouldDirty: true });
  }, [chosen, form]);

  const staffOptions = (staff.data ?? []).filter((s) => s.id !== chosen?.slot.staffId).map((s) => ({ value: s.id, label: s.name }));

  return (
    <ModalForm title="Arrange a cover" description="One lesson, one day. The substitute and the teacher being covered are notified." dirty={hasDirtyFields(form.formState)} onClose={onClose}>
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          setErr(null);
          if (chosen && isoWeekday(v.date) !== chosen.slot.dayOfWeek) {
            form.setError('date', { type: 'validate', message: `This lesson is on ${weekdayName(chosen.slot.dayOfWeek)}s. Pick a ${weekdayName(chosen.slot.dayOfWeek)}.` });
            return;
          }
          if (v.date < todayIso()) {
            form.setError('date', { type: 'validate', message: 'A cover cannot be arranged for a past date.' });
            return;
          }
          try {
            await create.mutateAsync({ ...v, reason: v.reason?.trim() || undefined });
            onClose();
          } catch (e) {
            setErr(applyApiErrors(form, e));
          }
        })}
      >
        {!preset && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="cover-section" className="t-label block">Class</label>
              <SectionSelect id="cover-section" value={sectionId} onChange={(v) => { setSectionId(v); form.setValue('slotId', '', { shouldDirty: true }); }} options={sectionOptions(sections.data)} loading={sections.isPending} />
            </div>
            <FormSelect
              control={form.control}
              name="slotId"
              label="Lesson to cover"
              required
              placeholder={!sectionId ? 'Choose a class first' : grid.isPending ? 'Loading lessons…' : 'Choose a lesson'}
              options={lessons.map((l) => ({ value: l.slot.id, label: `${weekdayName(l.slot.dayOfWeek, true)} · ${l.period?.name ?? ''} · ${l.slot.subjectName}${l.slot.teacherName ? ` (${l.slot.teacherName})` : ''}` }))}
              hint={grid.isError ? 'The timetable of this class could not be loaded.' : undefined}
            />
          </>
        )}
        {preset && chosen && (
          <p className="rounded-lg bg-surface-subtle px-3 py-2 text-sm">
            <span className="font-medium">{chosen.slot.subjectName}</span> · {weekdayName(chosen.slot.dayOfWeek)} {chosen.period ? `· ${chosen.period.name} (${fmtClock(chosen.period.startTime)} – ${fmtClock(chosen.period.endTime)})` : ''}
            {chosen.slot.teacherName && <span className="block text-ink-2">Usually taught by {chosen.slot.teacherName}</span>}
          </p>
        )}
        <FormDate control={form.control} name="date" label="Date" required min={todayIso()} hint={chosen ? `Must be a ${weekdayName(chosen.slot.dayOfWeek)}.` : undefined} />
        <FormSelect control={form.control} name="substituteStaffId" label="Substitute teacher" required options={staffOptions} placeholder={staff.isPending ? 'Loading staff…' : 'Choose a teacher'} hint={staff.isError ? 'The staff list could not be loaded.' : 'They must be free in that period; a clash is refused.'} />
        <FormTextarea control={form.control} name="reason" label="Reason" hint="Optional, shown to the substitute." rows={2} maxLength={300} />
        {chosen && form.watch('date') && <Banner tone="info">{chosen.slot.subjectName} for {sectionOptions(sections.data).find((o) => o.value === sectionId)?.label ?? 'this class'} on {fmtDate(form.watch('date'), { weekday: 'long', day: 'numeric', month: 'long' })}.</Banner>}
        <FormBanner message={err} />
        <DialogButtons onCancel={onClose} submitLabel="Arrange cover" loading={form.formState.isSubmitting || create.isPending} disabled={!!sectionId && lessons.length === 0 && !grid.isPending} disabledHint="This class has no lessons yet" />
      </form>
    </ModalForm>
  );
}

function SectionSelect({ id, value, onChange, options, loading }: { id: string; value: string; onChange: (v: string) => void; options: { value: string; label: React.ReactNode }[]; loading?: boolean }) {
  return <Select id={id} value={value} onValueChange={onChange} options={options} placeholder={loading ? 'Loading classes…' : 'Choose a class'} />;
}

