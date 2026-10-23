'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Download, MapPin, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { transportStopCreateBody, type TransportStop } from '@school-sync/shared';
import { useAddStop, useDeleteStop, useManifest, useReorderStops, useRoute, useUpdateStop, useVehicles, type RouteDetail as RouteDetailT } from '@/lib/client/operations';
import { amountText, friendlyError, minorToText, parseMinor } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { downloadCsv, toCsv } from '@/lib/csv';
import { fmtClock, todayIso } from '@/lib/format';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormActions, FormInput } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { ProgressBar } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { AsyncConfirm } from '../common/dialogs';
import { GuardedButton } from '../common/guarded';
import { esc, printHtml } from '../common/print';
import { ErrorPanel } from '../common/states';
import { useTabParam } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { InsuranceBadge } from './vehicles-tab';
import { RouteDialog } from './routes-tab';

export function RouteDetailPage({ id }: { id: string }) {
  const { base, writeBlock } = useMgmt();
  const q = useRoute(id);
  const r = q.data;
  const [tab, setTab] = useTabParam(['stops', 'manifest']);
  const [editing, setEditing] = React.useState(false);

  return (
    <>
      <PageHeader
        title={r?.name ?? 'Route'}
        description={r ? `${r.vehicle ? `${r.vehicle.registrationNo}${r.vehicle.driverName ? `, driver ${r.vehicle.driverName}` : ''}` : 'No bus assigned'} · pickup ${r.pickupStartTime ? fmtClock(r.pickupStartTime) : 'not set'}, drop ${r.dropStartTime ? fmtClock(r.dropStartTime) : 'not set'}` : undefined}
        crumbs={[{ label: 'Transport', href: `${base}/operations/transport` }, { label: r?.name ?? '…' }]}
        actions={
          r && (
            <>
              {!r.isActive && <Badge variant="neutral">Out of service</Badge>}
              <GuardedButton blocked={writeBlock('transport:edit', 'school')} variant="secondary" onClick={() => setEditing(true)}>
                <Pencil /> Edit route
              </GuardedButton>
            </>
          )
        }
      />
      {q.isPending ? (
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : q.isError || !r ? (
        <Card>
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this route" compact={false} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Stops" value={r.stopCount} />
            <StatTile label="Students on board" value={r.studentCount} hint={r.capacity ? `of ${r.capacity} seats` : 'no bus assigned'} />
            <StatTile label="Seats left" value={r.seatsLeft ?? '—'} />
            <Card className="p-4 sm:p-5">
              <p className="t-caption text-ink-2">Insurance</p>
              <div className="mt-2">{r.vehicle ? <VehicleInsurance vehicleId={r.vehicle.id} /> : <span className="text-sm text-ink-3">No bus</span>}</div>
            </Card>
          </div>
          {r.capacity ? <ProgressBar value={r.studentCount} max={r.capacity} tone={r.seatsLeft !== null && r.seatsLeft <= 2 ? 'danger' : 'brand'} label={`${r.studentCount} of ${r.capacity} seats used`} /> : null}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Route sections">
              <TabsTrigger value="stops">Stops</TabsTrigger>
              <TabsTrigger value="manifest">Manifest</TabsTrigger>
            </TabsList>
            <TabsContent value="stops">
              <StopsPanel route={r} />
            </TabsContent>
            <TabsContent value="manifest">
              <ManifestPanel route={r} />
            </TabsContent>
          </Tabs>
        </div>
      )}
      <RouteDialog target={editing && r ? { ...r } : null} onClose={() => setEditing(false)} />
      <p className="mt-6">
        <Button asChild variant="link">
          <Link href={`${base}/operations/transport`}>Back to transport</Link>
        </Button>
      </p>
    </>
  );
}

function VehicleInsurance({ vehicleId }: { vehicleId: string }) {
  // the route only carries a summary of its bus: look the bus up for its insurance dates
  const q = useVehicles({ pageSize: 100, page: 1 });
  const v = q.data?.data.find((x) => x.id === vehicleId);
  if (q.isError) return <span className="text-sm text-ink-3">Unavailable</span>;
  return v ? <InsuranceBadge v={v} /> : <Skeleton className="h-5 w-28" />;
}

// ── stops ───────────────────────────────────────────────────────────────────────────────────

function StopsPanel({ route }: { route: RouteDetailT }) {
  const { writeBlock, money } = useMgmt();
  const reorder = useReorderStops();
  const del = useDeleteStop();
  const [order, setOrder] = React.useState<TransportStop[]>(route.stops);
  const [edit, setEdit] = React.useState<TransportStop | 'new' | null>(null);
  const [remove, setRemove] = React.useState<TransportStop | null>(null);
  const [busy, setBusy] = React.useState(false);
  const editBlock = writeBlock('transport:edit', 'school');
  React.useEffect(() => setOrder(route.stops), [route.stops]);

  const move = async (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    setBusy(true);
    try {
      await reorder.mutateAsync({ routeId: route.id, stopIds: next.map((s) => s.id) });
      toast.success('Stop order saved', { description: `${next[j]!.name} is now stop ${j + 1}.` });
    } catch (e) {
      setOrder(route.stops);
      toast.error(friendlyError(e), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">Stops are listed in driving order. Move a stop up or down to change the order; pickup and drop times can be set per stop.</p>
        <GuardedButton blocked={writeBlock('transport:edit', 'school')} onClick={() => setEdit('new')}>
          <Plus /> Add stop
        </GuardedButton>
      </div>
      {order.length === 0 ? (
        <Card>
          <EmptyState icon={<MapPin />} title="No stops yet" description="Add the places the bus picks students up from, in driving order." action={<GuardedButton blocked={editBlock} onClick={() => setEdit('new')}>Add the first stop</GuardedButton>} />
        </Card>
      ) : (
        <Card>
          <ol className="divide-y divide-border" aria-label="Stops in driving order">
            {order.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="figure grid size-8 shrink-0 place-items-center rounded-full bg-surface-sunken text-[15px]" aria-label={`Stop ${i + 1}`}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="t-caption text-ink-2">
                    Pickup {s.pickupTime ? fmtClock(s.pickupTime) : '—'} · Drop {s.dropTime ? fmtClock(s.dropTime) : '—'}
                    {s.feeMinor ? ` · Fee ${money(s.feeMinor)}` : ''} · {s.studentCount} student{s.studentCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton label={`Move ${s.name} up`} size="icon-sm" disabled={!!editBlock || busy || i === 0} onClick={() => void move(i, -1)}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton label={`Move ${s.name} down`} size="icon-sm" disabled={!!editBlock || busy || i === order.length - 1} onClick={() => void move(i, 1)}>
                    <ArrowDown />
                  </IconButton>
                  <IconButton label={`Edit ${s.name}`} size="icon-sm" disabled={!!editBlock} onClick={() => setEdit(s)}>
                    <Pencil />
                  </IconButton>
                  <IconButton label={`Delete ${s.name}`} size="icon-sm" disabled={!!editBlock} onClick={() => setRemove(s)}>
                    <Trash2 />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <StopDialog routeId={route.id} stopCount={order.length} target={edit} onClose={() => setEdit(null)} />
      <AsyncConfirm
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title={`Delete the stop “${remove?.name ?? ''}”?`}
        description={remove && remove.studentCount > 0 ? `${remove.studentCount} student${remove.studentCount === 1 ? ' boards' : 's board'} here, so it cannot be deleted until they are moved to another stop.` : 'The stop is removed from this route. Nobody boards here, so no student is affected.'}
        confirmLabel="Delete stop"
        destructive
        onConfirm={async () => {
          if (!remove) return;
          await del.mutateAsync({ id: remove.id });
          toast.success('Stop deleted');
        }}
      />
    </div>
  );
}

const timeText = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Use a time like 06:45');
const coord = (min: number, max: number, what: string) => z.string().refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= max), `${what} must be between ${min} and ${max}`);
const stopForm = z.object({
  name: z.string().trim().min(1, 'Name the stop').max(100),
  position: z.string().regex(/^\d{0,3}$/, 'A stop number'),
  pickupTime: timeText,
  dropTime: timeText,
  lat: coord(-90, 90, 'Latitude'),
  lng: coord(-180, 180, 'Longitude'),
  fee: amountText('the fee', { allowZero: true }).or(z.literal('')),
});

function StopDialog({ routeId, stopCount, target, onClose }: { routeId: string; stopCount: number; target: TransportStop | 'new' | null; onClose: () => void }) {
  const isNew = target === 'new';
  const add = useAddStop();
  const upd = useUpdateStop();
  const f = useZodForm(stopForm, { defaultValues: { name: '', position: '', pickupTime: '', dropTime: '', lat: '', lng: '', fee: '' } });
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!target) return;
    f.reset(target === 'new' ? { name: '', position: '', pickupTime: '', dropTime: '', lat: '', lng: '', fee: '' } : { name: target.name, position: '', pickupTime: target.pickupTime ?? '', dropTime: target.dropTime ?? '', lat: target.lat === null ? '' : String(target.lat), lng: target.lng === null ? '' : String(target.lng), fee: target.feeMinor ? minorToText(target.feeMinor) : '' });
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try {
      const body = { name: v.name, pickupTime: v.pickupTime || null, dropTime: v.dropTime || null, lat: v.lat === '' ? null : Number(v.lat), lng: v.lng === '' ? null : Number(v.lng), feeMinor: v.fee === '' ? null : parseMinor(v.fee) };
      if (isNew) await add.mutateAsync({ routeId, body: transportStopCreateBody.parse({ ...body, ordinal: v.position ? Number(v.position) : undefined }) });
      else if (target) await upd.mutateAsync({ id: target.id, body });
      toast.success(isNew ? 'Stop added' : 'Stop updated');
      onClose();
    } catch (e) {
      setErr(applyApiErrors(f, e, { feeMinor: 'fee' }));
    }
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={isNew ? 'Add a stop' : 'Edit stop'} size="lg">
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <FormInput control={f.control} name="name" label="Stop name" required maxLength={100} placeholder="ITPL Main Road" />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={f.control} name="pickupTime" label="Morning pickup" type="time" />
            <FormInput control={f.control} name="dropTime" label="Afternoon drop" type="time" />
            {isNew && <FormInput control={f.control} name="position" label="Position" inputMode="numeric" maxLength={3} hint={`Leave empty to add at the end (after stop ${stopCount}). Later stops move down.`} />}
            <FormInput control={f.control} name="fee" label="Fee for this stop" inputMode="decimal" hint="Optional, per term." />
            <FormInput control={f.control} name="lat" label="Latitude" inputMode="decimal" hint="Optional." />
            <FormInput control={f.control} name="lng" label="Longitude" inputMode="decimal" hint="Optional." />
          </div>
          {err && <Banner tone="danger">{err}</Banner>}
          <FormActions className="-mx-5 -mb-5 mt-2 border-t px-5">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending || upd.isPending}>
              {isNew ? 'Add stop' : 'Save'}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── manifest ────────────────────────────────────────────────────────────────────────────────

function ManifestPanel({ route }: { route: RouteDetailT }) {
  const q = useManifest(route.id);
  const m = q.data;
  const total = m?.stops.reduce((t, s) => t + s.students.length, 0) ?? 0;

  const csv = () => {
    if (!m) return;
    const rows: (string | number | null)[][] = [];
    m.stops.forEach((g, i) => g.students.forEach((s) => rows.push([g.stop ? i + 1 : '', g.stop?.name ?? 'No stop assigned', g.stop?.pickupTime ?? '', g.stop?.dropTime ?? '', s.studentName, s.admissionNo, [s.grade, s.section].filter(Boolean).join(' ')])));
    downloadCsv(`manifest-${route.name.replace(/[^\w]+/g, '-').toLowerCase()}-${todayIso()}.csv`, toCsv(['Stop no.', 'Stop', 'Pickup', 'Drop', 'Student', 'Admission no.', 'Class'], rows));
    toast.success('Manifest downloaded', { description: `${total} students` });
  };

  const print = () => {
    if (!m) return;
    printHtml(
      `Manifest ${route.name}`,
      `<h1>${esc(route.name)}</h1><p class="muted">${esc(route.vehicle ? `${route.vehicle.registrationNo}${route.vehicle.driverName ? ` · Driver ${route.vehicle.driverName}${route.vehicle.driverPhone ? ` (${route.vehicle.driverPhone})` : ''}` : ''}` : 'No bus assigned')} · Pickup from ${esc(route.pickupStartTime ? fmtClock(route.pickupStartTime) : '—')} · Drop from ${esc(route.dropStartTime ? fmtClock(route.dropStartTime) : '—')} · ${total} students · printed ${esc(todayIso())}</p>` +
        m.stops
          .map(
            (g, i) =>
              `<div class="stop"><h2>${g.stop ? `${i + 1}. ${esc(g.stop.name)}` : 'No stop assigned'}${g.stop ? ` <span class="muted">· pickup ${esc(g.stop.pickupTime ? fmtClock(g.stop.pickupTime) : '—')} · drop ${esc(g.stop.dropTime ? fmtClock(g.stop.dropTime) : '—')}</span>` : ''}</h2>` +
              (g.students.length ? `<table><thead><tr><th>Student</th><th>Admission no.</th><th>Class</th><th>Boarded</th></tr></thead><tbody>${g.students.map((s) => `<tr><td>${esc(s.studentName)}</td><td>${esc(s.admissionNo)}</td><td>${esc([s.grade, s.section].filter(Boolean).join(' '))}</td><td style="width:60px"></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nobody boards here.</p>') +
              '</div>',
          )
          .join(''),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">Every student on this route, stop by stop in driving order. Print it for the driver or download it as a spreadsheet.</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={!m || total === 0} onClick={csv}>
            <Download /> CSV
          </Button>
          <Button variant="secondary" size="sm" disabled={!m} onClick={print}>
            <Printer /> Print
          </Button>
        </div>
      </div>
      {q.isPending ? (
        <Skeleton className="h-64 w-full" aria-busy />
      ) : q.isError || !m ? (
        <Card>
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the manifest" />
        </Card>
      ) : total === 0 && m.stops.every((s) => s.students.length === 0) ? (
        <Card>
          <EmptyState illustration="empty-generic" title="Nobody is allocated to this route" description="Allocate students from the Students tab of Transport." />
        </Card>
      ) : (
        <div className="space-y-4">
          {m.stops.map((g, i) => (
            <Card key={g.stop?.id ?? 'none'}>
              <CardBody>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="t-section">{g.stop ? `${i + 1}. ${g.stop.name}` : 'No stop assigned'}</h3>
                  <p className="t-caption text-ink-2">
                    {g.stop ? `Pickup ${g.stop.pickupTime ? fmtClock(g.stop.pickupTime) : '—'} · Drop ${g.stop.dropTime ? fmtClock(g.stop.dropTime) : '—'} · ` : ''}
                    {g.students.length} student{g.students.length === 1 ? '' : 's'}
                  </p>
                </div>
                {g.students.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-3">Nobody boards here.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-border">
                    {g.students.map((s) => (
                      <li key={s.studentId} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="font-medium">{s.studentName}</span>
                        <span className="t-caption text-ink-2">
                          {s.admissionNo} · {[s.grade, s.section].filter(Boolean).join(' ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Banner tone="info" className="print:hidden">The printed version lists every stop with tick boxes for the driver.</Banner>
    </div>
  );
}
