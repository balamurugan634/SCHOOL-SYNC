'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, Gauge, Receipt } from 'lucide-react';
import type { PlatformInvoice, PlatformTenantDetail } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DefList, ErrorPanel, Panel } from '@/components/features/management/shared/detail';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate, fmtDateTime, money } from '@/lib/format';
import { useMeterTenant, useTenant, useTenantInvoices } from '@/lib/platform/queries';
import { ApiError } from '@/lib/problem';
import { IssueInvoiceDialog, InvoiceTable, PayInvoiceDialog, VoidInvoiceDialog } from './invoice-parts';
import { LicenseChip, SeatsMeter, TenantStatusChip } from './bits';
import { SettingsPanel } from './settings-panel';
import { SubscriptionPanel } from './subscription-panel';
import { UsagePanel } from './usage-panel';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'usage', label: 'Usage' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'settings', label: 'Settings' },
] as const;

/** One school: overview, subscription, usage chart, invoices and settings (feature switches, suspend / resume). */
export function SchoolDetail({ code, siteUrlTemplate }: { code: string; siteUrlTemplate: string }) {
  const q = useTenant(code);
  const [url, setUrl] = useUrlState({ tab: 'overview' });
  const tab = TABS.some((t) => t.id === url.tab) ? url.tab : 'overview';
  const meter = useMeterTenant(code);
  const [issue, setIssue] = React.useState<{ kind?: 'seats' | 'true_up' } | null>(null);

  if (q.isPending) {
    return (
      <div aria-busy aria-label="Loading school" className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-5 w-96 max-w-full" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" state="loading" />)}</div>
      </div>
    );
  }
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <PageHeader title={missing ? 'School not found' : 'School'} crumbs={[{ label: 'Schools', href: '/platform/schools' }, { label: code }]} />
        {missing ? (
          <EmptyState illustration="no-results" title={`No school with the code “${code}”`} description="It may have been mistyped or removed." action={<Button asChild variant="secondary"><Link href="/platform/schools">Back to schools</Link></Button>} />
        ) : (
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this school" />
        )}
      </>
    );
  }

  const d = q.data;
  const t = d.tenant;
  const live = t.status === 'active' || t.status === 'suspended';
  const siteUrl = siteUrlTemplate.replace('{code}', t.code);
  return (
    <>
      <PageHeader
        title={t.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px]">{t.code}</span>
            <TenantStatusChip status={t.status} />
            {live && <LicenseChip state={d.license.state} />}
          </span>
        }
        crumbs={[{ label: 'Schools', href: '/platform/schools' }, { label: t.name }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => void meter.run()} loading={meter.isPending} disabled={!live}>
              <Gauge /> Meter now
            </Button>
            <Button variant="secondary" onClick={() => setIssue({})} disabled={!live || d.subscriptions.length === 0}>
              <Receipt /> Issue invoice
            </Button>
            <Button asChild variant="ghost">
              <a href={siteUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Open school site<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
          </>
        }
      />
      {(t.status === 'failed' || t.status === 'provisioning') && (
        <Banner tone="danger" title={t.status === 'failed' ? 'Setup did not finish' : 'Still being set up'} className="mb-4">
          {t.status === 'failed' ? 'Creating a school with this code again resumes the setup where it stopped.' : 'If this lasts more than a few minutes, create the school again with the same code to finish it.'}
        </Banner>
      )}
      <Tabs value={tab} onValueChange={(v) => setUrl({ tab: v })}>
        <TabsList aria-label="School sections">
          {TABS.map((x) => <TabsTrigger key={x.id} value={x.id}>{x.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview"><Overview d={d} onTab={(v) => setUrl({ tab: v })} /></TabsContent>
        <TabsContent value="subscription"><SubscriptionPanel detail={d} onIssue={() => setIssue({})} /></TabsContent>
        <TabsContent value="usage"><UsagePanel detail={d} /></TabsContent>
        <TabsContent value="invoices"><InvoicesTab d={d} onIssue={() => setIssue({})} /></TabsContent>
        <TabsContent value="settings"><SettingsPanel detail={d} /></TabsContent>
      </Tabs>
      <IssueInvoiceDialog code={t.code} name={t.name} subscriptions={d.subscriptions} open={issue !== null} onOpenChange={(o) => !o && setIssue(null)} initial={{ kind: issue?.kind, academicYear: d.license.academicYear ?? undefined }} />
    </>
  );
}

function Overview({ d, onTab }: { d: PlatformTenantDetail; onTab: (t: string) => void }) {
  const { tenant: t, license: l, seats: s, billing: b } = d;
  const cur = l.currency ?? t.currency;
  const daysText = l.daysLeft === null ? '—' : l.daysLeft < 0 ? `${-l.daysLeft} d ago` : `${l.daysLeft} d`;
  return (
    <div className="space-y-6">
      {t.status === 'suspended' && <Banner tone="danger" title="This school is suspended">Nobody can sign in. Resume it from Settings when the matter is settled.</Banner>}
      {l.state === 'unlicensed' && t.status === 'active' && (
        <Banner tone="warning" title="No subscription yet" action={<Button size="sm" onClick={() => onTab('subscription')}>Add subscription</Button>}>
          Until there is one, the school has no seat limit and nothing is metered for billing.
        </Banner>
      )}
      {(l.state === 'expired' || l.state === 'cancelled') && <Banner tone="locked" title="Read-only: subscription ended" action={<Button size="sm" onClick={() => onTab('subscription')}>Renew</Button>}>The school can read everything but cannot make changes until it is renewed.</Banner>}
      {l.state === 'grace' && <Banner tone="warning" title="Grace period" action={<Button size="sm" onClick={() => onTab('subscription')}>Renew</Button>}>The subscription ended; full access continues until {fmtDate(l.graceEndsOn)}.</Banner>}
      {s.overBy > 0 && <Banner tone="warning" title={`${s.overBy.toLocaleString()} students over the committed seats`}>{l.overagePolicy === 'allow_and_bill' ? 'The school keeps admitting students. Issue a true-up invoice to bill the extra seats.' : 'New students are blocked until seats are added.'}</Banner>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Seats used" value={s.used} hint={s.licensed !== null ? `of ${s.licensed.toLocaleString()} committed${s.asOf ? ` · ${fmtDate(s.asOf, { day: 'numeric', month: 'short' })}` : ''}` : 'No seat limit'} />
        <StatTile label={l.state === 'grace' ? 'Grace ends in' : 'Subscription ends'} value={l.endsOn ? (l.state === 'grace' && l.graceEndsOn ? fmtDate(l.graceEndsOn, { day: 'numeric', month: 'short' }) : daysText) : '—'} hint={l.endsOn ? fmtDate(l.endsOn) : 'No subscription'} />
        <StatTile label="Price per student" value={l.pricePerStudentMinor !== null ? money(l.pricePerStudentMinor, cur) : '—'} hint={l.academicYear ? `Year ${l.academicYear}` : undefined} />
        <StatTile label="Outstanding" value={b.outstandingCount ? money(b.outstandingMinor, t.currency) : money(0, t.currency)} hint={b.overdueCount ? `${b.overdueCount} overdue` : b.outstandingCount ? `${b.outstandingCount} unpaid` : 'Nothing owed'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Seats" description={l.academicYear ? `Academic year ${l.academicYear}` : undefined}>
          {s.used !== null && s.licensed !== null ? <SeatsMeter seats={s} className="max-w-md" /> : s.licensed === null ? <p className="text-sm text-ink-2">{s.used === null ? 'No seat limit, and not metered yet.' : `${s.used.toLocaleString()} students enrolled · no seat limit.`}</p> : <p className="text-sm text-ink-2">Not metered yet. Use “Meter now” for the first count.</p>}
        </Panel>
        <Panel title="School" bodyClassName="space-y-4">
          <DefList
            items={[
              { label: 'Site code', value: <span className="font-mono text-[13px]">{t.code}</span> },
              { label: 'Time zone', value: t.timezone },
              { label: 'Currency', value: t.currency },
              { label: 'Brand colour', value: t.branding.primaryColor ? <span className="inline-flex items-center gap-2"><span className="size-4 rounded border border-border-strong" style={{ background: t.branding.primaryColor }} aria-hidden /><span className="font-mono text-[13px]">{t.branding.primaryColor}</span></span> : null },
              { label: 'Database', value: <span className="font-mono text-[13px]">{t.dbName}</span> },
              { label: 'Created', value: fmtDateTime(t.createdAt) },
              { label: 'Schema version', value: t.schemaVersion ? <span className="font-mono text-[13px]">{t.schemaVersion}</span> : null },
              { label: 'Extra domains', value: d.domains.length ? d.domains.map((x) => x.domain).join(', ') : null },
            ]}
          />
          <div className="flex flex-wrap gap-1.5" aria-label="Features">
            {(Object.entries(t.features) as [string, boolean][]).map(([k, on]) => (
              <Badge key={k} variant={on ? 'success' : 'neutral'}>{FEATURE_LABEL[k] ?? k}: {on ? 'on' : 'off'}</Badge>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

const FEATURE_LABEL: Record<string, string> = { fees: 'Fees', transport: 'Transport', library: 'Library', onlinePayments: 'Online payments', studentLogin: 'Student sign-in' };

function InvoicesTab({ d, onIssue }: { d: PlatformTenantDetail; onIssue: () => void }) {
  const q = useTenantInvoices(d.tenant.code);
  const [pay, setPay] = React.useState<PlatformInvoice | null>(null);
  const [voidInv, setVoidInv] = React.useState<PlatformInvoice | null>(null);
  return (
    <>
      <InvoiceTable
        id="platform-school-invoices"
        rows={q.data}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        onPay={setPay}
        onVoid={setVoidInv}
        empty={<EmptyState illustration="empty-generic" title="No invoices yet" description="Issue the committed-seats invoice at the start of the year, and a true-up when the school goes past its seats." action={<Button onClick={onIssue} disabled={d.subscriptions.length === 0}><Receipt /> Issue invoice</Button>} compact />}
      />
      <PayInvoiceDialog invoice={pay} onClose={() => setPay(null)} />
      <VoidInvoiceDialog invoice={voidInv} onClose={() => setVoidInv(null)} />
    </>
  );
}
