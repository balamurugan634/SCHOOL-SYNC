'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlarmClock, BookOpen, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { TASK_PRIORITIES, TASK_STATUSES, taskCreateBody, type TasksFeedItem } from '@school-sync/shared';
import { useCreateTask, useDeleteTask, useTask, useTasksFeed, useUpdateTask } from '@/lib/client/learner-learning';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { errorMessage } from '@/lib/problem';
import { dueLabel, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FormInput, FormSelect, FormTextarea } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { QueryView } from '../states';
import { useGates, useLearner } from '../use-learner';
import { useTabParam, useUrlParams } from '../url-state';
import { Segmented } from '../comms/common';
import { HomeworkStatusChip } from './common';
import { FormDateTime } from './fields';

const VIEWS = ['open', 'done', 'all'] as const;
type Item = TasksFeedItem;

const PRIORITY_LABEL: Record<string, string> = { high: 'High priority', normal: 'Normal', low: 'Low priority' };

type Bucket = 'overdue' | 'today' | 'upcoming' | 'nodate' | 'done';
const BUCKET_LABEL: Record<Bucket, string> = { overdue: 'Overdue', today: 'Due today', upcoming: 'Coming up', nodate: 'No due date', done: 'Done' };

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function bucketOf(i: Item, now: Date): Bucket {
  if (i.kind === 'task' && i.status === 'done') return 'done';
  if (i.overdue) return 'overdue';
  if (!i.dueAt) return 'nodate';
  return sameDay(new Date(i.dueAt), now) ? 'today' : 'upcoming';
}

