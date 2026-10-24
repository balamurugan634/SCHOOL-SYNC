'use client';

import * as React from 'react';
import { CheckCircle2, MoreHorizontal, Pencil, Plus, Power, Send, Star, Trash2, XCircle } from 'lucide-react';
import type { EmailAccountOut, EmailPlatformSenderOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toaster';
import { useEmailAccountActions, useEmailAccounts } from '@/lib/client/email';
import { errorMessage } from '@/lib/problem';
import { useAccess } from '../../shared/access';
import { Panel } from '../../shared/detail';
import { AccountDrawer } from './account-drawer';
import { providerLabel, relativeTime } from './email-bits';
import { TestEmailDialog, type TestTarget } from './test-email-dialog';

type Row = { kind: 'account'; a: EmailAccountOut } | { kind: 'platform'; p: EmailPlatformSenderOut };
const keyOf = (r: Row) => (r.kind === 'account' ? r.a.id : 'platform');

function LastTest({ a }: { a: EmailAccountOut }) {
  if (a.lastTestOk === null) return <span className="text-ink-3">Not tested yet</span>;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span>
        {a.lastTestOk ? <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Passed</Badge> : <Badge variant="danger" icon={<XCircle aria-hidden />}>Failed</Badge>}
      </span>
      {a.lastTestAt && <span className="t-caption text-ink-3">{relativeTime(a.lastTestAt)}</span>}
    </span>
  );
}

function SendState({ a }: { a: EmailAccountOut }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="tnum text-sm">
        {a.sentToday}
        {a.dailyLimit ? ` of ${a.dailyLimit}` : ''} today
      </span>
      {a.lastSendError ? <span className="t-caption line-clamp-2 text-danger">{a.lastSendError}</span> : a.lastSendAt ? <span className="t-caption text-ink-3">Last sent {relativeTime(a.lastSendAt)}</span> : null}
    </span>
  );
}

type Pending = { kind: 'delete'; a: EmailAccountOut } | { kind: 'default'; a: EmailAccountOut } | { kind: 'platform' } | null;

