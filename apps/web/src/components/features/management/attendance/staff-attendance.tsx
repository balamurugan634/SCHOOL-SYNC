'use client';

import * as React from 'react';
import { format, startOfMonth } from 'date-fns';
import { Check, ChevronDown, Pencil, Save, Undo2 } from 'lucide-react';
import type { AttendanceStatus, StaffAttendanceItem } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { PageHeader } from '@/components/shell/page-header';
import { attMessage, useSaveStaffRegister, useStaffRegister, useStaffSummary, useUpdateStaffRecord, type StaffMarkRow } from '@/lib/client/attendance-admin';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { useUrlState } from '@/lib/client/url-state';
import { fmtClock, percent, plural, todayIso } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ExportButton, FilterChip, SearchBox } from '../shared/controls';
import { ErrorPanel, Panel } from '../shared/detail';
import { AttendanceTabs } from './attendance-tabs';
import { rangeProblem } from './export-card';
import { longDate, STATUS_WORD, StatusCounts, statusOptions, TableSection } from './status-bits';

type Draft = Record<string, AttendanceStatus>;
const PAGE_SIZE = 25;

/** `/admin/attendance/staff` — daily staff register (mark one by one or in bulk), single-record corrections, and a period summary. */
export function StaffAttendanceScreen() {
  const a = useAccess();
  const [p, set] = useUrlState({ tab: 'register', date: '', dept: '', q: '', from: '', to: '' });
  const [drafts, setDrafts] = React.useState<Draft>({});
  const dirty = Object.keys(drafts).length > 0;
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Leave the register without saving?', description: 'Some marks have not been saved. If you switch now they will be lost.', confirmLabel: 'Discard marks' });
  const tab = p.tab === 'summary' && a.can('staff_attendance:view', 'school') ? 'summary' : 'register';
  const [depts, setDepts] = React.useState<string[]>([]);
  const learnDepts = React.useCallback((names: (string | null)[]) => {
    setDepts((cur) => {
      const next = Array.from(new Set([...cur, ...names.filter((n): n is string => !!n)])).sort();
      return next.length === cur.length ? cur : next;
    });
  }, []);
  const today = todayIso();

  return (
    <>
      <PageHeader title="Staff attendance" description="Mark who is in each school day, correct a record, and see how attendance adds up over a period." />
      <AttendanceTabs />
      <Tabs value={tab} onValueChange={(v) => guard(() => set({ tab: v }))}>
        <TabsList aria-label="Staff attendance views">
          <TabsTrigger value="register">Daily register</TabsTrigger>
          <TabsTrigger value="summary">Period summary</TabsTrigger>
        </TabsList>
        <TabsContent value="register">
          <RegisterTab
            date={p.date || today}
            today={today}
            dept={p.dept}
            q={p.q}
            depts={depts}
            learnDepts={learnDepts}
            drafts={drafts}
            setDrafts={setDrafts}
            onDate={(v) => guard(() => { setDrafts({}); set({ date: v === today ? '' : v }); })}
            onDept={(v) => guard(() => { setDrafts({}); set({ dept: v }); })}
            onQ={(v) => set({ q: v })}
          />
        </TabsContent>
        <TabsContent value="summary">
          <SummaryTab from={p.from || format(startOfMonth(new Date()), 'yyyy-MM-dd')} to={p.to || today} today={today} dept={p.dept} depts={depts} learnDepts={learnDepts} onRange={(from, to) => set({ from, to })} onDept={(v) => set({ dept: v })} />
        </TabsContent>
      </Tabs>
      {dialog}
    </>
  );
}

