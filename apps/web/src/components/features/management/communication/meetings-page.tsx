'use client';

import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { MEETING_MODES, MEETING_STATUSES, type MeetingAction, type MeetingItem } from '@school-sync/shared';
import { useMeetingAction, useMeetings, useRetryMeetingOnline, type MeetingActionVars } from '@/lib/client/communication';
import { useOnlineProviders } from '@/lib/client/online-meetings';
import { friendlyError } from '@/lib/client/mgmt';
import { fmtZoned, isFuture, sameTimeTomorrow } from '@/lib/zoned';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { JoinCard, JoinFor, providerLabel } from '../../online-meeting/online-meeting';
import { ReasonDialog } from '../common/dialogs';
import { DateTimeField } from '../common/date-time-field';
import { ChoicePills, ClearFilters, FilterBar, FilterChips, FilterDate, SearchBox } from '../common/filters';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { useUrlState } from '@/lib/client/use-url-state';

const STATUS_OPTIONS = [{ value: '' as const, label: 'All' }, ...MEETING_STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))];
const MODE_LABEL: Record<string, string> = { in_person: 'In person', online: 'Online', phone: 'Phone call' };
const ACTION_LABEL: Record<MeetingAction, string> = { confirm: 'Confirm…', decline: 'Decline…', reschedule: 'Reschedule…', complete: 'Mark as done…', cancel: 'Cancel meeting…' };

