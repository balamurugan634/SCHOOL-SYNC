'use client';

import * as React from 'react';
import { AlertTriangle, Pencil, Plus, Power } from 'lucide-react';
import { z } from 'zod';
import { transportVehicleCreateBody, type TransportVehicle } from '@school-sync/shared';
import { useCreateVehicle, useRetireVehicle, useUpdateVehicle, useVehicles } from '@/lib/client/operations';
import { friendlyError } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormActions, FormDate, FormInput } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toaster';
import { AsyncConfirm } from '../common/dialogs';
import { ClearFilters, FilterBar, FilterChips, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

export function InsuranceBadge({ v }: { v: Pick<TransportVehicle, 'insuranceStatus' | 'insuranceExpiry'> }) {
  const d = v.insuranceExpiry ? fmtDate(v.insuranceExpiry) : '';
  switch (v.insuranceStatus) {
    case 'valid':
      return <Badge variant="success">Insured until {d}</Badge>;
    case 'expiring':
      return (
        <Badge variant="warning" icon={<AlertTriangle aria-hidden />}>
          Expires {d}
        </Badge>
      );
    case 'expired':
      return (
        <Badge variant="danger" icon={<AlertTriangle aria-hidden />}>
          Expired {d}
        </Badge>
      );
    default:
      return <Badge variant="neutral">Not recorded</Badge>;
  }
}

export function VehiclesTab() {
  const { writeBlock } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const active = ls.get('active') || 'true';
  const alert = ls.get('alert') === '1';
  const q = useVehicles({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, active: active === 'all' ? undefined : active, insuranceAlert: alert ? 'true' : undefined });
  const alerts = useVehicles({ insuranceAlert: 'true', active: 'true', pageSize: 1, page: 1 });
  const [edit, setEdit] = React.useState<TransportVehicle | 'new' | null>(null);
  const [retire, setRetire] = React.useState<TransportVehicle | null>(null);
  const retireMut = useRetireVehicle();
  const updateMut = useUpdateVehicle();
  const createBlock = writeBlock('transport:create', 'school');
  const editBlock = writeBlock('transport:edit', 'school');
  const filtered = !!ls.q || alert || active !== 'true';

  return (
    <div className="space-y-4">
      {alerts.data && alerts.data.meta.total > 0 && !alert && (
        <Banner tone="warning" title={`${alerts.data.meta.total} vehicle${alerts.data.meta.total === 1 ? ' needs' : 's need'} insurance attention`} action={<Button size="sm" variant="secondary" onClick={() => ls.set({ alert: '1' })}>Show them</Button>}>
          Insurance has expired or runs out within 30 days.
        </Banner>
      )}
      <div className="flex justify-end">
        <GuardedButton blocked={createBlock} onClick={() => setEdit('new')}>
          <Plus /> Add vehicle
        </GuardedButton>
      </div>
      <DataTable<TransportVehicle>
        id="ops-vehicles"
        caption="Vehicles"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        filters={
          <FilterBar>
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Registration, driver or model" />
            <FilterSelect label="Status" allLabel={null} value={active} onChange={(v) => ls.set({ active: v === 'true' ? null : v })} options={[{ value: 'true', label: 'In service' }, { value: 'false', label: 'Out of service' }, { value: 'all', label: 'All' }]} />
            <button type="button" aria-pressed={alert} onClick={() => ls.set({ alert: alert ? null : '1' })} className={`tr-colors inline-flex h-11 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium sm:h-9 ${alert ? 'border-warning bg-warning-soft text-warning' : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-subtle'}`}>
              <AlertTriangle className="size-3.5" aria-hidden /> Insurance needs attention
            </button>
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No vehicles match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(alert ? [{ label: 'Insurance', value: 'needs attention' }] : []), ...(active !== 'true' ? [{ label: 'Status', value: active === 'false' ? 'out of service' : 'all' }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No vehicles yet" description="Add the buses the school runs, with driver details and insurance dates." action={<GuardedButton blocked={createBlock} onClick={() => setEdit('new')}>Add vehicle</GuardedButton>} />
          )
        }
        columns={[
          { id: 'reg', header: 'Registration', cell: (r) => (<><span className="tnum block font-medium">{r.registrationNo}</span><span className="t-caption block text-ink-3">{r.model ?? ''}</span></>), sortable: true, sortValue: (r) => r.registrationNo, mobile: 'title' },
          { id: 'cap', header: 'Seats', cell: (r) => r.capacity, align: 'right', sortable: true, sortValue: (r) => r.capacity, mobile: 'detail', label: 'Seats' },
          { id: 'driver', header: 'Driver', cell: (r) => (<><span className="block">{r.driverName ?? '—'}</span>{r.driverPhone && <a href={`tel:${r.driverPhone}`} className="t-caption tnum block text-brand-ink hover:underline">{r.driverPhone}</a>}</>), mobile: 'sub' },
          { id: 'att', header: 'Attendant', cell: (r) => r.attendantName ?? '—', defaultHidden: true, mobile: 'hide' },
          { id: 'ins', header: 'Insurance', cell: (r) => <InsuranceBadge v={r} />, sortable: true, sortValue: (r) => r.insuranceExpiry ?? '9999', mobile: 'status' },
          { id: 'routes', header: 'Routes', cell: (r) => r.routeCount, align: 'right', mobile: 'detail', label: 'Active routes' },
          { id: 'state', header: 'Status', cell: (r) => <Badge variant={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'In service' : 'Out of service'}</Badge>, mobile: 'hide' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            label: 'Actions',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <IconButton label={`Edit ${r.registrationNo}`} size="icon-sm" disabled={!!editBlock} onClick={() => setEdit(r)}>
                  <Pencil />
                </IconButton>
                {r.isActive ? (
                  <IconButton label={`Take ${r.registrationNo} out of service`} size="icon-sm" disabled={!!writeBlock('transport:delete', 'school')} onClick={() => setRetire(r)}>
                    <Power />
                  </IconButton>
                ) : (
                  <Button size="sm" variant="ghost" disabled={!!editBlock} onClick={async () => { try { await updateMut.mutateAsync({ id: r.id, body: { isActive: true } }); toast.success('Back in service'); } catch (e) { toast.error(friendlyError(e), { duration: 8000 }); } }}>
                    Reactivate
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <VehicleDialog target={edit} onClose={() => setEdit(null)} />
      <AsyncConfirm
        open={!!retire}
        onOpenChange={(o) => !o && setRetire(null)}
        title={`Take ${retire?.registrationNo ?? 'this vehicle'} out of service?`}
        description="It can no longer be put on a route. A vehicle that an active route uses cannot be retired until the route is given another bus."
        confirmLabel="Take out of service"
        destructive
        onConfirm={async () => {
          if (!retire) return;
          await retireMut.mutateAsync({ id: retire.id });
          toast.success('Vehicle taken out of service');
        }}
      />
    </div>
  );
}

const vehicleForm = z.object({
  registrationNo: z.string().trim().min(3, 'Enter the registration number').max(20),
  model: z.string().trim().max(80),
  capacity: z.string().regex(/^[1-9]\d{0,2}$/, 'Whole number of seats, 1 to 150'),
  driverName: z.string().trim().max(100),
  driverPhone: z.string().trim().max(20).refine((v) => v === '' || v.length >= 5, 'Enter a phone number'),
  attendantName: z.string().trim().max(100),
  insuranceExpiry: z.string(),
});
const blank = { registrationNo: '', model: '', capacity: '40', driverName: '', driverPhone: '', attendantName: '', insuranceExpiry: '' };

function VehicleDialog({ target, onClose }: { target: TransportVehicle | 'new' | null; onClose: () => void }) {
  const isNew = target === 'new';
  const create = useCreateVehicle();
  const update = useUpdateVehicle();
  const f = useZodForm(vehicleForm, { defaultValues: blank });
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!target) return;
    f.reset(target === 'new' ? blank : { registrationNo: target.registrationNo, model: target.model ?? '', capacity: String(target.capacity), driverName: target.driverName ?? '', driverPhone: target.driverPhone ?? '', attendantName: target.attendantName ?? '', insuranceExpiry: target.insuranceExpiry ?? '' });
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try {
      const body = { registrationNo: v.registrationNo, model: v.model || null, capacity: Number(v.capacity), driverName: v.driverName || null, driverPhone: v.driverPhone || null, attendantName: v.attendantName || null, insuranceExpiry: v.insuranceExpiry || null };
      if (isNew) await create.mutateAsync(transportVehicleCreateBody.parse(body));
      else if (target) await update.mutateAsync({ id: target.id, body });
      toast.success(isNew ? 'Vehicle added' : 'Vehicle updated');
      onClose();
    } catch (e) {
      setErr(applyApiErrors(f, e));
    }
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={isNew ? 'Add a vehicle' : 'Edit vehicle'} size="lg">
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={f.control} name="registrationNo" label="Registration number" required maxLength={20} placeholder="KA-01-AB-1234" />
            <FormInput control={f.control} name="model" label="Model" maxLength={80} placeholder="Tata Starbus 40-seater" />
            <FormInput control={f.control} name="capacity" label="Seats" required inputMode="numeric" maxLength={3} hint="Students already on its routes must still fit." />
            <FormDate control={f.control} name="insuranceExpiry" label="Insurance valid until" />
            <FormInput control={f.control} name="driverName" label="Driver" maxLength={100} />
            <FormInput control={f.control} name="driverPhone" label="Driver phone" inputMode="tel" maxLength={20} />
            <FormInput control={f.control} name="attendantName" label="Attendant" maxLength={100} />
          </div>
          {err && <Banner tone="danger">{err}</Banner>}
          <FormActions className="-mx-5 -mb-5 mt-2 border-t px-5">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {isNew ? 'Add vehicle' : 'Save'}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
