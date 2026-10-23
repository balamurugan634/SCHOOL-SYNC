'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Pencil, Send, Trash2, Lock } from 'lucide-react';
import type { HomeworkItem } from '@school-sync/shared';
import { ApiError } from '@/lib/problem';
import { dueLabel, fmtDateTime, percent, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { isOutOfScope, teacherError } from '@/lib/client/teacher-errors';
import { useCloseHomework, useDeleteHomework, useHomework, useHomeworkRoster, usePublishHomework } from '@/lib/client/teacher-homework';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchField } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { PageHeader } from '@/components/shell/page-header';
import { useMeContext, usePermissions } from '@/components/me-context';
import { AttachmentLinks, ErrorCard, Meta, OutOfScope, useUrlState, useWriteGate } from '../common';
import { HomeworkStatusChip, WorkStatusChip, handedIn, hwClass, marksText, toReviewCount } from './shared';
import { ReviewTab, SubmissionDrawer, type DrawerState } from './submission-review';

type Tab = 'overview' | 'roster' | 'review';
type Confirm = 'publish' | 'close' | 'delete' | null;

export function HomeworkDetailScreen({ id }: { id: string }) {
  const { base } = useMeContext();
  const router = useRouter();
  const u = useUrlState();
  const { can } = usePermissions();
  const gate = useWriteGate();
  const q = useHomework(id);
  const publish = usePublishHomework();
  const close = useCloseHomework();
  const del = useDeleteHomework();
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [actionError, setActionError] = React.useState<{ message: string; offerClose: boolean } | null>(null);
  const [drawer, setDrawer] = React.useState<DrawerState | null>(null);

  const list = `${base}/homework`;
  const h = q.data;
  const crumbs = [{ label: 'Home', href: base || '/' }, { label: 'Homework', href: list }, { label: h?.title ?? 'Homework' }];

  if (q.isPending)
    return (
      <>
        <PageHeader title="Homework" crumbs={crumbs} />
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-6 w-64" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <StatTile key={i} label="Loading" state="loading" />
            ))}
          </div>
          <Skeleton className="h-56 w-full" />
        </div>
      </>
    );
  if (q.isError || !h)
    return (
      <>
        <PageHeader title="Homework" crumbs={crumbs} />
        {isOutOfScope(q.error) ? <OutOfScope what="This homework" backHref={list} backLabel="Back to homework" /> : <ErrorCard error={q.error} onRetry={() => void q.refetch()} />}
      </>
    );

  const stats = h.stats;
  const submitted = stats ? handedIn(stats) : 0;
  const hasSubs = h.status !== 'draft' && (h.allowSubmission || submitted > 0);
  const requested = (['overview', 'roster', 'review'] as const).find((t) => t === u.get('tab')) ?? 'overview';
  const tab: Tab = requested !== 'overview' && !hasSubs ? 'overview' : requested;
  const canReview = can('submissions:edit');
  const waiting = stats ? toReviewCount(stats) : 0;
  const busy = publish.isPending || close.isPending || del.isPending;
  const due = dueLabel(h.dueAt);

  const run = async (kind: Exclude<Confirm, null>) => {
    setActionError(null);
    try {
      if (kind === 'publish') {
        await publish.mutateAsync(h.id);
        toast.success('Homework published', { description: 'Students and their guardians have been notified.' });
      } else if (kind === 'close') {
        await close.mutateAsync(h.id);
        toast.success('Homework closed', { description: 'Students can no longer hand in work.' });
      } else {
        await del.mutateAsync(h.id);
        toast.success('Homework deleted');
        router.replace(list);
        return;
      }
      setConfirm(null);
    } catch (e) {
      setConfirm(null);
      setActionError({ message: teacherError(e), offerClose: e instanceof ApiError && e.code === 'HOMEWORK_HAS_SUBMISSIONS' && h.status === 'published' });
      void q.refetch();
    }
  };

  const canEdit = can('homework:edit') && h.status !== 'closed';
  const canPublish = can('homework:publish') && h.status === 'draft';
  const canClose = can('homework:edit') && h.status === 'published';
  const canDelete = can('homework:delete') && (h.status === 'draft' || submitted === 0);

  return (
    <>
      <PageHeader
        title={h.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{hwClass(h)} · {h.subjectName}</span>
            <span aria-hidden>·</span>
            <span className={cn(due.overdue && h.status === 'published' && 'text-danger')}>Due {fmtDateTime(h.dueAt)}</span>
            <HomeworkStatusChip status={h.status} />
          </span>
        }
        crumbs={crumbs}
        actions={
          <>
            {canEdit && (
              <Button variant="secondary" onClick={() => router.push(`${base}/homework/${h.id}/edit`)} disabled={gate.readOnly} title={gate.reason}>
                <Pencil /> Edit
              </Button>
            )}
            {canPublish && (
              <Button onClick={() => setConfirm('publish')} disabled={gate.readOnly || busy} title={gate.reason}>
                <Send /> Publish
              </Button>
            )}
            {canClose && (
              <Button variant="secondary" onClick={() => setConfirm('close')} disabled={gate.readOnly || busy} title={gate.reason}>
                <Lock /> Close
              </Button>
            )}
            {canDelete && (
              <Button variant="danger" onClick={() => setConfirm('delete')} disabled={gate.readOnly || busy} title={gate.reason}>
                <Trash2 /> Delete
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-5">
        {actionError && (
          <Banner
            tone="danger"
            title="That didn’t work"
            onDismiss={() => setActionError(null)}
            action={actionError.offerClose && canClose ? <Button size="sm" variant="secondary" onClick={() => setConfirm('close')}>Close it instead</Button> : undefined}
          >
            {actionError.message}
          </Banner>
        )}
        {h.status === 'draft' && <Banner tone="info" title="This is a draft">Students and guardians can’t see it until you publish it.</Banner>}
        {h.status === 'closed' && <Banner tone="locked" title="This homework is closed">Students can no longer hand in work and it can’t be edited. You can still review what was handed in.</Banner>}
        {h.status === 'published' && due.overdue && h.allowSubmission && <Banner tone="info">The due date has passed. Work handed in now is marked as late.</Banner>}

        <Tabs value={tab} onValueChange={(v) => u.set({ tab: v === 'overview' ? null : v })}>
          <TabsList aria-label="Homework sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {hasSubs && <TabsTrigger value="roster">Roster</TabsTrigger>}
            {hasSubs && (
              <TabsTrigger value="review">
                Review
                {waiting > 0 && <Badge variant="accent">{waiting}</Badge>}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview">
            <Overview h={h} />
          </TabsContent>
          {hasSubs && (
            <TabsContent value="roster">
              <RosterTab homework={h} canReview={canReview} onOpen={setDrawer} />
            </TabsContent>
          )}
          {hasSubs && (
            <TabsContent value="review">
              <ReviewTab homework={h} canReview={canReview} onOpen={setDrawer} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <SubmissionDrawer homework={h} state={drawer} onChange={setDrawer} canReview={canReview} />

      <ConfirmDialog
        open={confirm === 'publish'}
        onOpenChange={(o) => !o && !busy && setConfirm(null)}
        title="Publish this homework?"
        description={`“${h.title}” goes to ${hwClass(h)}. Students and their verified guardians are notified straight away.`}
        confirmLabel="Publish and notify"
        loading={publish.isPending}
        onConfirm={() => void run('publish')}
      />
      <ConfirmDialog
        open={confirm === 'close'}
        onOpenChange={(o) => !o && !busy && setConfirm(null)}
        title="Close this homework?"
        description={`Students can no longer hand in “${h.title}”, and it can’t be edited afterwards. Work already handed in stays available for review.`}
        confirmLabel="Close homework"
        loading={close.isPending}
        onConfirm={() => void run('close')}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && !busy && setConfirm(null)}
        title="Delete this homework?"
        description={h.status === 'draft' ? `The draft “${h.title}” is removed permanently. Nobody has seen it yet.` : `“${h.title}” is removed permanently for ${hwClass(h)}. Nobody has handed anything in, so no work is lost.`}
        confirmLabel="Delete homework"
        destructive
        loading={del.isPending}
        onConfirm={() => void run('delete')}
      />
    </>
  );
}

/* ───────────────────────── overview ───────────────────────── */

function Overview({ h }: { h: HomeworkItem }) {
  const s = h.stats;
  const published = h.status !== 'draft';
  const done = s ? handedIn(s) : 0;
  const total = s?.totalStudents ?? 0;
  return (
    <div className="space-y-5">
      {published && s && h.allowSubmission && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Handed in" value={done} hint={`of ${plural(total, 'student')}`} />
            <StatTile label="To review" value={toReviewCount(s)} hint={s.late > 0 ? `${s.late} late` : undefined} />
            <StatTile label="Reviewed" value={s.reviewed} />
            <StatTile label="Not handed in" value={s.missing} hint={s.returned > 0 ? `${s.returned} returned for rework` : undefined} />
          </div>
          <Card>
            <CardBody className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="t-section">Completion</h2>
                <span className="t-caption tnum text-ink-2">{total > 0 ? percent((done / total) * 100) : '—'}</span>
              </div>
              <ProgressBar value={done} max={Math.max(1, total)} label={`${done} of ${total} students have handed in`} />
              <p className="t-caption text-ink-2">
                {done} of {plural(total, 'student')} have handed in{s.missing > 0 ? `; ${s.missing} still to go` : '. Everyone has handed in'}.
              </p>
            </CardBody>
          </Card>
        </>
      )}
      {published && !h.allowSubmission && <Banner tone="info">Students don’t hand this in online, so there is nothing to review. Turn on online hand-in by editing the homework.</Banner>}
      {!published && <Banner tone="info">Hand-in numbers appear here once you publish the homework.</Banner>}

      <Card>
        <CardHeader title="Instructions" />
        <CardBody className="space-y-4 pt-3">
          {h.description ? <p className="max-w-[68ch] whitespace-pre-wrap break-words text-sm leading-[22px]">{h.description}</p> : <p className="text-sm text-ink-2">No instructions were added.</p>}
          <AttachmentLinks items={h.attachments} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Details" />
        <CardBody className="pt-3">
          <Meta
            cols={3}
            items={[
              { label: 'Class', value: hwClass(h) },
              { label: 'Subject', value: h.subjectName },
              { label: 'Set by', value: h.teacherName },
              { label: 'Assigned', value: fmtDateTime(h.assignedAt) },
              { label: 'Due', value: fmtDateTime(h.dueAt) },
              { label: 'Maximum marks', value: h.maxMarks ?? 'Not marked' },
              { label: 'Online hand-in', value: h.allowSubmission ? 'Yes' : 'No' },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}

/* ───────────────────────── roster ───────────────────────── */

const ROSTER_FILTERS = [
  { value: '', label: 'Everyone' },
  { value: 'missing', label: 'Missing' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'late', label: 'Late' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'returned', label: 'Returned' },
] as const;

function RosterTab({ homework, canReview, onOpen }: { homework: HomeworkItem; canReview: boolean; onOpen: (s: DrawerState) => void }) {
  const u = useUrlState();
  const q = useHomeworkRoster(homework.id);
  const [search, setSearch] = React.useState('');
  const rows = React.useMemo(() => q.data?.data ?? [], [q.data]);
  const filter = ROSTER_FILTERS.find((f) => f.value === u.get('rs'))?.value ?? '';
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { '': rows.length, missing: 0, submitted: 0, late: 0, reviewed: 0, returned: 0 };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);
  const term = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!filter || r.status === filter) && (!term || r.name.toLowerCase().includes(term) || r.admissionNo.toLowerCase().includes(term)));
  const ids = shown.flatMap((r) => (r.submission ? [r.submission.id] : []));

  const copyMissing = async () => {
    const names = shown.map((r) => r.name).join('\n');
    try {
      await navigator.clipboard.writeText(names);
      toast.success(`Copied ${plural(shown.length, 'name')}`);
    } catch {
      toast.error('Couldn’t copy. Select the names in the table instead.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Filter the roster by status" className="flex flex-wrap gap-1.5">
          {ROSTER_FILTERS.map((f) => {
            const on = filter === f.value;
            return (
              <button
                key={f.value || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => u.set({ rs: f.value })}
                className={cn('tr-colors inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium', on ? 'border-brand bg-brand-soft text-brand-ink' : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-subtle hover:text-ink')}
              >
                {f.label}
                <span className="tnum text-ink-3">{counts[f.value] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <SearchField className="sm:w-64" value={search} onChange={setSearch} placeholder="Find a student" aria-label="Find a student in this roster" hint={null} />
      </div>

      <DataTable<(typeof rows)[number]>
        id="teacher-homework-roster"
        caption="Students and their hand-in status"
        rows={q.isPending ? undefined : shown}
        rowKey={(r) => r.studentId}
        loading={q.isPending}
        error={q.error ? new Error(teacherError(q.error)) : undefined}
        onRetry={() => void q.refetch()}
        onRowClick={(r) => r.submission && onOpen({ id: r.submission.id, ids })}
        toolbar={
          filter === 'missing' && shown.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => void copyMissing()}>
              <Copy /> Copy names
            </Button>
          ) : undefined
        }
        columns={[
          { id: 'roll', header: 'Roll', mobile: 'hide', className: 'w-16', cell: (r) => <span className="tnum text-ink-3">{r.rollNo ?? ''}</span> },
          {
            id: 'name',
            header: 'Student',
            mobile: 'title',
            hideable: false,
            cell: (r) => (
              <span className="min-w-0">
                <span className="font-medium">{r.name}</span>
                <span className="t-caption ml-2 text-ink-3">{r.admissionNo}</span>
              </span>
            ),
          },
          { id: 'status', header: 'Status', mobile: 'status', cell: (r) => <WorkStatusChip status={r.status} /> },
          { id: 'at', header: 'Handed in', mobile: 'detail', cell: (r) => <span className="tnum text-ink-2">{r.submission ? fmtDateTime(r.submission.submittedAt) : '—'}</span> },
          { id: 'marks', header: 'Marks', align: 'right', mobile: 'detail', cell: (r) => <span className="tnum">{homework.maxMarks ? marksText(r.submission?.marks, homework.maxMarks) : '—'}</span> },
          {
            id: 'open',
            header: <span className="sr-only">Open</span>,
            label: 'Open',
            hideable: false,
            mobile: 'hide',
            align: 'right',
            cell: (r) =>
              r.submission ? (
                <Button variant="ghost" size="sm" aria-label={`${canReview ? 'Review' : 'View'} ${r.name}’s submission`} onClick={(e) => { e.stopPropagation(); onOpen({ id: r.submission!.id, ids }); }}>
                  {canReview ? 'Review' : 'View'}
                </Button>
              ) : null,
          },
        ]}
        empty={
          rows.length === 0 ? (
            <EmptyState compact illustration="empty-generic" title="No students in this class" description="Students appear here once they are allocated to the class." />
          ) : (
            <EmptyState compact illustration="no-results" title="No students match" description="Try another status or clear the search." action={<Button variant="secondary" size="sm" onClick={() => { setSearch(''); u.set({ rs: null }); }}>Show everyone</Button>} />
          )
        }
      />
    </div>
  );
}
