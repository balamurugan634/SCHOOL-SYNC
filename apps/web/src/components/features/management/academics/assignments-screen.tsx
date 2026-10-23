'use client';

import * as React from 'react';
import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAssignmentMutations, useAssignments, useGradeSubjects, type GradeSubjectOut, type SectionOut, type TeachingAssignmentOut, useAllSections } from '@/lib/client/academics';
import { gradeOptions, sectionLabel, useCurrentYear, useGradeList, useStaffPicker } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { useMediaQuery } from '@/lib/client/use-media-query';
import { cn } from '@/lib/cn';
import { useAccess } from '../shared/access';
import { ErrorPanel } from '../shared/detail';
import { paths } from '../shared/paths';

const NONE = '__none__';

export function AssignmentsScreen() {
  const access = useAccess();
  const wide = useMediaQuery('(min-width: 768px)', true); // mount only the layout that is showing: the grid holds one picker per cell
  const [p, set] = useUrlState({ grade: '', sectionId: '' });
  const year = useCurrentYear();
  const grades = useGradeList();
  const sections = useAllSections();
  const assignments = useAssignments();
  const staff = useStaffPicker({ teachingOnly: true });
  const m = useAssignmentMutations();
  const qc = useQueryClient();

  const linkedSection = sections.data?.find((s) => s.id === p.sectionId);
  const activeGrades = grades.data?.filter((g) => g.isActive) ?? [];
  const gradeId = p.grade || linkedSection?.gradeId || activeGrades[0]?.id || '';
  const offered = useGradeSubjects(gradeId || null);
  const rows = (sections.data ?? []).filter((s) => s.gradeId === gradeId);

  // value shown while a change is being saved (so the cell does not flick back before the list refetches)
  const [busy, setBusy] = React.useState<Map<string, string>>(new Map());
  const [removing, setRemoving] = React.useState<TeachingAssignmentOut | null>(null);
  const markBusy = (key: string, value: string | null) => setBusy((b) => { const n = new Map(b); if (value) n.set(key, value); else n.delete(key); return n; });

  const byCell = React.useMemo(() => new Map((assignments.data ?? []).map((a) => [`${a.sectionId}|${a.subjectId}`, a])), [assignments.data]);
  const load = React.useMemo(() => {
    const c = new Map<string, number>();
    for (const a of assignments.data ?? []) c.set(a.staffId, (c.get(a.staffId) ?? 0) + 1);
    return c;
  }, [assignments.data]);

  const subjects = React.useMemo(() => [...(offered.data ?? [])].sort((a, b) => a.subjectName.localeCompare(b.subjectName)), [offered.data]);
  const total = rows.length * subjects.length;
  const filled = rows.reduce((n, s) => n + subjects.filter((sub) => byCell.has(`${s.id}|${sub.subjectId}`)).length, 0);
  const canEdit = access.ok('academics:edit');

  const baseOptions: SelectOption[] = React.useMemo(() => (staff.data ?? []).map((t) => ({ value: t.id, label: `${t.name}${load.get(t.id) ? ` · ${load.get(t.id)} ${load.get(t.id) === 1 ? 'class' : 'classes'}` : ''}` })), [staff.data, load]);

  const change = async (section: SectionOut, sub: GradeSubjectOut, value: string) => {
    const key = `${section.id}|${sub.subjectId}`;
    const existing = byCell.get(key);
    if (value === NONE) {
      if (existing) setRemoving(existing);
      return;
    }
    if (existing?.staffId === value) return;
    markBusy(key, value);
    try {
      const r = existing ? await m.update.run({ id: existing.id, staffId: value }) : await m.create.run({ sectionId: section.id, subjectId: sub.subjectId, staffId: value });
      if (r.ok) await qc.refetchQueries({ queryKey: ['academics', 'assignments'] });
    } finally {
      markBusy(key, null);
    }
  };

  const optionsFor = (a: TeachingAssignmentOut | undefined): SelectOption[] => {
    const opts = [{ value: NONE, label: a ? 'Remove teacher' : 'Not assigned' }, ...baseOptions];
    // the current teacher stays visible even if the picker list does not contain them (e.g. non-teaching staff)
    if (a && !opts.some((o) => o.value === a.staffId)) opts.splice(1, 0, { value: a.staffId, label: a.staffName });
    return opts;
  };

  const renderCell = (section: SectionOut, sub: GradeSubjectOut) => {
    const key = `${section.id}|${sub.subjectId}`;
    const a = byCell.get(key);
    return (
      <Select
        aria-label={`${sub.subjectName} teacher for ${sectionLabel(section)}`}
        className={cn('min-w-[15.5rem]', !a && 'border-dashed border-warning/60 text-ink-2')}
        value={busy.get(key) ?? a?.staffId ?? NONE}
        onValueChange={(v) => void change(section, sub, v)}
        options={optionsFor(a)}
        disabled={!canEdit || busy.has(key) || staff.isPending}
        placeholder="Not assigned"
      />
    );
  };

  const loading = grades.isPending || sections.isPending || assignments.isPending;
  const error = grades.error ?? sections.error ?? assignments.error ?? offered.error;

  return (
    <>
      <PageHeader
        title="Teaching assignments"
        description={`Who teaches which subject in each section${year.current ? ` for ${year.current.name}` : ''}. Pick a teacher in a cell to save it straight away.`}
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Academics' }, { label: 'Teaching assignments' }]}
      />

      {error ? (
        <ErrorPanel error={error} onRetry={() => { void grades.refetch(); void sections.refetch(); void assignments.refetch(); void offered.refetch(); }} />
      ) : loading ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : activeGrades.length === 0 || (sections.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState illustration="first-use" title="Set up classes first" description="Assignments connect teachers to subjects in each section, so the school needs grades and sections first." action={<Button asChild size="sm"><Link href={paths.classes}>Go to classes and sections</Link></Button>} compact />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="w-full sm:w-64">
              <label htmlFor="asg-grade" className="t-label mb-1.5 block">Grade</label>
              <Select id="asg-grade" value={gradeId} onValueChange={(g) => set({ grade: g, sectionId: '' })} options={gradeOptions(activeGrades)} />
            </div>
            {offered.isSuccess && total > 0 && (
              <div className="w-full sm:w-72" aria-live="polite">
                <p className="t-caption mb-1.5 text-ink-2"><span className="font-medium text-ink">{filled}</span> of {total} subject slots have a teacher{total - filled > 0 ? ` · ${total - filled} to go` : ''}</p>
                <ProgressBar value={filled} max={total} tone={filled === total ? 'success' : 'brand'} label="Subject slots with a teacher" />
              </div>
            )}
          </div>

          {staff.isError && <Banner tone="warning">The staff list could not be loaded, so teachers cannot be changed right now. {staff.error instanceof Error ? staff.error.message : ''}</Banner>}

          {offered.isPending ? (
            <Skeleton className="h-72 w-full rounded-lg" />
          ) : subjects.length === 0 ? (
            <Card>
              <EmptyState icon={<CircleAlert />} title="This grade offers no subjects yet" description="Choose the subjects (and periods per week) for the grade first. Then you can assign teachers here." action={<Button asChild size="sm"><Link href={`/admin/academics/subjects?tab=offerings&grade=${gradeId}`}>Set grade offerings</Link></Button>} compact />
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState icon={<CircleAlert />} title="No sections in this grade" description="Add sections to this grade in the current year, then come back to assign teachers." action={<Button asChild size="sm"><Link href={paths.classes}>Go to classes and sections</Link></Button>} compact />
            </Card>
          ) : (
            <>
              {/* tablet / desktop: the matrix scrolls inside its own container, first column stays put */}
              {wide && <Card className="hidden md:block">
                <div className="overflow-x-auto rounded-lg" tabIndex={0} role="region" aria-label="Teaching assignments matrix">
                  <table className="t-table w-full border-separate border-spacing-0">
                    <caption className="sr-only">Teacher for each subject in each section of the selected grade</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="t-colhead sticky left-0 z-[2] h-11 min-w-32 border-b border-border bg-surface-subtle px-4 text-left text-ink-2">Section</th>
                        {subjects.map((s) => (
                          <th key={s.subjectId} scope="col" className="t-colhead h-11 whitespace-nowrap border-b border-border bg-surface-subtle px-3 text-left text-ink-2">
                            {s.subjectName}
                            <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-3">{s.periodsPerWeek}/wk</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((sec) => (
                        <tr key={sec.id} className={cn(sec.id === p.sectionId && 'bg-brand-soft')}>
                          <th scope="row" className="sticky left-0 z-[1] border-b border-border bg-surface px-4 py-2 text-left text-sm font-medium">
                            {sectionLabel(sec)}
                            <span className="t-caption block font-normal text-ink-2">{sec.classTeacherName ? `Class teacher: ${sec.classTeacherName}` : 'No class teacher'}</span>
                          </th>
                          {subjects.map((sub) => (
                            <td key={sub.subjectId} className="border-b border-border px-3 py-2 align-middle">{renderCell(sec, sub)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>}

              {/* phone: one card per section */}
              {!wide && <ul className="space-y-3 md:hidden" aria-label="Sections">
                {rows.map((sec) => (
                  <li key={sec.id}>
                    <Card className={cn(sec.id === p.sectionId && 'border-brand')}>
                      <CardBody className="space-y-3">
                        <div>
                          <h2 className="t-section">{sectionLabel(sec)}</h2>
                          <p className="t-caption text-ink-2">{sec.classTeacherName ? `Class teacher: ${sec.classTeacherName}` : 'No class teacher'}</p>
                        </div>
                        <div className="space-y-3">
                          {subjects.map((sub) => (
                            <div key={sub.subjectId} className="space-y-1">
                              <p className="t-label">{sub.subjectName} <span className="font-normal text-ink-3">{sub.periodsPerWeek}/wk</span></p>
                              {renderCell(sec, sub)}
                            </div>
                          ))}
                        </div>
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Remove ${removing.staffName} from ${removing.subjectName}?` : ''}
        description={
          removing && (
            <div className="space-y-2">
              <p>{removing.staffName} will no longer be the {removing.subjectName} teacher of {removing.gradeName} {removing.sectionName}. They lose access to that class for marks and homework unless they teach another subject in it.</p>
              <p>Lessons already on the timetable keep their teacher until you change them there.</p>
            </div>
          )
        }
        confirmLabel="Remove teacher"
        destructive
        loading={m.remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          const r = await m.remove.run(removing.id);
          if (r.ok) setRemoving(null);
        }}
      />
    </>
  );
}
