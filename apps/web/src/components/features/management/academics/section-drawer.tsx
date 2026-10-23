'use client';

import * as React from 'react';
import Link from 'next/link';
import { Clock, ListChecks, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useSectionDetail, useSectionMutations, type SectionOut } from '@/lib/client/academics';
import { useStaffPicker } from '@/lib/client/options';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useAccess } from '../shared/access';
import { ErrorPanel } from '../shared/detail';
import { paths } from '../shared/paths';
import { FormNumber } from './fields';
import { DrawerForm, FormBanner } from './form-shell';
import { sectionUpdateSchema } from './schemas';

const NONE = '__none__';

/** Detail + edit drawer of one section: name / room / capacity, the class teacher, and the subject teachers. */
export function SectionDrawer({ section, onClose }: { section: SectionOut; onClose: () => void }) {
  const access = useAccess();
  const m = useSectionMutations();
  const detail = useSectionDetail(section.id);
  const staff = useStaffPicker();
  const form = useZodForm(sectionUpdateSchema, { defaultValues: { name: section.name, room: section.room ?? '', capacity: section.capacity ?? undefined } });
  const [err, setErr] = React.useState<string | null>(null);
  const [teacher, setTeacher] = React.useState<string>(section.classTeacherId ?? NONE);
  const [teacherErr, setTeacherErr] = React.useState<string | null>(null);
  const teacherDirty = teacher !== (section.classTeacherId ?? NONE);
  const canEdit = access.ok('academics:edit');

  const teacherOptions = React.useMemo(() => {
    const opts = (staff.data ?? []).map((s) => ({ value: s.id, label: `${s.name}${s.designation ? ` · ${s.designation}` : ''}` }));
    // keep the current class teacher selectable even when the staff list could not include them (inactive, or the list failed)
    if (section.classTeacherId && !opts.some((o) => o.value === section.classTeacherId)) opts.unshift({ value: section.classTeacherId, label: section.classTeacherName ?? 'Current class teacher' });
    return [{ value: NONE, label: 'No class teacher' }, ...opts];
  }, [staff.data, section.classTeacherId, section.classTeacherName]);

  const title = `${section.gradeName} ${section.name}`;
  return (
    <DrawerForm title={title} description={`${section.academicYearName} · ${section.studentCount} ${section.studentCount === 1 ? 'student' : 'students'}${section.capacity ? ` of ${section.capacity} seats` : ''}`} dirty={hasDirtyFields(form.formState) || teacherDirty} onClose={onClose}>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" asChild>
          <Link href={paths.students({ sectionId: section.id })}>
            <UsersRound /> Students
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href={paths.timetable(section.id)}>
            <Clock /> Timetable
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href={paths.assignments(section.id)}>
            <ListChecks /> Subject teachers
          </Link>
        </Button>
      </div>

      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          setErr(null);
          try {
            const saved = await m.update.mutateAsync({ id: section.id, body: { name: v.name, room: v.room || null, capacity: v.capacity ?? null } });
            form.reset({ name: saved.name, room: saved.room ?? '', capacity: saved.capacity ?? undefined });
          } catch (e) {
            setErr(applyApiErrors(form, e));
          }
        })}
      >
        <h3 className="t-section">Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <FormInput control={form.control} name="name" label="Section name" required disabled={!canEdit} />
          <FormInput control={form.control} name="room" label="Room" disabled={!canEdit} />
        </div>
        <FormNumber control={form.control} name="capacity" label="Capacity" min={1} max={500} hint={`${section.studentCount} enrolled now. Capacity cannot go below that.`} />
        <FormBanner message={err} />
        <div className="flex justify-end">
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!canEdit || !hasDirtyFields(form.formState)} title={access.hint('academics:edit')}>
            Save details
          </Button>
        </div>
      </form>

      <section className="space-y-3 border-t border-border pt-5" aria-labelledby="ct-heading">
        <h3 id="ct-heading" className="t-section">Class teacher</h3>
        <Field label="Teacher" htmlFor="ct-select" hint="Leads the section: marks attendance, writes report-card remarks and decides leave. Gets the Class teacher role automatically.">
          <Select id="ct-select" value={teacher} onValueChange={(v) => { setTeacher(v); setTeacherErr(null); }} options={teacherOptions} disabled={!canEdit} />
        </Field>
        {staff.isError && <Banner tone="info">The staff list could not be loaded, so only the current class teacher can be chosen.</Banner>}
        <FormBanner message={teacherErr} />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            loading={m.classTeacher.isPending}
            disabled={!canEdit || !teacherDirty}
            title={access.hint('academics:edit')}
            onClick={async () => {
              setTeacherErr(null);
              try {
                await m.classTeacher.mutateAsync({ id: section.id, body: { staffId: teacher === NONE ? null : teacher } });
              } catch (e) {
                setTeacherErr(e instanceof Error ? e.message : 'Could not change the class teacher.');
              }
            }}
          >
            {teacher === NONE ? 'Remove class teacher' : 'Assign class teacher'}
          </Button>
        </div>
      </section>

      <section className="space-y-3 border-t border-border pt-5" aria-labelledby="st-heading">
        <h3 id="st-heading" className="t-section">Subject teachers</h3>
        {detail.isPending ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : detail.isError ? (
          <ErrorPanel error={detail.error} onRetry={() => void detail.refetch()} title="We couldn’t load the subject teachers" />
        ) : detail.data.teachingAssignments.length === 0 ? (
          <p className="text-sm text-ink-2">No subject teachers assigned yet. Use the Teaching assignments screen to add them.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {detail.data.teachingAssignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant="neutral">{a.subjectCode}</Badge>
                  {a.subjectName}
                </span>
                <span className="text-ink-2">{a.staffName}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DrawerForm>
  );
}
