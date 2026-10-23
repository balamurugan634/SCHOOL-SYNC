'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import type { AuditEntryOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Drawer, DrawerContent, SheetBody } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { useAudit, useAuditEntry, useStaffUsers, type AuditFilters } from '@/lib/client/settings';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate } from '@/lib/format';
import { todayIso } from '@/lib/format';
import { errorMessage } from '@/lib/problem';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, ExportButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { DefList, ErrorPanel } from '../shared/detail';

const ENTITIES: [string, string][] = [
  ['academic_year', 'Academic year'], ['admission', 'Admission'], ['announcement', 'Announcement'], ['attendance_correction', 'Attendance correction'], ['attendance_session', 'Attendance roll call'], ['concession', 'Concession'],
  ['event', 'Event'], ['exam', 'Exam'], ['exam_paper', 'Exam paper'], ['expense', 'Expense'], ['fee_category', 'Fee category'], ['fee_structure', 'Fee structure'], ['file', 'File'], ['grade', 'Grade'], ['grade_scale', 'Grade scale'],
  ['guardian', 'Parent or guardian'], ['homework', 'Homework'], ['invoice', 'Invoice'], ['leave_request', 'Student leave'], ['library_book', 'Library book'], ['library_issue', 'Library loan'], ['mark_sheet', 'Mark sheet'], ['meeting', 'Meeting'],
  ['payment', 'Payment'], ['period', 'Period'], ['refund', 'Refund'], ['report_remark', 'Report remark'], ['role', 'Role'], ['section', 'Section'], ['section_timetable', 'Timetable'], ['session', 'Sign-in session'], ['settings', 'Settings'],
  ['staff', 'Staff'], ['staff_attendance', 'Staff attendance'], ['staff_leave_request', 'Staff leave'], ['student', 'Student'], ['subject', 'Subject'], ['teaching_assignment', 'Teaching assignment'], ['term', 'Term'],
  ['timetable_slot', 'Timetable slot'], ['timetable_substitution', 'Substitution'], ['transport_route', 'Transport route'], ['user', 'User account'],
];
const entityLabel = (e: string) => ENTITIES.find(([k]) => k === e)?.[1] ?? e.replace(/_/g, ' ');

const fmtStamp = (iso: string) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
const fmtShort = (iso: string) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

function DateFilter({ label, value, onChange, max }: { label: string; value: string; onChange: (v: string) => void; max?: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <span className="t-caption text-ink-2">{label}</span>
      <DatePicker value={value || null} onChange={onChange} max={max} placeholder="Any date" className="w-[9.5rem] sm:h-9" />
      {value && <IconButton label={`Clear ${label.toLowerCase()} date`} size="icon-sm" onClick={() => onChange('')}><X /></IconButton>}
    </div>
  );
}

