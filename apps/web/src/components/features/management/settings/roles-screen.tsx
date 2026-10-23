'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { RoleOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shell/page-header';
import { useRoles } from '@/lib/client/settings';
import { fmtDate, plural } from '@/lib/format';
import { useAccess } from '../shared/access';
import { paths } from '../shared/paths';
import { CreateRoleDialog } from './role-dialogs';

/** Roles: system presets and custom roles with how many people hold each; open one to edit its permission matrix. */
export function RolesScreen() {
  const router = useRouter();
  const access = useAccess();
  const q = useRoles();
  const [creating, setCreating] = React.useState(false);

  const columns: Column<RoleOut>[] = [
    {
      id: 'name',
      header: 'Role',
      sortable: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <span className="block min-w-0">
          <Link href={paths.role(r.id)} className="font-medium text-ink underline-offset-4 hover:underline">{r.name}</Link>
          {r.description && <span className="t-caption line-clamp-2 block max-w-[46ch] text-ink-2">{r.description}</span>}
        </span>
      ),
      mobile: 'title',
      className: 'min-w-[16rem]',
    },
    { id: 'type', header: 'Type', cell: (r) => (r.isSystem ? <Badge variant="neutral">Built in</Badge> : <Badge variant="primary">Custom</Badge>), mobile: 'status' },
    { id: 'people', header: 'People', align: 'right', sortable: true, sortValue: (r) => r.userCount, cell: (r) => (r.userCount > 0 ? <Link href={`${paths.users}?role=${r.id}`} className="text-brand-ink underline-offset-4 hover:underline">{r.userCount.toLocaleString()}</Link> : '0'), mobile: 'detail', label: 'People' },
    { id: 'perms', header: 'Permissions', align: 'right', sortable: true, sortValue: (r) => r.permissionCount, cell: (r) => r.permissionCount.toLocaleString(), mobile: 'detail', label: 'Permissions' },
    { id: 'updated', header: 'Last changed', cell: (r) => <span className="text-ink-2">{fmtDate(r.updatedAt)}</span>, mobile: 'hide', defaultHidden: true },
  ];

  return (
    <>
      <PageHeader
        title="Roles and permissions"
        description="A role is a set of permissions. Each permission has a scope that says whose records it covers."
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Settings and access' }, { label: 'Roles' }]}
        actions={
          <Button onClick={() => setCreating(true)} disabled={!access.ok('roles:create', 'school')} title={access.hint('roles:create', 'school')}>
            <Plus /> Create role
          </Button>
        }
      />
      {!access.can('roles:edit', 'school') && <Banner tone="info" className="mb-4">You can look at roles but not change them. Only people with the “edit roles” permission can.</Banner>}
      <DataTable<RoleOut>
        id="settings-roles"
        caption="Roles"
        rows={q.data}
        rowKey={(r) => r.id}
        columns={columns}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        onRowClick={(r) => router.push(paths.role(r.id))}
        empty={<EmptyState illustration="empty-generic" title="No roles yet" description="Roles appear here once the school is set up." compact />}
      />
      {q.data && <p className="t-caption mt-3 text-ink-2">{plural(q.data.length, 'role')}. Built-in roles can be adjusted but not deleted. A person can hold several roles and gets the widest scope of each permission.</p>}
      <CreateRoleDialog open={creating} onOpenChange={setCreating} roles={q.data ?? []} onCreated={(r) => router.push(paths.role(r.id))} />
    </>
  );
}
