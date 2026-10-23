'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Check, CheckCircle2, Clock3, MessageSquareText } from 'lucide-react';
import type { AttendanceRosterResponse, AttendanceRosterStudent, AttendanceStatusCounts } from '@school-sync/shared';
import { useAttendanceToday, useRoster, useSubmitRoster } from '@/lib/client/hooks';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { ApiError, errorMessage } from '@/lib/problem';
import { fmtDate, fmtDateTime, plural, todayIso } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Illustration } from '../illustrations/illustration';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { Card, CardBody } from '../ui/card';
import { DatePicker } from '../ui/date-picker';
import { EmptyState } from '../ui/empty-state';
import { ProgressBar } from '../ui/progress';
import { Skeleton } from '../ui/skeleton';
import { StatusChip } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { toast } from '../ui/toaster';
import { PageHeader } from '../shell/page-header';

type Status = 'present' | 'absent' | 'late' | 'half_day' | 'leave';
interface Mark {
  status: Status | null;
  remarks: string;
}

const KEYS: Record<string, Status> = { p: 'present', a: 'absent', l: 'late', h: 'half_day' };
const OPTIONS: { status: Exclude<Status, 'leave'>; key: string; label: string; on: string }[] = [
  { status: 'present', key: 'P', label: 'Present', on: 'border-success bg-success-soft text-success' },
  { status: 'absent', key: 'A', label: 'Absent', on: 'border-danger bg-danger-soft text-danger' },
  { status: 'late', key: 'L', label: 'Late', on: 'border-warning bg-warning-soft text-warning' },
  { status: 'half_day', key: 'H', label: 'Half day', on: 'border-warning bg-surface text-warning' },
];

/** Human wording for every code the roll-call endpoints can answer with. */
const REASONS: Record<string, string> = {
  FUTURE_DATE: 'Attendance can’t be taken for a future date.',
  NOT_A_WORKING_DAY: 'That date is not a school working day, so there is nothing to mark.',
  HOLIDAY: 'That date is a holiday, so there is nothing to mark.',
  EDIT_WINDOW_CLOSED: 'The time to edit this roll call has passed. Ask the class teacher or the office for a correction.',
  NOT_CLASS_TEACHER: 'Only this class’s teacher can take its daily attendance.',
  NOT_YOUR_PERIOD: 'This period isn’t one of yours, so you can’t take its attendance.',
  NOT_ALLOWED_TO_MARK: 'You don’t have permission to mark attendance for this class.',
  PERIOD_REQUIRED: 'Pick the period you are taking attendance for.',
};
const reason = (code: string | null | undefined) => (code ? (REASONS[code] ?? 'Attendance can’t be submitted for this class right now.') : null);

const keyOf = (sectionId: string, periodId: string | null) => `${sectionId}:${periodId ?? ''}`;

