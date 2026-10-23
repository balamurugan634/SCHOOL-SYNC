'use client';

import * as React from 'react';
import type { StudentDetailOut, StudentStatus } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { sectionLabel, useSectionList } from '@/lib/client/options';
import { useStudentActions } from '@/lib/client/people';
import { todayIso } from '@/lib/format';
import { ApiError } from '@/lib/problem';
import { LabelledSelect } from '../shared/controls';
import { ErrorBanner } from './errors';
import { asArray } from './ui';
import type { SectionOut } from '@school-sync/shared';

export type StatusTarget = Exclude<StudentStatus, never>;

const ARCHIVING: StudentStatus[] = ['transferred', 'withdrawn', 'alumni'];

function copy(target: StudentStatus, s: StudentDetailOut) {
  const cls = s.gradeName ? `${s.gradeName} ${s.sectionName ?? ''}`.trim() : 'their class';
  switch (target) {
    case 'suspended':
      return { title: `Suspend ${s.name}?`, confirm: 'Suspend student', destructive: true, body: `${s.name}’s login is switched off and they are signed out on every device. Their place in ${cls}, records and fees stay as they are, and they still count as a seat. You can reinstate them at any time.` };
    case 'active':
      return {
        title: `Reinstate ${s.name}?`,
        confirm: 'Reinstate student',
        destructive: false,
        body: ARCHIVING.includes(s.status) ? `${s.name} returns to ${cls} if the place is still open and there is room, their login works again and they count as a seat. If the place is gone, re-admit them through Admissions instead.` : `${s.name}’s login works again straight away.`,
      };
    case 'transferred':
      return { title: `Record ${s.name} as transferred?`, confirm: 'Mark as transferred', destructive: true, body: `${s.name} leaves ${cls} and stops counting as a licence seat. Their login is switched off. Attendance, results and fee history are kept. You can reinstate them later if the place is still open.` };
    case 'withdrawn':
      return { title: `Withdraw ${s.name}?`, confirm: 'Withdraw student', destructive: true, body: `${s.name} leaves ${cls} and stops counting as a licence seat. Their login is switched off. Records are kept for the school’s history. You can reinstate them later if the place is still open.` };
    case 'alumni':
      return { title: `Mark ${s.name} as alumni?`, confirm: 'Mark as alumni', destructive: true, body: `${s.name} has completed their studies. They leave ${cls}, stop counting as a licence seat and their login is switched off. Records are kept.` };
  }
}

/** Status change with a stated consequence. Archiving (transfer / withdraw / alumni) takes an effective date and an optional reason. */
export function StatusDialog({ student, target, onClose }: { student: StudentDetailOut; target: StudentStatus | null; onClose: () => void }) {
  const { setStatus } = useStudentActions(student.id);
  const [reason, setReason] = React.useState('');
  const [date, setDate] = React.useState(todayIso());
  const [error, setError] = React.useState<unknown>(null);
  React.useEffect(() => {
    if (target) {
      setReason('');
      setDate(todayIso());
      setError(null);
    }
  }, [target]);
  if (!target) return null;
  const c = copy(target, student);
  const archiving = ARCHIVING.includes(target);
  return (
    <Dialog open onOpenChange={(o) => !o && !setStatus.isPending && onClose()}>
      <DialogContent title={c.title}>
        <form
          className="mt-3 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await setStatus.mutateAsync({ status: target, reason: reason.trim() || undefined, effectiveDate: archiving ? date : undefined });
              toast.success(target === 'active' ? `${student.name} was reinstated` : `${student.name} is now ${target}`);
              onClose();
            } catch (err) {
              setError(err);
            }
          }}
        >
          <p className="text-sm text-ink-2">{c.body}</p>
          {archiving && (
            <Field label="Effective date" htmlFor="status-date" hint="The last day at the school.">
              <DatePicker id="status-date" value={date} onChange={setDate} />
            </Field>
          )}
          <Field label="Reason" htmlFor="status-reason" hint="Optional. Kept in the audit trail.">
            <Textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} />
          </Field>
          <ErrorBanner error={error} />
          {error instanceof ApiError && error.status === 403 && archiving && <p className="t-caption text-ink-2">Archiving a student needs the permission to archive students.</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={setStatus.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant={c.destructive ? 'danger-solid' : 'primary'} loading={setStatus.isPending}>
              {c.confirm}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Move to another section of the current academic year (no new seat). A full section can be overridden explicitly. */
export function MoveSectionDialog({ student, open, onClose }: { student: StudentDetailOut; open: boolean; onClose: () => void }) {
  const { move } = useStudentActions(student.id);
  const secQ = useSectionList({ enabled: open });
  const sections = asArray<SectionOut>(secQ.data);
  const [sectionId, setSectionId] = React.useState('');
  const [roll, setRoll] = React.useState('');
  const [force, setForce] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  React.useEffect(() => {
    if (open) {
      setSectionId('');
      setRoll('');
      setForce(false);
      setError(null);
    }
  }, [open]);
  const target = sections?.find((s) => s.id === sectionId);
  const full = error instanceof ApiError && error.code === 'SECTION_FULL';
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !move.isPending && onClose()}>
      <DialogContent title={`Move ${student.name}`} description={`Currently in ${student.gradeName ?? '—'} ${student.sectionName ?? ''}. The move keeps their seat and updates the enrollment for this year.`}>
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await move.mutateAsync({ sectionId, rollNo: roll ? Number(roll) : undefined, force });
              onClose();
            } catch (err) {
              setError(err);
            }
          }}
        >
          {secQ.isError ? (
            <Banner tone="danger">The list of sections could not be loaded. Close this window and try again.</Banner>
          ) : (
            <LabelledSelect
              label="New section"
              required
              value={sectionId}
              onChange={setSectionId}
              placeholder={secQ.isPending ? 'Loading sections…' : 'Choose a section'}
              options={(sections ?? []).map((s) => ({ value: s.id, label: `${sectionLabel(s)} · ${s.studentCount}${s.capacity ? `/${s.capacity}` : ''} students`, disabled: s.id === student.sectionId }))}
            />
          )}
          {target && target.capacity !== null && target.studentCount >= target.capacity && <Banner tone="warning">{sectionLabel(target)} is at capacity ({target.studentCount}/{target.capacity}). The move is refused unless you allow it below.</Banner>}
          <Field label="Roll number" htmlFor="move-roll" hint="Optional. Leave empty to keep the current one.">
            <Input id="move-roll" type="number" inputMode="numeric" min={1} max={9999} value={roll} onChange={(e) => setRoll(e.target.value)} />
          </Field>
          {(full || force) && (
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="mt-0.5 size-[18px] accent-[var(--brand)]" />
              <span>
                Move even though the section is at capacity
                <span className="t-caption block text-ink-3">The section will be over its limit. Raise the capacity afterwards under Classes &amp; sections.</span>
              </span>
            </label>
          )}
          <ErrorBanner error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={move.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!sectionId} loading={move.isPending}>
              Move student
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
