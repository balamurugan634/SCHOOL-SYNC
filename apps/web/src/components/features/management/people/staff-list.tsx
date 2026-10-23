'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { StaffListItem } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { assetUrl } from '@/lib/assets';
import { fetchAllStaff, useStaffDirectory } from '@/lib/client/people-staff';
import { useUrlState } from '@/lib/client/url-state';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { PersonCell } from '../shared/detail';
import { paths } from '../shared/paths';
import { CsvExportButton } from './csv-export';
import { STAFF_STATUS_LABEL, STAFF_STATUS_OPTIONS, STAFF_TYPE_OPTIONS, StaffStatusChip, titleCase } from './ui';

export function StaffList() {
  const router = useRouter();
  const acc = useAccess();
  const [f, set, reset] = useUrlState({ q: '', staffType: '', status: '', department: '', page: 1, pageSize: 25 });
  const q = useStaffDirectory(f);

  const active = [
    f.q && { key: 'q', label: `Search: ${f.q}` },
    f.staffType && { key: 'staffType', label: STAFF_TYPE_OPTIONS.find((o) => o.value === f.staffType)?.label ?? f.staffType },
    f.status && { key: 'status', label: STAFF_STATUS_LABEL[f.status] ?? f.status },
    f.department && { key: 'department', label: `Department: ${f.department}` },
  ].filter(Boolean) as { key: 'q' | 'staffType' | 'status' | 'department'; label: string }[];
  const clearAll = () => reset(['q', 'staffType', 'status', 'department']);

  const columns: Column<StaffListItem>[] = [
    {
      id: 'name',
      header: 'Staff member',
      mobile: 'title',
      cell: (r) => (
        <Link href={paths.staffMember(r.id)} onClick={(e) => e.stopPropagation()} className="block min-w-0 rounded-md focus-visible:outline-none">
          <PersonCell name={r.name} sub={r.employeeId} src={assetUrl(r.photoUrl)} />
        </Link>
      ),
    },
    { id: 'role', header: 'Designation', mobile: 'sub', cell: (r) => [r.designation, r.department].filter(Boolean).join(' · ') || <span className="text-ink-3">—</span> },
    { id: 'type', header: 'Type', mobile: 'hide', cell: (r) => (r.staffType === 'teaching' ? 'Teaching' : 'Non-teaching') },
    {
      id: 'roles',
      header: 'Roles',
      mobile: 'hide',
      cell: (r) =>
        r.roles.length === 0 ? (
          <span className="text-ink-3">None</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {r.roles.map((k) => (
              <Badge key={k} variant="neutral">{titleCase(k)}</Badge>
            ))}
          </span>
        ),
    },
    { id: 'contact', header: 'Contact', mobile: 'hide', defaultHidden: true, cell: (r) => [r.phone, r.email].filter(Boolean).join(' · ') || '—' },
    { id: 'login', header: 'Login', mobile: 'hide', cell: (r) => (r.hasLogin ? <Badge variant="success">Has login</Badge> : <Badge variant="outline">No login</Badge>) },
    { id: 'status', header: 'Status', mobile: 'status', cell: (r) => <StaffStatusChip status={r.status} /> },
  ];

  const canCreate = acc.can('staff:create', 'school');
  return (
    <>
      <PageHeader
        title="Staff"
        description={q.data ? `${q.data.meta.total.toLocaleString()} ${q.data.meta.total === 1 ? 'staff member' : 'staff members'}. Profiles, logins, roles and workload.` : 'Staff profiles, teaching assignments and roles.'}
        actions={
          canCreate && (
            <Button asChild={!acc.readOnly} disabled={acc.readOnly} title={acc.hint('staff:create', 'school')}>
              {acc.readOnly ? <span><Plus /> Add staff</span> : <Link href={paths.staffNew}><Plus /> Add staff</Link>}
            </Button>
          )
        }
      />
      <DataTable
        memoRows
        id="people-staff"
        caption="Staff"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={columns}
        page={f.page}
        pageSize={f.pageSize}
        total={q.data?.meta.total}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize, page: 1 })}
        onRowClick={(r) => router.push(paths.staffMember(r.id))}
        filters={
          <>
            <SearchBox value={f.q} onChange={(v) => set({ q: v })} placeholder="Search name or employee id" />
            <FilterSelect label="Type" value={f.staffType} onChange={(v) => set({ staffType: v })} options={STAFF_TYPE_OPTIONS} allLabel="All staff types" />
            <FilterSelect label="Status" value={f.status} onChange={(v) => set({ status: v })} options={STAFF_STATUS_OPTIONS} allLabel="All statuses" />
            <SearchBox value={f.department} onChange={(v) => set({ department: v })} placeholder="Department" className="sm:w-44" />
            {active.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
                {active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: '' })} />)}
                <ClearFiltersButton onClick={clearAll} />
              </div>
            )}
          </>
        }
        toolbar={
          acc.can('staff:export') && (
            <CsvExportButton
              filename="staff.csv"
              disabled={!q.data || q.data.meta.total === 0}
              build={async () => {
                const all = await fetchAllStaff(f);
                return {
                  header: ['Employee id', 'First name', 'Last name', 'Designation', 'Department', 'Type', 'Status', 'Phone', 'Email', 'Roles'],
                  rows: all.map((s) => [s.employeeId, s.firstName, s.lastName, s.designation, s.department, s.staffType, STAFF_STATUS_LABEL[s.status] ?? s.status, s.phone, s.email, s.roles.join('; ')]),
                };
              }}
            />
          )
        }
        empty={
          active.length > 0 ? (
            <EmptyState illustration="no-results" title="No staff match these filters" filters={active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: '' })} />)} action={<ClearFiltersButton onClick={clearAll} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No staff added yet" description="Add teachers and other staff. Each gets a login with a temporary password." action={canCreate && !acc.readOnly ? <Button asChild><Link href={paths.staffNew}>Add staff</Link></Button> : undefined} />
          )
        }
      />
    </>
  );
}
