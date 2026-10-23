'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Paperclip, Plus } from 'lucide-react';
import type { HomeworkItem } from '@school-sync/shared';
import { dueLabel, fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { sectionOutLabel, useMyTeaching } from '@/lib/client/teacher';
import { teacherError } from '@/lib/client/teacher-errors';
import { useHomeworkList, type HomeworkFilters } from '@/lib/client/teacher-homework';
import { Button } from '@/components/ui/button';
import { DataTable, type SortState } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { SearchField } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { useMe, useMeContext, usePermissions } from '@/components/me-context';
import { FilterSelect, useUrlState, useWriteGate } from '../common';
import { FilterChip, HomeworkStatusChip, handedIn, hwClass, toReviewCount, useDebounced } from './shared';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'closed', label: 'Closed' },
];

export function HomeworkListScreen() {
  const u = useUrlState();
  const router = useRouter();
  const me = useMe();
  const { base } = useMeContext();
  const { can } = usePermissions();
  const gate = useWriteGate();
  const teaching = useMyTeaching();

  const status = (['draft', 'published', 'closed'] as const).find((s) => s === u.get('status')) ?? '';
  const f: HomeworkFilters = {
    scope: u.get('scope') === 'class' ? 'class' : 'mine',
    sectionId: u.get('section'),
    subjectId: u.get('subject'),
    status,
    q: u.get('q'),
    dueFrom: u.get('from'),
    dueTo: u.get('to'),
    sort: u.get('sort') === 'dueAsc' ? 'dueAsc' : 'dueDesc',
    page: u.num('page', 1),
    pageSize: u.num('size', 25),
  };
  const q = useHomeworkList(f);

  // search: type freely, the URL follows after a short pause
  const [text, setText] = React.useState(f.q);
  const debounced = useDebounced(text, 350);
  React.useEffect(() => {
    if (debounced !== f.q) u.set({ q: debounced });
    // only when the typed text settles; the URL is the source of truth otherwise
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const sectionOptions = (teaching.sections ?? []).map((s) => ({ value: s.id, label: sectionOutLabel(s) }));
  const subjectOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of teaching.pairs) m.set(p.subjectId, p.subjectName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [teaching.pairs]);

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (f.sectionId) chips.push({ key: 'section', label: `Class: ${sectionOptions.find((o) => o.value === f.sectionId)?.label ?? 'selected'}`, clear: () => u.set({ section: null }) });
  if (f.subjectId) chips.push({ key: 'subject', label: `Subject: ${subjectOptions.find((o) => o.value === f.subjectId)?.label ?? 'selected'}`, clear: () => u.set({ subject: null }) });
  if (f.status) chips.push({ key: 'status', label: `Status: ${STATUS_OPTIONS.find((o) => o.value === f.status)?.label}`, clear: () => u.set({ status: null }) });
  if (f.q) chips.push({ key: 'q', label: `Search: “${f.q}”`, clear: () => { setText(''); u.set({ q: null }); } });
  if (f.dueFrom) chips.push({ key: 'from', label: `Due from ${fmtDate(f.dueFrom)}`, clear: () => u.set({ from: null }) });
  if (f.dueTo) chips.push({ key: 'to', label: `Due until ${fmtDate(f.dueTo)}`, clear: () => u.set({ to: null }) });
  const clearAll = () => {
    setText('');
    u.set({ section: null, subject: null, status: null, q: null, from: null, to: null });
  };

  const sort: SortState = { id: 'due', dir: f.sort === 'dueAsc' ? 'asc' : 'desc' };
  const createBlocked = gate.readOnly;
  const go = (h: HomeworkItem) => router.push(`${base}/homework/${h.id}`);

  return (
    <>
      <PageHeader
        title="Homework"
        description="Set work for your classes, see who has handed in, and review what comes back."
        actions={
          can('homework:create') && (
            <Button onClick={() => router.push(`${base}/homework/new`)} disabled={createBlocked} title={gate.reason}>
              <Plus /> New homework
            </Button>
          )
        }
      />

      <div className="space-y-4">
        <Tabs value={f.scope} onValueChange={(v) => u.set({ scope: v === 'mine' ? null : v })}>
          <TabsList aria-label="Which homework">
            <TabsTrigger value="mine">Set by me</TabsTrigger>
            <TabsTrigger value="class">All in my classes</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <SearchField value={text} onChange={setText} placeholder="Search by title" aria-label="Search homework by title" />
          <FilterSelect label="Filter by class" allLabel="All classes" value={f.sectionId} onChange={(v) => u.set({ section: v })} options={sectionOptions} className="sm:w-full" />
          <FilterSelect label="Filter by subject" allLabel="All subjects" value={f.subjectId} onChange={(v) => u.set({ subject: v })} options={subjectOptions} className="sm:w-full" />
          <FilterSelect label="Filter by status" allLabel="Any status" value={f.status} onChange={(v) => u.set({ status: v })} options={STATUS_OPTIONS} className="sm:w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <DatePicker value={f.dueFrom || null} onChange={(v) => u.set({ from: v })} placeholder="Due from" max={f.dueTo || undefined} />
          </div>
          <div className="w-40">
            <DatePicker value={f.dueTo || null} onChange={(v) => u.set({ to: v })} placeholder="Due until" min={f.dueFrom || undefined} />
          </div>
          {chips.map((c) => (
            <FilterChip key={c.key} label={c.label} onRemove={c.clear} />
          ))}
          {chips.length > 1 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          )}
        </div>

        <DataTable<HomeworkItem>
          id="teacher-homework"
          caption="Homework"
          rows={q.data?.data}
          rowKey={(h) => h.id}
          loading={q.isPending}
          error={q.error ? new Error(teacherError(q.error)) : undefined}
          onRetry={() => void q.refetch()}
          onRowClick={go}
          sort={sort}
          onSortChange={(s) => u.set({ sort: s?.dir === 'desc' ? 'dueDesc' : 'dueAsc' })}
          page={f.page}
          pageSize={f.pageSize}
          total={q.data?.meta.total}
          onPageChange={(p) => u.set({ page: p }, { keepPage: true })}
          onPageSizeChange={(s) => u.set({ size: s === 25 ? null : s })}
          columns={[
            {
              id: 'title',
              header: 'Homework',
              mobile: 'title',
              hideable: false,
              cell: (h) => (
                <div className="min-w-0">
                  <Link href={`${base}/homework/${h.id}`} onClick={(e) => e.stopPropagation()} className="block max-w-[34ch] truncate font-medium hover:underline">
                    {h.title}
                  </Link>
                  {h.attachments.length > 0 && (
                    <span className="t-caption inline-flex items-center gap-1 text-ink-3">
                      <Paperclip className="size-3" aria-hidden /> {h.attachments.length}
                      <span className="sr-only"> attachments</span>
                    </span>
                  )}
                </div>
              ),
            },
            { id: 'class', header: 'Class and subject', mobile: 'sub', cell: (h) => <span className="text-ink-2">{hwClass(h)} · {h.subjectName}</span> },
            { id: 'teacher', header: 'Set by', mobile: 'hide', cell: (h) => <span className="text-ink-2">{h.staffId && h.staffId === me.profile.staffId ? 'You' : (h.teacherName ?? '—')}</span> },
            {
              id: 'due',
              header: 'Due',
              sortable: true,
              mobile: 'detail',
              cell: (h) => {
                const d = dueLabel(h.dueAt);
                return <span className={cn('tnum', d.overdue && h.status === 'published' ? 'text-danger' : 'text-ink-2')}>{d.text}</span>;
              },
            },
            {
              id: 'handin',
              header: 'Handed in',
              label: 'Handed in',
              mobile: 'detail',
              cell: (h) => <HandIn h={h} />,
            },
            { id: 'status', header: 'Status', mobile: 'status', cell: (h) => <HomeworkStatusChip status={h.status} /> },
          ]}
          empty={
            chips.length > 0 ? (
              <EmptyState
                illustration="no-results"
                title="No homework matches these filters"
                filters={chips.map((c) => <FilterChip key={c.key} label={c.label} onRemove={c.clear} />)}
                action={<Button variant="secondary" onClick={clearAll}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                illustration="empty-homework"
                title={f.scope === 'mine' ? 'You haven’t set any homework yet' : 'No homework in your classes yet'}
                description={f.scope === 'mine' ? 'Create homework for a class and subject you teach. Students and guardians are told when you publish it.' : 'Homework from you and from the teachers of your classes will appear here.'}
                action={can('homework:create') ? <Button onClick={() => router.push(`${base}/homework/new`)} disabled={createBlocked}><Plus /> New homework</Button> : undefined}
              />
            )
          }
        />
      </div>
    </>
  );
}

function HandIn({ h }: { h: HomeworkItem }) {
  const s = h.stats;
  if (h.status === 'draft') return <span className="t-caption text-ink-3">Not published</span>;
  if (!s) return <span className="text-ink-3">—</span>;
  const done = handedIn(s);
  if (!h.allowSubmission && done === 0) return <span className="t-caption text-ink-3">No online submission</span>;
  const review = toReviewCount(s);
  return (
    <div className="w-36 max-w-full">
      <p className="t-caption tnum mb-1 text-ink-2">
        {done} of {s.totalStudents}
        {review > 0 ? ` · ${review} to review` : ''}
      </p>
      <ProgressBar value={done} max={Math.max(1, s.totalStudents)} label={`${done} of ${s.totalStudents} students handed in`} />
    </div>
  );
}
