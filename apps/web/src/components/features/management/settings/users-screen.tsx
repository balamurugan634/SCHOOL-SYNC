'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import type { UserOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shell/page-header';
import { useRoles, useUsers, type UserCreated } from '@/lib/client/settings';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDateTime } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { CredentialsDialog } from '../shared/dialogs';
import { PersonCell } from '../shared/detail';
import { UserCreateDrawer } from './user-create';
import { USER_TYPE_LABEL, UserStatus } from './user-bits';
import { UserDrawer } from './user-drawer';

const TYPES = [{ value: 'staff', label: 'Staff' }, { value: 'student', label: 'Students' }, { value: 'parent', label: 'Parents' }];
const STATUSES = [{ value: 'active', label: 'Active' }, { value: 'invited', label: 'Not signed in yet' }, { value: 'suspended', label: 'Suspended' }, { value: 'deactivated', label: 'Deactivated' }];

/** User accounts: search, filter, create a staff sign-in, and manage one account in a drawer. */
export function UsersScreen() {
  const access = useAccess();
  const [url, setUrl, resetUrl] = useUrlState({ q: '', type: '', status: '', role: '', page: 1, size: 25, user: '' });
  const canRoles = access.can('roles:view', 'school');
  const roles = useRoles(canRoles);
  const q = useUsers({ q: url.q || undefined, userType: url.type || undefined, status: url.status || undefined, roleId: url.role || undefined, page: url.page, pageSize: url.size });
  const [creating, setCreating] = React.useState(false);
  const [created, setCreated] = React.useState<UserCreated | null>(null);
  const active = !!(url.q || url.type || url.status || url.role);
  const roleName = roles.data?.find((r) => r.id === url.role)?.name;

  const columns: Column<UserOut>[] = [
    { id: 'user', header: 'User', cell: (u) => <PersonCell name={u.displayName} sub={u.username} />, mobile: 'title', className: 'min-w-[14rem]' },
    { id: 'type', header: 'Type', cell: (u) => USER_TYPE_LABEL[u.userType], mobile: 'sub' },
    {
      id: 'roles',
      header: 'Roles',
      cell: (u) =>
        u.roles.length ? (
          <span className="flex flex-wrap gap-1">
            {u.roles.slice(0, 2).map((r) => <Badge key={r.id} variant="neutral">{r.name}</Badge>)}
            {u.roles.length > 2 && <Badge variant="outline">+{u.roles.length - 2}</Badge>}
          </span>
        ) : (
          <span className="text-ink-3">None</span>
        ),
      mobile: 'detail',
      label: 'Roles',
    },
    { id: 'status', header: 'Status', cell: (u) => <UserStatus user={u} />, mobile: 'status' },
    { id: 'last', header: 'Last signed in', cell: (u) => (u.lastLoginAt ? <span className="tnum text-ink-2">{fmtDateTime(u.lastLoginAt)}</span> : <span className="text-ink-3">Never</span>), mobile: 'detail', label: 'Last signed in' },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who can sign in: staff, students and parents. Create staff accounts, change roles and handle sign-in problems."
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Settings and access' }, { label: 'Users' }]}
        actions={
          <Button onClick={() => setCreating(true)} disabled={!access.ok('users:create', 'school')} title={access.hint('users:create', 'school')}>
            <Plus /> Create staff account
          </Button>
        }
      />
      <DataTable<UserOut>
        memoRows
        id="settings-users"
        caption="User accounts"
        rows={q.data?.data}
        rowKey={(u) => u.id}
        columns={columns}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        page={url.page}
        pageSize={url.size}
        total={q.data?.meta.total}
        onPageChange={(p) => setUrl({ page: p })}
        onPageSizeChange={(s) => setUrl({ size: s })}
        onRowClick={(u) => setUrl({ user: u.id }, { push: true })}
        activeRowKey={url.user || null}
        filters={
          <>
            <SearchBox value={url.q} onChange={(v) => setUrl({ q: v })} placeholder="Search name, username, email or phone" className="sm:w-72" />
            <FilterSelect label="Account type" value={url.type} onChange={(v) => setUrl({ type: v })} options={TYPES} allLabel="All types" />
            <FilterSelect label="Status" value={url.status} onChange={(v) => setUrl({ status: v })} options={STATUSES} allLabel="Any status" />
            {canRoles && roles.data && <FilterSelect label="Role" value={url.role} onChange={(v) => setUrl({ role: v })} options={roles.data.map((r) => ({ value: r.id, label: r.name }))} allLabel="Any role" />}
          </>
        }
        empty={
          active ? (
            <EmptyState
              illustration="no-results"
              title="No accounts match"
              description="Try a different search or clear the filters."
              filters={<>{url.q && <FilterChip label={`“${url.q}”`} onRemove={() => setUrl({ q: '' })} />}{url.type && <FilterChip label={TYPES.find((t) => t.value === url.type)?.label ?? url.type} onRemove={() => setUrl({ type: '' })} />}{url.status && <FilterChip label={STATUSES.find((t) => t.value === url.status)?.label ?? url.status} onRemove={() => setUrl({ status: '' })} />}{url.role && <FilterChip label={roleName ?? 'Role'} onRemove={() => setUrl({ role: '' })} />}</>}
              action={<ClearFiltersButton onClick={() => resetUrl(['q', 'type', 'status', 'role'])} />}
              compact
            />
          ) : (
            <EmptyState illustration="empty-generic" title="No accounts yet" description="Create the first staff account to get started." action={access.ok('users:create', 'school') ? <Button onClick={() => setCreating(true)}><Plus /> Create staff account</Button> : undefined} compact />
          )
        }
      />
      <UserDrawer id={url.user || null} onClose={() => setUrl({ user: '' })} />
      <UserCreateDrawer open={creating} onOpenChange={setCreating} onCreated={setCreated} />
      {created && (
        <CredentialsDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              const id = created.id;
              setCreated(null);
              setUrl({ user: id }, { push: true });
            }
          }}
          title={`${created.displayName} can now sign in`}
          logins={[{ label: 'Staff account', username: created.username, temporaryPassword: created.temporaryPassword }]}
        />
      )}
    </>
  );
}
