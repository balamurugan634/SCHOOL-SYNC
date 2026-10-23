'use client';

import * as React from 'react';
import { ArrowRightLeft, Plus, UserMinus, UsersRound } from 'lucide-react';
import type { TransportAllocation } from '@school-sync/shared';
import { useAllocate, useAllocations, useDeallocate, useRoute, useRoutes } from '@/lib/client/operations';
import { friendlyError, useSectionList, useStudentSearch } from '@/lib/client/mgmt';
import { fmtClock, fmtDate, todayIso } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { AsyncConfirm } from '../common/dialogs';
import { ClearFilters, FilterBar, FilterChips, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { StudentPicker, type PickerOption } from '../common/picker';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

export function AllocationsTab() {
  const { writeBlock } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const routeId = ls.get('route');
  const stopId = ls.get('stop');
  const routes = useRoutes({ pageSize: 100, active: 'true' });
  const routeDetail = useRoute(routeId || null);
  const q = useAllocations({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, routeId: routeId || undefined, stopId: stopId || undefined });
  const [dlg, setDlg] = React.useState<{ kind: 'single'; row?: TransportAllocation } | { kind: 'bulk' } | null>(null);
  const [off, setOff] = React.useState<TransportAllocation | null>(null);
  const dealloc = useDeallocate();
  const block = writeBlock('transport:edit', 'school');
  const filtered = !!ls.q || !!routeId || !!stopId;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">Which students use the bus, and where they board. A bus that is full refuses further students.</p>
        <div className="flex flex-wrap gap-2">
          <GuardedButton blocked={block} variant="secondary" onClick={() => setDlg({ kind: 'bulk' })}>
            <UsersRound /> Allocate a class
          </GuardedButton>
          <GuardedButton blocked={block} onClick={() => setDlg({ kind: 'single' })}>
            <Plus /> Allocate a student
          </GuardedButton>
        </div>
      </div>
      <DataTable<TransportAllocation>
        id="ops-allocations"
        caption="Students using the bus"
        rows={q.data?.data}
        rowKey={(r) => r.studentId}
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
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search student" />
            <FilterSelect label="Route" className="w-56" value={routeId} onChange={(v) => ls.set({ route: v, stop: null })} options={(routes.data?.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
            {routeId && <FilterSelect label="Stop" className="w-48" value={stopId} onChange={(v) => ls.set({ stop: v })} options={(routeDetail.data?.stops ?? []).map((s) => ({ value: s.id, label: s.name }))} />}
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No students match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(routeId ? [{ label: 'Route', value: routes.data?.data.find((r) => r.id === routeId)?.name ?? '…' }] : []), ...(stopId ? [{ label: 'Stop', value: routeDetail.data?.stops.find((s) => s.id === stopId)?.name ?? '…' }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No student uses the bus yet" description="Allocate students to a route and a stop." action={<GuardedButton blocked={block} onClick={() => setDlg({ kind: 'single' })}>Allocate a student</GuardedButton>} />
          )
        }
        columns={[
          { id: 'student', header: 'Student', cell: (r) => (<><span className="block font-medium">{r.studentName}</span><span className="t-caption block text-ink-3">{r.admissionNo}</span></>), sortable: true, sortValue: (r) => r.studentName, mobile: 'title' },
          { id: 'class', header: 'Class', cell: (r) => [r.grade, r.section].filter(Boolean).join(' ') || '—', mobile: 'sub' },
          { id: 'route', header: 'Route', cell: (r) => r.routeName, sortable: true, sortValue: (r) => r.routeName, mobile: 'detail', label: 'Route' },
          { id: 'stop', header: 'Stop', cell: (r) => r.stopName ?? <span className="text-warning">No stop</span>, mobile: 'detail', label: 'Stop' },
          { id: 'times', header: 'Pickup / drop', cell: (r) => `${r.pickupTime ? fmtClock(r.pickupTime) : '—'} / ${r.dropTime ? fmtClock(r.dropTime) : '—'}`, defaultHidden: true, mobile: 'hide' },
          { id: 'since', header: 'Since', cell: (r) => fmtDate(r.startDate), mobile: 'hide' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            label: 'Actions',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <IconButton label={`Move ${r.studentName} to another stop or route`} size="icon-sm" disabled={!!block} onClick={() => setDlg({ kind: 'single', row: r })}>
                  <ArrowRightLeft />
                </IconButton>
                <IconButton label={`Take ${r.studentName} off the bus`} size="icon-sm" disabled={!!block} onClick={() => setOff(r)}>
                  <UserMinus />
                </IconButton>
              </div>
            ),
          },
        ]}
      />
      {dlg?.kind === 'single' && <AllocateDialog row={dlg.row} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'bulk' && <BulkDialog onClose={() => setDlg(null)} />}
      <AsyncConfirm
        open={!!off}
        onOpenChange={(o) => !o && setOff(null)}
        title={`Take ${off?.studentName ?? 'this student'} off the bus?`}
        description={`${off?.studentName ?? 'The student'} is removed from ${off?.routeName ?? 'the route'} and frees a seat. Their transport fee is not changed automatically.`}
        confirmLabel="Remove from bus"
        destructive
        onConfirm={async () => {
          if (!off) return;
          await dealloc.mutateAsync({ studentId: off.studentId });
          toast.success(`${off.studentName} is off the bus`);
        }}
      />
    </div>
  );
}

function RouteStopPicker({ routeId, setRouteId, stopId, setStopId, tried }: { routeId: string; setRouteId: (v: string) => void; stopId: string; setStopId: (v: string) => void; tried: boolean }) {
  const routes = useRoutes({ pageSize: 100, active: 'true' });
  const detail = useRoute(routeId || null);
  const route = routes.data?.data.find((r) => r.id === routeId);
  return (
    <>
      <Field label="Route" required error={tried && !routeId ? 'Choose a route' : null} hint={route && route.seatsLeft !== null ? `${route.seatsLeft} seat${route.seatsLeft === 1 ? '' : 's'} left of ${route.capacity}.` : undefined}>
        <Select
          value={routeId}
          onValueChange={(v) => {
            setRouteId(v);
            setStopId('');
          }}
          placeholder={routes.isPending ? 'Loading…' : 'Choose a route'}
          invalid={tried && !routeId}
          options={(routes.data?.data ?? []).map((r) => ({ value: r.id, label: `${r.name}${r.seatsLeft !== null ? ` · ${r.seatsLeft} seats left` : ''}` }))}
        />
      </Field>
      <Field label="Stop" hint="Optional. The student can be put on the route first and given a stop later.">
        <Select value={stopId} onValueChange={setStopId} disabled={!routeId} placeholder={!routeId ? 'Choose a route first' : detail.isPending ? 'Loading…' : 'No stop yet'} options={(detail.data?.stops ?? []).map((s) => ({ value: s.id, label: `${s.ordinal}. ${s.name}` }))} />
      </Field>
    </>
  );
}

function AllocateDialog({ row, onClose }: { row?: TransportAllocation; onClose: () => void }) {
  const allocate = useAllocate();
  const [student, setStudent] = React.useState<PickerOption | null>(row ? { value: row.studentId, label: row.studentName, sub: row.admissionNo } : null);
  const [routeId, setRouteId] = React.useState(row?.routeId ?? '');
  const [stopId, setStopId] = React.useState(row?.stopId ?? '');
  const [start, setStart] = React.useState('');
  const [tried, setTried] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const submit = async () => {
    setTried(true);
    if (!student || !routeId) return;
    setErr(null);
    try {
      await allocate.mutateAsync({ studentId: student.value, body: { routeId, stopId: stopId || null, startDate: start || undefined } });
      toast.success(row ? 'Allocation changed' : 'Student allocated', { description: student.label });
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={row ? 'Move a student' : 'Allocate a student to the bus'} description={row ? `${row.studentName} is on ${row.routeName}.` : 'A student has one route and stop at a time; allocating again moves them.'}>
        <div className="mt-4 space-y-4">
          <Field label="Student" required error={tried && !student ? 'Choose a student' : null}>
            <StudentPicker selected={student} onSelect={setStudent} disabled={!!row} clearable={!row} invalid={tried && !student} />
          </Field>
          <RouteStopPicker routeId={routeId} setRouteId={setRouteId} stopId={stopId} setStopId={setStopId} tried={tried} />
          <Field label="Starts on" hint="Optional. Defaults to today.">
            <DatePicker value={start || null} onChange={setStart} className="w-44" placeholder="Today" presets={[{ label: 'Today', value: todayIso() }]} />
          </Field>
          {err && <Banner tone="danger">{err}</Banner>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={allocate.isPending} onClick={() => void submit()}>
              {row ? 'Move student' : 'Allocate'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Run `fn` over `items` with a small concurrency, collecting per-item results (one failure never stops the rest). */
async function runLimited<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<{ item: T; ok: boolean; value?: R; error?: unknown }[]> {
  const out: { item: T; ok: boolean; value?: R; error?: unknown }[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = { item: items[i]!, ok: true, value: await fn(items[i]!) };
        } catch (error) {
          out[i] = { item: items[i]!, ok: false, error };
        }
      }
    }),
  );
  return out;
}

function BulkDialog({ onClose }: { onClose: () => void }) {
  const allocate = useAllocate();
  const sections = useSectionList();
  const [sectionId, setSectionId] = React.useState('');
  const students = useStudentSearch('', { sectionId: sectionId || undefined, pageSize: 100 });
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [routeId, setRouteId] = React.useState('');
  const [stopId, setStopId] = React.useState('');
  const [tried, setTried] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<{ name: string; ok: boolean; message?: string }[] | null>(null);
  const routes = useRoutes({ pageSize: 100, active: 'true' });
  const route = routes.data?.data.find((r) => r.id === routeId);
  const list = students.data?.data ?? [];
  React.useEffect(() => setPicked(new Set()), [sectionId]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const over = route && route.seatsLeft !== null && picked.size > route.seatsLeft;

  const go = async () => {
    setTried(true);
    if (!routeId || picked.size === 0) return;
    setRunning(true);
    const chosen = list.filter((s) => picked.has(s.id));
    const res = await runLimited(chosen, 3, (s) => allocate.mutateAsync({ studentId: s.id, body: { routeId, stopId: stopId || null } }));
    setResults(res.map((r) => ({ name: r.item.name, ok: r.ok, message: r.ok ? undefined : friendlyError(r.error) })));
    setRunning(false);
    const done = res.filter((r) => r.ok).length;
    if (done) toast.success(`${done} student${done === 1 ? '' : 's'} allocated`, { description: res.length - done ? `${res.length - done} could not be allocated.` : undefined });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent title="Allocate a class to the bus" description="Pick a class, tick the students, choose the route and stop." size="lg">
        {results ? (
          <div className="mt-4 space-y-4">
            <Banner tone={results.every((r) => r.ok) ? 'success' : 'warning'} title={`${results.filter((r) => r.ok).length} of ${results.length} allocated`}>
              {results.some((r) => !r.ok) ? 'Some students were refused (for example because the bus is full). They are listed below; fix the cause and try those again.' : 'Everyone is on the bus.'}
            </Banner>
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm" aria-label="Results">
              {results.map((r) => (
                <li key={r.name} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="font-medium">{r.name}</span>
                  <span className={r.ok ? 'text-success' : 'text-danger'}>{r.ok ? 'Allocated' : r.message}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <Field label="Class" required>
              <Select value={sectionId} onValueChange={setSectionId} placeholder="Choose a class" options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.gradeName} ${s.name}` }))} />
            </Field>
            {sectionId && (
              <Field label={`Students${picked.size ? ` (${picked.size} selected)` : ''}`} required error={tried && picked.size === 0 ? 'Tick at least one student' : null}>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
                  {students.isPending ? (
                    <div className="space-y-2 p-3" aria-busy>
                      <Skeleton className="h-5 w-full" />
                      <Skeleton className="h-5 w-full" />
                    </div>
                  ) : list.length === 0 ? (
                    <p className="p-3 text-sm text-ink-2">No active students in this class.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      <li className="flex items-center gap-2.5 px-3 py-2">
                        <Checkbox id="bulk-all" checked={picked.size === list.length ? true : picked.size > 0 ? 'indeterminate' : false} onCheckedChange={(v) => setPicked(v === true ? new Set(list.map((s) => s.id)) : new Set())} />
                        <label htmlFor="bulk-all" className="text-sm font-medium">
                          Select the whole class
                        </label>
                      </li>
                      {list.map((s) => (
                        <li key={s.id} className="flex items-center gap-2.5 px-3 py-2">
                          <Checkbox id={`b-${s.id}`} checked={picked.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                          <label htmlFor={`b-${s.id}`} className="flex-1 text-sm">
                            {s.name} <span className="t-caption text-ink-3">{s.admissionNo}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Field>
            )}
            <RouteStopPicker routeId={routeId} setRouteId={setRouteId} stopId={stopId} setStopId={setStopId} tried={tried} />
            {over && <Banner tone="warning">Only {route!.seatsLeft} seat{route!.seatsLeft === 1 ? ' is' : 's are'} left on this route but {picked.size} students are ticked. The ones that do not fit will be refused.</Banner>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={running}>
                Cancel
              </Button>
              <Button loading={running} onClick={() => void go()}>
                Allocate {picked.size > 0 ? `${picked.size} student${picked.size === 1 ? '' : 's'}` : ''}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
