'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Paperclip, X } from 'lucide-react';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { useMe } from '@/components/me-context';
import { useDecideLeave, useStaffLeave, useStaffLeaveBalance, useStudentLeave, type LeaveFilters } from '@/lib/client/attendance-admin';
import { sectionLabel, sectionOptions, staffOptions, useSectionList, useStaffPicker } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { errorMessage } from '@/lib/problem';
import { fmtDate, fmtDateTime, plural } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { DefList, Panel } from '../shared/detail';
import { ReasonDialog } from '../shared/dialogs';
import { paths } from '../shared/paths';
import { AttendanceTabs } from './attendance-tabs';
import { BulkApproveDialog } from './bulk-approve';

type Kind = 'student' | 'staff';

/** One shape for both queues so they share the table, drawer and dialogs. */
interface Leave {
  id: string;
  personId: string;
  person: string;
  /** admission no. / employee id */
  code: string;
  /** class (students) / designation (staff) */
  extra: string | null;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: string;
  requestedByName: string | null;
  createdAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
  attachmentFileId: string | null;
  sectionId: string | null;
}

const TYPE_LABEL: Record<string, string> = { sick: 'Sick', casual: 'Casual', family: 'Family', event: 'School event', other: 'Other' };
const STATUS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All requests' },
];
const range = (l: Pick<Leave, 'fromDate' | 'toDate'>) => (l.fromDate === l.toDate ? fmtDate(l.fromDate, { day: 'numeric', month: 'short', year: 'numeric' }) : `${fmtDate(l.fromDate, { day: 'numeric', month: 'short' })} – ${fmtDate(l.toDate, { day: 'numeric', month: 'short', year: 'numeric' })}`);

export function StudentLeaveScreen() {
  return <LeaveQueue kind="student" />;
}
export function StaffLeaveScreen() {
  return <LeaveQueue kind="staff" />;
}

