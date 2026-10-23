'use client';

import * as React from 'react';
import { Pencil } from 'lucide-react';
import type { SheetDetailOut, SheetOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { bff } from '@/lib/client/fetcher';
import { examErrorMessage, useExamMutation, useSheetDetail } from '@/lib/client/exams-admin';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { fmtDateTime, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useAccess } from '../shared/access';
import { ReasonDialog } from '../shared/dialogs';
import { DefList, ErrorPanel } from '../shared/detail';
import { SheetStatusChip } from './meta';
import { CAN_APPROVE, CAN_PUBLISH, CAN_RETURN, useSheetActions } from './sheet-actions';

type Edit = { marks: string; absent: boolean };

/**
 * One mark sheet: entries, status, and the decisions allowed for the caller (approve / return with a note / publish).
 * A published sheet can be corrected here with a mandatory reason — the families of the changed students are notified.
 */
export function SheetDrawer({ sheet, onClose }: { sheet: SheetOut | null; onClose: () => void }) {
  const open = sheet !== null;
  const q = useSheetDetail(sheet?.id ?? null);
  const access = useAccess();
  const actions = useSheetActions();
  const detail: SheetDetailOut | undefined = q.data;
  const s = detail ?? sheet;

  const [returning, setReturning] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [correcting, setCorrecting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setReturning(false);
      setPublishing(false);
      setCorrecting(false);
    }
  }, [open]);

  const canApprove = access.can('marks:approve');
  const canPublish = access.can('marks:publish');
  const done = () => void q.refetch();

  return (
    <Drawer open={open} onOpenChange={(o) => !o && !correcting && onClose()}>
      <DrawerContent
        title={s ? `${s.subjectName} · ${s.gradeName} ${s.sectionName}` : 'Mark sheet'}
        description={s ? `${s.examName}${s.teacherName ? ` · ${s.teacherName}` : ''}` : undefined}
        showTitle
        className="sm:w-[min(96vw,560px)]"
        onInteractOutside={(e) => correcting && e.preventDefault()}
      >
        {!s ? null : (
          <>
            <SheetBody>
              <div className="flex flex-wrap items-center gap-2">
                <SheetStatusChip status={s.status} />
                <span className="t-caption tnum text-ink-2">
                  {s.enteredCount} of {s.studentCount} entered{s.absentCount ? `, ${s.absentCount} absent` : ''} · out of {s.maxMarks}
                  {s.passMarks != null ? ` (pass ${s.passMarks})` : ''}
                </span>
              </div>
              {s.status === 'returned' && s.returnNote && (
                <Banner tone="warning" title="Returned to the teacher">
                  {s.returnNote}
                </Banner>
              )}
              <DefList
                items={[
                  { label: 'Subject teacher', value: s.teacherName },
                  { label: 'Submitted', value: s.submittedAt ? fmtDateTime(s.submittedAt) : null },
                  { label: 'Reviewed', value: s.reviewedAt ? fmtDateTime(s.reviewedAt) : null },
                  { label: 'Published', value: s.publishedAt ? fmtDateTime(s.publishedAt) : null },
                ]}
              />
              {q.isPending ? (
                <div className="space-y-2" aria-busy>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : q.isError ? (
                <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the marks" />
              ) : detail ? (
                correcting ? (
                  <CorrectionForm sheet={detail} onCancel={() => setCorrecting(false)} onDone={() => { setCorrecting(false); done(); }} />
                ) : (
                  <EntriesTable detail={detail} />
                )
              ) : null}
            </SheetBody>
            {!correcting && (
              <SheetFooter>
                {s.status === 'submitted' || s.status === 'approved' ? (
                  <>
                    {canApprove && CAN_RETURN(s) && (
                      <Button variant="secondary" onClick={() => setReturning(true)} disabled={!access.ok('marks:approve')} title={access.hint('marks:approve')}>
                        Return with a note
                      </Button>
                    )}
                    {canApprove && CAN_APPROVE(s) && (
                      <Button
                        loading={actions.approve.isPending}
                        disabled={!access.ok('marks:approve')}
                        title={access.hint('marks:approve')}
                        onClick={async () => {
                          const r = await actions.approve.run(s as SheetOut);
                          if (r.ok) onClose();
                        }}
                      >
                        Approve
                      </Button>
                    )}
                    {canPublish && CAN_PUBLISH(s) && (
                      <Button onClick={() => setPublishing(true)} disabled={!access.ok('marks:publish')} title={access.hint('marks:publish')}>
                        Publish
                      </Button>
                    )}
                  </>
                ) : s.status === 'published' ? (
                  canApprove ? (
                    <Button variant="secondary" onClick={() => setCorrecting(true)} disabled={!access.ok('marks:approve') || !detail} title={access.hint('marks:approve')}>
                      <Pencil /> Correct marks
                    </Button>
                  ) : (
                    <p className="t-caption mr-auto text-ink-2">Published. Corrections need the principal or an administrator.</p>
                  )
                ) : (
                  <p className="t-caption mr-auto text-ink-2">{s.status === 'returned' ? 'The teacher is revising this sheet.' : 'The teacher is still entering marks.'}</p>
                )}
              </SheetFooter>
            )}
            <ReasonDialog
              open={returning}
              onOpenChange={setReturning}
              title="Return this sheet to the teacher?"
              description={`${s.teacherName ?? 'The subject teacher'} is notified and can fix and resubmit ${s.subjectName} for ${s.gradeName} ${s.sectionName}.`}
              label="What needs fixing"
              placeholder="e.g. Question 5 was marked out of 10 instead of 5."
              required
              minLength={3}
              confirmLabel="Return sheet"
              consequence="The sheet goes back to the teacher as returned. Nothing is visible to students."
              onSubmit={async (note) => {
                const r = await actions.back.run({ sheet: s as SheetOut, note });
                if (r.ok) onClose();
                return r.ok;
              }}
            />
            <ConfirmDialog
              open={publishing}
              onOpenChange={setPublishing}
              title="Publish this sheet?"
              description={`Students of ${s.gradeName} ${s.sectionName} and their verified guardians can see their ${s.subjectName} marks and are notified. Later changes need a correction with a reason.`}
              confirmLabel="Publish"
              loading={actions.publish.isPending}
              onConfirm={async () => {
                const r = await actions.publish.run(s as SheetOut);
                if (r.ok) {
                  setPublishing(false);
                  onClose();
                }
              }}
            />
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function EntriesTable({ detail }: { detail: SheetDetailOut }) {
  if (detail.entries.length === 0) return <p className="text-sm text-ink-2">This section has no students.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="t-table w-full">
        <caption className="sr-only">Marks entered for {detail.subjectName}, {detail.gradeName} {detail.sectionName}</caption>
        <thead>
          <tr>
            <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">Roll</th>
            <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">Student</th>
            <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-right text-ink-2">Marks</th>
          </tr>
        </thead>
        <tbody>
          {detail.entries.map((e) => (
            <tr key={e.studentId} className="border-t border-border">
              <td className="tnum h-10 px-3 text-ink-2">{e.rollNo ?? '—'}</td>
              <td className="px-3">
                <span className="block font-medium">{e.name}</span>
                <span className="t-caption block text-ink-3">{e.admissionNo}{e.remarks ? ` · ${e.remarks}` : ''}</span>
              </td>
              <td className="tnum px-3 text-right">
                {e.isAbsent ? <Badge variant="danger">Absent</Badge> : e.marksObtained === null ? <span className="text-ink-3">Not entered</span> : `${e.marksObtained} / ${detail.maxMarks}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CorrectionForm({ sheet, onCancel, onDone }: { sheet: SheetDetailOut; onCancel: () => void; onDone: () => void }) {
  const initial = React.useMemo(() => Object.fromEntries(sheet.entries.map((e) => [e.studentId, { marks: e.marksObtained === null ? '' : String(e.marksObtained), absent: e.isAbsent } as Edit])), [sheet.entries]);
  const [edits, setEdits] = React.useState<Record<string, Edit>>(initial);
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const changed = sheet.entries.filter((e) => {
    const cur = edits[e.studentId]!;
    const o = initial[e.studentId]!;
    return cur.absent !== o.absent || (!cur.absent && cur.marks.trim() !== o.marks.trim());
  });
  const dirty = changed.length > 0 || reason.trim().length > 0;
  const { guard, dialog } = useUnsavedGuard(dirty);

  const rowError = (id: string): string | null => {
    const cur = edits[id]!;
    if (cur.absent || cur.marks.trim() === '') return null;
    const n = Number(cur.marks);
    if (!Number.isFinite(n) || n < 0) return 'Enter a number from 0';
    if (n > sheet.maxMarks) return `At most ${sheet.maxMarks}`;
    return null;
  };
  const hasRowError = sheet.entries.some((e) => rowError(e.studentId));
  const reasonShort = reason.trim().length < 5;

  const save = useExamMutation(
    () =>
      bff(`/marks/sheets/${sheet.id}/correct`, {
        method: 'POST',
        body: {
          reason: reason.trim(),
          entries: changed.map((e) => {
            const cur = edits[e.studentId]!;
            return { studentId: e.studentId, isAbsent: cur.absent, marksObtained: cur.absent || cur.marks.trim() === '' ? null : Number(cur.marks), remarks: e.remarks };
          }),
        },
      }),
    { success: () => `Correction saved. Families of ${plural(changed.length, 'student')} were notified.`, toastError: false },
  );

  return (
    <div className="space-y-4">
      <Banner tone="info" title="Correcting published marks">
        Change only the marks that are wrong. A reason is required, the before and after values are kept in the audit trail, and the families of the changed students are notified that a published result was updated.
      </Banner>
      <div className="overflow-hidden rounded-lg border border-border">
        <ul className="divide-y divide-border">
          {sheet.entries.map((e) => {
            const cur = edits[e.studentId]!;
            const isChanged = changed.some((c) => c.studentId === e.studentId);
            const err = rowError(e.studentId);
            return (
              <li key={e.studentId} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2', isChanged && 'bg-brand-soft')}>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="t-caption text-ink-3">Roll {e.rollNo ?? '—'} · was {e.isAbsent ? 'absent' : e.marksObtained ?? 'not entered'}</p>
                </div>
                <label className="flex items-center gap-1.5 text-[13px]">
                  <Checkbox checked={cur.absent} onCheckedChange={(v) => setEdits((m) => ({ ...m, [e.studentId]: { marks: v === true ? '' : m[e.studentId]!.marks, absent: v === true } }))} aria-label={`${e.name} absent`} />
                  Absent
                </label>
                <div className="w-24">
                  <Input type="number" min={0} max={sheet.maxMarks} step="any" inputMode="decimal" aria-label={`Marks for ${e.name}, out of ${sheet.maxMarks}`} value={cur.marks} disabled={cur.absent} invalid={!!err} onChange={(ev) => setEdits((m) => ({ ...m, [e.studentId]: { ...m[e.studentId]!, marks: ev.target.value } }))} />
                </div>
                {err && <p role="alert" className="t-caption w-full text-right text-danger">{err}</p>}
              </li>
            );
          })}
        </ul>
      </div>
      <Field label="Reason for the correction" htmlFor="correction-reason" required error={touched && reasonShort ? 'Write at least 5 characters.' : null}>
        <Textarea id="correction-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} invalid={touched && reasonShort} placeholder="e.g. Total re-checked; answer script 14 was mis-added." />
      </Field>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="t-caption mr-auto text-ink-2">{changed.length === 0 ? 'No marks changed yet.' : `${plural(changed.length, 'mark')} changed.`}</p>
        <Button variant="secondary" onClick={() => guard(onCancel)}>
          Cancel
        </Button>
        <Button
          disabled={changed.length === 0 || hasRowError}
          onClick={() => {
            setTouched(true);
            setError(null);
            if (!reasonShort) setConfirm(true);
          }}
        >
          Save correction
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => !save.isPending && setConfirm(o)}
        title="Save this correction?"
        description={`${plural(changed.length, 'mark')} will change on a published sheet. The families of ${plural(changed.length, 'student')} are notified that a published result was updated, and the change is recorded in the audit trail with your reason.`}
        confirmLabel="Save correction"
        loading={save.isPending}
        onConfirm={async () => {
          const r = await save.run();
          if (r.ok) {
            setConfirm(false);
            onDone();
          } else {
            setConfirm(false);
            setError(examErrorMessage(r.error));
          }
        }}
      />
      {dialog}
    </div>
  );
}
