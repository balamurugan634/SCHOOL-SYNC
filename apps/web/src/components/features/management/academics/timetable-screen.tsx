'use client';

import * as React from 'react';
import Link from 'next/link';
import { Pencil, Plus, Save, Undo2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { TimetableGridResponse } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { acad, useAllSections, useGradeSubjects, useSectionDetail, type AcademicYearOut } from '@/lib/client/academics';
import { sectionLabel, sectionOptions, useStaffPicker, weekdayName, useYearList, yearOptions } from '@/lib/client/options';
import { useReplaceTimetable, useTimetable, TimetableError, type SlotInputDraft } from '@/lib/client/timetable';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { useUrlState } from '@/lib/client/url-state';
import { cn } from '@/lib/cn';
import { fmtClock, fmtDate, todayIso } from '@/lib/format';
import { ApiError, errorMessage } from '@/lib/problem';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAccess } from '../shared/access';
import { ErrorPanel } from '../shared/detail';
import { paths } from '../shared/paths';
import { CoversPanel } from './covers-panel';
import { SubstitutionDialog, type CoverPreset } from './substitution-dialog';
import { SlotDialog } from './timetable-slot-dialog';
import { isoWeekday, mondayOf, nextDateOnWeekday, shiftDays, slotKey, type CellLesson } from './timetable-helpers';

export function TimetableScreen() {
  const [p, set] = useUrlState({ tab: 'grid', sectionId: '', week: '', year: '' });
  const sections = useAllSections({ yearId: p.year || undefined });
  const years = useYearList();
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Discard the unsaved timetable?', description: 'You have lessons changed in the whole-timetable editor that are not saved yet. If you leave now they will be lost.', confirmLabel: 'Discard changes' });
  const tab = p.tab === 'covers' ? 'covers' : 'grid';
  const sectionId = p.sectionId && sections.data?.some((s) => s.id === p.sectionId) ? p.sectionId : (sections.data?.[0]?.id ?? '');

  return (
    <>
      <PageHeader title="Timetable" description="Build each section’s weekly timetable. Clashes are checked as you save, and covers handle a teacher’s absence for a day." crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Academics' }, { label: 'Timetable' }]} />
      <Tabs value={tab} onValueChange={(t) => guard(() => set({ tab: t }))}>
        <TabsList aria-label="Timetable">
          <TabsTrigger value="grid">Weekly timetable</TabsTrigger>
          <TabsTrigger value="covers">Covers</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-5">
        {tab === 'covers' ? (
          <CoversPanel />
        ) : sections.isPending ? (
          <Skeleton className="h-96 w-full rounded-lg" />
        ) : sections.isError ? (
          <ErrorPanel error={sections.error} onRetry={() => void sections.refetch()} />
        ) : sections.data.length === 0 ? (
          <Card>
            <EmptyState illustration="first-use" title="No sections to schedule yet" description="Add grades and sections for the current year first, then build their timetables here." action={<Button asChild size="sm"><Link href={paths.classes}>Go to classes and sections</Link></Button>} compact />
          </Card>
        ) : (
          <GridEditor
            key={sectionId}
            sectionId={sectionId}
            week={p.week}
            yearId={p.year}
            years={years.data ?? []}
            onYear={(y) => guard(() => set({ year: y, sectionId: '' }))}
            onSection={(id) => guard(() => set({ sectionId: id }))}
            onWeek={(w) => set({ week: w })}
            onDirty={setDirty}
          />
        )}
      </div>
      {dialog}
    </>
  );
}

type Draft = Record<string, CellLesson>;

