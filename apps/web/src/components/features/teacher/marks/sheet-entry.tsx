'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MessageSquareText, RotateCw, Send } from 'lucide-react';
import type { SheetDetailOut, SheetEntryOut } from '@school-sync/shared';
import { ABSENT_TOKEN, cleanPasted, MARK_TYPING, parseMark, useMarkSheet, useSaveEntries, useSubmitSheet, type MarkEntryBody } from '@/lib/client/teacher-marks';
import { secLabel, useMyTeaching } from '@/lib/client/teacher';
import { isOutOfScope, teacherError } from '@/lib/client/teacher-errors';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { ApiError } from '@/lib/problem';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, plural } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { controlBase } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { PageHeader } from '@/components/shell/page-header';
import { useMeContext } from '@/components/me-context';
import { ErrorCard, OutOfScope, useWriteGate } from '../common';

interface RowState {
  marks: string;
  absent: boolean;
  remarks: string;
}
type Rows = Record<string, RowState>;

const AUTOSAVE_MS = 2500;
const CHUNK = 300;

const normMarks = (r: RowState): string => (r.absent || r.marks.trim() === '' || r.marks.trim() === '.' ? '' : String(Number(r.marks)));
const sameRow = (a: RowState | undefined, b: RowState | undefined): boolean => !!a && !!b && a.absent === b.absent && normMarks(a) === normMarks(b) && a.remarks.trim() === b.remarks.trim();
const toRow = (e: SheetEntryOut): RowState => ({ marks: e.marksObtained === null ? '' : String(e.marksObtained), absent: e.isAbsent, remarks: e.remarks ?? '' });
const initRows = (entries: SheetEntryOut[]): Rows => Object.fromEntries(entries.map((e) => [e.studentId, toRow(e)]));
const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/* ───────────────────────── screen: load, then edit ───────────────────────── */

