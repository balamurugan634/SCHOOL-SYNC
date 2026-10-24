'use client';

import * as React from 'react';
import { Ban, Eraser, RotateCcw, Send, Trash2, X, Zap } from 'lucide-react';
import { EMAIL_QUEUE_STATUSES, EMAIL_QUEUE_STATUS_LABELS, type EmailQueueAction, type EmailQueueItem, type EmailQueueStatus } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { StatTile } from '@/components/ui/stat-tile';
import { useEmailAccounts, useEmailQueue, useEmailQueueActions, useEmailQueueSummary } from '@/lib/client/email';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate, fmtDateTime, todayIso } from '@/lib/format';
import { errorMessage } from '@/lib/problem';
import { useAccess } from '../../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../../shared/controls';
import { Panel } from '../../shared/detail';
import { isDue, QueueStatusBadge, recipientsText, relativeTime } from './email-bits';
import { QueueDrawer } from './queue-drawer';

const STATUS_OPTIONS = EMAIL_QUEUE_STATUSES.map((s) => ({ value: s, label: EMAIL_QUEUE_STATUS_LABELS[s] }));

function DateField({ label, value, onChange, max }: { label: string; value: string; onChange: (v: string) => void; max?: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <span className="t-caption text-ink-2">{label}</span>
      <DatePicker value={value || null} onChange={onChange} max={max} placeholder="Any date" className="w-[9.5rem] sm:h-9" />
      {value && (
        <IconButton label={`Clear ${label.toLowerCase()} date`} size="icon-sm" onClick={() => onChange('')}>
          <X />
        </IconButton>
      )}
    </div>
  );
}

function WhenCell({ m }: { m: EmailQueueItem }) {
  if (m.status === 'sent' && m.sentAt) return <span className="tnum" title={fmtDateTime(m.sentAt)}>Sent {relativeTime(m.sentAt)}</span>;
  if (m.status === 'not_sent' && m.nextAttemptAt) {
    const due = isDue(m.nextAttemptAt);
    return <span className="tnum" title={fmtDateTime(m.nextAttemptAt)}>{due ? 'Waiting to send' : `Next try ${relativeTime(m.nextAttemptAt)}`}</span>;
  }
  if (m.status === 'sending') return <span>Sending now</span>;
  return <span className="tnum text-ink-2" title={fmtDateTime(m.createdAt)}>{relativeTime(m.createdAt)}</span>;
}

const CLEAR_AGES = [
  { value: '0', label: 'Any age' },
  { value: '7', label: 'Older than 7 days' },
  { value: '30', label: 'Older than 30 days' },
  { value: '90', label: 'Older than 90 days' },
];