export function TasksScreen() {
  const feed = useTasksFeed(true);
  const [view, setView] = useTabParam(VIEWS, 'open', 'view');
  const { set } = useUrlParams();
  const { readOnly, can } = useGates();
  const canCreate = can('tasks:create') && !readOnly;
  const [editing, setEditing] = React.useState<{ id: string | null } | null>(null);
  const { get } = useUrlParams();
  // ?new=1 opens the form straight away (used by the "Add task" shortcut elsewhere)
  React.useEffect(() => {
    if (get('new') === '1' && canCreate) {
      setEditing({ id: null });
      set({ new: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = React.useMemo(() => feed.data ?? [], [feed.data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = React.useMemo(() => new Date(), [feed.data]);
  const counts = React.useMemo(() => {
    const open = items.filter((i) => !(i.kind === 'task' && i.status === 'done'));
    return { open: open.length, overdue: open.filter((i) => i.overdue).length, done: items.length - open.length };
  }, [items]);
  const visible = items.filter((i) => {
    const isDone = i.kind === 'task' && i.status === 'done';
    return view === 'all' ? true : view === 'done' ? isDone : !isDone;
  });
  const groups = (['overdue', 'today', 'upcoming', 'nodate', 'done'] as Bucket[]).map((b) => ({ b, rows: visible.filter((i) => bucketOf(i, now) === b) })).filter((g) => g.rows.length > 0);

  return (
    <>
      <PageHeader
        title="My Tasks"
        description="Homework to hand in and your own to-dos, in one list."
        actions={
          canCreate ? (
            <Button onClick={() => setEditing({ id: null })}>
              <Plus /> New task
            </Button>
          ) : undefined
        }
      />
      {readOnly && <Banner tone="locked" className="mb-4">The school is in read-only mode, so tasks can be read but not changed for now.</Banner>}
      {counts.overdue > 0 && view !== 'done' && (
        <Banner tone="warning" className="mb-4" title={`${counts.overdue} overdue`}>
          These are past their due date — finish them first, or move the date if the plan changed.
        </Banner>
      )}

      {canCreate && <QuickAdd />}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Which tasks to show"
          value={view}
          onChange={(v) => setView(v)}
          options={[
            { value: 'open', label: `To do${feed.data ? ` (${counts.open})` : ''}` },
            { value: 'done', label: `Done${feed.data ? ` (${counts.done})` : ''}` },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      <QueryView
        query={feed}
        skeleton={<TaskSkeleton />}
        isEmpty={() => visible.length === 0}
        empty={
          <Card>
            <EmptyState
              illustration="empty-homework"
              title={view === 'done' ? 'Nothing is marked done yet' : view === 'all' ? 'No tasks yet' : 'You’re all caught up'}
              description={view === 'done' ? 'Tasks you tick off will be listed here.' : 'Homework to hand in shows up here automatically. Add your own to-dos too.'}
              action={canCreate && view !== 'done' ? <Button onClick={() => setEditing({ id: null })}><Plus /> Add a task</Button> : undefined}
            />
          </Card>
        }
      >
        {() => (
          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.b} aria-labelledby={`tasks-${g.b}`}>
                <h2 id={`tasks-${g.b}`} className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                  {BUCKET_LABEL[g.b]}
                  <span className="tnum rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-2">{g.rows.length}</span>
                </h2>
                <Card>
                  <ul className="divide-y divide-border">
                    {g.rows.map((i) => (
                      <TaskRow key={`${i.kind}-${i.id}`} item={i} bucket={g.b} onEdit={() => setEditing({ id: i.id })} />
                    ))}
                  </ul>
                </Card>
              </section>
            ))}
          </div>
        )}
      </QueryView>

      {editing && <TaskDrawer id={editing.id} onClose={() => setEditing(null)} />}
    </>
  );
}

function TaskSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only">Loading tasks…</span>
      <Skeleton className="h-4 w-24" />
      <Card>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0 max-sm:px-4">
            <Skeleton className="size-[18px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function QuickAdd() {
  const create = useCreateTask();
  const [title, setTitle] = React.useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    try {
      await create.mutateAsync({ title: t, priority: 'normal' });
      setTitle('');
      toast.success('Task added');
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
    }
  };
  return (
    <form onSubmit={submit} className="mb-5 flex gap-2" aria-label="Add a task">
      <div className="min-w-0 flex-1">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Add a task and press Enter…" aria-label="New task title" leftIcon={<Plus />} />
      </div>
      <Button type="submit" variant="secondary" loading={create.isPending} disabled={!title.trim()}>
        Add
      </Button>
    </form>
  );
}

function TaskRow({ item, bucket, onEdit }: { item: Item; bucket: Bucket; onEdit: () => void }) {
  const l = useLearner();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const { readOnly, can } = useGates();
  const [confirm, setConfirm] = React.useState(false);
  const isTask = item.kind === 'task';
  const done = isTask && item.status === 'done';
  const due = item.dueAt ? dueLabel(item.dueAt) : null;
  const toggle = async () => {
    try {
      await update.mutateAsync({ id: item.id, body: { status: done ? 'todo' : 'done' } });
      toast.success(done ? 'Moved back to your list' : 'Marked as done');
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    }
  };
  const editable = isTask && can('tasks:edit') && !readOnly;
  const deletable = isTask && can('tasks:delete') && !readOnly;
  return (
    <li className="flex items-start gap-3 px-5 py-3.5 max-sm:px-4">
      {isTask ? (
        <span className="mt-0.5 grid size-6 place-items-center">
          <Checkbox checked={done} disabled={!editable || update.isPending} onCheckedChange={() => void toggle()} aria-label={done ? `Mark “${item.title}” as not done` : `Mark “${item.title}” as done`} />
        </span>
      ) : (
        <span className="mt-0.5 grid size-6 place-items-center text-ink-3" title="Homework">
          <BookOpen className="size-4" aria-hidden />
          <span className="sr-only">Homework</span>
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {isTask ? (
            <button type="button" onClick={editable ? onEdit : undefined} className={cn('min-w-0 text-left text-sm font-medium', done && 'text-ink-3 line-through', editable && 'hover:underline')}>
              {item.title}
            </button>
          ) : (
            <Link href={`${l.base}/learning/homework/${item.id}`} className="min-w-0 text-sm font-medium hover:underline">
              {item.title}
            </Link>
          )}
          {item.priority === 'high' && !done && <Badge variant="warning">High priority</Badge>}
        </p>
        <p className="t-caption mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
          {item.subtitle && <span className="min-w-0 truncate">{item.subtitle}</span>}
          {due && !done && (
            <span className={cn(bucket === 'overdue' && 'font-medium text-danger')}>
              {bucket === 'overdue' ? 'Overdue · ' : ''}
              {due.text}
            </span>
          )}
          {!isTask && <HomeworkStatusChip status={item.status} />}
          {isTask && item.status === 'doing' && <Badge variant="info">In progress</Badge>}
        </p>
      </div>
      {!isTask && (
        <Button asChild variant="secondary" size="sm">
          <Link href={`${l.base}/learning/homework/${item.id}`}>{item.status === 'returned' ? 'Rework' : 'Open'}</Link>
        </Button>
      )}
      {isTask && (editable || deletable) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`More actions for ${item.title}`} size="icon-sm">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {editable && (
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
            )}
            {editable && !done && item.status !== 'doing' && (
              <DropdownMenuItem onSelect={() => void update.mutateAsync({ id: item.id, body: { status: 'doing' } }).catch((e) => toast.error(errorMessage(e)))}>
                <AlarmClock /> Start it
              </DropdownMenuItem>
            )}
            {deletable && (
              <DropdownMenuItem danger onSelect={() => setConfirm(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this task?"
        description={<>“{item.title}” will be removed from your list. This can’t be undone.</>}
        confirmLabel="Delete task"
        destructive
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(item.id);
            setConfirm(false);
            toast.success('Task deleted');
          } catch (e) {
            toast.error(errorMessage(e), { duration: 8000 });
          }
        }}
      />
    </li>
  );
}

// ───────────────────────────── create / edit ─────────────────────────────

const formSchema = taskCreateBody.extend({ status: z.enum(TASK_STATUSES).optional() });

function TaskDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const existing = useTask(id);
  const loading = !!id && existing.isPending;
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty);
  return (
    <Drawer open onOpenChange={(o) => !o && guard(onClose)}>
      <DrawerContent title={id ? 'Edit task' : 'New task'} description="A to-do just for you. Teachers can’t see it." showTitle>
        {loading ? (
          <SheetBody>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-9 w-full" />
          </SheetBody>
        ) : id && existing.isError ? (
          <div className="p-5">
            <EmptyState compact illustration="error-offline" title="We couldn’t open this task" description={errorMessage(existing.error)} action={<Button variant="secondary" size="sm" onClick={() => void existing.refetch()}>Try again</Button>} />
          </div>
        ) : (
          <TaskForm
            key={id ?? 'new'}
            id={id}
            onClose={onClose}
            onCancel={() => guard(onClose)}
            onDirty={setDirty}
            defaults={
              existing.data
                ? { title: existing.data.title, notes: existing.data.notes ?? '', dueAt: existing.data.dueAt, remindAt: existing.data.remindAt, priority: existing.data.priority, status: existing.data.status }
                : { title: '', notes: '', dueAt: null, remindAt: null, priority: 'normal' as const }
            }
          />
        )}
      </DrawerContent>
      {dialog}
    </Drawer>
  );
}

function TaskForm({ id, defaults, onClose, onCancel, onDirty }: { id: string | null; defaults: z.input<typeof formSchema>; onClose: () => void; onCancel: () => void; onDirty: (d: boolean) => void }) {
  const create = useCreateTask();
  const update = useUpdateTask();
  const { readOnly } = useGates();
  const form = useZodForm(formSchema, { defaultValues: defaults });
  const [formError, setFormError] = React.useState<string | null>(null);
  const isDirty = form.formState.isDirty;
  React.useEffect(() => onDirty(isDirty), [isDirty, onDirty]);
  const due = form.watch('dueAt');
  const remind = form.watch('remindAt');

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    if (v.remindAt && v.dueAt && new Date(v.remindAt) > new Date(v.dueAt)) {
      form.setError('remindAt', { message: 'The reminder should come before the due time.' });
      return;
    }
    try {
      const body = { title: v.title, notes: v.notes?.trim() ? v.notes : null, dueAt: v.dueAt ?? null, remindAt: v.remindAt ?? null, priority: v.priority };
      if (id) await update.mutateAsync({ id, body: { ...body, status: v.status } });
      else await create.mutateAsync(body);
      toast.success(id ? 'Task saved' : 'Task added');
      onClose();
    } catch (e) {
      setFormError(applyApiErrors(form, e));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex h-full flex-col">
      <SheetBody className="flex-1">
        <FormInput control={form.control} name="title" label="What do you need to do?" required maxLength={200} autoFocus />
        <FormTextarea control={form.control} name="notes" label="Notes" hint="Optional — anything you want to remember." rows={3} maxLength={2000} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormSelect
            control={form.control}
            name="priority"
            label="Priority"
            options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] ?? p }))}
          />
          {id && (
            <FormSelect
              control={form.control}
              name="status"
              label="Progress"
              options={[
                { value: 'todo', label: 'To do' },
                { value: 'doing', label: 'In progress' },
                { value: 'done', label: 'Done' },
              ]}
            />
          )}
        </div>
        <FormDateTime control={form.control} name="dueAt" label="Due" defaultTime="17:00" />
        <FormDateTime control={form.control} name="remindAt" label="Remind me" defaultTime="08:00" hint={remind ? `We’ll notify you on ${fmtDateTime(remind)}.` : due ? 'Pick a time before the due date and we’ll send a notification.' : 'We’ll send you a notification at this time.'} />
        {formError && <Banner tone="danger">{formError}</Banner>}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} disabled={readOnly}>
          {id ? 'Save changes' : 'Add task'}
        </Button>
      </SheetFooter>
    </form>
  );
}
