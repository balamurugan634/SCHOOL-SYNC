'use client';

import * as React from 'react';
import { attendanceCorrectionCreateBody } from '@school-sync/shared';
import { useRequestCorrection } from '@/lib/client/teacher-classes';
import { teacherError } from '@/lib/client/teacher-errors';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { fmtDate } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormSelect, FormTextarea } from '@/components/ui/form';
import { StatusChip } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { useWriteGate } from '../common';

const LABEL: Record<string, string> = { present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half day', leave: 'On leave' };

export interface CorrectionTarget {
  recordId: string;
  studentName: string;
  date: string;
  status: string;
}

/** Ask for a change to a submitted attendance record once the edit window has closed (`POST /attendance/records/:id/corrections`). */
export function CorrectionDialog({ target, onClose }: { target: CorrectionTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      {target && <CorrectionForm key={target.recordId} target={target} onClose={onClose} />}
    </Dialog>
  );
}

function CorrectionForm({ target, onClose }: { target: CorrectionTarget; onClose: () => void }) {
  const form = useZodForm(attendanceCorrectionCreateBody, { defaultValues: { reason: '' } });
  const request = useRequestCorrection();
  const gate = useWriteGate();
  const [formError, setFormError] = React.useState<string | null>(null);

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await request.mutateAsync({ recordId: target.recordId, body: v });
      toast.success('Correction requested', { description: 'The class teacher will be asked to approve it.' });
      onClose();
    } catch (e) {
      setFormError(applyApiErrors(form, e) ?? teacherError(e));
    }
  });

  return (
    <DialogContent title="Request a correction" description={`${target.studentName} · ${fmtDate(target.date, { weekday: 'long', day: 'numeric', month: 'long' })}`} size="md">
      <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
        <p className="flex items-center gap-2 text-sm">
          <span className="text-ink-2">Currently recorded as</span>
          <StatusChip status={target.status} />
        </p>
        <FormSelect
          control={form.control}
          name="toStatus"
          label="Change it to"
          required
          placeholder="Choose a status"
          options={Object.entries(LABEL)
            .filter(([k]) => k !== target.status)
            .map(([value, label]) => ({ value, label }))}
        />
        <FormTextarea control={form.control} name="reason" label="Reason" required rows={3} maxLength={500} hint="Say what happened. The approver and the student’s family may see this." />
        {formError && <Banner tone="danger">{formError}</Banner>}
        {gate.readOnly && <Banner tone="locked">{gate.reason}</Banner>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting} disabled={gate.readOnly}>
            Send request
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