function LeaveQueue({ kind }: { kind: Kind }) {
  const a = useAccess();
  const me = useMe();
  const student = kind === 'student';
  const permApprove = student ? 'leave:approve' : 'staff_leave:approve';
  const [p, set, reset] = useUrlState({ status: 'pending', sectionId: '', q: '', from: '', to: '', page: 1, size: 25 });
  const filters: LeaveFilters = { status: p.status, sectionId: p.sectionId, q: p.q, from: p.from, to: p.to, page: p.page, pageSize: p.size };
  const sq = useStudentLeave(filters, student);
  const tq = useStaffLeave(filters, !student);
  const q = student ? sq : tq;
  const rows: Leave[] | undefined = React.useMemo(() => {
    if (student) return sq.data?.data.map((l) => ({ id: l.id, personId: l.studentId, person: l.studentName, code: l.admissionNo, extra: l.sectionName, leaveType: l.leaveType, fromDate: l.fromDate, toDate: l.toDate, days: l.days, reason: l.reason, status: l.status, requestedByName: l.requestedByName, createdAt: l.createdAt, decidedByName: l.decidedByName, decidedAt: l.decidedAt, decisionNote: l.decisionNote, canDecide: l.canDecide, attachmentFileId: l.attachmentFileId, sectionId: l.sectionId }));
    return tq.data?.data.map((l) => ({ id: l.id, personId: l.staffId, person: l.staffName, code: l.employeeId, extra: l.designation, leaveType: l.leaveType, fromDate: l.fromDate, toDate: l.toDate, days: l.days, reason: l.reason, status: l.status, requestedByName: null, createdAt: l.createdAt, decidedByName: l.decidedByName, decidedAt: l.decidedAt, decisionNote: l.decisionNote, canDecide: l.canDecide, attachmentFileId: null, sectionId: null }));
  }, [student, sq.data, tq.data]);
  const total = q.data?.meta.total;

  const secQ = useSectionList({ enabled: student && a.can('academics:view') });
  const sections = Array.isArray(secQ.data) ? secQ.data : undefined;
  const decide = useDecideLeave(kind);
  const [open, setOpen] = React.useState<Leave | null>(null);
  const [dlg, setDlg] = React.useState<{ item: Leave; decision: 'approve' | 'reject' } | null>(null);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [bulk, setBulk] = React.useState(false);
  const canDecide = a.ok(permApprove, student ? undefined : 'school');
  const hint = a.hint(permApprove, student ? undefined : 'school');
  const filtered = p.status !== 'pending' || !!p.sectionId || !!p.q || !!p.from || !!p.to;
  const ownStaff = (l: Leave) => !student && l.personId === me.profile.staffId;

  const rowActions = (r: Leave) =>
    r.status === 'pending' && r.canDecide ? (
      <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" onClick={() => setDlg({ item: r, decision: 'approve' })} disabled={!canDecide} title={hint} aria-label={`Approve leave for ${r.person}`}>
          <Check /> Approve
        </Button>
        <Button size="sm" variant="danger" onClick={() => setDlg({ item: r, decision: 'reject' })} disabled={!canDecide} title={hint} aria-label={`Reject leave for ${r.person}`}>
          <X /> Reject
        </Button>
      </span>
    ) : ownStaff(r) && r.status === 'pending' ? (
      <span className="t-caption text-ink-2">Your own request</span>
    ) : null;

  const cols: Column<Leave>[] = [
    {
      id: 'person',
      header: student ? 'Student' : 'Staff member',
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium">{r.person}</span>
          <span className="t-caption block truncate text-ink-2">{[r.code, r.extra].filter(Boolean).join(' · ')}</span>
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.person,
      mobile: 'title',
    },
    { id: 'dates', header: 'Dates', cell: (r) => <span className="whitespace-nowrap">{range(r)}</span>, sortable: true, sortValue: (r) => r.fromDate, mobile: 'sub' },
    { id: 'days', header: 'School days', cell: (r) => r.days, align: 'right', sortable: true, sortValue: (r) => r.days, mobile: 'detail' },
    { id: 'type', header: 'Type', cell: (r) => TYPE_LABEL[r.leaveType] ?? r.leaveType, mobile: 'detail' },
    { id: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2 max-w-xs">{r.reason}</span>, mobile: 'hide' },
    ...(student ? [{ id: 'by', header: 'Asked by', cell: (r: Leave) => r.requestedByName ?? '—', defaultHidden: true, mobile: 'hide' as const }] : []),
    { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
    { id: 'actions', header: <span className="sr-only">Actions</span>, label: 'Actions', cell: rowActions, hideable: false, align: 'right', mobile: 'hide' },
  ];

  const noun = student ? 'student leave request' : 'staff leave request';
  return (
    <>
      <PageHeader
        title={student ? 'Student leave' : 'Staff leave'}
        description={student ? 'Leave that parents and students have asked for. Approved days show as leave in attendance instead of absence.' : 'Leave that staff have asked for. You cannot decide your own request: another approver has to.'}
      />
      <AttendanceTabs />
      {!a.can(permApprove, student ? undefined : 'school') && (
        <Banner tone="info" className="mb-4" title="You can view these requests but not decide them">
          Deciding leave needs a different role. Ask a school administrator if you should be able to.
        </Banner>
      )}
      <DataTable
        id={`attendance-${kind}-leave`}
        caption={student ? 'Student leave requests' : 'Staff leave requests'}
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.isError ? q.error : null}
        onRetry={() => void q.refetch()}
        page={p.page}
        pageSize={p.size}
        total={total}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(size) => set({ size, page: 1 })}
        selectable={p.status === 'pending' && canDecide}
        selected={sel}
        onSelectedChange={setSel}
        bulkActions={(sRows) => {
          const ids = sRows.filter((r) => r.status === 'pending' && r.canDecide).map((r) => r.id);
          return (
            <Button size="sm" onClick={() => setBulk(true)} disabled={ids.length === 0}>
              <Check /> Approve {ids.length}
            </Button>
          );
        }}
        onRowClick={setOpen}
        filters={
          <>
            <SearchBox value={p.q} onChange={(v) => set({ q: v })} placeholder={student ? 'Search student or admission no.' : 'Search staff member'} />
            <Select aria-label="Status" className="w-36" value={p.status} onValueChange={(v) => set({ status: v })} options={STATUS} />
            {student && <FilterSelect label="Class" value={p.sectionId} onChange={(v) => set({ sectionId: v })} options={sectionOptions(sections)} allLabel="All classes" disabled={!sections} />}
            <div className="flex items-center gap-1.5">
              <div className="w-36">
                <DatePicker value={p.from || null} onChange={(v) => set({ from: v })} placeholder="From date" />
              </div>
              <span className="t-caption text-ink-3" aria-hidden>
                to
              </span>
              <div className="w-36">
                <DatePicker value={p.to || null} onChange={(v) => set({ to: v })} placeholder="To date" min={p.from || undefined} />
              </div>
              {(p.from || p.to) && (
                <Button variant="ghost" size="sm" onClick={() => reset(['from', 'to'])}>
                  Clear dates
                </Button>
              )}
            </div>
          </>
        }
        empty={
          filtered ? (
            <EmptyState
              illustration="no-results"
              title="No requests match"
              description="Try another status or widen the dates."
              filters={
                <>
                  {p.status !== 'pending' && <FilterChip label={`Status: ${p.status}`} onRemove={() => reset(['status'])} />}
                  {p.q && <FilterChip label={`“${p.q}”`} onRemove={() => reset(['q'])} />}
                  {p.sectionId && <FilterChip label={sections?.find((s) => s.id === p.sectionId) ? sectionLabel(sections.find((s) => s.id === p.sectionId)!) : 'One class'} onRemove={() => reset(['sectionId'])} />}
                  {(p.from || p.to) && <FilterChip label={`${p.from ? fmtDate(p.from) : 'Any'} to ${p.to ? fmtDate(p.to) : 'any'}`} onRemove={() => reset(['from', 'to'])} />}
                </>
              }
              action={<ClearFiltersButton onClick={() => reset()} />}
              compact
            />
          ) : (
            <EmptyState illustration="success" title="No leave requests are waiting" description={student ? 'Requests from parents and students appear here as soon as they are sent.' : 'Requests from staff appear here as soon as they are sent.'} compact />
          )
        }
      />

      {!student && a.can('staff:view', 'school') && (
        <div className="mt-6">
          <StaffBalanceCard />
        </div>
      )}

      <LeaveDrawer
        item={open}
        kind={kind}
        onClose={() => setOpen(null)}
        canDecide={canDecide}
        hint={hint}
        own={open ? ownStaff(open) : false}
        onDecide={(item, decision) => setDlg({ item, decision })}
      />

      <ReasonDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.decision === 'approve' ? 'Approve this leave?' : 'Reject this leave?'}
        description={dlg ? `${dlg.item.person}, ${range(dlg.item)} (${plural(dlg.item.days, 'school day')}).` : undefined}
        label={dlg?.decision === 'approve' ? 'Note (optional)' : 'Why is it rejected?'}
        required={dlg?.decision === 'reject'}
        placeholder={dlg?.decision === 'reject' ? 'The applicant will read this.' : 'Anything the applicant should know.'}
        confirmLabel={dlg?.decision === 'approve' ? 'Approve leave' : 'Reject leave'}
        destructive={dlg?.decision === 'reject'}
        consequence={
          dlg?.decision === 'approve'
            ? student
              ? 'Attendance for these days will show as leave rather than absent, and the family is notified.'
              : 'The staff member is notified. Their attendance for these days can be marked as leave.'
            : 'Nothing changes in attendance and the applicant is told why.'
        }
        onSubmit={async (note) => {
          if (!dlg) return false;
          const r = await decide.go({ id: dlg.item.id, decision: dlg.decision, note });
          if (r.ok) setOpen(null);
          return r.ok;
        }}
      />
      <BulkApproveDialog
        open={bulk}
        onOpenChange={setBulk}
        ids={(rows ?? []).filter((r) => sel.has(r.id) && r.status === 'pending' && r.canDecide).map((r) => r.id)}
        kind={student ? 'leave' : 'staff-leave'}
        noun={noun}
        consequence={student ? 'Attendance for those days will show as leave rather than absent, and each family is notified. The selected requests are approved one by one.' : 'Each staff member is notified. The selected requests are approved one by one.'}
        onDone={() => setSel(new Set())}
      />
    </>
  );
}

