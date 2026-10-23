'use client';

import * as React from 'react';
import { CalendarClock, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { timetableSlotInput } from '@school-sync/shared';
import type { StaffListItem, TimetablePeriod } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { FormInput, FormSelect } from '@/components/ui/form';
import { ApiError } from '@/lib/problem';
import type { GradeSubjectOut } from '@/lib/client/academics';
import { useClearSlot, useSetSlot } from '@/lib/client/timetable';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { fmtClock } from '@/lib/format';
import { weekdayName } from '@/lib/client/options';
import { FormBanner, ModalForm } from './form-shell';
import type { CellLesson } from './timetable-helpers';

const DEFAULT_TEACHER = '__assigned__';

const schema = timetableSlotInput.pick({ room: true }).extend({ subjectId: z.uuid('Choose a subject'), staffId: z.string() });

export interface SlotDialogProps {
  mode: 'live' | 'draft';
  section: { id: string; label: string };
  day: number;
  period: TimetablePeriod;
  lesson?: CellLesson;
  subjects: GradeSubjectOut[];
  /** subjectId → the teacher assigned to it in this section */
  assigned: Map<string, { staffId: string; staffName: string }>;
  staff: StaffListItem[];
  onClose: () => void;
  /** draft mode: apply the lesson (or null = clear) to the draft instead of calling the API */
  onDraft?: (lesson: CellLesson | null) => void;
  /** live mode: open the cover dialog for this lesson */
  onCover?: (lesson: CellLesson) => void;
}

/** Set / change / clear one lesson. Clash and "teacher not assigned" answers from the API stay inline with a clear next step. */
export function SlotDialog({ mode, section, day, period, lesson, subjects, assigned, staff, onClose, onDraft, onCover }: SlotDialogProps) {
  const setSlot = useSetSlot();
  const clearSlot = useClearSlot();
  const form = useZodForm(schema, { defaultValues: { subjectId: lesson?.subjectId ?? '', staffId: lesson?.staffId ?? DEFAULT_TEACHER, room: lesson?.room ?? '' } });
  const [err, setErr] = React.useState<ApiError | string | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const subjectId = form.watch('subjectId');
  const assignee = subjectId ? assigned.get(subjectId) : undefined;

  const teacherOptions = React.useMemo(() => {
    const opts = [{ value: DEFAULT_TEACHER, label: assignee ? `Assigned teacher (${assignee.staffName})` : 'Assigned teacher (none yet)' }, ...staff.map((s) => ({ value: s.id, label: s.name }))];
    if (lesson?.staffId && !opts.some((o) => o.value === lesson.staffId)) opts.push({ value: lesson.staffId, label: lesson.teacherName ?? 'Current teacher' });
    return opts;
  }, [staff, assignee, lesson]);

  const persist = async (v: z.output<typeof schema>, allowUnassigned: boolean) => {
    setErr(null);
    const staffId = v.staffId === DEFAULT_TEACHER ? null : v.staffId;
    const room = v.room?.trim() ? v.room.trim() : null;
    if (mode === 'draft') {
      const subj = subjects.find((s) => s.subjectId === v.subjectId);
      const teacher = staffId ? staff.find((s) => s.id === staffId)?.name ?? lesson?.teacherName ?? null : null;
      onDraft?.({ dayOfWeek: day, periodId: period.id, subjectId: v.subjectId, subjectName: subj?.subjectName ?? null, subjectCode: subj?.subjectCode ?? null, staffId, teacherName: teacher, room });
      onClose();
      return;
    }
    try {
      const saved = await setSlot.mutateAsync({ sectionId: section.id, dayOfWeek: day, periodId: period.id, subjectId: v.subjectId, staffId, room, allowUnassigned });
      if (saved.warnings?.includes('TEACHER_NOT_ASSIGNED')) {
        toast.message('Saved, but this teacher is not assigned to the subject in this section.', { duration: 8000 });
      }
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR') setErr(applyApiErrors(form, e));
      else setErr(e instanceof ApiError ? e : e instanceof Error ? e.message : 'Could not save the lesson.');
    }
  };

  const unassigned = err instanceof ApiError && err.code === 'TEACHER_NOT_ASSIGNED';
  const clash = err instanceof ApiError && err.code === 'TEACHER_CLASH';

  return (
    <ModalForm title={`${lesson ? 'Edit' : 'Add'} lesson · ${section.label}`} description={`${weekdayName(day)}, ${period.name} (${fmtClock(period.startTime)} – ${fmtClock(period.endTime)})${mode === 'draft' ? ' · changes apply when you save the whole timetable' : ''}`} dirty={hasDirtyFields(form.formState)} onClose={onClose}>
      <form className="mt-4 space-y-4" noValidate onSubmit={form.handleSubmit((v) => persist(v, false))}>
        <FormSelect control={form.control} name="subjectId" label="Subject" required options={subjects.map((s) => ({ value: s.subjectId, label: `${s.subjectName} (${s.periodsPerWeek}/wk)` }))} placeholder={subjects.length ? 'Choose a subject' : 'No subjects offered'} hint={subjects.length === 0 ? 'This grade offers no subjects yet. Set them under Subjects → Grade offerings.' : 'Only subjects the grade offers can be scheduled.'} />
        <FormSelect control={form.control} name="staffId" label="Teacher" options={teacherOptions} hint="The assigned teacher is used unless you pick someone else. A teacher cannot be in two classes in the same period." />
        <FormInput control={form.control} name="room" label="Room" hint="Optional, for example Lab 2." />

        {unassigned && (
          <Banner tone="warning" title="Teacher not assigned to this subject">
            <p>{err.message}</p>
            <p className="mt-1">Assign them under Teaching assignments, or save the lesson anyway and it will be flagged.</p>
            <Button type="button" size="sm" variant="secondary" className="mt-2" loading={setSlot.isPending} onClick={form.handleSubmit((v) => persist(v, true))}>
              Save anyway
            </Button>
          </Banner>
        )}
        {clash && (
          <Banner tone="danger" title="Teacher clash" role="alert">
            {err.message}
          </Banner>
        )}
        {!unassigned && !clash && <FormBanner message={err instanceof ApiError ? err.message : err} />}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex gap-2">
            {lesson && (
              <Button type="button" variant="danger" onClick={() => setConfirmClear(true)} loading={clearSlot.isPending}>
                <Trash2 /> Clear lesson
              </Button>
            )}
            {mode === 'live' && lesson?.id && onCover && (
              <Button type="button" variant="secondary" onClick={() => onCover(lesson)}>
                <CalendarClock /> Arrange cover
              </Button>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting || setSlot.isPending} disabled={subjects.length === 0}>
              Save lesson
            </Button>
          </div>
        </div>
        {confirmClear && (
          <Banner tone="warning" title="Clear this lesson?" role="alert">
            <p>{mode === 'draft' ? 'The cell becomes empty in the draft.' : `${lesson?.subjectName ?? 'The lesson'} is removed from ${section.label} on ${weekdayName(day)}. Covers arranged for it are removed too.`}</p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="danger-solid"
                loading={clearSlot.isPending}
                onClick={async () => {
                  if (mode === 'draft') {
                    onDraft?.(null);
                    onClose();
                    return;
                  }
                  if (!lesson?.id) return;
                  const r = await clearSlot.run(lesson.id);
                  if (r.ok) onClose();
                }}
              >
                Yes, clear it
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmClear(false)}>
                Keep it
              </Button>
            </div>
          </Banner>
        )}
      </form>
    </ModalForm>
  );
}