/** The audit trail: keyset-paginated, filterable, with a before/after drawer and CSV export. */
export function AuditScreen() {
  const access = useAccess();
  const [url, setUrl, resetUrl] = useUrlState({ actor: '', actorName: '', entity: '', action: '', from: '', to: '', entry: '' });
  const filters: AuditFilters = { actorUserId: url.actor || undefined, entity: url.entity || undefined, action: url.action || undefined, from: url.from || undefined, to: url.to || undefined };
  const q = useAudit(filters);
  const actors = useStaffUsers(access.can('users:view', 'school'));
  const rows = React.useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const active = !!(url.actor || url.entity || url.action || url.from || url.to);
  const today = todayIso();

  const columns: Column<AuditEntryOut>[] = [
    { id: 'at', header: 'When', cell: (r) => <span className="tnum whitespace-nowrap">{fmtShort(r.at)}</span>, mobile: 'sub', className: 'w-44' },
    { id: 'actor', header: 'Who', cell: (r) => r.actorName ?? <span className="text-ink-3">System</span>, mobile: 'title' },
    { id: 'action', header: 'Action', cell: (r) => <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-[12px]">{r.action}</code>, mobile: 'status' },
    { id: 'entity', header: 'Record', cell: (r) => <span className="capitalize">{entityLabel(r.entity)}</span>, mobile: 'detail', label: 'Record' },
    { id: 'summary', header: 'What happened', cell: (r) => <span className="line-clamp-2 text-ink-2">{r.summary ?? '—'}</span>, mobile: 'detail', label: 'Summary', className: 'min-w-[14rem]' },
    { id: 'ip', header: 'IP address', cell: (r) => <span className="tnum text-ink-2">{r.ip ?? '—'}</span>, mobile: 'hide', defaultHidden: true },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what, and when. Entries cannot be edited or deleted."
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Settings and access' }, { label: 'Audit log' }]}
        actions={<ExportButton path="/audit/export" query={{ ...filters }} filename="audit-log.csv" disabled={!access.can('audit:export', 'school')} title={access.can('audit:export', 'school') ? 'Download up to 50,000 matching entries. The export is itself recorded in the log.' : 'Your role cannot export the audit log.'} />}
      />
      <DataTable<AuditEntryOut>
        memoRows
        id="settings-audit"
        caption="Audit log, newest first"
        rows={q.isPending ? undefined : rows}
        rowKey={(r) => r.id}
        columns={columns}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        onRowClick={(r) => setUrl({ entry: r.id }, { push: true })}
        activeRowKey={url.entry || null}
        compact
        filters={
          <>
            <SearchBox value={url.action} onChange={(v) => setUrl({ action: v.trim() })} placeholder="Action starts with, e.g. role." className="sm:w-60" />
            {actors.data && actors.data.length > 0 && (
              <FilterSelect label="Person" value={url.actor} onChange={(v) => setUrl({ actor: v, actorName: actors.data?.find((u) => u.id === v)?.displayName ?? '' })} options={actors.data.map((u) => ({ value: u.id, label: u.displayName }))} allLabel="Anyone" />
            )}
            <FilterSelect label="Record type" value={url.entity} onChange={(v) => setUrl({ entity: v })} options={ENTITIES.map(([value, label]) => ({ value, label }))} allLabel="All record types" />
            <DateFilter label="From" value={url.from} onChange={(v) => setUrl({ from: v })} max={url.to || today} />
            <DateFilter label="To" value={url.to} onChange={(v) => setUrl({ to: v })} max={today} />
            {url.actor && <FilterChip label={`By ${url.actorName || 'one person'}`} onRemove={() => setUrl({ actor: '', actorName: '' })} />}
            {active && <ClearFiltersButton onClick={() => resetUrl(['actor', 'actorName', 'entity', 'action', 'from', 'to'])} />}
          </>
        }
        empty={
          active ? (
            <EmptyState illustration="no-results" title="No entries match these filters" description="Try a wider date range or fewer filters." filters={<>{url.entity && <FilterChip label={entityLabel(url.entity)} onRemove={() => setUrl({ entity: '' })} />}{url.action && <FilterChip label={`${url.action}…`} onRemove={() => setUrl({ action: '' })} />}{url.from && <FilterChip label={`From ${fmtDate(url.from)}`} onRemove={() => setUrl({ from: '' })} />}{url.to && <FilterChip label={`To ${fmtDate(url.to)}`} onRemove={() => setUrl({ to: '' })} />}</>} action={<ClearFiltersButton onClick={() => resetUrl(['actor', 'actorName', 'entity', 'action', 'from', 'to'])} />} compact />
          ) : (
            <EmptyState illustration="empty-generic" title="Nothing recorded yet" description="Sign-ins and changes made by staff will appear here." compact />
          )
        }
      />
      {!q.isPending && rows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="t-caption tnum text-ink-2" aria-live="polite">Showing {rows.length.toLocaleString()} {rows.length === 1 ? 'entry' : 'entries'}{q.hasNextPage ? ', newest first' : '. That is everything that matches.'}</p>
          {q.hasNextPage && (
            <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              Load older entries
            </Button>
          )}
        </div>
      )}
      {q.isError && q.data && <Banner tone="danger" className="mt-4" action={<Button size="sm" variant="secondary" onClick={() => void q.fetchNextPage()}>Try again</Button>}>{errorMessage(q.error)}</Banner>}

      <EntryDrawer
        id={url.entry || null}
        onClose={() => setUrl({ entry: '' })}
        onFilterActor={(id, name) => setUrl({ actor: id, actorName: name, entry: '' })}
      />
    </>
  );
}