function LeaveDrawer({ item, kind, onClose, canDecide, hint, own, onDecide }: { item: Leave | null; kind: Kind; onClose: () => void; canDecide: boolean; hint?: string; own: boolean; onDecide: (i: Leave, d: 'approve' | 'reject') => void }) {
  const a = useAccess();
  const student = kind === 'student';
  return (
    <Drawer open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent title={student ? 'Student leave request' : 'Staff leave request'} description={item ? `${item.person} · ${range(item)}` : undefined} showTitle>
        {item && (
          <>
            <SheetBody>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={item.status} />
                <Badge variant="neutral">{TYPE_LABEL[item.leaveType] ?? item.leaveType}</Badge>
                <span className="t-caption text-ink-2">{plural(item.days, 'school day')}</span>
              </div>
              <DefList
                items={[
                  { label: student ? 'Student' : 'Staff member', value: student && a.can('students:view') ? <Link href={paths.student(item.personId)} className="text-brand-ink underline-offset-4 hover:underline">{item.person}</Link> : !student && a.can('staff:view') ? <Link href={paths.staffMember(item.personId)} className="text-brand-ink underline-offset-4 hover:underline">{item.person}</Link> : item.person },
                  { label: student ? 'Admission no.' : 'Employee id', value: item.code },
                  { label: student ? 'Class' : 'Designation', value: item.extra },
                  { label: 'Dates', value: range(item) },
                  { label: 'Reason', value: item.reason },
                  ...(student ? [{ label: 'Asked by', value: item.requestedByName }] : []),
                  { label: 'Sent on', value: fmtDateTime(item.createdAt) },
                  ...(item.attachmentFileId ? [{ label: 'Attachment', value: <a href={`/api/bff/files/${item.attachmentFileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ink underline-offset-4 hover:underline"><Paperclip className="size-3.5" aria-hidden /> Open the attached file</a> }] : []),
                  ...(item.status !== 'pending' ? [{ label: 'Decided by', value: item.decidedByName }, { label: 'Decided on', value: item.decidedAt ? fmtDateTime(item.decidedAt) : null }, { label: 'Note', value: item.decisionNote }] : []),
                ]}
              />
              {!student && <BalanceBlock staffId={item.personId} />}
              {item.status === 'pending' && !item.canDecide && (
                <Banner tone="info" title={own ? 'This is your own request' : 'You cannot decide this request'}>
                  {own ? 'Another approver (the principal, HR or an administrator) has to decide it.' : 'It is outside what your role may decide.'}
                </Banner>
              )}
            </SheetBody>
            {item.status === 'pending' && item.canDecide && (
              <SheetFooter>
                <Button variant="danger" onClick={() => onDecide(item, 'reject')} disabled={!canDecide} title={hint}>
                  <X /> Reject
                </Button>
                <Button onClick={() => onDecide(item, 'approve')} disabled={!canDecide} title={hint}>
                  <Check /> Approve
                </Button>
              </SheetFooter>
            )}
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/** Leave taken and pending this academic year, per type (staff). */
export function BalanceBlock({ staffId }: { staffId: string }) {
  const q = useStaffLeaveBalance(staffId);
  return (
    <section aria-label="Leave balance this academic year">
      <h3 className="t-label mb-2">Leave this year{q.data?.academicYear ? ` (${q.data.academicYear})` : ''}</h3>
      {q.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : q.isError ? (
        <p className="t-caption text-ink-2">
          {errorMessage(q.error)}{' '}
          <button type="button" className="font-medium text-brand-ink underline-offset-4 hover:underline" onClick={() => void q.refetch()}>
            Try again
          </button>
        </p>
      ) : q.data.byType.length === 0 ? (
        <p className="text-sm text-ink-2">No leave taken or waiting this year.</p>
      ) : (
        <table className="t-table w-full">
          <thead>
            <tr className="t-colhead text-left text-ink-2">
              <th className="py-1.5 font-medium">Type</th>
              <th className="py-1.5 text-right font-medium">Approved</th>
              <th className="py-1.5 text-right font-medium">Pending</th>
            </tr>
          </thead>
          <tbody>
            {q.data.byType.map((t) => (
              <tr key={t.leaveType} className="border-t border-border">
                <td className="py-1.5">{TYPE_LABEL[t.leaveType] ?? t.leaveType}</td>
                <td className="tnum py-1.5 text-right">{plural(t.approvedDays, 'day')}</td>
                <td className="tnum py-1.5 text-right">{plural(t.pendingDays, 'day')}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-medium">
              <td className="py-1.5">Total</td>
              <td className="tnum py-1.5 text-right">{plural(q.data.totalApprovedDays, 'day')}</td>
              <td className="tnum py-1.5 text-right">{plural(q.data.totalPendingDays, 'day')}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Pick a staff member and see their leave this year (approved and pending, per type). */
function StaffBalanceCard() {
  const q = useStaffPicker();
  const list = Array.isArray(q.data) ? q.data : undefined;
  const [staffId, setStaffId] = React.useState('');
  return (
    <Panel title="Leave balance" description="Pick a staff member to see the leave they have taken and the days still waiting for a decision.">
      <div className="space-y-4">
        <div className="max-w-xs">
          {q.isPending ? <Skeleton className="h-9 w-full" /> : <Select aria-label="Staff member" value={staffId} onValueChange={setStaffId} options={staffOptions(list)} placeholder={q.isError ? 'Could not load staff' : 'Choose a staff member'} disabled={q.isError} />}
        </div>
        {staffId ? <BalanceBlock staffId={staffId} /> : <p className="t-caption text-ink-2">Nothing selected yet.</p>}
      </div>
    </Panel>
  );
}
