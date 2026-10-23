'use client';

import * as React from 'react';
import { CalendarPlus, ListPlus, Lock, Pencil, Trash2 } from 'lucide-react';
import type { ExamOut, PaperOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { bff } from '@/lib/client/fetcher';
import { useExamMutation, usePapers } from '@/lib/client/exams-admin';
import { gradeOptions, useGradeList } from '@/lib/client/options';
import { fmtClock, fmtDate } from '@/lib/format';
import { useAccess } from '../shared/access';
import { FilterSelect } from '../shared/controls';
import { PaperFormDrawer } from './paper-form';
import { PlanGradeDrawer } from './plan-grade';

const timeLabel = (p: PaperOut) => (p.startTime && p.endTime ? `${fmtClock(p.startTime)} – ${fmtClock(p.endTime)}` : p.startTime ? fmtClock(p.startTime) : '—');

/** The paper schedule of one exam (grade × subject), with add / edit / remove and a one-grade planner. Locked once the exam is under review. */
export function ExamSchedule({ exam }: { exam: ExamOut }) {
  const access = useAccess();
  const grades = useGradeList();
  const q = usePapers(exam.id);
  const [gradeId, setGradeId] = React.useState('');
  const [form, setForm] = React.useState<{ paper: PaperOut | null } | null>(null);
  const [plan, setPlan] = React.useState(false);
  const [remove, setRemove] = React.useState<PaperOut | null>(null);

  const locked = exam.status === 'under_review' || exam.status === 'published';
  const canEdit = access.can('exams:edit') && !locked;
  const write = access.ok('exams:edit');
  const del = useExamMutation((p: PaperOut) => bff(`/exams/${exam.id}/papers/${p.id}`, { method: 'DELETE' }), { success: 'Paper removed' });

  const rows = (q.data ?? []).filter((p) => !gradeId || p.gradeId === gradeId);
  const columns: Column<PaperOut>[] = [
    { id: 'date', header: 'Date', mobile: 'sub', cell: (p) => <span className="tnum">{p.examDate ? fmtDate(p.examDate, { weekday: 'short', day: 'numeric', month: 'short' }) : <span className="text-ink-3">Not scheduled</span>}</span> },
    { id: 'time', header: 'Time', mobile: 'detail', cell: (p) => <span className="tnum">{timeLabel(p)}</span> },
    { id: 'grade', header: 'Grade', mobile: 'detail', cell: (p) => p.gradeName },
    {
      id: 'subject',
      header: 'Subject',
      mobile: 'title',
      cell: (p) => (
        <span className="font-medium">
          {p.subjectName} <span className="t-caption font-normal text-ink-3 md:hidden">· {p.gradeName}</span>
        </span>
      ),
    },
    { id: 'room', header: 'Room', mobile: 'detail', cell: (p) => p.room ?? '—' },
    { id: 'marks', header: 'Marks', align: 'right', mobile: 'value', cell: (p) => <span className="tnum">{p.maxMarks}{p.passMarks != null ? ` (pass ${p.passMarks})` : ''}</span> },
  ];
  if (canEdit)
    columns.push({
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      label: 'Actions',
      hideable: false,
      align: 'right',
      mobile: 'hide',
      cell: (p) => (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton label={`Edit ${p.subjectName} paper for ${p.gradeName}`} size="icon-sm" onClick={() => setForm({ paper: p })} disabled={!write}>
            <Pencil />
          </IconButton>
          <IconButton label={`Remove ${p.subjectName} paper for ${p.gradeName}`} size="icon-sm" onClick={() => setRemove(p)} disabled={!write}>
            <Trash2 />
          </IconButton>
        </span>
      ),
    });

  return (
    <div className="space-y-4">
      {locked && (
        <Banner tone="locked" title="The schedule is locked">
          <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" aria-hidden /> It cannot change once an exam is under review or published.</span>
        </Banner>
      )}
      <DataTable
        id="exam-papers"
        caption={`Papers of ${exam.name}`}
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        loading={q.isPending}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        onRowClick={canEdit && write ? (p) => setForm({ paper: p }) : undefined}
        filters={<FilterSelect label="Grade" value={gradeId} onChange={setGradeId} options={gradeOptions(grades.data)} allLabel="All grades" />}
        toolbar={
          canEdit ? (
            <>
              <Button variant="secondary" onClick={() => setPlan(true)} disabled={!write} title={access.hint('exams:edit')}>
                <ListPlus /> Plan a grade
              </Button>
              <Button onClick={() => setForm({ paper: null })} disabled={!write} title={access.hint('exams:edit')}>
                <CalendarPlus /> Add paper
              </Button>
            </>
          ) : undefined
        }
        empty={
          gradeId ? (
            <EmptyState illustration="no-results" title="No papers for this grade" description="Add one, or plan the whole grade at once." action={canEdit ? <Button variant="secondary" onClick={() => setPlan(true)}>Plan a grade</Button> : undefined} compact />
          ) : (
            <EmptyState illustration="empty-events" title="No papers scheduled yet" description="Add the papers of each grade. The exam can be scheduled once it has at least one." action={canEdit ? <Button onClick={() => setPlan(true)}><ListPlus /> Plan a grade</Button> : undefined} compact />
          )
        }
      />
      <p className="t-caption text-ink-2">Clashes are checked when you save: two papers of one grade on the same day clash when both have no times, or their times overlap.</p>

      <PaperFormDrawer exam={exam} paper={form?.paper} open={form !== null} onClose={() => setForm(null)} defaultGradeId={gradeId || undefined} />
      <PlanGradeDrawer exam={exam} papers={q.data ?? []} open={plan} onClose={() => setPlan(false)} />
      <ConfirmDialog
        open={remove !== null}
        onOpenChange={(o) => !del.isPending && !o && setRemove(null)}
        title={remove ? `Remove ${remove.subjectName} for ${remove.gradeName}?` : 'Remove paper?'}
        description="The paper leaves the schedule. If students or teachers already saw the schedule, they will see it change. A paper that already has mark sheets cannot be removed."
        confirmLabel="Remove paper"
        destructive
        loading={del.isPending}
        onConfirm={async () => {
          if (!remove) return;
          const r = await del.run(remove);
          if (r.ok) setRemove(null);
        }}
      />
    </div>
  );
}
