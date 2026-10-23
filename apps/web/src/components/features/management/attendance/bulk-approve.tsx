'use client';

import * as React from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toaster';
import { attMessage, useBulkApprove, type BulkKind } from '@/lib/client/attendance-admin';
import { plural } from '@/lib/format';

/** Approve several pending requests one after another and report what happened (partial failures are listed, not hidden). */
export function BulkApproveDialog({ open, onOpenChange, ids, kind, noun, consequence, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; ids: string[]; kind: BulkKind; noun: string; consequence: React.ReactNode; onDone: () => void }) {
  const m = useBulkApprove(kind);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !m.isPending && onOpenChange(o)}
      title={`Approve ${plural(ids.length, noun)}?`}
      description={consequence}
      confirmLabel={`Approve ${ids.length}`}
      loading={m.isPending}
      onConfirm={async () => {
        try {
          const r = await m.mutateAsync(ids);
          if (r.failed.length === 0) toast.success(`Approved ${plural(r.done, noun)}.`);
          else {
            const first = r.failed[0]!.message;
            toast.error(`${r.done > 0 ? `Approved ${r.done}, but ` : ''}${plural(r.failed.length, 'request')} could not be approved. ${first}`, { duration: 10000 });
          }
          onDone();
        } catch (e) {
          toast.error(attMessage(e), { duration: 8000 });
        } finally {
          onOpenChange(false);
        }
      }}
    />
  );
}