export function MeetingsPage() {
  const { tz } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const url = useUrlState();
  const status = ls.get('status') as '' | (typeof MEETING_STATUSES)[number];
  const from = ls.get('from');
  const to = ls.get('to');
  const openId = ls.get('meeting') || null;
  const q = useMeetings({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, status: status || undefined, from: from || undefined, to: to || undefined });
  const [act, setAct] = React.useState<{ m: MeetingItem; action: MeetingAction } | null>(null);
  const filtered = ls.hasFilters(['status', 'from', 'to']);
  const open = q.data?.data.find((m) => m.id === openId) ?? null;
  const retry = useRetryMeetingOnline();
  const whenOf = (m: MeetingItem) => (m.scheduledAt ? fmtZoned(m.scheduledAt, tz) : m.proposedAt ? `Asked for ${fmtZoned(m.proposedAt, tz)}` : '—');

  const menu = (m: MeetingItem) =>
    m.availableActions.length > 0 && (
      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Actions for the meeting about ${m.student.name}`} size="icon-sm">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {m.availableActions.map((a) => (
              <DropdownMenuItem key={a} danger={a === 'cancel' || a === 'decline'} onSelect={() => setAct({ m, action: a })}>
                {ACTION_LABEL[a]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );

  return (
    <>
      <PageHeader title="Parent–teacher meetings" description="Every meeting request and booking across the school, with what can be done next." />
      <DataTable<MeetingItem>
        id="comm-meetings"
        caption="Parent–teacher meetings"
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
        onRowClick={(r) => url.set({ meeting: r.id }, { resetPage: false })}
        activeRowKey={openId}
        filters={
          <div className="flex w-full flex-col gap-3">
            <ChoicePills label="Meeting status" value={status} onChange={(v) => ls.set({ status: v })} options={STATUS_OPTIONS} />
            <FilterBar>
              <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search child, teacher or topic" />
              <FilterDate label="From" value={from} onChange={(v) => ls.set({ from: v })} max={to || undefined} />
              <FilterDate label="To" value={to} onChange={(v) => ls.set({ to: v })} min={from || undefined} />
            </FilterBar>
          </div>
        }
        empty={
          filtered || ls.q ? (
            <EmptyState illustration="no-results" title="No meetings match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(status ? [{ label: 'Status', value: status }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No meeting requests yet" description="Parents ask for a meeting with a teacher from their app; the requests land here." />
          )
        }
        columns={[
          { id: 'student', header: 'Child', cell: (r) => (<><span className="block font-medium">{r.student.name}</span><span className="t-caption block text-ink-3">{[r.student.grade, r.student.section].filter(Boolean).join(' ')} · {r.student.admissionNo}</span></>), mobile: 'title' },
          { id: 'teacher', header: 'Teacher', cell: (r) => (<><span className="block">{r.teacher.name}</span><span className="t-caption block text-ink-3">{r.teacher.designation ?? ''}</span></>), mobile: 'sub' },
          { id: 'topic', header: 'Topic', cell: (r) => <span className="block max-w-[30ch] truncate" title={r.topic}>{r.topic}</span>, mobile: 'detail', label: 'Topic' },
          { id: 'when', header: 'When', cell: whenOf, sortable: true, sortValue: (r) => r.scheduledAt ?? r.proposedAt ?? '', mobile: 'detail', label: 'When' },
          { id: 'mode', header: 'How', cell: (r) => MODE_LABEL[r.mode] ?? r.mode, defaultHidden: true, mobile: 'hide' },
          {
            id: 'online',
            header: 'Online',
            // depends on the row alone
            cell: (r) => (r.onlineMeeting?.status === 'scheduled' && r.status === 'confirmed' ? <JoinFor meeting={r.onlineMeeting} /> : r.onlineMeeting?.status === 'failed' && r.onlineMeeting.error !== undefined ? <Badge variant="danger">Needs attention</Badge> : <span className="text-ink-3">—</span>),
            mobile: 'detail',
            label: 'Online',
          },
          { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
          { id: 'actions', header: <span className="sr-only">Actions</span>, label: 'Actions', hideable: false, align: 'right', mobile: 'hide', cell: (r) => menu(r) || null },
        ]}
      />
      <Drawer open={!!openId} onOpenChange={(o) => !o && url.set({ meeting: null }, { resetPage: false })}>
        <DrawerContent title="Meeting" description={open ? `${open.student.name} · ${open.teacher.name}` : undefined} showTitle>
          {open ? (
            <>
              <SheetBody>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{open.topic}</p>
                  <StatusChip status={open.status} />
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-border p-4 text-sm">
                  <Info label="Child" value={`${open.student.name} (${[open.student.grade, open.student.section].filter(Boolean).join(' ')})`} />
                  <Info label="Teacher" value={`${open.teacher.name}${open.teacher.designation ? `, ${open.teacher.designation}` : ''}`} />
                  <Info label="Parent" value={open.guardian?.name ?? '—'} />
                  <Info label="When" value={whenOf(open)} />
                  <Info label="Length" value={`${open.durationMin} minutes`} />
                  <Info label="How" value={`${MODE_LABEL[open.mode] ?? open.mode}${open.onlineMeeting ? ` · ${providerLabel(open.onlineMeeting.provider)}` : open.locationOrLink ? ` · ${open.locationOrLink}` : ''}`} />
                </dl>
                {open.onlineMeeting && (
                  <JoinCard
                    subject="meeting"
                    meeting={open.onlineMeeting}
                    canEdit={open.onlineMeeting.startUrl !== undefined}
                    retrying={retry.isPending}
                    onRetry={() =>
                      void retry.mutateAsync({ id: open.id }).then(
                        (r) => (r.onlineMeeting?.status === 'scheduled' ? toast.success('The online meeting is set up') : toast.error('Still not working', { description: r.onlineMeeting?.error ?? 'Try again in a few minutes.' })),
                        (e) => toast.error('Couldn’t retry', { description: friendlyError(e) }),
                      )
                    }
                  />
                )}
                {open.outcomeNotes && <Banner tone="info" title={open.status === 'completed' ? 'Outcome' : open.status === 'declined' ? 'Why it was declined' : 'Note'}>{open.outcomeNotes}</Banner>}
                {open.availableActions.length === 0 && <p className="t-caption text-ink-3">There is nothing more to do on this meeting{open.status === 'requested' || open.status === 'confirmed' ? ' with your role' : ''}.</p>}
              </SheetBody>
              <SheetFooter>
                {open.availableActions.map((a) => (
                  <Button key={a} variant={a === 'confirm' || a === 'complete' ? 'primary' : a === 'cancel' || a === 'decline' ? 'danger' : 'secondary'} onClick={() => setAct({ m: open, action: a })}>
                    {ACTION_LABEL[a].replace('…', '')}
                  </Button>
                ))}
              </SheetFooter>
            </>
          ) : (
            <EmptyState compact title="That meeting is not on this page" description="Open it from the list." />
          )}
        </DrawerContent>
      </Drawer>
      <MeetingActionDialogs target={act} onClose={() => setAct(null)} />
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="t-caption text-ink-2">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function MeetingActionDialogs({ target, onClose }: { target: { m: MeetingItem; action: MeetingAction } | null; onClose: () => void }) {
  const act = useMeetingAction();
  if (!target) return null;
  const { m, action } = target;
  const who = `${m.student.name} with ${m.teacher.name}`;
  if (action === 'confirm' || action === 'reschedule') return <SlotDialog m={m} action={action} onClose={onClose} />;
  const spec = {
    decline: { title: 'Decline this meeting request?', body: `${who}. The parent is told, with your reason.`, label: 'Reason', required: true, confirm: 'Decline request', destructive: true, done: 'Request declined' },
    complete: { title: 'Mark this meeting as done?', body: `${who}. Record what was discussed or decided; it is kept with the meeting.`, label: 'Outcome notes', required: true, confirm: 'Mark as done', destructive: false, done: 'Meeting completed' },
    cancel: { title: 'Cancel this meeting?', body: `${who}. The other side is notified. This cannot be undone.`, label: 'Reason', required: false, confirm: 'Cancel meeting', destructive: true, done: 'Meeting cancelled' },
  }[action];
  return (
    <ReasonDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={spec.title}
      description={spec.body}
      label={spec.label}
      required={spec.required}
      minLength={1}
      maxLength={action === 'complete' ? 3000 : 500}
      confirmLabel={spec.confirm}
      destructive={spec.destructive}
      onConfirm={async (text) => {
        const vars: MeetingActionVars = action === 'decline' ? { id: m.id, action, reason: text } : action === 'complete' ? { id: m.id, action, outcomeNotes: text } : { id: m.id, action, reason: text || undefined };
        await act.mutateAsync(vars);
        toast.success(spec.done);
      }}
    />
  );
}

function SlotDialog({ m, action, onClose }: { m: MeetingItem; action: 'confirm' | 'reschedule'; onClose: () => void }) {
  const { tz } = useMgmt();
  const act = useMeetingAction();
  const init = m.scheduledAt ?? m.proposedAt;
  const [when, setWhen] = React.useState<string | null>(init ? (isFuture(init) ? init : sameTimeTomorrow(init, tz)) : null);
  const [duration, setDuration] = React.useState(String(m.durationMin || 15));
  const [mode, setMode] = React.useState<string>(m.mode);
  const [where, setWhere] = React.useState(m.onlineMeeting ? '' : (m.locationOrLink ?? ''));
  const providers = useOnlineProviders();
  const offered = providers.data?.providers ?? [];
  // 'manual' = the teacher types the link; otherwise the provider creates the meeting
  const [via, setVia] = React.useState<string | null>(null);
  const wasOnline = m.mode === 'online';
  const defaultVia = wasOnline ? (m.onlineMeeting?.provider ?? 'manual') : (providers.data?.defaultProvider ?? 'manual');
  const chosenVia = !offered.length ? 'manual' : (via ?? defaultVia);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const online = mode === 'online';
  const past = !!when && !isFuture(when);
  const usesProvider = online && chosenVia !== 'manual';
  const missingLink = online && !usesProvider && !where.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={action === 'confirm' ? 'Confirm this meeting' : 'Reschedule this meeting'} description={`${m.student.name} with ${m.teacher.name}. The parent is notified.`}>
        <div className="mt-4 space-y-4">
          <Field label="Date and time" required hint={`School time (${tz}). The teacher must be free then.`} error={past ? 'Pick a time in the future.' : null}>
            <DateTimeField value={when} onChange={setWhen} tz={tz} invalid={past} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Length">
              <Select value={duration} onValueChange={setDuration} options={[10, 15, 20, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} minutes` }))} />
            </Field>
            <Field label="How">
              <Select value={mode} onValueChange={setMode} options={MEETING_MODES.map((x) => ({ value: x, label: MODE_LABEL[x] ?? x }))} />
            </Field>
          </div>
          {online && offered.length > 0 && (
            <Field label="Meeting service" hint={usesProvider ? `SchoolSync creates the ${providerLabel(chosenVia as 'zoom' | 'google')} meeting and shares its link with the parent. It follows the time you set here.` : 'You type the link yourself.'}>
              <Select
                value={chosenVia}
                onValueChange={setVia}
                options={[...offered.map((p) => ({ value: p, label: providerLabel(p) })), { value: 'manual', label: 'My own link (I will type it)' }]}
                aria-label="Meeting service"
              />
            </Field>
          )}
          {!usesProvider && (
            <Field label={online ? 'Meeting link' : mode === 'phone' ? 'Phone number or note' : 'Room'} required={online} error={missingLink ? 'Add the link for an online meeting.' : null}>
              <Input value={where} onChange={(e) => setWhere(e.target.value)} maxLength={300} placeholder={online ? 'https://meet.example.com/…' : 'Staff room 2'} invalid={missingLink} />
            </Field>
          )}
          {err && <Banner tone="danger">{err}</Banner>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!when || past || missingLink}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await act.mutateAsync({ id: m.id, action, scheduledAt: when!, durationMin: Number(duration), mode: mode as 'in_person' | 'online' | 'phone', locationOrLink: usesProvider ? undefined : where.trim() || undefined, ...(online && offered.length > 0 ? { provider: usesProvider ? (chosenVia as 'zoom' | 'google') : null } : {}) });
                  toast.success(action === 'confirm' ? 'Meeting confirmed' : 'Meeting rescheduled');
                  onClose();
                } catch (e) {
                  setErr(friendlyError(e));
                  setBusy(false);
                }
              }}
            >
              {action === 'confirm' ? 'Confirm meeting' : 'Reschedule'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
