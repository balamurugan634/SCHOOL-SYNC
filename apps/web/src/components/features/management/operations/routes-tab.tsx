'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Power } from 'lucide-react';
import { z } from 'zod';
import { transportRouteCreateBody, type TransportRoute } from '@school-sync/shared';
import { useCreateRoute, useRetireRoute, useRoutes, useUpdateRoute, useVehicles } from '@/lib/client/operations';
import { friendlyError } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { fmtClock } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormActions, FormInput, FormSelect } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { ProgressBar } from '@/components/ui/progress';
import { toast } from '@/components/ui/toaster';
import { AsyncConfirm } from '../common/dialogs';
import { ClearFilters, FilterBar, FilterChips, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

export function RoutesTab() {
  const router = useRouter();
  const { base, writeBlock } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const active = ls.get('active') || 'true';
  const q = useRoutes({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, active: active === 'all' ? undefined : active });
  const [edit, setEdit] = React.useState<TransportRoute | 'new' | null>(null);
  const [retire, setRetire] = React.useState<TransportRoute | null>(null);
  const retireMut = useRetireRoute();
  const createBlock = writeBlock('transport:create', 'school');
  const editBlock = writeBlock('transport:edit', 'school');
  const filtered = !!ls.q || active !== 'true';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <GuardedButton blocked={createBlock} onClick={() => setEdit('new')}>
          <Plus /> Add route
        </GuardedButton>
      </div>
      <DataTable<TransportRoute>
        id="ops-routes"
        caption="Bus routes"
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
        onRowClick={(r) => router.push(`${base}/operations/transport/routes/${r.id}`)}
        filters={
          <FilterBar>
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search routes" />
            <FilterSelect label="Status" allLabel={null} value={active} onChange={(v) => ls.set({ active: v === 'true' ? null : v })} options={[{ value: 'true', label: 'In service' }, { value: 'false', label: 'Out of service' }, { value: 'all', label: 'All' }]} />
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No routes match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(active !== 'true' ? [{ label: 'Status', value: active === 'false' ? 'out of service' : 'all' }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No routes yet" description="Create a route, give it a bus and add its stops." action={<GuardedButton blocked={createBlock} onClick={() => setEdit('new')}>Add route</GuardedButton>} />
          )
        }
        columns={[
          { id: 'name', header: 'Route', cell: (r) => <Link href={`${base}/operations/transport/routes/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.name}</Link>, sortable: true, sortValue: (r) => r.name, mobile: 'title' },
          { id: 'vehicle', header: 'Bus', cell: (r) => (r.vehicle ? (<><span className="tnum block">{r.vehicle.registrationNo}</span><span className="t-caption block text-ink-3">{r.vehicle.driverName ?? ''}</span></>) : <span className="text-warning">No bus assigned</span>), mobile: 'sub' },
          { id: 'times', header: 'Pickup / drop', cell: (r) => `${r.pickupStartTime ? fmtClock(r.pickupStartTime) : '—'} / ${r.dropStartTime ? fmtClock(r.dropStartTime) : '—'}`, mobile: 'detail', label: 'Pickup / drop' },
          { id: 'stops', header: 'Stops', cell: (r) => r.stopCount, align: 'right', sortable: true, sortValue: (r) => r.stopCount, mobile: 'detail', label: 'Stops' },
          {
            id: 'students',
            header: 'Students',
            cell: (r) => (
              <div className="ml-auto w-28 text-right">
                <span className="tnum text-sm">{r.studentCount}{r.capacity ? ` / ${r.capacity}` : ''}</span>
                {r.capacity ? <ProgressBar className="mt-1" value={r.studentCount} max={r.capacity} tone={r.seatsLeft !== null && r.seatsLeft <= 2 ? 'danger' : 'brand'} label={`${r.name}: ${r.studentCount} of ${r.capacity} seats used`} /> : null}
              </div>
            ),
            align: 'right',
            sortable: true,
            sortValue: (r) => r.studentCount,
            mobile: 'value',
          },
          { id: 'seats', header: 'Seats left', cell: (r) => (r.seatsLeft === null ? '—' : r.seatsLeft), align: 'right', mobile: 'hide' },
          { id: 'state', header: 'Status', cell: (r) => <Badge variant={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'In service' : 'Out of service'}</Badge>, mobile: 'status' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            label: 'Actions',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <IconButton label={`Edit ${r.name}`} size="icon-sm" disabled={!!editBlock} onClick={() => setEdit(r)}>
                  <Pencil />
                </IconButton>
                {r.isActive && (
                  <IconButton label={`Take ${r.name} out of service`} size="icon-sm" disabled={!!writeBlock('transport:delete', 'school')} onClick={() => setRetire(r)}>
                    <Power />
                  </IconButton>
                )}
              </div>
            ),
          },
        ]}
      />
      <RouteDialog target={edit} onClose={() => setEdit(null)} />
      <AsyncConfirm
        open={!!retire}
        onOpenChange={(o) => !o && setRetire(null)}
        title={`Take “${retire?.name ?? ''}” out of service?`}
        description="The route disappears from allocation. A route that still has students cannot be retired: move them first."
        confirmLabel="Take out of service"
        destructive
        onConfirm={async () => {
          if (!retire) return;
          await retireMut.mutateAsync({ id: retire.id });
          toast.success('Route taken out of service');
        }}
      />
    </div>
  );
}

const timeText = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Use a time like 06:45');
const routeForm = z.object({ name: z.string().trim().min(1, 'Name the route').max(100), vehicleId: z.string(), pickupStartTime: timeText, dropStartTime: timeText });

export function RouteDialog({ target, onClose }: { target: TransportRoute | 'new' | null; onClose: () => void }) {
  const isNew = target === 'new';
  const vehicles = useVehicles({ active: 'true', pageSize: 100 }, !!target);
  const create = useCreateRoute();
  const update = useUpdateRoute();
  const f = useZodForm(routeForm, { defaultValues: { name: '', vehicleId: 'none', pickupStartTime: '', dropStartTime: '' } });
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!target) return;
    f.reset(target === 'new' ? { name: '', vehicleId: 'none', pickupStartTime: '', dropStartTime: '' } : { name: target.name, vehicleId: target.vehicle?.id ?? 'none', pickupStartTime: target.pickupStartTime ?? '', dropStartTime: target.dropStartTime ?? '' });
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try {
      const body = { name: v.name, vehicleId: v.vehicleId === 'none' ? null : v.vehicleId, pickupStartTime: v.pickupStartTime || null, dropStartTime: v.dropStartTime || null };
      if (isNew) await create.mutateAsync(transportRouteCreateBody.parse(body));
      else if (target) await update.mutateAsync({ id: target.id, body });
      toast.success(isNew ? 'Route added' : 'Route updated');
      onClose();
    } catch (e) {
      setErr(applyApiErrors(f, e) ?? friendlyError(e));
    }
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={isNew ? 'Add a route' : 'Edit route'}>
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <FormInput control={f.control} name="name" label="Route name" required maxLength={100} placeholder="Route 4 – Koramangala" />
          <FormSelect control={f.control} name="vehicleId" label="Bus" options={[{ value: 'none', label: 'No bus yet' }, ...(vehicles.data?.data ?? []).map((v) => ({ value: v.id, label: `${v.registrationNo} · ${v.capacity} seats` }))]} hint="The bus must seat the students already on this route." />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={f.control} name="pickupStartTime" label="Morning pickup starts" type="time" />
            <FormInput control={f.control} name="dropStartTime" label="Afternoon drop starts" type="time" />
          </div>
          {err && <Banner tone="danger">{err}</Banner>}
          <FormActions className="-mx-5 -mb-5 mt-2 border-t px-5">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {isNew ? 'Add route' : 'Save'}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