// ── register ────────────────────────────────────────────────────────────────────────────────────
function RegisterTab({ date, today, dept, q, depts, learnDepts, drafts, setDrafts, onDate, onDept, onQ }: { date: string; today: string; dept: string; q: string; depts: string[]; learnDepts: (n: (string | null)[]) => void; drafts: Draft; setDrafts: React.Dispatch<React.SetStateAction<Draft>>; onDate: (v: string) => void; onDept: (v: string) => void; onQ: (v: string) => void }) {
  const a = useAccess();
  const reg = useStaffRegister(date === today ? undefined : date, dept);
  const save = useSaveStaffRegister();
  const [page, setPage] = React.useState(1);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = React.useState<AttendanceStatus>('present');
  const [editing, setEditing] = React.useState<StaffAttendanceItem | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const canMark = a.ok('staff_attendance:create', 'school');
  const canEdit = a.ok('staff_attendance:edit', 'school');
  const hint = a.hint('staff_attendance:create', 'school');

  const all = reg.data?.data;
  React.useEffect(() => {
    if (all) learnDepts(all.map((r) => r.department));
  }, [all, learnDepts]);
  React.useEffect(() => setPage(1), [q, dept, date]);

  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.employeeId.toLowerCase().includes(needle));
  }, [all, q]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const byId = React.useMemo(() => new Map((all ?? []).map((r) => [r.staffId, r])), [all]);

  const setStatus = (staffId: string, status: AttendanceStatus | null) =>
    setDrafts((d) => {
      const row = byId.get(staffId);
      const next = { ...d };
      if (!status || status === row?.status) delete next[staffId];
      else next[staffId] = status;
      return next;
    });
  const apply = (ids: string[], status: AttendanceStatus) =>
    setDrafts((d) => {
      const next = { ...d };
      for (const id of ids) {
        if (byId.get(id)?.status === status) delete next[id];
        else next[id] = status;
      }
      return next;
    });
  const unmarked = (all ?? []).filter((r) => !r.status && !drafts[r.staffId]);
  const leaveUnmarked = (all ?? []).filter((r) => !r.status && !drafts[r.staffId] && r.onApprovedLeave);
  const dirtyIds = Object.keys(drafts);

  const doSave = async () => {
    setSaveError(null);
    const records: StaffMarkRow[] = dirtyIds.map((id) => {
      const r = byId.get(id)!;
      // PUT replaces the whole mark, so keep the times and note that are already saved
      return { staffId: id, status: drafts[id]!, checkIn: r.checkIn, checkOut: r.checkOut, note: r.note };
    });
    const r = await save.go({ date: date === today ? undefined : date, records });
    if (r.ok) {
      toast.success(`Saved attendance for ${plural(r.data.saved, 'staff member')} on ${longDate(r.data.date)}.`);
      setDrafts({});
      setSel(new Set());
    } else setSaveError(attMessage(r.error));
  };

  const cols: Column<StaffAttendanceItem>[] = [
    {
      id: 'name',
      header: 'Staff member',
      cell: (r) => (
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium">{r.name}</span>
            {drafts[r.staffId] && <Badge variant="outline">Unsaved</Badge>}
          </span>
          <span className="t-caption block truncate text-ink-2">{[r.employeeId, r.designation].filter(Boolean).join(' · ')}</span>
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.name,
      mobile: 'title',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Select aria-label={`Status of ${r.name}`} className="!w-36" value={drafts[r.staffId] ?? r.status ?? ''} onValueChange={(v) => setStatus(r.staffId, v as AttendanceStatus)} options={statusOptions} placeholder="Not marked" disabled={!canMark} />
          {r.onApprovedLeave && !(drafts[r.staffId] ?? r.status) && <Badge variant="primary">Leave approved</Badge>}
        </span>
      ),
      hideable: false,
      mobile: 'status',
    },
    { id: 'in', header: 'In', cell: (r) => (r.checkIn ? fmtClock(r.checkIn) : <span className="text-ink-3">—</span>), mobile: 'detail', label: 'Check-in' },
    { id: 'out', header: 'Out', cell: (r) => (r.checkOut ? fmtClock(r.checkOut) : <span className="text-ink-3">—</span>), mobile: 'detail', label: 'Check-out' },
    { id: 'note', header: 'Note', cell: (r) => (r.note ? <span className="line-clamp-1 max-w-[14rem]">{r.note}</span> : <span className="text-ink-3">—</span>), mobile: 'hide' },
    {
      id: 'edit',
      header: <span className="sr-only">Edit</span>,
      label: 'Times and note',
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <IconButton label={`Edit times and note for ${r.name}`} size="icon-sm" onClick={() => setEditing(r)} disabled={!(r.recordId ? canEdit : canMark)} title={r.recordId ? a.hint('staff_attendance:edit', 'school') : hint}>
            <Pencil />
          </IconButton>
        </span>
      ),
      hideable: false,
      align: 'right',
      mobile: 'detail',
    },
  ];

  if (reg.isError && !reg.data) return <ErrorPanel error={reg.error} onRetry={() => void reg.refetch()} title="We couldn’t load the register" />;
  const counts = reg.data?.counts;
  return (
    <div className="space-y-6">
      {!canMark && (
        <Banner tone="info" title="You can see the register but not change it">
          {a.readOnly ? 'The school is in read-only mode until the subscription is renewed.' : 'Marking staff attendance needs the HR role. Ask a school administrator if you should be able to.'}
        </Banner>
      )}
      <Panel title={longDate(date)} description="Totals as saved. Marks you change below count once you save.">
        {counts ? <StatusCounts counts={counts} unmarked={counts.unmarked} /> : <div className="grid h-14 grid-cols-6 gap-3">{Array.from({ length: 6 }, (_, i) => <StatTile key={i} label="Loading" state="loading" className="!p-2" />)}</div>}
      </Panel>

      <DataTable
        id="attendance-staff-register"
        caption="Daily staff attendance register"
        columns={cols}
        rows={pageRows}
        rowKey={(r) => r.staffId}
        loading={reg.isPending}
        error={reg.isError ? reg.error : null}
        onRetry={() => void reg.refetch()}
        page={page}
        pageSize={PAGE_SIZE}
        total={rows.length}
        onPageChange={setPage}
        selectable={canMark}
        selected={sel}
        onSelectedChange={setSel}
        bulkActions={(sRows, clear) => (
          <>
            <Select aria-label="Mark selected as" className="!w-36" value={bulkStatus} onValueChange={(v) => setBulkStatus(v as AttendanceStatus)} options={statusOptions} />
            <Button
              size="sm"
              onClick={() => {
                apply(sRows.map((r) => r.staffId), bulkStatus);
                clear();
              }}
            >
              <Check /> Mark {sRows.length} as {STATUS_WORD[bulkStatus].toLowerCase()}
            </Button>
          </>
        )}
        filters={
          <>
            <div className="w-44">
              <DatePicker value={date} onChange={onDate} max={today} />
            </div>
            <SearchBox value={q} onChange={onQ} placeholder="Search name or employee id" />
            {depts.length > 0 && (
              <Select aria-label="Department" className="w-44" value={dept || '__all'} onValueChange={(v) => onDept(v === '__all' ? '' : v)} options={[{ value: '__all', label: 'All departments' }, ...depts.map((d) => ({ value: d, label: d }))]} />
            )}
            {dept && <FilterChip label={dept} onRemove={() => onDept('')} />}
          </>
        }
        toolbar={
          canMark ? (
            <>
              {leaveUnmarked.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => apply(leaveUnmarked.map((r) => r.staffId), 'leave')}>
                  Mark {leaveUnmarked.length} on approved leave
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" disabled={unmarked.length === 0}>
                    Mark {unmarked.length} unmarked <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Mark everyone who has no mark as</DropdownMenuLabel>
                  {statusOptions.map((o) => (
                    <DropdownMenuItem key={o.value} onSelect={() => apply(unmarked.map((r) => r.staffId), o.value as AttendanceStatus)}>
                      {o.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : undefined
        }
        empty={
          q || dept ? (
            <EmptyState illustration="no-results" title="No staff match" description="Try a different name, or clear the department." action={<Button variant="secondary" size="sm" onClick={() => { onQ(''); onDept(''); }}>Clear filters</Button>} compact />
          ) : (
            <EmptyState illustration="empty-generic" title="No active staff" description="Staff members appear here once they are added under People → Staff." compact />
          )
        }
      />

      {dirtyIds.length > 0 && (
        <div className="sticky bottom-4 z-20 space-y-2" role="region" aria-label="Unsaved attendance marks">
          {saveError && <Banner tone="danger" title="The register was not saved">{saveError}</Banner>}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised px-4 py-2.5 shadow-pop">
            <span className="text-sm font-medium">{plural(dirtyIds.length, 'change')} not saved</span>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setDrafts({}); setSaveError(null); }} disabled={save.isPending}>
                <Undo2 /> Discard
              </Button>
              <Button size="sm" onClick={() => void doSave()} loading={save.isPending} disabled={!canMark} title={hint}>
                <Save /> Save register
              </Button>
            </div>
          </div>
        </div>
      )}

      <RecordDialog row={editing} date={date === today ? undefined : date} draft={editing ? drafts[editing.staffId] : undefined} onClose={() => setEditing(null)} onSaved={(id) => setStatus(id, null)} />
    </div>
  );
}

/** Correct one record (PATCH) or enter its first mark (PUT): status, check-in, check-out, note. Saves immediately. */
function RecordDialog({ row, date, draft, onClose, onSaved }: { row: StaffAttendanceItem | null; date: string | undefined; draft?: AttendanceStatus; onClose: () => void; onSaved: (staffId: string) => void }) {
  const patch = useUpdateStaffRecord();
  const put = useSaveStaffRegister();
  const [status, setStatus] = React.useState('');
  const [inT, setInT] = React.useState('');
  const [outT, setOutT] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (row) {
      setStatus(draft ?? row.status ?? '');
      setInT(row.checkIn ?? '');
      setOutT(row.checkOut ?? '');
      setNote(row.note ?? '');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.staffId]);
  const timesBad = inT && outT && outT < inT ? 'Check-out must be after check-in.' : null;
  const busy = patch.isPending || put.isPending;
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={row ? `${row.recordId ? 'Correct' : 'Mark'} attendance: ${row.name}` : 'Attendance'} description={row?.recordId ? 'This changes the saved record straight away and is kept in the audit log.' : 'This saves a first mark for the day straight away.'}>
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!row || !status || timesBad) return;
            setError(null);
            const body = { status: status as AttendanceStatus, checkIn: inT || null, checkOut: outT || null, note: note.trim() || null };
            const r = row.recordId ? await patch.go({ id: row.recordId, body }) : await put.go({ date, records: [{ staffId: row.staffId, ...body }] });
            if (r.ok) {
              onSaved(row.staffId);
              onClose();
            } else setError(attMessage(r.error));
          }}
        >
          <Field label="Status" htmlFor="rec-status" required>
            <Select id="rec-status" value={status} onValueChange={setStatus} options={statusOptions} placeholder="Choose a status" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in" htmlFor="rec-in">
              <Input id="rec-in" type="time" value={inT} onChange={(e) => setInT(e.target.value)} />
            </Field>
            <Field label="Check-out" htmlFor="rec-out" error={timesBad}>
              <Input id="rec-out" type="time" value={outT} onChange={(e) => setOutT(e.target.value)} invalid={!!timesBad} />
            </Field>
          </div>
          <Field label="Note" htmlFor="rec-note" hint="Optional">
            <Input id="rec-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          {error && <Banner tone="danger">{error}</Banner>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!status || !!timesBad}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── summary ─────────────────────────────────────────────────────────────────────────────────────