export function RollCallScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const today = useAttendanceToday();
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Discard this roll call?', description: 'You have marks that have not been submitted. If you switch now they will be lost.', confirmLabel: 'Discard marks' });

  const items = today.data?.items ?? [];
  const date = sp.get('date') || todayIso();
  const selected = items.find((i) => keyOf(i.sectionId, i.periodId) === sp.get('class')) ?? items.find((i) => !i.marked) ?? items[0];
  const selKey = selected ? keyOf(selected.sectionId, selected.periodId) : '';

  const setParams = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) n.delete(k);
      else n.set(k, v);
    }
    router.replace(`${pathname}?${n.toString()}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Take the roll call for your class. Marks are saved when you submit."
        actions={
          <div className="w-44">
            <DatePicker value={date} max={todayIso()} onChange={(v) => guard(() => setParams({ date: v === todayIso() ? null : v }))} presets={[{ label: 'Yesterday', value: shiftDay(-1) }]} />
          </div>
        }
      />

      {today.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : today.isError ? (
        <Card>
          <EmptyState illustration="error-offline" title="We couldn’t load your classes" description={errorMessage(today.error)} action={<Button variant="secondary" onClick={() => void today.refetch()}>Try again</Button>} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            illustration="empty-generic"
            title="No classes to take attendance for"
            description={today.data.holiday ? `Today is a holiday (${today.data.holiday}).` : !today.data.isWorkingDay ? 'Today is not a working day.' : 'You aren’t assigned a class for attendance. If that looks wrong, ask the school office.'}
            action={
              <Button asChild variant="secondary">
                <Link href="/teacher">Back to home</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {items.length > 1 && (
            <Tabs value={selKey} onValueChange={(v) => guard(() => setParams({ class: v }))}>
              <TabsList aria-label="Your classes">
                {items.map((i) => (
                  <TabsTrigger key={keyOf(i.sectionId, i.periodId)} value={keyOf(i.sectionId, i.periodId)}>
                    {i.sectionName}
                    {i.periodName ? ` · ${i.periodName}` : ''}
                    {i.marked ? <CheckCircle2 className="size-3.5 text-success" aria-label="marked" /> : <Clock3 className="size-3.5 text-warning" aria-label="not yet marked" />}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          {selected && (
            <RollCallPanel
              key={`${selKey}|${date}`}
              sectionId={selected.sectionId}
              periodId={selected.periodId}
              date={date}
              nextPending={items.find((i) => !i.marked && keyOf(i.sectionId, i.periodId) !== selKey) ?? null}
              onDirtyChange={setDirty}
              onGoto={(i) => setParams({ class: keyOf(i.sectionId, i.periodId) })}
            />
          )}
        </div>
      )}
      {dialog}
    </>
  );
}

function shiftDay(delta: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function initialMarks(r: AttendanceRosterResponse): Record<string, Mark> {
  return Object.fromEntries(r.students.map((s) => [s.studentId, { status: s.status ?? (s.onApprovedLeave ? 'leave' : null), remarks: s.remarks ?? '' } as Mark]));
}
const sameMarks = (a: Record<string, Mark>, b: Record<string, Mark>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k]?.status === v.status && (b[k]?.remarks ?? '') === v.remarks);

function RollCallPanel({ sectionId, periodId, date, nextPending, onDirtyChange, onGoto }: { sectionId: string; periodId: string | null; date: string; nextPending: { sectionId: string; periodId: string | null } | null; onDirtyChange: (d: boolean) => void; onGoto: (i: { sectionId: string; periodId: string | null }) => void }) {
  const roster = useRoster(sectionId, date, periodId);
  const submit = useSubmitRoster(sectionId);
  const [marks, setMarks] = React.useState<Record<string, Mark> | null>(null);
  const [base, setBase] = React.useState<Record<string, Mark> | null>(null);
  const [active, setActive] = React.useState(0);
  const [notes, setNotes] = React.useState<Record<string, boolean>>({});
  const [error, setError] = React.useState<ApiError | null>(null);
  const [done, setDone] = React.useState<{ counts: AttendanceStatusCounts & { total: number }; changed: number; notified: number; first: boolean; until: string } | null>(null);
  const rows = React.useRef<(HTMLLIElement | null)[]>([]);
  const r = roster.data;

  React.useEffect(() => {
    if (r && !done) {
      const m = initialMarks(r);
      setMarks(m);
      setBase(m);
    }
  }, [r, done]);

  const dirty = !!marks && !!base && !sameMarks(marks, base);
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const students = React.useMemo(() => r?.students ?? [], [r]);
  const editable = !!r?.canSubmit && !done;
  const counts = React.useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0, unmarked: 0 };
    for (const s of students) {
      const st = marks?.[s.studentId]?.status;
      if (st) c[st]++;
      else c.unmarked++;
    }
    return c;
  }, [students, marks]);

  const setStatus = (id: string, status: Status | null) => {
    setError(null);
    setMarks((m) => (m ? { ...m, [id]: { ...m[id]!, status } } : m));
  };
  const lockedLeave = (s: AttendanceRosterStudent) => s.onApprovedLeave;
  const markAll = (onlyBlank: boolean) => {
    setError(null);
    setMarks((m) => (m ? Object.fromEntries(students.map((s) => [s.studentId, lockedLeave(s) ? m[s.studentId]! : onlyBlank && m[s.studentId]?.status ? m[s.studentId]! : { ...m[s.studentId]!, status: 'present' as Status }])) : m));
  };

  const focusRow = (i: number) => {
    const n = Math.max(0, Math.min(students.length - 1, i));
    setActive(n);
    rows.current[n]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (!editable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const s = students[active];
    if (KEYS[k] && s && !lockedLeave(s)) {
      e.preventDefault();
      setStatus(s.studentId, KEYS[k]!);
      focusRow(active + 1);
    } else if (k === 'arrowdown' || k === 'j') {
      e.preventDefault();
      focusRow(active + 1);
    } else if (k === 'arrowup' || k === 'k') {
      e.preventDefault();
      focusRow(active - 1);
    } else if (k === 'home') {
      e.preventDefault();
      focusRow(0);
    } else if (k === 'end') {
      e.preventDefault();
      focusRow(students.length - 1);
    } else if ((k === 'backspace' || k === 'delete' || k === 'u') && s && !lockedLeave(s)) {
      e.preventDefault();
      setStatus(s.studentId, null);
    }
  };

  const doSubmit = () => {
    if (!marks || !r) return;
    setError(null);
    submit.mutate(
      { date, periodId: periodId ?? undefined, records: students.map((s) => ({ studentId: s.studentId, status: (marks[s.studentId]!.status ?? 'present') as Status, remarks: marks[s.studentId]!.remarks.trim() || null })) },
      {
        onSuccess: (res) => {
          setDone({ counts: res.counts, changed: res.changed, notified: res.notifiedGuardians, first: res.firstSubmission, until: res.editableUntil });
          toast.success('Roll call submitted', { description: `${res.counts.present} present · ${res.counts.absent} absent · ${res.counts.late} late` });
        },
        onError: (e) => {
          const err = e instanceof ApiError ? e : new ApiError({ status: 0, code: 'API_UNREACHABLE' });
          setError(err);
          if (err.code === 'EDIT_WINDOW_CLOSED' || err.code === 'NOT_A_WORKING_DAY' || err.code === 'HOLIDAY') void roster.refetch();
        },
      },
    );
  };

  /* ───────── states ───────── */
  if (roster.isPending) return <RosterSkeleton />;
  if (roster.isError || !r)
    return (
      <Card>
        <EmptyState illustration="error-offline" title="We couldn’t load this class" description={errorMessage(roster.error)} action={<Button variant="secondary" onClick={() => void roster.refetch()}>Try again</Button>} />
      </Card>
    );

  if (done) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center py-10 text-center">
          <Illustration name="success" className="mb-3 w-44" />
          <h2 className="t-section">{done.first ? 'Roll call submitted' : 'Roll call updated'}</h2>
          <p className="mt-1 max-w-md text-sm text-ink-2">
            {r.gradeName} {r.sectionName}, {fmtDate(r.date, { weekday: 'long', day: 'numeric', month: 'long' })}: {done.counts.present} present, {done.counts.absent} absent, {done.counts.late} late
            {done.counts.half_day ? `, ${done.counts.half_day} half day` : ''}
            {done.counts.leave ? `, ${done.counts.leave} on leave` : ''}.
          </p>
          <p className="t-caption mt-2 text-ink-2">
            {done.changed > 0 && !done.first ? `${plural(done.changed, 'mark')} changed. ` : ''}
            {done.notified > 0 ? `${plural(done.notified, 'guardian')} notified of an absence. ` : ''}
            You can edit until {fmtDateTime(done.until)}.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {nextPending && <Button onClick={() => onGoto(nextPending)}>Next class</Button>}
            <Button variant={nextPending ? 'secondary' : 'primary'} onClick={() => { setDone(null); void roster.refetch(); }}>Edit roll call</Button>
            <Button asChild variant="ghost"><Link href="/teacher">Back to home</Link></Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const blocked = !r.canSubmit ? reason(r.blockedReason) : null;
  const submitted = r.session?.status === 'submitted';
  const canSend = editable && counts.unmarked === 0 && (dirty || !submitted);

  return (
    <div className="space-y-4" onKeyDown={onKeyDown}>
      {blocked && (
        <Banner tone="warning" title={r.blockedReason === 'EDIT_WINDOW_CLOSED' ? 'Editing has closed' : 'You can’t submit this roll call'}>
          {blocked}
          {r.canRequestCorrection && (
            <>
              {' '}
              <Link href={`/teacher/attendance/history?section=${sectionId}&date=${date}${periodId ? `&period=${periodId}` : ''}`} className="font-medium text-brand-ink underline underline-offset-4">
                Request a correction
              </Link>{' '}
              for individual students.
            </>
          )}
        </Banner>
      )}
      {r.warnings.filter((w) => w !== r.blockedReason).map((w) => (
        <Banner key={w} tone="info">{reason(w) ?? w}</Banner>
      ))}
      {r.session && (
        <p className="t-caption flex items-center gap-1.5 text-ink-2">
          <Check className="size-3.5 text-success" aria-hidden />
          {r.session.status === 'submitted' ? `Submitted by ${r.session.takenByName ?? 'a teacher'}${r.session.submittedAt ? ` at ${fmtDateTime(r.session.submittedAt)}` : ''}.` : 'A draft is saved for this class.'}
          {r.session.editableUntil && editable ? ` You can edit until ${fmtDateTime(r.session.editableUntil)}.` : ''}
        </p>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 max-sm:px-3">
          <div className="min-w-0">
            <h2 className="t-section">
              {r.gradeName} {r.sectionName}
              {r.periodName ? ` · ${r.periodName}` : ''}
            </h2>
            <p className="t-caption text-ink-2">
              {plural(students.length, 'student')} · {fmtDate(r.date, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          {editable && (
            <Button variant="secondary" size="sm" onClick={() => markAll(false)}>
              <Check /> Mark all present
            </Button>
          )}
        </div>
        {editable && (
          <p className="t-caption hidden border-b border-border bg-surface-subtle px-4 py-2 text-ink-2 md:block" aria-label="Keyboard shortcuts">
            Shortcuts: <kbd className="rounded border border-border bg-surface px-1">P</kbd> present · <kbd className="rounded border border-border bg-surface px-1">A</kbd> absent · <kbd className="rounded border border-border bg-surface px-1">L</kbd> late · <kbd className="rounded border border-border bg-surface px-1">H</kbd> half day · <kbd className="rounded border border-border bg-surface px-1">↑</kbd> <kbd className="rounded border border-border bg-surface px-1">↓</kbd> move
          </p>
        )}
        {students.length === 0 ? (
          <EmptyState compact illustration="empty-generic" title="No students in this class" description="Students appear here once they are allocated to the section." />
        ) : (
          <ul role="group" aria-label="Roster" className="divide-y divide-border">
            {students.map((s, i) => {
              const m = marks?.[s.studentId] ?? { status: null, remarks: '' };
              const locked = !editable || lockedLeave(s);
              return (
                <li
                  key={s.studentId}
                  ref={(el) => {
                    rows.current[i] = el;
                  }}
                  tabIndex={i === active ? 0 : -1}
                  onFocus={() => setActive(i)}
                  className={cn('px-4 py-2 outline-offset-[-2px] max-sm:px-3', i === active && editable && 'bg-surface-subtle/60')}
                  aria-label={`${s.name}, ${m.status ? STATUS_LABEL[m.status] : 'not marked'}`}
                >
                  <div className="flex min-h-11 items-center gap-3">
                    <span className="tnum w-7 shrink-0 text-right text-[13px] text-ink-3">{s.rollNo ?? i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="t-caption truncate text-ink-3">{s.admissionNo}{s.onApprovedLeave ? ' · approved leave' : ''}</p>
                    </div>
                    {s.onApprovedLeave ? (
                      <StatusChip status="leave" />
                    ) : (
                      <StatusControl value={m.status} disabled={locked} onChange={(st) => setStatus(s.studentId, st)} name={s.name} />
                    )}
                    {!locked && (
                      <button type="button" onClick={() => setNotes((n) => ({ ...n, [s.studentId]: !n[s.studentId] }))} aria-label={`Note for ${s.name}`} aria-pressed={!!notes[s.studentId] || !!m.remarks} className={cn('tr-colors grid size-11 shrink-0 place-items-center rounded-md hover:bg-surface-subtle sm:size-8', m.remarks ? 'text-brand-ink' : 'text-ink-3')}>
                        <MessageSquareText className="size-4" />
                      </button>
                    )}
                  </div>
                  {(notes[s.studentId] || m.remarks) && !locked && (
                    <input
                      value={m.remarks}
                      onChange={(e) => setMarks((mm) => (mm ? { ...mm, [s.studentId]: { ...mm[s.studentId]!, remarks: e.target.value.slice(0, 300) } } : mm))}
                      placeholder="Add a note (optional)"
                      aria-label={`Note for ${s.name}`}
                      className="mb-1 ml-10 mt-1 h-9 w-[calc(100%-2.5rem)] rounded-md border border-border-strong bg-surface px-3 text-sm placeholder:text-ink-3 focus:border-brand focus:outline-none focus:shadow-[0_0_0_3px_var(--ring)]"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* summary footer */}
      {students.length > 0 && (
        <div className="sticky bottom-14 z-20 rounded-lg border border-border bg-surface-raised p-3 shadow-pop md:bottom-4" role="region" aria-label="Roll call summary">
          {error && (
            <Banner tone="danger" className="mb-3" title={error.code === 'EDIT_WINDOW_CLOSED' ? 'Editing has closed' : 'Couldn’t submit the roll call'}>
              {reason(error.code) && error.code !== 'VALIDATION_ERROR' ? reason(error.code) : errorMessage(error)}
              {error.errors.length > 0 && <ul className="mt-1 list-disc pl-5">{error.errors.slice(0, 3).map((x) => <li key={x.path + x.message}>{x.message}</li>)}</ul>}
            </Banner>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <dl className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
              {(['present', 'absent', 'late', 'half_day', 'leave'] as const).filter((k) => k !== 'leave' || counts.leave > 0).map((k) => (
                <div key={k} className="flex items-center gap-1.5">
                  <dt><StatusChip status={k} /></dt>
                  <dd className="figure text-lg leading-6">{counts[k]}</dd>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <dt className="t-caption text-ink-2">Not marked</dt>
                <dd className={cn('figure text-lg leading-6', counts.unmarked > 0 && 'text-warning')}>{counts.unmarked}</dd>
              </div>
            </dl>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              {editable && counts.unmarked > 0 && (
                <Button variant="secondary" onClick={() => markAll(true)} className="max-sm:flex-1">
                  Mark rest present
                </Button>
              )}
              <Button onClick={doSubmit} loading={submit.isPending} disabled={!canSend} className="max-sm:flex-1">
                {submitted ? 'Update roll call' : 'Submit roll call'}
              </Button>
            </div>
          </div>
          <div className="mt-2.5">
            <ProgressBar value={students.length - counts.unmarked} max={students.length} label="Students marked" />
          </div>
          {editable && counts.unmarked > 0 && <p className="t-caption mt-1.5 flex items-center gap-1.5 text-ink-2"><AlertTriangle className="size-3.5 text-warning" aria-hidden /> Mark every student to submit.</p>}
          {editable && counts.unmarked === 0 && submitted && !dirty && <p className="t-caption mt-1.5 text-ink-2">No changes since the last submission.</p>}
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<Status, string> = { present: 'present', absent: 'absent', late: 'late', half_day: 'half day', leave: 'on leave' };

/** Segmented P / A / L / H control. Selected = tint + icon + label (never colour alone). */
function StatusControl({ value, onChange, disabled, name }: { value: Status | null; onChange: (s: Status) => void; disabled?: boolean; name: string }) {
  return (
    <div role="radiogroup" aria-label={`Attendance for ${name}`} className="flex shrink-0 gap-1">
      {OPTIONS.map((o) => {
        const on = value === o.status;
        return (
          <button
            key={o.status}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            tabIndex={-1}
            disabled={disabled}
            onClick={() => onChange(o.status)}
            className={cn(
              'press tr-colors inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-md border px-2 text-[13px] font-medium sm:h-8 sm:min-w-0 sm:px-2.5',
              on ? o.on : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-subtle hover:text-ink',
              'disabled:pointer-events-none disabled:border-border disabled:bg-surface-subtle disabled:text-ink-disabled',
            )}
          >
            {on && <Check className="size-3.5 max-sm:hidden" aria-hidden />}
            <span className="sm:hidden">{o.key}</span>
            <span className="max-sm:hidden">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function RosterSkeleton() {
  return (
    <Card aria-busy>
      <div className="border-b border-border px-4 py-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1.5 h-3 w-56" />
      </div>
      <ul className="divide-y divide-border">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="flex min-h-[60px] items-center gap-3 px-4">
            <Skeleton className="h-4 w-6" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-8 w-56 max-sm:w-32" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