/** Dialog behind “Clear sent older than…”: which finished emails to remove. */
function ClearDialog({ open, onClose, retention }: { open: boolean; onClose: () => void; retention: { sentDays: number; failedDays: number } | undefined }) {
  const actions = useEmailQueueActions();
  const [age, setAge] = React.useState('30');
  const [kinds, setKinds] = React.useState<Set<'sent' | 'error' | 'cancelled'>>(new Set(['sent']));
  React.useEffect(() => {
    if (open) {
      setAge('30');
      setKinds(new Set(['sent']));
    }
  }, [open]);
  const toggle = (k: 'sent' | 'error' | 'cancelled', on: boolean) => setKinds((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
  const opts = [
    { k: 'sent' as const, label: 'Sent' },
    { k: 'error' as const, label: 'Error' },
    { k: 'cancelled' as const, label: 'Cancelled' },
  ];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Clear old emails" description={retention ? `Sent emails are removed automatically after ${retention.sentDays} days, and failed or cancelled ones after ${retention.failedDays} days. Clear them sooner here.` : undefined}>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="clear-age" className="t-label text-ink">Remove emails that are</label>
            <Select id="clear-age" value={age} onValueChange={setAge} options={CLEAR_AGES} />
          </div>
          <fieldset className="space-y-2">
            <legend className="t-label text-ink">With the status</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {opts.map((o) => (
                <div key={o.k} className="flex min-h-9 items-center gap-2">
                  <Checkbox id={`clear-${o.k}`} checked={kinds.has(o.k)} onCheckedChange={(c) => toggle(o.k, c === true)} />
                  <label htmlFor={`clear-${o.k}`} className="text-sm">{o.label}</label>
                </div>
              ))}
            </div>
            <p className="t-caption text-ink-2">Emails that are waiting or being sent are never removed here.</p>
          </fieldset>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger-solid"
            loading={actions.clear.isPending}
            disabled={kinds.size === 0}
            onClick={async () => {
              const r = await actions.clear.run({ olderThanDays: Number(age), statuses: [...kinds] });
              if (r.ok) onClose();
            }}
          >
            <Eraser /> Remove emails
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type BulkPending = { action: EmailQueueAction; ids: string[]; clear: () => void } | null;
const BULK_COPY: Record<EmailQueueAction, { title: (n: number) => string; body: string; confirm: string; destructive: boolean }> = {
  send_now: { title: (n) => `Send ${n} email${n === 1 ? '' : 's'} now?`, body: 'They go out one at a time as soon as the worker reaches them, skipping any waiting time.', confirm: 'Send now', destructive: false },
  retry: { title: (n) => `Retry ${n} email${n === 1 ? '' : 's'}?`, body: 'They go back in the queue with fresh attempts.', confirm: 'Retry', destructive: false },
  cancel: { title: (n) => `Cancel ${n} email${n === 1 ? '' : 's'}?`, body: 'They will not be sent. Only emails that are still waiting can be cancelled.', confirm: 'Cancel emails', destructive: true },
  delete: { title: (n) => `Delete ${n} email${n === 1 ? '' : 's'}?`, body: 'The entries and their history are removed for good. Emails that were already sent stay sent.', confirm: 'Delete', destructive: true },
};

/** The email queue like Frappe's Email Queue: counts per status, a filterable table, and Send now / Retry / Cancel / Delete. */
export function QueuePanel() {
  const access = useAccess();
  const editable = access.ok('settings:edit', 'school');
  const hint = access.hint('settings:edit', 'school');
  const [url, setUrl, resetUrl] = useUrlState({ qs: '', qa: '', qq: '', qf: '', qt: '', page: 1, size: 25, mail: '' });
  const summary = useEmailQueueSummary();
  const accounts = useEmailAccounts();
  const counts = summary.data?.counts;
  const waiting = (counts?.not_sent ?? 0) + (counts?.sending ?? 0) > 0;
  const q = useEmailQueue({ status: (url.qs || undefined) as EmailQueueStatus | undefined, accountId: url.qa || undefined, q: url.qq || undefined, from: url.qf || undefined, to: url.qt || undefined, page: url.page, pageSize: url.size }, waiting);
  const actions = useEmailQueueActions();
  const [sel, setSel] = React.useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = React.useState<BulkPending>(null);
  const [clearing, setClearing] = React.useState(false);
  const active = !!(url.qs || url.qa || url.qq || url.qf || url.qt);
  const accountOptions = [{ value: 'platform', label: 'SchoolSync default' }, ...(accounts.data?.data ?? []).map((a) => ({ value: a.id, label: a.name }))];
  const accountName = accountOptions.find((o) => o.value === url.qa)?.label;
  React.useEffect(() => setSel(new Set()), [url.qs, url.qa, url.qq, url.qf, url.qt, url.page, url.size]);

  const columns: Column<EmailQueueItem>[] = [
    { id: 'status', header: 'Status', cell: (m) => <QueueStatusBadge status={m.status} />, mobile: 'status' },
    { id: 'to', header: 'To', cell: (m) => <span className="block max-w-[14rem] truncate" title={[...m.to, ...m.cc].join(', ')}>{recipientsText(m.to, m.cc)}</span>, mobile: 'sub', className: 'min-w-[10rem]' },
    { id: 'subject', header: 'Subject', cell: (m) => <span className="block max-w-[20rem] truncate font-medium" title={m.subject}>{m.subject}</span>, mobile: 'title', className: 'min-w-[12rem]' },
    { id: 'account', header: 'Account', label: 'Account', cell: (m) => m.accountName ?? <span className="text-ink-2">SchoolSync default</span>, mobile: 'detail' },
    { id: 'attempts', header: 'Tries', label: 'Tries', cell: (m) => <span className="tnum">{m.attempts} of {m.maxAttempts}</span>, mobile: 'detail', align: 'right' },
    { id: 'when', header: 'When', label: 'When', cell: (m) => <WhenCell m={m} />, mobile: 'detail', className: 'min-w-[9rem]' },
    { id: 'error', header: 'Error', label: 'Error', cell: (m) => (m.lastError ? <span className="line-clamp-2 max-w-[18rem] text-[13px] text-danger" title={m.lastError}>{m.lastError}</span> : <span className="text-ink-3">—</span>), mobile: 'detail', className: 'min-w-[12rem]' },
  ];

  const tile = (s: EmailQueueStatus) => {
    const on = url.qs === s;
    return (
      <button key={s} type="button" aria-pressed={on} onClick={() => setUrl({ qs: on ? '' : s })} className={`tr-colors rounded-lg text-left outline-none focus-visible:shadow-[0_0_0_3px_var(--ring)] ${on ? 'ring-2 ring-brand' : ''}`}>
        <StatTile label={EMAIL_QUEUE_STATUS_LABELS[s]} value={counts?.[s]} state={summary.isPending ? 'loading' : 'ready'} className={`h-full ${on ? '' : 'hover:border-border-strong'}`} hint={s === 'not_sent' && summary.data?.nextDueAt && (counts?.not_sent ?? 0) > 0 ? `Next ${relativeTime(summary.data.nextDueAt)}` : undefined} />
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {summary.isError && <Banner tone="danger" title="We could not load the queue summary">{errorMessage(summary.error)}</Banner>}
      {summary.data && !summary.data.workerEnabled && <Banner tone="info" title="Sending happens on another server">This server only queues email. Emails go out within about ten seconds when the background worker runs elsewhere.</Banner>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Emails by status. Choose one to filter the table.">
        {EMAIL_QUEUE_STATUSES.map(tile)}
      </div>

      <Panel
        title="Email queue"
        description="Every email the school sends. They go out one at a time, urgent ones first, and failed ones are tried again after 1, 5 and 30 minutes."
        bodyClassName="p-0 sm:p-0"
      >
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
          <Button variant="secondary" onClick={() => void actions.flush.run()} loading={actions.flush.isPending} disabled={!editable || (counts?.not_sent ?? 0) === 0} title={hint ?? ((counts?.not_sent ?? 0) === 0 ? 'Nothing is waiting.' : 'Skip the waiting time and send everything that is queued, one at a time.')}>
            <Zap /> Flush queue now
          </Button>
          <Button variant="secondary" onClick={() => setClearing(true)} disabled={!editable} title={hint}>
            <Eraser /> Clear sent older than…
          </Button>
        </div>
        <DataTable<EmailQueueItem>
          memoRows
          id="settings-email-queue"
          caption="Email queue"
          rows={q.data?.data}
          rowKey={(m) => m.id}
          columns={columns}
          loading={q.isPending}
          error={q.isError && !q.data ? q.error : undefined}
          onRetry={() => void q.refetch()}
          page={url.page}
          pageSize={url.size}
          total={q.data?.meta.total}
          onPageChange={(p) => setUrl({ page: p })}
          onPageSizeChange={(s) => setUrl({ size: s })}
          onRowClick={(m) => setUrl({ mail: m.id }, { push: true })}
          activeRowKey={url.mail || null}
          selectable={editable}
          selected={sel}
          onSelectedChange={setSel}
          bulkActions={(rows, clear) => {
            const ids = rows.map((r) => r.id);
            const ok = (a: EmailQueueAction) => rows.some((r) => (a === 'send_now' ? r.status === 'not_sent' || r.status === 'error' : a === 'retry' ? r.status === 'error' || r.status === 'cancelled' : a === 'cancel' ? r.status === 'not_sent' : r.status !== 'sending'));
            return (
              <>
                <Button size="sm" onClick={() => setBulk({ action: 'send_now', ids, clear })} disabled={!ok('send_now')}><Send /> Send now</Button>
                <Button size="sm" variant="secondary" onClick={() => setBulk({ action: 'retry', ids, clear })} disabled={!ok('retry')}><RotateCcw /> Retry</Button>
                <Button size="sm" variant="secondary" onClick={() => setBulk({ action: 'cancel', ids, clear })} disabled={!ok('cancel')}><Ban /> Cancel</Button>
                <Button size="sm" variant="danger" onClick={() => setBulk({ action: 'delete', ids, clear })} disabled={!ok('delete')}><Trash2 /> Delete</Button>
              </>
            );
          }}
          filters={
            <>
              <SearchBox value={url.qq} onChange={(v) => setUrl({ qq: v })} placeholder="Search recipient or subject" className="sm:w-64" />
              <FilterSelect label="Status" value={url.qs} onChange={(v) => setUrl({ qs: v })} options={STATUS_OPTIONS} allLabel="Any status" />
              <FilterSelect label="Account" value={url.qa} onChange={(v) => setUrl({ qa: v })} options={accountOptions} allLabel="Any account" />
              <DateField label="From" value={url.qf} onChange={(v) => setUrl({ qf: v })} max={url.qt || todayIso()} />
              <DateField label="To" value={url.qt} onChange={(v) => setUrl({ qt: v })} max={todayIso()} />
            </>
          }
          empty={
            active ? (
              <EmptyState
                illustration="no-results"
                title="No emails match"
                description="Try different filters, or clear them to see the whole queue."
                filters={
                  <>
                    {url.qq && <FilterChip label={`“${url.qq}”`} onRemove={() => setUrl({ qq: '' })} />}
                    {url.qs && <FilterChip label={EMAIL_QUEUE_STATUS_LABELS[url.qs as EmailQueueStatus] ?? url.qs} onRemove={() => setUrl({ qs: '' })} />}
                    {url.qa && <FilterChip label={accountName ?? 'One account'} onRemove={() => setUrl({ qa: '' })} />}
                    {url.qf && <FilterChip label={`From ${fmtDate(url.qf)}`} onRemove={() => setUrl({ qf: '' })} />}
                    {url.qt && <FilterChip label={`To ${fmtDate(url.qt)}`} onRemove={() => setUrl({ qt: '' })} />}
                  </>
                }
                action={<ClearFiltersButton onClick={() => resetUrl(['qs', 'qa', 'qq', 'qf', 'qt'])} />}
                compact
              />
            ) : (
              <EmptyState illustration="empty-generic" title="The queue is empty" description="Emails the school sends, such as password resets and notices, appear here while they wait and for a while after they are sent." compact />
            )
          }
        />
      </Panel>

      <QueueDrawer id={url.mail || null} onClose={() => setUrl({ mail: '' })} />
      <ClearDialog open={clearing} onClose={() => setClearing(false)} retention={summary.data?.retention} />
      <ConfirmDialog
        open={!!bulk}
        onOpenChange={(o) => !o && setBulk(null)}
        title={bulk ? BULK_COPY[bulk.action].title(bulk.ids.length) : ''}
        description={bulk ? BULK_COPY[bulk.action].body : ''}
        confirmLabel={bulk ? BULK_COPY[bulk.action].confirm : 'Confirm'}
        destructive={bulk ? BULK_COPY[bulk.action].destructive : false}
        loading={actions.bulk.isPending}
        onConfirm={async () => {
          if (!bulk) return;
          const r = await actions.bulk.run({ action: bulk.action, ids: bulk.ids });
          if (r.ok) {
            bulk.clear();
            setBulk(null);
          }
        }}
      />
    </div>
  );
}
