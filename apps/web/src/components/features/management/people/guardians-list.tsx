'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { GuardianOut } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { useGuardians } from '@/lib/client/people';
import { useUrlState } from '@/lib/client/url-state';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { CredentialsDialog, type IssuedLogin } from '../shared/dialogs';
import { PersonCell } from '../shared/detail';
import { paths } from '../shared/paths';
import { FormDrawer } from './form-drawer';
import { GuardianCreateForm } from './guardian-form';

const LOGIN_OPTIONS = [
  { value: 'true', label: 'Has a login' },
  { value: 'false', label: 'No login yet' },
];

export function GuardiansList() {
  const router = useRouter();
  const acc = useAccess();
  const [f, set, reset] = useUrlState({ q: '', hasLogin: '', page: 1, pageSize: 25 });
  const q = useGuardians(f);
  const [adding, setAdding] = React.useState(false);
  const [creds, setCreds] = React.useState<IssuedLogin[] | null>(null);

  const active = [f.q && { key: 'q' as const, label: `Search: ${f.q}` }, f.hasLogin && { key: 'hasLogin' as const, label: LOGIN_OPTIONS.find((o) => o.value === f.hasLogin)?.label ?? f.hasLogin }].filter(Boolean) as { key: 'q' | 'hasLogin'; label: string }[];

  const columns: Column<GuardianOut>[] = [
    {
      id: 'name',
      header: 'Parent',
      mobile: 'title',
      cell: (r) => (
        <Link href={paths.guardian(r.id)} onClick={(e) => e.stopPropagation()} className="block min-w-0 rounded-md focus-visible:outline-none">
          <PersonCell name={r.name} sub={r.occupation} />
        </Link>
      ),
    },
    { id: 'contact', header: 'Contact', mobile: 'sub', cell: (r) => (r.phone || r.email ? <span className="block min-w-0"><span className="block truncate">{r.phone ?? '—'}</span>{r.email && <span className="t-caption block truncate text-ink-2">{r.email}</span>}</span> : <span className="text-ink-3">Hidden for your role</span>) },
    {
      id: 'children',
      header: 'Children',
      mobile: 'detail',
      cell: (r) =>
        r.children.length === 0 ? (
          <span className="text-ink-3">None linked</span>
        ) : (
          <span className="block max-w-[26ch] truncate" title={r.children.map((c) => c.name).join(', ')}>
            {r.children.map((c) => c.name).join(', ')}
          </span>
        ),
    },
    { id: 'verified', header: 'Verified links', mobile: 'hide', cell: (r) => (r.children.length === 0 ? '—' : `${r.children.filter((c) => c.verified).length} of ${r.children.length}`) },
    { id: 'login', header: 'Login', mobile: 'status', cell: (r) => (r.hasLogin ? <Badge variant="success">Has login</Badge> : <Badge variant="outline">No login</Badge>) },
  ];

  const canCreate = acc.can('guardians:create', 'school');
  return (
    <>
      <PageHeader
        title="Parents and guardians"
        description={q.data ? `${q.data.meta.total.toLocaleString()} registered ${q.data.meta.total === 1 ? 'parent' : 'parents'}. A parent only sees a child once the link is verified.` : 'Guardian accounts and their verified links to children.'}
        actions={canCreate && <Button onClick={() => setAdding(true)} disabled={acc.readOnly} title={acc.hint('guardians:create', 'school')}><Plus /> Add parent</Button>}
      />
      <DataTable
        memoRows
        id="people-guardians"
        caption="Parents and guardians"
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
        onRowClick={(r) => router.push(paths.guardian(r.id))}
        filters={
          <>
            <SearchBox value={f.q} onChange={(v) => set({ q: v })} placeholder="Search name, phone or email" />
            <FilterSelect label="Login" value={f.hasLogin} onChange={(v) => set({ hasLogin: v })} options={LOGIN_OPTIONS} allLabel="Any login status" />
            {active.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
                {active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: '' })} />)}
                <ClearFiltersButton onClick={() => reset(['q', 'hasLogin'])} />
              </div>
            )}
          </>
        }
        empty={
          active.length > 0 ? (
            <EmptyState illustration="no-results" title="No parents match these filters" filters={active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: '' })} />)} action={<ClearFiltersButton onClick={() => reset(['q', 'hasLogin'])} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No parents registered yet" description="Parents are added when you add a student, or here." action={canCreate && !acc.readOnly ? <Button onClick={() => setAdding(true)}>Add parent</Button> : undefined} />
          )
        }
      />
      {adding && (
        <FormDrawer open onOpenChange={setAdding} title="Add a parent" description="Register a parent or guardian. Link them to students from the student’s record.">
          <GuardianCreateForm
            onCreated={(g, credential) => {
              setAdding(false);
              if (credential) setCreds([{ label: `Parent (${g.name})`, username: credential.username, temporaryPassword: credential.temporaryPassword }]);
              else router.push(paths.guardian(g.id));
            }}
          />
        </FormDrawer>
      )}
      <CredentialsDialog open={!!creds} onOpenChange={(o) => !o && setCreds(null)} logins={creds ?? []} title="Parent sign-in details" />
    </>
  );
}
