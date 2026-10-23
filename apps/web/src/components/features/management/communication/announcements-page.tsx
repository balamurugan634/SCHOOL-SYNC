'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, MoreHorizontal, Paperclip, Plus } from 'lucide-react';
import { ANNOUNCEMENT_STATES, type AnnouncementItem } from '@school-sync/shared';
import { useManagedAnnouncements } from '@/lib/client/communication';
import { fmtDate } from '@/lib/format';
import { fmtZoned } from '@/lib/zoned';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { ChoicePills, ClearFilters, FilterBar, FilterChips, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { availableOps, useAnnouncementOps } from './announcement-actions';

const STATE_OPTIONS = [{ value: '' as const, label: 'All' }, ...ANNOUNCEMENT_STATES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))];

export function PriorityBadge({ priority }: { priority: AnnouncementItem['priority'] }) {
  if (priority === 'normal') return <span className="text-ink-2">Normal</span>;
  return <Badge variant={priority === 'urgent' ? 'danger' : 'warning'}>{priority === 'urgent' ? 'Urgent' : 'Important'}</Badge>;
}

export function AnnouncementsPage() {
  const router = useRouter();
  const { base, can, tz, writeBlock, me } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const state = ls.get('state') as '' | (typeof ANNOUNCEMENT_STATES)[number];
  const mine = ls.get('mine') === '1';
  const q = useManagedAnnouncements({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, state: state || undefined, mine: mine ? 'true' : undefined });
  const ops = useAnnouncementOps();
  const filtered = !!state || mine || !!ls.q;
  const seesEveryones = can('announcements:edit', 'school');

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Circulars and notices to everyone or to a chosen audience, with delivery and acknowledgement tracking."
        actions={
          <GuardedButton blocked={writeBlock('announcements:create')} onClick={() => router.push(`${base}/communication/announcements/new`)}>
            <Plus /> New announcement
          </GuardedButton>
        }
      />
      <DataTable<AnnouncementItem>
        id="comm-announcements"
        caption="Announcements"
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
        onRowClick={(r) => router.push(`${base}/communication/announcements/${r.id}`)}
        filters={
          <div className="flex w-full flex-col gap-3">
            <ChoicePills label="Announcement state" value={state} onChange={(v) => ls.set({ state: v })} options={STATE_OPTIONS} />
            <FilterBar>
              <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search title or message" />
              {seesEveryones && (
                <button type="button" aria-pressed={mine} onClick={() => ls.set({ mine: mine ? null : '1' })} className={`tr-colors inline-flex h-11 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium sm:h-9 ${mine ? 'border-brand bg-brand-soft text-brand-ink' : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-subtle'}`}>
                  {mine && <Check className="size-3.5" aria-hidden />} Only mine
                </button>
              )}
            </FilterBar>
          </div>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No announcements match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(state ? [{ label: 'State', value: state }] : []), ...(mine ? [{ label: 'Author', value: 'me' }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No announcements yet" description="Write the first one and choose who it is for." action={<GuardedButton blocked={writeBlock('announcements:create')} onClick={() => router.push(`${base}/communication/announcements/new`)}>New announcement</GuardedButton>} />
          )
        }
        columns={[
          {
            id: 'title',
            header: 'Announcement',
            cell: (r) => (
              <div className="min-w-0">
                <Link href={`${base}/communication/announcements/${r.id}`} onClick={(e) => e.stopPropagation()} className="flex max-w-[44ch] items-center gap-1.5 font-medium hover:underline">
                  <span className="truncate">{r.title}</span>
                  {r.attachments.length > 0 && <Paperclip className="size-3.5 shrink-0 text-ink-3" aria-label={`${r.attachments.length} attachment${r.attachments.length === 1 ? '' : 's'}`} />}
                </Link>
                <p className="t-caption max-w-[56ch] truncate text-ink-3">{r.body}</p>
              </div>
            ),
            mobile: 'title',
          },
          { id: 'state', header: 'State', cell: (r) => <StatusChip status={r.state} />, mobile: 'status' },
          { id: 'priority', header: 'Priority', cell: (r) => <PriorityBadge priority={r.priority} />, mobile: 'detail', label: 'Priority' },
          { id: 'audience', header: 'Audience', cell: (r) => <span className="block max-w-[28ch] truncate" title={r.audience.map((a) => a.label).join(', ')}>{r.audience.map((a) => a.label).join(', ') || '—'}</span>, mobile: 'sub' },
          {
            id: 'reach',
            header: 'Read',
            cell: (r) => (r.state === 'draft' || r.state === 'scheduled' ? <span className="text-ink-3">—</span> : (<span className="tnum">{r.readCount ?? 0}{r.requiresAck && <span className="t-caption block text-ink-3">{r.ackCount ?? 0} acknowledged</span>}</span>)),
            align: 'right',
            mobile: 'detail',
            label: 'Read by',
          },
          { id: 'when', header: 'When', cell: (r) => (r.state === 'scheduled' && r.publishAt ? `Scheduled ${fmtZoned(r.publishAt, tz, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : fmtDate(r.publishAt ?? r.createdAt)), sortable: true, sortValue: (r) => r.publishAt ?? r.createdAt, mobile: 'hide' },
          { id: 'author', header: 'Author', cell: (r) => (r.author?.id === me.id ? 'You' : (r.author?.name ?? '—')), defaultHidden: true, mobile: 'hide' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            label: 'Actions',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) => {
              const list = availableOps(r, (p) => can(p));
              return (
                <div onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton label={`Actions for ${r.title}`} size="icon-sm">
                        <MoreHorizontal />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => router.push(`${base}/communication/announcements/${r.id}`)}>Open</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => router.push(`${base}/communication/announcements/${r.id}?tab=delivery`)}>Delivery and readers</DropdownMenuItem>
                      {list.length > 0 && <DropdownMenuSeparator />}
                      {list.map((o) => (
                        <DropdownMenuItem key={o.op} danger={o.danger} disabled={!!writeBlock(o.perm)} onSelect={() => ops.request(o.op, r)}>
                          {o.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            },
          },
        ]}
      />
      {ops.dialogs}
      <p className="t-caption mt-4 text-ink-3">
        <Button variant="link" size="sm" asChild className="mr-1">
          <Link href={`${base}/communication/preferences`}>Notification settings</Link>
        </Button>
        control how you receive notifications yourself.
      </p>
    </>
  );
}
