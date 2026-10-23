'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import type { AnnouncementItem } from '@school-sync/shared';
import { useAnnouncement } from '@/lib/client/communication';
import { fileHref } from '@/lib/client/mgmt';
import { fmtZoned } from '@/lib/zoned';
import { PageHeader } from '@/components/shell/page-header';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GuardedButton } from '../common/guarded';
import { ErrorPanel } from '../common/states';
import { useTabParam } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { availableOps, useAnnouncementOps } from './announcement-actions';
import { AnnouncementDelivery } from './announcement-delivery';
import { AnnouncementForm } from './announcement-form';
import { PriorityBadge } from './announcements-page';

export function AnnouncementDetail({ id }: { id: string }) {
  const router = useRouter();
  const { base, can, tz, writeBlock } = useMgmt();
  const q = useAnnouncement(id);
  const a = q.data;
  const [tab, setTab] = useTabParam(['details', 'delivery']);
  const ops = useAnnouncementOps((op) => {
    if (op === 'delete') router.push(`${base}/communication/announcements`);
  });
  const editable = !!a && a.canManage && (a.state === 'draft' || a.state === 'scheduled');
  const list = a ? availableOps(a, (p) => can(p)) : [];

  return (
    <>
      <PageHeader
        title={a?.title ?? 'Announcement'}
        description={a ? `${a.author?.name ? `By ${a.author.name}. ` : ''}${a.audience.map((x) => x.label).join(', ')}` : undefined}
        crumbs={[{ label: 'Announcements', href: `${base}/communication/announcements` }, { label: a?.title ?? '…' }]}
        actions={
          a && (
            <>
              <StatusChip status={a.state} />
              {list.map((o) => (
                <GuardedButton key={o.op} blocked={writeBlock(o.perm)} variant={o.danger ? 'danger' : o.op === 'publish' ? 'primary' : 'secondary'} onClick={() => ops.request(o.op, a)}>
                  {o.label}
                </GuardedButton>
              ))}
            </>
          )
        }
      />
      {q.isPending ? (
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : q.isError || !a ? (
        <Card>
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this announcement" compact={false} />
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Announcement sections">
            <TabsTrigger value="details">{editable ? 'Edit' : 'Details'}</TabsTrigger>
            <TabsTrigger value="delivery">Delivery and readers</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            {editable ? (
              <div className="max-w-3xl">
                {a.state === 'scheduled' && a.publishAt && <Banner tone="info" className="mb-6">Scheduled to publish {fmtZoned(a.publishAt, tz)}. Saving changes keeps the schedule.</Banner>}
                <AnnouncementForm announcement={a} onSaved={() => void q.refetch()} />
              </div>
            ) : (
              <ReadOnlyView a={a} tz={tz} />
            )}
          </TabsContent>
          <TabsContent value="delivery">
            <AnnouncementDelivery a={a} />
          </TabsContent>
        </Tabs>
      )}
      {ops.dialogs}
      <p className="mt-6">
        <Button asChild variant="link">
          <Link href={`${base}/communication/announcements`}>Back to all announcements</Link>
        </Button>
      </p>
    </>
  );
}

function ReadOnlyView({ a, tz }: { a: AnnouncementItem; tz: string }) {
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardBody className="space-y-4">
          {a.state === 'archived' && <Banner tone="info">This announcement is archived. Its history is kept.</Banner>}
          {a.state === 'expired' && <Banner tone="info">This announcement has expired and is no longer shown in feeds.</Banner>}
          <p className="whitespace-pre-wrap text-sm leading-6">{a.body}</p>
          {a.attachments.length > 0 && (
            <section aria-labelledby="an-att">
              <h2 id="an-att" className="t-section mb-2">
                Attachments
              </h2>
              <ul className="divide-y divide-border rounded-md border border-border">
                {a.attachments.map((f) => (
                  <li key={f.fileId} className="flex items-center gap-3 px-3 py-2">
                    <FileText className="size-4 shrink-0 text-ink-3" aria-hidden />
                    <a href={fileHref(f.fileId)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm text-brand-ink underline-offset-4 hover:underline">
                      {f.name}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </CardBody>
      </Card>
      <Card className="self-start">
        <CardBody>
          <dl className="space-y-3 text-sm">
            <Row label="Priority" value={<PriorityBadge priority={a.priority} />} />
            <Row label="Audience" value={a.audience.map((x) => x.label).join(', ') || '—'} />
            <Row label="Acknowledgement" value={a.requiresAck ? 'Required' : 'Not required'} />
            <Row label="Published" value={a.publishAt ? fmtZoned(a.publishAt, tz) : '—'} />
            <Row label="Expires" value={a.expiresAt ? fmtZoned(a.expiresAt, tz) : 'Never'} />
            <Row label="Written by" value={a.author?.name ?? '—'} />
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