function SummaryTab({ from, to, today, dept, depts, learnDepts, onRange, onDept }: { from: string; to: string; today: string; dept: string; depts: string[]; learnDepts: (n: (string | null)[]) => void; onRange: (from: string, to: string) => void; onDept: (v: string) => void }) {
  const a = useAccess();
  const problem = from > to ? 'The start date must not be after the end date.' : null;
  const q = useStaffSummary(from, to, dept, !problem);
  const s = q.data;
  React.useEffect(() => {
    if (s) learnDepts(s.staff.map((r) => r.department));
  }, [s, learnDepts]);
  type Row = NonNullable<typeof s>['staff'][number];
  const exportProblem = rangeProblem(from, to);
  const exportBlocked = a.hint('staff_attendance:export', 'school');

  const cols: Column<Row>[] = [
    {
      id: 'name',
      header: 'Staff member',
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium">{r.name}</span>
          <span className="t-caption block truncate text-ink-2">{[r.employeeId, r.designation].filter(Boolean).join(' · ')}</span>
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.name,
      mobile: 'title',
    },
    { id: 'dept', header: 'Department', cell: (r) => r.department ?? <span className="text-ink-3">—</span>, sortable: true, sortValue: (r) => r.department ?? '', defaultHidden: true, mobile: 'hide' },
    { id: 'present', header: 'Present', cell: (r) => r.present, align: 'right', sortable: true, sortValue: (r) => r.present, mobile: 'detail' },
    { id: 'late', header: 'Late', cell: (r) => r.late, align: 'right', sortable: true, sortValue: (r) => r.late, mobile: 'detail' },
    { id: 'half', header: 'Half day', cell: (r) => r.half_day, align: 'right', sortable: true, sortValue: (r) => r.half_day, mobile: 'hide' },
    { id: 'absent', header: 'Absent', cell: (r) => r.absent, align: 'right', sortable: true, sortValue: (r) => r.absent, mobile: 'detail' },
    { id: 'leave', header: 'Leave', cell: (r) => r.leave, align: 'right', sortable: true, sortValue: (r) => r.leave, mobile: 'hide' },
    { id: 'total', header: 'Days marked', cell: (r) => r.total, align: 'right', sortable: true, sortValue: (r) => r.total, mobile: 'hide' },
    { id: 'pct', header: '% present', label: 'Percent present', cell: (r) => percent(r.percentage), align: 'right', sortable: true, sortValue: (r) => r.percentage, mobile: 'value' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" htmlFor="staff-sum-from">
          <div className="w-44">
            <DatePicker id="staff-sum-from" value={from} onChange={(v) => onRange(v, to)} max={today} invalid={!!problem} />
          </div>
        </Field>
        <Field label="To" htmlFor="staff-sum-to">
          <div className="w-44">
            <DatePicker id="staff-sum-to" value={to} onChange={(v) => onRange(from, v)} max={today} invalid={!!problem} />
          </div>
        </Field>
        {depts.length > 0 && (
          <Field label="Department" htmlFor="staff-sum-dept">
            <Select id="staff-sum-dept" className="w-44" value={dept || '__all'} onValueChange={(v) => onDept(v === '__all' ? '' : v)} options={[{ value: '__all', label: 'All departments' }, ...depts.map((d) => ({ value: d, label: d }))]} />
          </Field>
        )}
        <div className="sm:ml-auto">
          <ExportButton path="/staff-attendance/export" query={{ from, to }} filename={`staff-attendance-${from}-to-${to}.csv`} disabled={!!exportProblem || !!exportBlocked} title={exportBlocked ?? exportProblem ?? undefined} />
        </div>
      </div>
      {(problem || exportProblem) && (
        <p role="alert" className="t-caption -mt-3 text-danger">
          {problem ?? `Table shows any range; the CSV export is limited: ${exportProblem}`}
        </p>
      )}

      {q.isError && !s ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the summary" />
      ) : problem ? null : (
        <>
          <Panel title={s ? `Marked on ${longDate(s.today.date)}` : 'Latest marked day'} description="The most recent day in the period that has attendance.">
            {s ? <StatusCounts counts={s.today} unmarked={s.today.unmarked} /> : <StatTile label="Loading" state="loading" />}
          </Panel>
          <TableSection title="By person" description={s ? `${plural(s.staff.length, 'staff member')} from ${longDate(s.from)} to ${longDate(s.to)}` : undefined}>
            <DataTable
              id="attendance-staff-summary"
              caption="Staff attendance over the chosen period"
              columns={cols}
              rows={s?.staff}
              rowKey={(r) => r.staffId}
              loading={q.isPending}
              error={q.isError ? q.error : null}
              onRetry={() => void q.refetch()}
              empty={<EmptyState illustration="empty-generic" title="No attendance in this period" description="Nothing was marked between these dates. Try a longer period." compact />}
            />
          </TableSection>
        </>
      )}
      <p className="t-caption text-ink-2">Percent present counts present and late days in full and half days as half, against every marked day. Days on approved leave are left out.</p>
    </div>
  );
}