// ── detail drawer with a before / after view ────────────────────────────────────────────────────
function flatten(v: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 0) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix || '(value)'] = v;
  return out;
}
const show = (v: unknown) => (v === undefined ? '—' : v === null ? 'empty' : typeof v === 'string' ? v : JSON.stringify(v));

function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = flatten(before);
  const a = flatten(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const rows = keys.map((k) => ({ k, before: b[k], after: a[k], changed: JSON.stringify(b[k]) !== JSON.stringify(a[k]) }));
  const hasBoth = before !== null && before !== undefined && after !== null && after !== undefined;
  const list = hasBoth ? rows.filter((r) => r.changed) : rows;
  if (before == null && after == null) return <p className="text-sm text-ink-2">No before or after values were recorded for this entry.</p>;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="t-table w-full">
          <caption className="sr-only">{hasBoth ? 'Fields that changed' : 'Recorded values'}</caption>
          <thead>
            <tr>
              <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">Field</th>
              <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">Before</th>
              <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">After</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-3 text-ink-2">Nothing differs between the two snapshots.</td></tr>
            )}
            {list.map((r) => (
              <tr key={r.k} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-mono text-[12px] font-medium">{r.k}</th>
                <td className="break-words px-3 py-2 text-ink-2 [overflow-wrap:anywhere]">{before == null ? '—' : show(r.before)}</td>
                <td className="break-words px-3 py-2 [overflow-wrap:anywhere]">{after == null ? '—' : show(r.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium">Raw snapshots</summary>
        <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
          {([['Before', before], ['After', after]] as const).map(([t, v]) => (
            <div key={t} className="min-w-0">
              <p className="t-caption mb-1 text-ink-2">{t}</p>
              <pre className="max-h-64 overflow-auto rounded-md bg-surface-sunken p-2 text-[12px] leading-5">{v == null ? 'none' : JSON.stringify(v, null, 2)}</pre>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function EntryDrawer({ id, onClose, onFilterActor }: { id: string | null; onClose: () => void; onFilterActor: (id: string, name: string) => void }) {
  const q = useAuditEntry(id);
  const e = q.data;
  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent title="Audit entry" description={e ? `${e.action} · ${fmtStamp(e.at)}` : 'Details of one audit entry'} showTitle>
        <SheetBody>
          {q.isPending ? (
            <div className="space-y-3" aria-busy aria-label="Loading entry"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-40 w-full" /></div>
          ) : q.isError || !e ? (
            <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this entry" />
          ) : (
            <>
              <DefList
                items={[
                  { label: 'When', value: fmtStamp(e.at) },
                  { label: 'Who', value: e.actorName ? (
                    <span className="flex flex-wrap items-center gap-2">{e.actorName}
                      {e.actorUserId && <Button variant="link" className="t-caption" onClick={() => onFilterActor(e.actorUserId!, e.actorName ?? '')}>Show only their activity</Button>}
                    </span>
                  ) : 'System' },
                  { label: 'Action', value: <code className="text-[12px]">{e.action}</code> },
                  { label: 'Record', value: <span><span className="capitalize">{entityLabel(e.entity)}</span>{e.entityId && <code className="t-caption ml-2 break-all text-ink-3">{e.entityId}</code>}</span> },
                  { label: 'Summary', value: e.summary },
                  { label: 'IP address', value: e.ip },
                  { label: 'Device', value: e.userAgent },
                  { label: 'Request', value: e.requestId && <code className="t-caption break-all">{e.requestId}</code> },
                ]}
              />
              <div>
                <h3 className="t-section mb-3">Before and after</h3>
                <Changes before={e.before} after={e.after} />
              </div>
            </>
          )}
        </SheetBody>
      </DrawerContent>
    </Drawer>
  );
}