function GridEditor({ sectionId, week, yearId, years, onYear, onSection, onWeek, onDirty }: { sectionId: string; week: string; yearId: string; years: AcademicYearOut[]; onYear: (id: string) => void; onSection: (id: string) => void; onWeek: (w: string) => void; onDirty: (d: boolean) => void }) {
  const access = useAccess();
  const qc = useQueryClient();
  const sections = useAllSections({ yearId: yearId || undefined });
  const today = todayIso();
  const monday = mondayOf(week || today);
  const grid = useTimetable(sectionId, monday);
  const detail = useSectionDetail(sectionId);
  const offered = useGradeSubjects(grid.data?.section.gradeId ?? null);
  const staff = useStaffPicker();
  const replace = useReplaceTimetable();
  const canEdit = access.ok('timetable:edit') && access.ok('timetable:create');

  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [cell, setCell] = React.useState<{ day: number; periodId: string } | null>(null);
  const [cover, setCover] = React.useState<CoverPreset | null>(null);
  const [day, setDay] = React.useState<number | null>(null);
  const [saveErr, setSaveErr] = React.useState<ApiError | string | null>(null);
  const [clashKey, setClashKey] = React.useState<string | null>(null);
  const [copyFrom, setCopyFrom] = React.useState('');
  const [confirmClear, setConfirmClear] = React.useState(false);

  const g = grid.data;
  const assigned = React.useMemo(() => new Map((detail.data?.teachingAssignments ?? []).map((a) => [a.subjectId, { staffId: a.staffId, staffName: a.staffName }])), [detail.data]);
  const periods = React.useMemo(() => [...(g?.periods ?? [])].sort((a, b) => a.ordinal - b.ordinal), [g]);
  const days = g?.workingDays ?? [];
  const activeDay = day && days.includes(day) ? day : (days.includes(isoWeekday(today)) ? isoWeekday(today) : days[0]) ?? 1;

  const serverMap: Draft = React.useMemo(() => {
    const m: Draft = {};
    for (const s of g?.slots ?? []) m[slotKey(s.dayOfWeek, s.periodId)] = { id: s.id, dayOfWeek: s.dayOfWeek, periodId: s.periodId, subjectId: s.subjectId, subjectName: s.subjectName, subjectCode: s.subjectCode, staffId: s.staffId, teacherName: s.teacherName, room: s.room };
    return m;
  }, [g]);
  const shown = draft ?? serverMap;

  const sig = (m: Draft) => Object.entries(m).filter(([, l]) => l.subjectId).map(([k, l]) => `${k}:${l.subjectId}:${l.staffId ?? ''}:${l.room ?? ''}`).sort().join('|');
  const dirty = draft !== null && sig(draft) !== sig(serverMap);
  React.useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const covers = React.useMemo(() => {
    const m = new Map<string, NonNullable<TimetableGridResponse['substitutions']>>();
    for (const s of g?.substitutions ?? []) m.set(s.slotId, [...(m.get(s.slotId) ?? []), s]);
    return m;
  }, [g]);

  const lessonsBySubject = React.useMemo(() => {
    const c = new Map<string, number>();
    for (const l of Object.values(shown)) if (l.subjectId) c.set(l.subjectId, (c.get(l.subjectId) ?? 0) + 1);
    return c;
  }, [shown]);

  const sectionRow = sections.data?.find((s) => s.id === sectionId);
  const label = g ? `${g.section.gradeName} ${g.section.name}` : sectionRow ? sectionLabel(sectionRow) : '';
  const lessonCount = Object.values(shown).filter((l) => l.subjectId).length;
  const slotCapacity = periods.filter((x) => !x.isBreak).length * days.length;

  const startDraft = () => {
    setSaveErr(null);
    setClashKey(null);
    setDraft({ ...serverMap });
  };
  const discard = () => {
    setDraft(null);
    setSaveErr(null);
    setClashKey(null);
  };

  const save = async (allowUnassigned: boolean) => {
    if (!draft) return;
    setSaveErr(null);
    setClashKey(null);
    const slots: SlotInputDraft[] = Object.values(draft)
      .filter((l) => l.subjectId)
      .map((l) => ({ dayOfWeek: l.dayOfWeek, periodId: l.periodId, subjectId: l.subjectId!, staffId: l.staffId, room: l.room }));
    try {
      await replace.mutateAsync({ sectionId, slots, allowUnassigned });
      setDraft(null);
      await qc.refetchQueries({ queryKey: ['timetable', 'section', sectionId] });
      toast.success(`Timetable of ${label} saved`);
    } catch (e) {
      if (e instanceof TimetableError && e.clash?.dayOfWeek && e.clash.periodId) setClashKey(slotKey(e.clash.dayOfWeek, e.clash.periodId));
      setSaveErr(e instanceof ApiError ? e : errorMessage(e));
    }
  };

  const copyLessons = async () => {
    if (!copyFrom || !g) return;
    try {
      const src = await acad<TimetableGridResponse>(`/timetable/sections/${copyFrom}`);
      const offeredIds = new Set((offered.data ?? []).map((o) => o.subjectId));
      const periodIds = new Set(periods.filter((x) => !x.isBreak).map((x) => x.id));
      const next: Draft = {};
      for (const s of src.slots) {
        if (!s.subjectId || !offeredIds.has(s.subjectId) || !periodIds.has(s.periodId) || !days.includes(s.dayOfWeek)) continue;
        next[slotKey(s.dayOfWeek, s.periodId)] = { dayOfWeek: s.dayOfWeek, periodId: s.periodId, subjectId: s.subjectId, subjectName: s.subjectName, subjectCode: s.subjectCode, staffId: null, teacherName: assigned.get(s.subjectId)?.staffName ?? null, room: null };
      }
      setDraft(next);
      setSaveErr(null);
      setClashKey(null);
      toast.message(`Copied ${Object.keys(next).length} lessons. Teachers are the ones assigned to this section. Review, then save.`, { duration: 7000 });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const applyDraft = (c: { day: number; periodId: string }, lesson: CellLesson | null) =>
    setDraft((d) => {
      const next = { ...(d ?? serverMap) };
      if (lesson) next[slotKey(c.day, c.periodId)] = lesson;
      else delete next[slotKey(c.day, c.periodId)];
      return next;
    });

  if (grid.isError) return <ErrorPanel error={grid.error} onRetry={() => void grid.refetch()} title="We couldn’t load this timetable" />;

  const currentYearId = years.find((y) => y.isCurrent)?.id ?? '';
  const sectionSelect = (
    <>
      {years.length > 1 && (
        <div className="w-full sm:w-44">
          <label htmlFor="tt-year" className="t-label mb-1.5 block">Academic year</label>
          <Select id="tt-year" value={yearId || currentYearId} onValueChange={onYear} options={yearOptions(years)} />
        </div>
      )}
      <div className="w-full sm:w-56">
        <label htmlFor="tt-section" className="t-label mb-1.5 block">Class</label>
      <Select id="tt-section" value={sectionId} onValueChange={onSection} options={sectionOptions(sections.data)} />
      </div>
    </>
  );
  const periodLabel = (id: string) => periods.find((x) => x.id === id)?.name ?? '';
  const weekEnd = shiftDays(monday, 6);
  const editingCell = cell ? periods.find((x) => x.id === cell.periodId) : undefined;
  const sameGrade = (sections.data ?? []).filter((s) => s.gradeId === g?.section.gradeId && s.id !== sectionId);

  const renderLesson = (d: number, periodId: string, mobile = false) => {
    const key = slotKey(d, periodId);
    const l = shown[key];
    const subj = l?.subjectId ? l : null;
    const teacher = subj ? (subj.teacherName ?? (subj.subjectId ? assigned.get(subj.subjectId)?.staffName : null) ?? null) : null;
    const notAssigned = !!subj && !!subj.staffId && !!subj.subjectId && assigned.get(subj.subjectId)?.staffId !== subj.staffId;
    const cellCovers = subj?.id && !draft ? (covers.get(subj.id) ?? []) : [];
    const clash = clashKey === key;
    const body = subj ? (
      <span className="block min-w-0 space-y-0.5">
        <span className="block truncate text-sm font-medium">{subj.subjectName}</span>
        <span className="t-caption block truncate text-ink-2">{teacher ?? 'No teacher yet'}{subj.room ? ` · ${subj.room}` : ''}</span>
        {(notAssigned || cellCovers.length > 0 || (!!draft && !teacher)) && (
          <span className="flex flex-wrap gap-1 pt-0.5">
            {notAssigned && <Badge variant="warning">Not the assigned teacher</Badge>}
            {!teacher && !!draft && <Badge variant="warning">No teacher</Badge>}
            {cellCovers.map((c) => <Badge key={c.id} variant="accent">Cover {fmtDate(c.date, { weekday: 'short' })}: {c.substituteTeacherName.split(' ')[0]}</Badge>)}
          </span>
        )}
      </span>
    ) : (
      <span className={cn('block text-sm', canEdit ? 'text-ink-3' : 'text-ink-disabled')}>{canEdit ? <span className="inline-flex items-center gap-1"><Plus className="size-3.5" aria-hidden /> Add lesson</span> : '—'}</span>
    );
    const cls = cn('block w-full min-h-[60px] rounded-md px-2.5 py-2 text-left', subj ? 'bg-brand-soft/60' : canEdit ? 'border border-dashed border-border-strong' : '', clash && 'ring-2 ring-danger', mobile && 'min-h-[56px]');
    return canEdit ? (
      <button type="button" className={cn(cls, 'tr-colors hover:bg-brand-soft')} onClick={() => setCell({ day: d, periodId })} aria-label={`${weekdayName(d)} ${periodLabel(periodId)}: ${subj ? `${subj.subjectName}, ${teacher ?? 'no teacher'}. Edit` : 'empty. Add a lesson'}`}>
        {body}
      </button>
    ) : (
      <div className={cls}>{body}</div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {sectionSelect}
          <div>
            <p className="t-label mb-1.5" id="tt-week-label">Week</p>
            <div className="flex items-center gap-1" role="group" aria-labelledby="tt-week-label">
              <IconButton label="Previous week" variant="secondary" onClick={() => onWeek(shiftDays(monday, -7))}><ChevronLeft /></IconButton>
              <span className="tnum min-w-36 text-center text-sm">{fmtDate(monday, { day: 'numeric', month: 'short' })} – {fmtDate(weekEnd, { day: 'numeric', month: 'short' })}</span>
              <IconButton label="Next week" variant="secondary" onClick={() => onWeek(shiftDays(monday, 7))}><ChevronRight /></IconButton>
              <Button variant="ghost" size="sm" onClick={() => onWeek('')} disabled={monday === mondayOf(today)}>This week</Button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draft ? (
            <>
              {sameGrade.length > 0 && (
                <>
                  <Select aria-label="Copy lessons from another section" className="w-44" value={copyFrom} onValueChange={setCopyFrom} options={sectionOptions(sameGrade)} placeholder="Copy from…" />
                  <Button variant="secondary" size="sm" disabled={!copyFrom} onClick={() => void copyLessons()}>Copy</Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} disabled={lessonCount === 0}>Clear all</Button>
              <Button variant="secondary" onClick={discard}><Undo2 /> Discard</Button>
              <Button onClick={() => void save(false)} loading={replace.isPending} disabled={!dirty}><Save /> Save timetable</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={startDraft} disabled={!canEdit || grid.isPending || periods.length === 0} title={access.hint('timetable:edit') ?? 'Edit every lesson of the week, then save them together'}>
              <Pencil /> Edit whole timetable
            </Button>
          )}
        </div>
      </div>

      {draft && (
        <Banner tone="info" title="Editing the whole timetable">
          Changes stay here until you press Save timetable, which replaces the section’s timetable in one step. Lessons you remove also remove their covers.
        </Banner>
      )}
      {saveErr && (
        saveErr instanceof ApiError && saveErr.code === 'TEACHER_NOT_ASSIGNED' ? (
          <Banner tone="warning" title="Some teachers are not assigned to their subject in this section" action={<Button size="sm" variant="secondary" loading={replace.isPending} onClick={() => void save(true)}>Save anyway</Button>}>
            {saveErr.message} Assign them under Teaching assignments, or save anyway and the lessons are flagged.
          </Banner>
        ) : (
          <Banner tone="danger" title={saveErr instanceof ApiError && saveErr.code === 'TEACHER_CLASH' ? 'Teacher clash' : 'The timetable was not saved'} role="alert">
            {saveErr instanceof ApiError ? saveErr.message : saveErr}
            {clashKey && <span className="mt-1 block">The clashing lesson is outlined in the grid.</span>}
          </Banner>
        )
      )}

      {grid.isPending || detail.isPending ? (
        <Skeleton className="h-[28rem] w-full rounded-lg" />
      ) : periods.length === 0 ? (
        <Card>
          <EmptyState illustration="empty-generic" title="Define the school-day periods first" description="The timetable is days by periods. Add the periods (and breaks) of the school day, then build the grid." action={<Button asChild size="sm"><Link href={paths.periods}>Set up periods</Link></Button>} compact />
        </Card>
      ) : days.length === 0 ? (
        <Card>
          <EmptyState title="No working days set" description="Choose the school’s working days in School settings, then come back." action={<Button asChild size="sm" variant="secondary"><Link href={paths.school('academic')}>Open school settings</Link></Button>} compact />
        </Card>
      ) : (
        <>
          <Card className="hidden md:block">
            <div className="overflow-x-auto rounded-lg" tabIndex={0} role="region" aria-label={`Weekly timetable of ${label}`}>
              <table className="t-table w-full min-w-[720px] border-separate border-spacing-0 table-fixed">
                <caption className="sr-only">Lessons of {label} by day and period</caption>
                <thead>
                  <tr>
                    <th scope="col" className="t-colhead sticky left-0 z-[2] h-10 w-36 border-b border-border bg-surface-subtle px-4 text-left text-ink-2">Period</th>
                    {days.map((d) => (
                      <th key={d} scope="col" className={cn('t-colhead h-10 border-b border-border bg-surface-subtle px-3 text-left text-ink-2', mondayOf(today) === monday && isoWeekday(today) === d && 'text-brand-ink')}>
                        {weekdayName(d)}
                        <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-3">{fmtDate(shiftDays(monday, d - 1), { day: 'numeric', month: 'short' })}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periods.map((per) =>
                    per.isBreak ? (
                      <tr key={per.id}>
                        <th scope="row" className="sticky left-0 z-[1] border-b border-border bg-surface px-4 py-1.5 text-left text-sm font-normal text-ink-2">
                          {per.name}
                          <span className="t-caption block text-ink-3">{fmtClock(per.startTime)} – {fmtClock(per.endTime)}</span>
                        </th>
                        <td colSpan={days.length} className="border-b border-border bg-surface-subtle px-3 py-1.5 text-center text-xs text-ink-3">Break</td>
                      </tr>
                    ) : (
                      <tr key={per.id}>
                        <th scope="row" className="sticky left-0 z-[1] border-b border-border bg-surface px-4 py-2 text-left text-sm font-medium">
                          {per.name}
                          <span className="t-caption block font-normal text-ink-2">{fmtClock(per.startTime)} – {fmtClock(per.endTime)}</span>
                        </th>
                        {days.map((d) => (
                          <td key={d} className="border-b border-border p-1.5 align-top">{renderLesson(d, per.id)}</td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* phone: pick a day, then its periods */}
          <div className="space-y-3 md:hidden">
            <Tabs value={String(activeDay)} onValueChange={(v) => setDay(Number(v))}>
              <TabsList aria-label="Day of the week">
                {days.map((d) => (
                  <TabsTrigger key={d} value={String(d)}>{weekdayName(d, true)}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <ul className="space-y-2" aria-label={`${weekdayName(activeDay)} lessons`}>
              {periods.map((per) => (
                <li key={per.id} className="rounded-lg border border-border bg-surface p-2.5">
                  <p className="t-caption mb-1.5 flex justify-between text-ink-2"><span className="font-medium text-ink">{per.name}</span><span>{fmtClock(per.startTime)} – {fmtClock(per.endTime)}</span></p>
                  {per.isBreak ? <p className="py-2 text-center text-xs text-ink-3">Break</p> : renderLesson(activeDay, per.id, true)}
                </li>
              ))}
            </ul>
          </div>

          <Card>
            <div className="space-y-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="t-section">Lessons per subject</h2>
                <p className="t-caption text-ink-2">{lessonCount} of {slotCapacity} lesson slots filled{g?.section.classTeacherName ? ` · Class teacher: ${g.section.classTeacherName}` : ''}</p>
              </div>
              {offered.isPending ? (
                <Skeleton className="h-6 w-2/3" />
              ) : (offered.data ?? []).length === 0 ? (
                <p className="text-sm text-ink-2">This grade offers no subjects yet. <Link href={`/admin/academics/subjects?tab=offerings&grade=${g?.section.gradeId ?? ''}`} className="text-brand-ink underline-offset-4 hover:underline">Set grade offerings</Link>.</p>
              ) : (
                <ul className="flex flex-wrap gap-2" aria-label="Scheduled lessons against periods per week">
                  {(offered.data ?? []).map((o) => {
                    const n = lessonsBySubject.get(o.subjectId) ?? 0;
                    const ok = n === o.periodsPerWeek;
                    return (
                      <li key={o.subjectId}>
                        <Badge variant={ok ? 'success' : n > o.periodsPerWeek ? 'danger' : 'neutral'} className="h-6">{o.subjectName} {n}/{o.periodsPerWeek}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="t-caption text-ink-3">Each chip is lessons placed against the periods per week the grade offers. It is a guide, not a rule.</p>
            </div>
          </Card>
        </>
      )}

      {cell && editingCell && g && (
        <SlotDialog
          mode={draft ? 'draft' : 'live'}
          section={{ id: sectionId, label }}
          day={cell.day}
          period={editingCell}
          lesson={shown[slotKey(cell.day, cell.periodId)]?.subjectId ? shown[slotKey(cell.day, cell.periodId)] : undefined}
          subjects={offered.data ?? []}
          assigned={assigned}
          staff={staff.data ?? []}
          onClose={() => setCell(null)}
          onDraft={(l) => applyDraft(cell, l)}
          onCover={(l) => {
            const dayDate = shiftDays(monday, l.dayOfWeek - 1);
            setCell(null);
            setCover({ sectionId, slotId: l.id!, date: dayDate >= today ? dayDate : nextDateOnWeekday(today, l.dayOfWeek) });
          }}
        />
      )}
      {cover && <SubstitutionDialog preset={cover} onClose={() => setCover(null)} />}
      <ConfirmDialog open={confirmClear} onOpenChange={setConfirmClear} title="Clear every lesson in the draft?" description={`The whole grid of ${label} becomes empty here. Nothing is deleted until you press Save timetable, and Discard brings the saved timetable back.`} confirmLabel="Clear all lessons" destructive onConfirm={() => { setDraft({}); setConfirmClear(false); }} />
    </div>
  );
}