export function SheetEntryScreen({ id }: { id: string }) {
  const { base } = useMeContext();
  const q = useMarkSheet(id);
  const back = `${base}/marks`;

  if (q.isError && !q.data) {
    return (
      <>
        <PageHeader title="Mark sheet" crumbs={[{ label: 'Marks', href: back }, { label: 'Mark sheet' }]} />
        {isOutOfScope(q.error) ? <OutOfScope what="This mark sheet" backHref={back} backLabel="Back to mark sheets" /> : <ErrorCard error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this mark sheet" />}
      </>
    );
  }
  // wait for a fresh copy: the reviewer may have returned or approved the sheet since the list was loaded
  if (!q.data || !q.isFetchedAfterMount) return <GridSkeleton />;
  return <SheetEditor key={q.data.id} sheet={q.data} refetch={() => void q.refetch()} />;
}

function GridSkeleton() {
  return (
    <div aria-busy aria-label="Loading mark sheet">
      <Skeleton className="mb-2 h-4 w-56" />
      <Skeleton className="mb-1 h-8 w-80" />
      <Skeleton className="mb-6 h-4 w-64" />
      <Card>
        <ul className="divide-y divide-border">
          {Array.from({ length: 10 }, (_, i) => (
            <li key={i} className="flex min-h-[60px] items-center gap-3 px-4">
              <Skeleton className="h-4 w-6" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-9 w-24" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ───────────────────────── the editor ───────────────────────── */

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function SheetEditor({ sheet, refetch }: { sheet: SheetDetailOut; refetch: () => void }) {
  const { base } = useMeContext();
  const gate = useWriteGate();
  const teaching = useMyTeaching();
  const save = useSaveEntries(sheet.id);
  const submit = useSubmitSheet(sheet.id);

  const max = sheet.maxMarks;
  const passMarks = sheet.passMarks;
  const [students] = React.useState(sheet.entries);
  const [rows, setRows] = React.useState<Rows>(() => initRows(sheet.entries));
  const [saved, setSaved] = React.useState<Rows>(() => initRows(sheet.entries));
  const rowsRef = React.useRef(rows);
  const savedRef = React.useRef(saved);
  React.useLayoutEffect(() => {
    rowsRef.current = rows;
    savedRef.current = saved;
  }, [rows, saved]);
  const [status, setStatus] = React.useState<SaveStatus>('idle');
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const listRef = React.useRef<HTMLUListElement>(null);
  const footerRef = React.useRef<HTMLDivElement>(null);

  const editable = sheet.canEdit && !gate.readOnly;
  const refetchRef = React.useRef(refetch);
  React.useLayoutEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  /* ── derived: validation + live summary ── */
  const stats = React.useMemo(() => {
    let entered = 0, absent = 0, missing = 0, errors = 0, sum = 0, pass = 0, fail = 0;
    let hi: number | null = null;
    let lo: number | null = null;
    for (const e of students) {
      const r = rows[e.studentId]!;
      if (r.absent) {
        absent++;
        continue;
      }
      const p = parseMark(r.marks, max);
      if (p.error) {
        errors++;
        continue;
      }
      if (p.value === null) {
        missing++;
        continue;
      }
      entered++;
      sum += p.value;
      hi = hi === null ? p.value : Math.max(hi, p.value);
      lo = lo === null ? p.value : Math.min(lo, p.value);
      if (passMarks !== null) {
        if (p.value >= passMarks) pass++;
        else fail++;
      }
    }
    return { entered, absent, missing, errors, avg: entered ? sum / entered : null, hi, lo, pass, fail };
  }, [rows, students, max, passMarks]);

  const changedIds = React.useMemo(() => students.filter((e) => !sameRow(rows[e.studentId], saved[e.studentId])).map((e) => e.studentId), [rows, saved, students]);
  const dirty = changedIds.length > 0;
  const { dialog: guardDialog } = useUnsavedGuard(editable && (dirty || status === 'saving'), { title: 'Leave with unsaved marks?', description: 'Some marks have not been saved yet. Save them first, or they will be lost.', confirmLabel: 'Discard and leave' });

  /* ── saving: serialised, only changed rows, in chunks of 300 ── */
  const inflight = React.useRef<Promise<boolean> | null>(null);
  const runSave = React.useCallback(async (): Promise<boolean> => {
    const cur = rowsRef.current;
    const base0 = savedRef.current;
    const ids = students.filter((e) => !sameRow(cur[e.studentId], base0[e.studentId])).map((e) => e.studentId);
    if (ids.length === 0) return true;
    if (ids.some((sid) => !cur[sid]!.absent && parseMark(cur[sid]!.marks, max).error)) return false;
    const entries: MarkEntryBody[] = ids.map((sid) => {
      const r = cur[sid]!;
      const p = parseMark(r.marks, max);
      return { studentId: sid, marksObtained: r.absent ? null : p.value, isAbsent: r.absent, remarks: r.remarks.trim() || null };
    });
    setStatus('saving');
    setSaveError(null);
    try {
      for (let i = 0; i < entries.length; i += CHUNK) await save.mutateAsync(entries.slice(i, i + CHUNK));
      const next = { ...savedRef.current };
      for (const sid of ids) next[sid] = { ...cur[sid]! };
      savedRef.current = next;
      setSaved(next);
      setSavedAt(new Date());
      setStatus('saved');
      return true;
    } catch (e) {
      setStatus('error');
      setSaveError(teacherError(e));
      if (e instanceof ApiError && ['SHEET_LOCKED', 'MARKS_ENTRY_NOT_OPEN', 'NOT_SUBJECT_TEACHER', 'MARKS_EXCEED_MAX', 'NOT_FOUND'].includes(e.code)) refetchRef.current();
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, max, save.mutateAsync]);

  const saveNow = React.useCallback((): Promise<boolean> => {
    const prev = inflight.current;
    const p = (async () => {
      if (prev) await prev.catch(() => false);
      return runSave();
    })();
    inflight.current = p;
    void p.finally(() => {
      if (inflight.current === p) inflight.current = null;
    });
    return p;
  }, [runSave]);

  // debounced autosave: ~2.5 s after the last edit, never while a mark is invalid
  React.useEffect(() => {
    if (!editable || !dirty || stats.errors > 0) return;
    const t = setTimeout(() => void saveNow(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [rows, editable, dirty, stats.errors, saveNow]);

  // leaving the tab: save right away
  React.useEffect(() => {
    if (!editable) return;
    const on = () => {
      if (document.visibilityState === 'hidden' && dirty && stats.errors === 0) void saveNow();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [editable, dirty, stats.errors, saveNow]);

  /* ── focus + keyboard ── */
  const focusRow = React.useCallback(
    (i: number) => {
      const root = listRef.current;
      if (!root) return;
      if (i >= students.length) {
        footerRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
        return;
      }
      const n = Math.max(0, i);
      const el = root.querySelector<HTMLInputElement>(`[data-mark="${n}"]`);
      const target = el && !el.disabled ? el : root.querySelector<HTMLElement>(`[data-abs="${n}"]`);
      target?.focus();
      if (target instanceof HTMLInputElement) target.select();
    },
    [students.length],
  );

  const didFocus = React.useRef(false);
  React.useEffect(() => {
    if (didFocus.current || !editable) return;
    didFocus.current = true;
    if (!window.matchMedia('(pointer: fine)').matches) return; // a phone keyboard popping up on load is not helpful
    const idx = students.findIndex((e) => !rows[e.studentId]!.absent && rows[e.studentId]!.marks.trim() === '');
    if (idx >= 0) focusRow(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  /* ── row handlers (stable, so memoised rows only re-render when their own data changes) ── */
  const onMarks = React.useCallback(
    (sid: string, idx: number, raw: string) => {
      if (/^\s*a/i.test(raw)) {
        setRows((r) => ({ ...r, [sid]: { ...r[sid]!, absent: true, marks: '' } }));
        requestAnimationFrame(() => focusRow(idx + 1));
        return;
      }
      const v = raw.replace(',', '.');
      if (!MARK_TYPING.test(v)) return;
      setRows((r) => (r[sid]!.marks === v ? r : { ...r, [sid]: { ...r[sid]!, marks: v } }));
    },
    [focusRow],
  );
  const onAbsent = React.useCallback(
    (sid: string, idx: number, on: boolean) => {
      setRows((r) => ({ ...r, [sid]: { ...r[sid]!, absent: on, marks: on ? '' : r[sid]!.marks } }));
      if (!on) requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>(`[data-mark="${idx}"]`)?.focus());
    },
    [],
  );
  const onRemark = React.useCallback((sid: string, v: string) => setRows((r) => ({ ...r, [sid]: { ...r[sid]!, remarks: v.slice(0, 300) } })), []);
  const onPaste = React.useCallback(
    (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData('text');
      const tokens = text.replace(/\r/g, '').split('\n');
      while (tokens.length > 1 && tokens[tokens.length - 1]!.trim() === '') tokens.pop();
      if (tokens.length <= 1) return; // a single value: normal paste, filtered by onChange
      e.preventDefault();
      // computed here (not inside the state updater) so the counts are exact and the toast never races the render
      let applied = 0, skipped = 0, extra = 0;
      const updates: { sid: string; patch: Partial<RowState> }[] = [];
      tokens.forEach((raw, k) => {
        const stu = students[idx + k];
        if (!stu) {
          extra++;
          return;
        }
        const cell = raw.includes('\t') ? (raw.split('\t').map((c) => c.trim()).filter(Boolean).pop() ?? '') : raw.trim();
        if (ABSENT_TOKEN.test(cell)) {
          updates.push({ sid: stu.studentId, patch: { absent: true, marks: '' } });
          applied++;
          return;
        }
        const cleaned = cleanPasted(cell);
        if (cleaned === null) skipped++;
        else if (cleaned !== '') {
          updates.push({ sid: stu.studentId, patch: { absent: false, marks: cleaned } });
          applied++;
        }
      });
      if (updates.length > 0) {
        setRows((r) => {
          const next = { ...r };
          for (const u of updates) next[u.sid] = { ...next[u.sid]!, ...u.patch };
          return next;
        });
      }
      const bits = [skipped ? `${plural(skipped, 'value')} skipped (not numbers)` : '', extra ? `${plural(extra, 'extra value')} ignored (past the last student)` : ''].filter(Boolean);
      if (applied > 0) toast.success(`Pasted ${plural(applied, 'value')} from row ${idx + 1}`, { description: bits.join(' · ') || undefined });
      else toast.error('Nothing was pasted', { description: 'Paste a column of numbers (or A for absent) from a spreadsheet.' });
    },
    [students],
  );

  /* ── submit ── */
  const doSubmit = async () => {
    setConfirm(false);
    setSubmitError(null);
    const ok = await saveNow();
    if (!ok) {
      setSubmitError('Your latest changes could not be saved, so the sheet was not submitted. Fix the problem above and try again.');
      return;
    }
    try {
      const r = await submit.mutateAsync();
      toast.success(r.status === 'submitted' ? 'Marks submitted for review' : 'Marks submitted', { description: `${sheet.subjectName} · ${secLabel(sheet.gradeName, sheet.sectionName)}` });
    } catch (e) {
      setSubmitError(teacherError(e));
      if (e instanceof ApiError && ['INCOMPLETE_SHEET', 'INVALID_SHEET_STATE', 'SHEET_LOCKED', 'MARKS_ENTRY_NOT_OPEN', 'NOT_SUBJECT_TEACHER'].includes(e.code)) refetchRef.current();
    }
  };

  /* ── view ── */
  const label = secLabel(sheet.gradeName, sheet.sectionName);
  const notMine = !editable && sheet.canEdit === false && (sheet.status === 'draft' || sheet.status === 'returned');
  const iTeach = teaching.isPending ? null : teaching.teaches(sheet.sectionId, sheet.subjectId);
  const canSubmit = editable && stats.missing === 0 && stats.errors === 0 && students.length > 0 && !submit.isPending;
  const needed = stats.missing + stats.errors;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Marks', href: `${base}/marks` }, { label: `${sheet.subjectName} · ${label}` }]}
        title={`${sheet.subjectName} · ${label}`}
        description={`${sheet.examName} · out of ${fmt(max)}${passMarks !== null ? ` · pass mark ${fmt(passMarks)}` : ''}${sheet.teacherName ? ` · subject teacher ${sheet.teacherName}` : ''}`}
        actions={<StatusChip status={sheet.status} />}
      />

      <div className="space-y-4">
        {sheet.status === 'returned' && (
          <Banner tone="warning" title="Returned by the reviewer">
            {sheet.returnNote ?? 'The reviewer asked for changes.'}
            {editable && <span className="mt-1 block">Correct the marks, then submit the sheet again.</span>}
          </Banner>
        )}
        {sheet.status === 'submitted' && <Banner tone="info" title="Waiting for review">Submitted{sheet.submittedAt ? ` on ${fmtDateTime(sheet.submittedAt)}` : ''}. Marks can’t be edited while the sheet is under review. If the reviewer returns it with a note you can edit it again.</Banner>}
        {sheet.status === 'approved' && <Banner tone="success" title="Approved">The reviewer approved these marks{sheet.reviewedAt ? ` on ${fmtDateTime(sheet.reviewedAt)}` : ''}. They will be published to students and parents by the school office.</Banner>}
        {sheet.status === 'published' && <Banner tone="success" title="Published">These marks were published to students and parents{sheet.publishedAt ? ` on ${fmtDate(sheet.publishedAt, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. Changes after publication go through a correction by the school office.</Banner>}
        {notMine && (
          <Banner tone="info" title="View only">
            {iTeach === true
              ? 'Marks entry isn’t open for this exam right now, so this sheet can’t be edited.'
              : iTeach === false
                ? `Only ${sheet.teacherName ?? 'the subject teacher'}, the subject teacher, can enter marks for this subject.`
                : 'You can look at these marks but not change them.'}
          </Banner>
        )}
        {gate.readOnly && (sheet.status === 'draft' || sheet.status === 'returned') && sheet.canEdit && <Banner tone="locked" title="Read-only school">{gate.reason}</Banner>}
        {saveError && (
          <Banner tone="danger" title="Couldn’t save your marks" action={editable && stats.errors === 0 ? <Button size="sm" variant="secondary" onClick={() => void saveNow()}><RotateCw /> Retry</Button> : undefined}>
            {saveError}
          </Banner>
        )}
        {submitError && <Banner tone="danger" title="The sheet was not submitted" onDismiss={() => setSubmitError(null)}>{submitError}</Banner>}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3 max-sm:px-3">
            <div className="min-w-0">
              <h2 className="t-section">Students</h2>
              <p className="t-caption text-ink-2">
                {plural(students.length, 'student')} · marks out of {fmt(max)}
              </p>
            </div>
          </div>
          {editable && (
            <p className="t-caption hidden border-b border-border bg-surface-subtle px-4 py-2 text-ink-2 md:block" aria-label="Keyboard shortcuts">
              <kbd className="rounded border border-border bg-surface px-1">Enter</kbd> or <kbd className="rounded border border-border bg-surface px-1">↓</kbd> next student · <kbd className="rounded border border-border bg-surface px-1">Shift+Enter</kbd> or <kbd className="rounded border border-border bg-surface px-1">↑</kbd> previous · type{' '}
              <kbd className="rounded border border-border bg-surface px-1">A</kbd> for absent · paste a column of marks from a spreadsheet to fill downward
            </p>
          )}
          {students.length === 0 ? (
            <EmptyState compact illustration="empty-generic" title="No students in this class" description="Students appear here once they are allocated to the section." />
          ) : (
            <ul ref={listRef} aria-label="Marks by student" className="divide-y divide-border">
              {students.map((e, i) => (
                <MarkRow key={e.studentId} idx={i} entry={e} row={rows[e.studentId]!} max={max} editable={editable} onMarks={onMarks} onAbsent={onAbsent} onRemark={onRemark} onPaste={onPaste} onNav={focusRow} />
              ))}
            </ul>
          )}
        </Card>

        {/* summary + actions */}
        <div ref={footerRef} className={cn('rounded-lg border border-border bg-surface-raised p-3 shadow-pop', editable && 'sticky bottom-14 z-20 md:bottom-4')} role="region" aria-label="Marks summary">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <dl className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1">
              <Figure label="Entered" value={`${stats.entered}`} sub={`of ${students.length}`} />
              <Figure label="Absent" value={stats.absent} />
              <Figure label="Missing" value={stats.missing} warn={stats.missing > 0 && editable} />
              {stats.errors > 0 && <Figure label="Above max" value={stats.errors} danger />}
              <Figure label="Average" value={stats.avg === null ? '—' : fmt(stats.avg)} sub={stats.avg === null ? undefined : `${fmt((stats.avg / max) * 100)}%`} />
              <Figure label="Highest" value={stats.hi === null ? '—' : fmt(stats.hi)} />
              <Figure label="Lowest" value={stats.lo === null ? '—' : fmt(stats.lo)} />
              {passMarks !== null && <Figure label="Pass" value={stats.pass} sub={stats.fail > 0 ? `${stats.fail} below` : undefined} />}
            </dl>
            {editable && (
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <SaveState status={status} dirty={dirty} errors={stats.errors} savedAt={savedAt} onRetry={() => void saveNow()} />
                <Button variant="secondary" onClick={() => void saveNow()} disabled={!dirty || stats.errors > 0 || status === 'saving'} className="max-sm:flex-1">
                  Save draft
                </Button>
                <Button onClick={() => setConfirm(true)} disabled={!canSubmit} loading={submit.isPending} className="max-sm:flex-1">
                  <Send /> Submit
                </Button>
              </div>
            )}
          </div>
          {/* one polite announcement for assistive tech: validation and save outcomes, not every keystroke */}
          <p className="sr-only" role="status" aria-live="polite">
            {stats.errors > 0 ? `${plural(stats.errors, 'mark')} above the maximum of ${fmt(max)}.` : status === 'saved' ? 'Marks saved.' : status === 'error' ? 'Marks could not be saved.' : ''}
          </p>
          {editable && needed > 0 && (
            <p className="t-caption mt-2 flex items-center gap-1.5 text-ink-2">
              <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
              {stats.errors > 0 ? `${plural(stats.errors, 'mark')} above ${fmt(max)}. Correct them to save and submit.` : `${plural(stats.missing, 'student')} still need marks or an absent flag before you can submit.`}
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit these marks for review?"
        description={
          <>
            <p>
              {sheet.subjectName}, {label}, {sheet.examName}: {plural(stats.entered, 'mark')} entered{stats.absent ? `, ${stats.absent} absent` : ''}.
            </p>
            <p className="mt-2">Once submitted you can’t change the marks, unless the reviewer returns the sheet to you.</p>
          </>
        }
        confirmLabel="Submit marks"
        loading={submit.isPending}
        onConfirm={() => void doSubmit()}
      />
      {guardDialog}
    </>
  );
}

function Figure({ label, value, sub, warn, danger }: { label: string; value: React.ReactNode; sub?: string; warn?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="t-caption text-ink-2">{label}</dt>
      <dd className={cn('figure text-lg leading-6', warn && 'text-warning', danger && 'text-danger')}>
        {value}
        {sub && <span className="t-caption ml-1 font-sans text-ink-3">{sub}</span>}
      </dd>
    </div>
  );
}

function SaveState({ status, dirty, errors, savedAt, onRetry }: { status: SaveStatus; dirty: boolean; errors: number; savedAt: Date | null; onRetry: () => void }) {
  const time = savedAt ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(savedAt) : '';
  let node: React.ReactNode;
  if (status === 'saving') node = <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…</>;
  else if (status === 'error') node = <><AlertTriangle className="size-3.5 text-danger" aria-hidden /> Couldn’t save · <button type="button" onClick={onRetry} className="font-medium text-brand-ink underline-offset-4 hover:underline">Retry</button></>;
  else if (dirty) node = <><AlertTriangle className="size-3.5 text-warning" aria-hidden /> {errors > 0 ? 'Fix the marks above the maximum to save' : 'Unsaved changes'}</>;
  else if (savedAt) node = <><CheckCircle2 className="size-3.5 text-success" aria-hidden /> Saved {time}</>;
  else node = <>No changes yet</>;
  return <span className="t-caption flex items-center gap-1.5 text-ink-2 max-sm:w-full">{node}</span>;
}

/* ───────────────────────── one student ───────────────────────── */

interface RowProps {
  idx: number;
  entry: SheetEntryOut;
  row: RowState;
  max: number;
  editable: boolean;
  onMarks: (sid: string, idx: number, raw: string) => void;
  onAbsent: (sid: string, idx: number, on: boolean) => void;
  onRemark: (sid: string, v: string) => void;
  onPaste: (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => void;
  onNav: (idx: number) => void;
}

const MarkRow = React.memo(function MarkRow({ idx, entry, row, max, editable, onMarks, onAbsent, onRemark, onPaste, onNav }: RowProps) {
  const [noteOpen, setNoteOpen] = React.useState(false);
  const errId = React.useId();
  const parsed = row.absent ? { value: null, error: null } : parseMark(row.marks, max);
  const pct = parsed.value !== null && !parsed.error ? (parsed.value / max) * 100 : null;
  const showNote = noteOpen || !!row.remarks;

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onNav(e.shiftKey ? idx - 1 : idx + 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onNav(idx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onNav(idx - 1);
    }
  };

  return (
    <li className={cn('scroll-my-28 px-4 py-2 focus-within:bg-surface-subtle max-sm:px-3', parsed.error && 'bg-danger-soft focus-within:bg-danger-soft')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="tnum w-7 shrink-0 text-right text-[13px] text-ink-3">{entry.rollNo ?? idx + 1}</span>
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-sm font-medium">{entry.name}</p>
          <p className="t-caption truncate text-ink-3">{entry.admissionNo}</p>
        </div>
        {editable ? (
          <div className="flex items-center gap-2 max-sm:w-full max-sm:pl-10">
            <input
              data-mark={idx}
              inputMode="decimal"
              autoComplete="off"
              value={row.marks}
              disabled={row.absent}
              placeholder={row.absent ? 'Absent' : '—'}
              aria-label={`Marks for ${entry.name}, out of ${max}`}
              aria-invalid={parsed.error ? true : undefined}
              aria-describedby={parsed.error ? errId : undefined}
              onChange={(e) => onMarks(entry.studentId, idx, e.target.value)}
              onKeyDown={onKey}
              onPaste={(e) => onPaste(idx, e)}
              onFocus={(e) => e.currentTarget.select()}
              className={cn(controlBase, 'tnum h-11 w-24 px-3 text-right sm:h-9', 'aria-[invalid=true]:bg-surface')}
            />
            <span className="t-caption w-10 shrink-0 text-ink-3 max-sm:w-auto">/ {fmt(max)}</span>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13px] text-ink-2 sm:min-h-9">
              <Checkbox data-abs={idx} checked={row.absent} onCheckedChange={(v) => onAbsent(entry.studentId, idx, v === true)} onKeyDown={onKey} aria-label={`Absent: ${entry.name}`} />
              Absent
            </label>
            <button
              type="button"
              onClick={() => setNoteOpen((o) => !o)}
              aria-label={`Note for ${entry.name}`}
              aria-pressed={showNote}
              className={cn('tr-colors grid size-11 shrink-0 place-items-center rounded-md hover:bg-surface-sunken sm:size-8', row.remarks ? 'text-brand-ink' : 'text-ink-3')}
            >
              <MessageSquareText className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 max-sm:w-full max-sm:pl-10">
            {row.absent ? (
              <StatusChip status="absent" />
            ) : parsed.value !== null ? (
              <>
                <span className="figure text-lg leading-6">{fmt(parsed.value)}</span>
                <span className="t-caption tnum text-ink-3">/ {fmt(max)}</span>
              </>
            ) : (
              <span className="t-caption text-ink-3">Not entered</span>
            )}
          </div>
        )}
        {pct !== null && <span className="t-caption tnum hidden w-12 shrink-0 text-right text-ink-3 sm:block">{fmt(pct)}%</span>}
      </div>
      {parsed.error && (
        <p id={errId} className="t-caption mt-1 flex items-center gap-1.5 pl-10 text-danger sm:pl-10">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {parsed.error}
        </p>
      )}
      {showNote && editable && (
        <input
          value={row.remarks}
          onChange={(e) => onRemark(entry.studentId, e.target.value)}
          placeholder="Add a note for the reviewer (optional)"
          aria-label={`Note for ${entry.name}`}
          maxLength={300}
          className={cn(controlBase, 'mb-1 ml-10 mt-2 h-10 w-[calc(100%-2.5rem)] px-3')}
        />
      )}
      {!editable && row.remarks && <p className="t-caption mt-1 pl-10 text-ink-2">Note: {row.remarks}</p>}
    </li>
  );
});
