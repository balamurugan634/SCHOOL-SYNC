'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, MessageSquareWarning } from 'lucide-react';
import type { MarkSheetStatus, SheetOut } from '@school-sync/shared';
import { SHEET_PRIORITY, SHEET_STATUS_LABEL, sheetNeedsAction, useExams, useMarkSheets } from '@/lib/client/teacher-marks';
import { secLabel, useMySections, useTeacherScope } from '@/lib/client/teacher';
import { fmtDate } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { StatusChip } from '@/components/ui/badge';
import { PageHeader } from '@/components/shell/page-header';
import { useMeContext } from '@/components/me-context';
import { FilterSelect, useUrlState } from '../common';
import { FilterChips } from './marks-shared';

const PAGE_SIZE = 20;
const STATUSES: MarkSheetStatus[] = ['returned', 'draft', 'submitted', 'approved', 'published'];

/** "Mark sheets": mine (default) or my class's, needs-action first, every filter and the page in the URL. */
export function SheetsScreen() {
  const url = useUrlState();
  const router = useRouter();
  const { base } = useMeContext();
  const scope = useTeacherScope();
  const exams = useExams();
  const sections = useMySections();

  const view: 'mine' | 'class' = scope.isClassTeacher && url.get('view') === 'class' ? 'class' : 'mine';
  const examId = url.get('exam');
  const sectionId = url.get('section');
  const rawStatus = url.get('status');
  const status = (STATUSES as string[]).includes(rawStatus) ? (rawStatus as MarkSheetStatus) : '';
  const page = url.num('page', 1);

  const q = useMarkSheets({ examId: examId || undefined, sectionId: sectionId || undefined, mine: view === 'mine' });

  const scoped = React.useMemo(() => {
    const all = q.data ?? [];
    return view === 'class' ? all.filter((s) => scope.isLead(s.sectionId)) : all;
  }, [q.data, view, scope]);

  const counts = React.useMemo(() => {
    const c: Record<MarkSheetStatus, number> = { returned: 0, draft: 0, submitted: 0, approved: 0, published: 0 };
    for (const s of scoped) c[s.status]++;
    return c;
  }, [scoped]);

  const rows = React.useMemo(() => {
    const list = status ? scoped.filter((s) => s.status === status) : scoped;
    // stable: keeps the API order (latest exam, grade, class, subject) inside each priority
    return list.map((s, i) => ({ s, i })).sort((a, b) => SHEET_PRIORITY[a.s.status] - SHEET_PRIORITY[b.s.status] || a.i - b.i).map((x) => x.s);
  }, [scoped, status]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const pageRows = rows.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const open = (s: SheetOut) => router.push(`${base}/marks/sheets/${s.id}`);

  const todo = counts.draft + counts.returned;
  const firstTodo = scoped.find((s) => s.status === 'returned') ?? scoped.find((s) => s.status === 'draft');
  const filtered = !!(examId || sectionId || status);

  const columns: Column<SheetOut>[] = [
    {
      id: 'subject',
      header: 'Subject',
      mobile: 'title',
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{s.subjectName}</p>
          <p className="t-caption truncate text-ink-2">{secLabel(s.gradeName, s.sectionName)}</p>
          {s.status === 'returned' && s.returnNote && (
            <p className="t-caption mt-1 flex items-start gap-1 text-warning">
              <MessageSquareWarning className="mt-px size-3.5 shrink-0" aria-hidden />
              <span className="line-clamp-2 whitespace-normal">Returned: {s.returnNote}</span>
            </p>
          )}
        </div>
      ),
    },
    { id: 'exam', header: 'Exam', mobile: 'sub', cell: (s) => <span className="block max-w-[14rem] truncate">{s.examName}</span> },
    { id: 'status', header: 'Status', mobile: 'status', cell: (s) => <StatusChip status={s.status} /> },
    {
      id: 'progress',
      header: 'Marks entered',
      label: 'Marks entered',
      mobile: 'detail',
      cell: (s) => (
        <span className="flex min-w-[8.5rem] items-center gap-2">
          <ProgressBar value={s.enteredCount} max={s.studentCount} label={`${s.enteredCount} of ${s.studentCount} students entered for ${s.subjectName} ${secLabel(s.gradeName, s.sectionName)}`} tone={s.enteredCount >= s.studentCount ? 'success' : 'brand'} className="w-20 max-sm:hidden" />
          <span className="tnum text-[13px]">
            {s.enteredCount}/{s.studentCount}
            {s.absentCount > 0 && <span className="text-ink-3"> · {s.absentCount} absent</span>}
          </span>
        </span>
      ),
    },
    { id: 'max', header: 'Out of', align: 'right', mobile: 'hide', cell: (s) => <span className="tnum">{s.maxMarks}</span> },
    ...(view === 'class'
      ? [{ id: 'teacher', header: 'Subject teacher', mobile: 'detail' as const, cell: (s: SheetOut) => s.teacherName ?? '—' } satisfies Column<SheetOut>]
      : []),
    {
      id: 'when',
      header: 'Last step',
      label: 'Last step',
      mobile: 'hide',
      cell: (s) => <span className="t-caption text-ink-2">{s.publishedAt ? `Published ${fmtDate(s.publishedAt, { day: 'numeric', month: 'short' })}` : s.reviewedAt ? `Reviewed ${fmtDate(s.reviewedAt, { day: 'numeric', month: 'short' })}` : s.submittedAt ? `Submitted ${fmtDate(s.submittedAt, { day: 'numeric', month: 'short' })}` : '—'}</span>,
    },
    {
      id: 'go',
      header: <span className="sr-only">Open</span>,
      label: 'Open',
      hideable: false,
      mobile: 'hide',
      align: 'right',
      cell: (s) => (
        <Button asChild variant={sheetNeedsAction(s) && view === 'mine' ? 'secondary' : 'ghost'} size="sm" onClick={(e) => e.stopPropagation()}>
          <Link href={`${base}/marks/sheets/${s.id}`} aria-label={`${sheetNeedsAction(s) ? 'Enter marks' : 'View'}: ${s.subjectName}, ${secLabel(s.gradeName, s.sectionName)}, ${s.examName}`}>
            {sheetNeedsAction(s) && view === 'mine' ? 'Enter marks' : 'View'}
            <ArrowRight />
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Marks" description={view === 'class' ? 'Every mark sheet of the class you lead. Sheets of other teachers are view-only.' : 'Mark sheets for the subjects you teach. Returned and unfinished sheets come first.'} />

      <div className="space-y-4">
        {view === 'mine' && !q.isPending && todo > 0 && (
          <Banner
            tone="warning"
            title={counts.returned > 0 ? `${counts.returned} returned with a note, ${counts.draft} still to enter` : `${counts.draft} ${counts.draft === 1 ? 'sheet is' : 'sheets are'} waiting for your marks`}
            action={
              firstTodo && (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`${base}/marks/sheets/${firstTodo.id}`}>Open next</Link>
                </Button>
              )
            }
          >
            {counts.returned > 0 ? 'Fix what the reviewer asked for, then submit again.' : 'Enter marks, then submit each sheet for review.'}
          </Banner>
        )}

        <DataTable<SheetOut>
          id={`teacher-marks-sheets-${view}`}
          caption="Mark sheets"
          rows={pageRows}
          rowKey={(s) => s.id}
          loading={q.isPending}
          error={q.isError ? q.error : undefined}
          onRetry={() => void q.refetch()}
          columns={columns}
          onRowClick={open}
          page={cur}
          pageSize={PAGE_SIZE}
          total={rows.length}
          onPageChange={(p) => url.set({ page: p > 1 ? p : null }, { keepPage: true })}
          filters={
            <div className="flex w-full flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {scope.isClassTeacher && (
                  <FilterChips
                    label="Which sheets"
                    value={view}
                    onChange={(v) => url.set({ view: v === 'class' ? 'class' : null })}
                    options={[
                      { value: 'mine', label: 'My sheets' },
                      { value: 'class', label: 'My class' },
                    ]}
                  />
                )}
                <FilterSelect label="Filter by exam" allLabel="All exams" value={examId} onChange={(v) => url.set({ exam: v })} options={(exams.data ?? []).map((e) => ({ value: e.id, label: e.name }))} />
                <FilterSelect label="Filter by class" allLabel="All classes" value={sectionId} onChange={(v) => url.set({ section: v })} options={(sections.data ?? []).map((s) => ({ value: s.id, label: secLabel(s.gradeName, s.name) }))} />
              </div>
              <FilterChips
                label="Status"
                value={status}
                onChange={(v) => url.set({ status: v })}
                options={[{ value: '' as MarkSheetStatus | '', label: 'All', count: scoped.length }, ...STATUSES.map((st) => ({ value: st as MarkSheetStatus | '', label: SHEET_STATUS_LABEL[st], count: counts[st] }))]}
              />
            </div>
          }
          empty={
            filtered ? (
              <EmptyState
                illustration="no-results"
                title="No mark sheets match"
                description="Try a different exam, class or status."
                filters={
                  <>
                    {examId && <span className="t-caption rounded-full bg-surface-sunken px-2 py-0.5">{exams.data?.find((e) => e.id === examId)?.name ?? 'Exam'}</span>}
                    {sectionId && <span className="t-caption rounded-full bg-surface-sunken px-2 py-0.5">{(() => { const sec = sections.data?.find((x) => x.id === sectionId); return sec ? secLabel(sec.gradeName, sec.name) : 'Class'; })()}</span>}
                    {status && <span className="t-caption rounded-full bg-surface-sunken px-2 py-0.5">{SHEET_STATUS_LABEL[status]}</span>}
                  </>
                }
                action={<Button variant="secondary" onClick={() => url.set({ exam: null, section: null, status: null })}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                illustration="empty-generic"
                title={view === 'class' ? 'No mark sheets for your class yet' : 'You have no mark sheets yet'}
                description="Sheets appear when the school opens marks entry for an exam you teach a subject in."
                action={
                  <Button asChild variant="secondary">
                    <Link href={`${base}/marks/exams`}>See the exam schedule</Link>
                  </Button>
                }
              />
            )
          }
        />
      </div>
    </>
  );
}
