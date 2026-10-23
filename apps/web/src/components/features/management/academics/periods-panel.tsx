'use client';

import * as React from 'react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FormCheckbox, FormInput } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { usePeriodMutations, type PeriodOut } from '@/lib/client/academics';
import { usePeriodList } from '@/lib/client/options';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { fmtClock } from '@/lib/format';
import { useAccess } from '../shared/access';
import { FormNumber, FormTime } from './fields';
import { DialogButtons, FormBanner, ModalForm } from './form-shell';
import { periodSchema } from './schemas';

export function PeriodsPanel() {
  const access = useAccess();
  const q = usePeriodList();
  const m = usePeriodMutations();
  const [dialog, setDialog] = React.useState<null | { period?: PeriodOut }>(null);
  const [removing, setRemoving] = React.useState<PeriodOut | null>(null);
  const teaching = q.data?.filter((p) => !p.isBreak).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">
          The periods of a school day, in order. Breaks and lunch take no lessons. The timetable and period-wise attendance use these timings.
          {q.data && q.data.length > 0 && <> {teaching} teaching {teaching === 1 ? 'period' : 'periods'} a day.</>}
        </p>
        <Button onClick={() => setDialog({})} disabled={!access.ok('academics:create')} title={access.hint('academics:create')}>
          <Plus /> Add period
        </Button>
      </div>
      <DataTable
        id="academics-periods"
        caption="Periods of the school day"
        rows={q.data}
        rowKey={(p) => p.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          { id: 'ordinal', header: '#', cell: (p) => p.ordinal, className: 'w-14', mobile: 'hide' },
          { id: 'name', header: 'Period', hideable: false, cell: (p) => <span className="font-medium">{p.name}</span>, mobile: 'title' },
          { id: 'time', header: 'Time', cell: (p) => `${fmtClock(p.startTime)} – ${fmtClock(p.endTime)}`, mobile: 'sub' },
          { id: 'kind', header: 'Type', cell: (p) => (p.isBreak ? <Badge variant="neutral">Break</Badge> : <Badge variant="primary">Lessons</Badge>), mobile: 'status' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (p) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Actions for ${p.name}`} size="icon-sm" type="button">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem disabled={!access.ok('academics:edit')} onSelect={() => setDialog({ period: p })}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem danger disabled={!access.ok('academics:delete')} onSelect={() => setRemoving(p)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
        empty={<EmptyState illustration="empty-generic" title="No periods defined" description="Add the periods of the school day, with the breaks between them. The timetable needs them." compact action={access.ok('academics:create') ? <Button size="sm" onClick={() => setDialog({})}>Add period</Button> : undefined} />}
      />
      {dialog && <PeriodDialog period={dialog.period} periods={q.data ?? []} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Delete ${removing.name}?` : ''}
        description="A period that the timetable or attendance records already use cannot be deleted; edit its name or times instead. This cannot be undone."
        confirmLabel="Delete period"
        destructive
        loading={m.remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          const r = await m.remove.run(removing.id);
          if (r.ok) setRemoving(null);
        }}
      />
    </div>
  );
}

function PeriodDialog({ period, periods, onClose }: { period?: PeriodOut; periods: PeriodOut[]; onClose: () => void }) {
  const m = usePeriodMutations();
  const last = periods[periods.length - 1];
  const form = useZodForm(periodSchema, {
    defaultValues: period
      ? { name: period.name, ordinal: period.ordinal, startTime: period.startTime, endTime: period.endTime, isBreak: period.isBreak }
      : { name: '', ordinal: (last?.ordinal ?? 0) + 1, startTime: last?.endTime ?? '08:30', endTime: '', isBreak: false },
  });
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <ModalForm title={period ? `Edit ${period.name}` : 'Add period'} description="Periods cannot overlap in time." dirty={hasDirtyFields(form.formState)} onClose={onClose}>
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          setErr(null);
          try {
            if (period) await m.update.mutateAsync({ id: period.id, body: v });
            else await m.create.mutateAsync(v);
            onClose();
          } catch (e) {
            setErr(applyApiErrors(form, e));
          }
        })}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <FormInput control={form.control} name="name" label="Name" required hint="Period 1, Lunch…" />
          <FormNumber control={form.control} name="ordinal" label="Order" required min={1} max={30} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormTime control={form.control} name="startTime" label="Starts" required />
          <FormTime control={form.control} name="endTime" label="Ends" required />
        </div>
        <FormCheckbox control={form.control} name="isBreak" label="This is a break" hint="Breaks (lunch, recess) take no lessons and no attendance." />
        <FormBanner message={err} />
        <DialogButtons onCancel={onClose} submitLabel={period ? 'Save changes' : 'Add period'} loading={form.formState.isSubmitting} />
      </form>
    </ModalForm>
  );
}