/** The school's mail accounts like Frappe's Email Account list, plus the read-only SchoolSync default (platform) row. */
export function AccountsPanel() {
  const access = useAccess();
  const editable = access.ok('settings:edit', 'school');
  const hint = access.hint('settings:edit', 'school');
  const q = useEmailAccounts();
  const actions = useEmailAccountActions();
  const [drawer, setDrawer] = React.useState<{ open: boolean; account: EmailAccountOut | null }>({ open: false, account: null });
  const [test, setTest] = React.useState<TestTarget | null>(null);
  const [pending, setPending] = React.useState<Pending>(null);

  const accounts = q.data?.data ?? [];
  const platform = q.data?.platform;
  const hasDefault = accounts.some((a) => a.isDefaultOutgoing);
  const rows: Row[] = [...accounts.map((a): Row => ({ kind: 'account', a })), ...(platform ? [{ kind: 'platform', p: platform } as Row] : [])];
  const defaultAccount = accounts.find((a) => a.isDefaultOutgoing);

  const openEdit = (a: EmailAccountOut) => setDrawer({ open: true, account: a });
  const toggle = async (a: EmailAccountOut) => void (await actions.setEnabled.run({ id: a.id, enabled: !a.enabled }));
  const makeDefault = async (a: EmailAccountOut) => {
    const r = await actions.setDefault.run(a.id);
    if (r.ok) setPending(null);
  };

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: 'Account',
      mobile: 'title',
      className: 'min-w-[12rem]',
      cell: (r) =>
        r.kind === 'account' ? (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium">{r.a.name}</span>
              {r.a.isDefaultOutgoing && <Badge variant="primary" icon={<Star aria-hidden />}>Default</Badge>}
            </span>
            <span className="t-caption truncate text-ink-2">{r.a.smtpHost}:{r.a.smtpPort}</span>
          </span>
        ) : (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium">SchoolSync default (platform)</span>
              {r.p.active && <Badge variant="primary" icon={<Star aria-hidden />}>In use</Badge>}
            </span>
            <span className="t-caption text-ink-2">Used when no account of yours is the default</span>
          </span>
        ),
    },
    {
      id: 'address',
      header: 'From address',
      mobile: 'sub',
      cell: (r) =>
        r.kind === 'account' ? (
          <span className="flex min-w-0 flex-col"><span className="truncate text-sm">{r.a.emailAddress}</span>{r.a.senderName && <span className="t-caption truncate text-ink-2">{r.a.senderName}</span>}</span>
        ) : (
          <span className="flex min-w-0 flex-col"><span className="truncate text-sm">{r.p.senderAddress}</span><span className="t-caption truncate text-ink-2">{r.p.senderName}{r.p.replyTo ? ` · replies to ${r.p.replyTo}` : ''}</span></span>
        ),
    },
    { id: 'provider', header: 'Provider', label: 'Provider', mobile: 'detail', cell: (r) => (r.kind === 'account' ? providerLabel(r.a.provider) : 'Shared by SchoolSync') },
    {
      id: 'status',
      header: 'Status',
      mobile: 'status',
      cell: (r) =>
        r.kind === 'account' ? (
          r.a.enabled ? <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Enabled</Badge> : <Badge variant="neutral" icon={<Power aria-hidden />}>Disabled</Badge>
        ) : r.p.configured ? (
          <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Available</Badge>
        ) : (
          <Badge variant="warning">Not set up</Badge>
        ),
    },
    { id: 'test', header: 'Last test', label: 'Last test', mobile: 'detail', cell: (r) => (r.kind === 'account' ? <LastTest a={r.a} /> : <span className="text-ink-3">Not applicable</span>) },
    { id: 'sent', header: 'Sending', label: 'Sending', mobile: 'detail', className: 'min-w-[9rem]', cell: (r) => (r.kind === 'account' ? <SendState a={r.a} /> : r.p.lastSendError ? <span className="t-caption line-clamp-2 text-danger">{r.p.lastSendError}</span> : r.p.lastSendAt ? <span className="t-caption text-ink-3">Last sent {relativeTime(r.p.lastSendAt)}</span> : <span className="text-ink-3">—</span>) },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      label: 'Actions',
      hideable: false,
      align: 'right',
      mobile: 'detail',
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Actions for ${r.kind === 'account' ? r.a.name : 'the SchoolSync default sender'}`} variant="ghost" size="icon-sm"><MoreHorizontal /></IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {r.kind === 'account' ? (
                <>
                  <DropdownMenuItem onSelect={() => openEdit(r.a)}><Pencil /> {editable ? 'Edit' : 'View'}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable} onSelect={() => setTest({ id: r.a.id, name: r.a.name })}><Send /> Send test email</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable || r.a.isDefaultOutgoing || !r.a.enabled} onSelect={() => (r.a.lastTestOk === true ? void makeDefault(r.a) : setPending({ kind: 'default', a: r.a }))}><Star /> Set as default</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable} onSelect={() => void toggle(r.a)}><Power /> {r.a.enabled ? 'Disable' : 'Enable'}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem danger disabled={!editable} onSelect={() => setPending({ kind: 'delete', a: r.a })}><Trash2 /> Delete</DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem disabled={!editable || !r.p.configured} onSelect={() => setTest({ id: null, name: 'SchoolSync default sender' })}><Send /> Send test email</DropdownMenuItem>
                  <DropdownMenuItem disabled={!editable || r.p.active} onSelect={() => setPending({ kind: 'platform' })}><Star /> Use as default</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {platform && (
        <Banner tone={platform.active && !platform.configured ? 'warning' : 'info'} title={defaultAccount ? `Outgoing email is sent from “${defaultAccount.name}”` : 'Outgoing email uses the SchoolSync default sender'}>
          {defaultAccount ? (
            <>Everything the school emails (password resets, receipts, notices) goes out as {defaultAccount.senderName ? `${defaultAccount.senderName} ` : ''}&lt;{defaultAccount.emailAddress}&gt;. If this account stops working, password reset emails still get through the SchoolSync default sender.</>
          ) : platform.configured ? (
            <>Mail is sent as “{platform.senderName}” from the shared SchoolSync address, with replies going to {platform.replyTo ? platform.replyTo : 'the shared address (add the school’s email under School details so replies reach you)'}. Add your own account to send from the school’s address instead.</>
          ) : (
            <>No mail server is set up yet, so emails wait in the queue and then fail. Add your own email account to start sending.</>
          )}
        </Banner>
      )}
      <Panel
        title="Email accounts"
        description="Mail accounts the school sends email from. One is the default."
        actions={
          <Button onClick={() => setDrawer({ open: true, account: null })} disabled={!editable} title={hint}>
            <Plus /> Add email account
          </Button>
        }
        bodyClassName="p-0 sm:p-0"
      >
        <DataTable<Row>
          id="settings-email-accounts"
          caption="Email accounts"
          rows={q.data ? rows : undefined}
          rowKey={keyOf}
          columns={columns}
          loading={q.isPending}
          error={q.isError && !q.data ? q.error : undefined}
          onRetry={() => void q.refetch()}
          onRowClick={(r) => (r.kind === 'account' ? openEdit(r.a) : undefined)}
          empty={<EmptyState illustration="empty-generic" title="No email accounts" description="Add one to send from your school’s own address." compact />}
        />
        {q.isError && q.data && <Banner tone="danger" className="m-4">We could not refresh the list: {errorMessage(q.error)}</Banner>}
      </Panel>

      <Panel title="Before you start" description="Three things that decide whether your emails arrive." bodyClassName="space-y-3 text-sm">
        <ul className="list-disc space-y-2 pl-5 text-ink-2">
          <li><strong className="font-medium text-ink">Use an app password</strong> for Google Workspace, Microsoft 365, Zoho and Yahoo. Your normal sign-in password is refused when SMTP is used. Create one in the provider’s security settings.</li>
          <li><strong className="font-medium text-ink">Send from an address you own.</strong> Use a mailbox at your school’s domain, not someone else’s address.</li>
          <li><strong className="font-medium text-ink">Authorise your provider (SPF and DKIM).</strong> Ask whoever manages your domain to add your mail provider to the domain’s SPF record and turn on DKIM signing. Without them, parents’ mail systems may put the school’s email in spam.</li>
        </ul>
      </Panel>

      <AccountDrawer
        open={drawer.open}
        account={drawer.account}
        hasDefault={hasDefault}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        onSaved={(a, created) => {
          setDrawer((d) => ({ ...d, open: false }));
          if (created) {
            toast.message('Send a test email to check that this account works.');
            setTest({ id: a.id, name: a.name });
          }
        }}
        onTest={(a) => setTest({ id: a.id, name: a.name })}
      />
      <TestEmailDialog target={test} onClose={() => setTest(null)} />

      <ConfirmDialog
        open={pending?.kind === 'delete'}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'delete' ? `Delete “${pending.a.name}”?` : 'Delete account'}
        description={
          pending?.kind === 'delete' && pending.a.isDefaultOutgoing
            ? 'This is the default account. After deleting it, email goes out through the SchoolSync default sender until you choose another default. Emails already waiting in the queue are kept and sent that way.'
            : 'The saved password is erased. Emails already waiting in the queue are kept and sent through the default sender instead.'
        }
        confirmLabel="Delete account"
        destructive
        loading={actions.remove.isPending}
        onConfirm={async () => {
          if (pending?.kind !== 'delete') return;
          const r = await actions.remove.run(pending.a.id);
          if (r.ok) setPending(null);
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'default'}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'default' ? `Make “${pending.a.name}” the default?` : 'Make default'}
        description="This account has not passed a test email. If its settings are wrong, ordinary emails will fail and be retried; only password reset emails fall back to the SchoolSync default sender. Send a test email first, or continue anyway."
        confirmLabel="Make default anyway"
        loading={actions.setDefault.isPending}
        onConfirm={() => pending?.kind === 'default' && void makeDefault(pending.a)}
      />
      <ConfirmDialog
        open={pending?.kind === 'platform'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Use the SchoolSync default sender?"
        description="Your own accounts stay saved but none is the default any more, so email is sent as the school from the shared SchoolSync address, with replies going to the school’s contact email."
        confirmLabel="Use the SchoolSync default"
        loading={actions.usePlatform.isPending}
        onConfirm={async () => {
          const r = await actions.usePlatform.run();
          if (r.ok) setPending(null);
        }}
      />
    </div>
  );
}
