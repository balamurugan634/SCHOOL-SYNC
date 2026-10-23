'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useGuardian, useGuardianActions } from '@/lib/client/people';
import { useAccess } from '../shared/access';
import { CredentialsDialog, type IssuedLogin } from '../shared/dialogs';
import { DefList, ErrorPanel, Panel } from '../shared/detail';
import { paths } from '../shared/paths';
import { ErrorBanner } from './errors';
import { FormDrawer } from './form-drawer';
import { GuardianEditForm } from './guardian-form';
import { relationshipLabel } from './ui';

export function GuardianDetail({ id }: { id: string }) {
  const router = useRouter();
  const acc = useAccess();
  const q = useGuardian(id);
  const { remove, createLogin } = useGuardianActions(id);
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [loginOpen, setLoginOpen] = React.useState(false);
  const [creds, setCreds] = React.useState<IssuedLogin[] | null>(null);
  const [actionError, setActionError] = React.useState<unknown>(null);
  const crumbs = [{ label: 'Home', href: '/admin' }, { label: 'Parents and guardians', href: paths.guardians }];

  if (q.isPending)
    return (
      <div aria-busy>
        <Skeleton className="mb-8 h-12 w-72" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    );
  if (q.isError)
    return (
      <>
        <PageHeader title="Parent" crumbs={[...crumbs, { label: 'Parent' }]} />
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this parent" />
      </>
    );
  const g = q.data;
  const addr = g.address ? [g.address.line1, g.address.line2, g.address.city, g.address.state, g.address.postalCode, g.address.country].filter(Boolean).join(', ') : '';
  const canEdit = acc.ok('guardians:edit', 'school');
  const hasChildren = g.children.length > 0;

  return (
    <>
      <PageHeader
        title={g.name}
        description={g.occupation ?? 'Parent or guardian'}
        crumbs={[...crumbs, { label: g.name }]}
        actions={
          <>
            {acc.can('guardians:edit', 'school') && (
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={!canEdit} title={acc.hint('guardians:edit', 'school')}>
                <Pencil /> Edit details
              </Button>
            )}
            {acc.can('guardians:delete', 'school') && (
              <Button variant="danger" onClick={() => setDeleting(true)} disabled={!acc.ok('guardians:delete', 'school') || hasChildren} title={hasChildren ? 'Unlink every student first' : acc.hint('guardians:delete', 'school')}>
                <Trash2 /> Remove
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-6">
          <Panel title="Children" description="A parent sees a child only when the link is verified.">
            {g.children.length === 0 ? (
              <EmptyState compact title="Not linked to any student" description="Open a student’s record and link this parent from the Parents tab." />
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {g.children.map((c) => (
                  <li key={c.studentId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link href={paths.student(c.studentId, 'guardians')} className="rounded-sm text-sm font-medium hover:underline">{c.name}</Link>
                      <p className="t-caption text-ink-2">{c.admissionNo} · {c.gradeName ? `${c.gradeName} ${c.sectionName ?? ''}`.trim() : 'Not placed'} · {relationshipLabel(c.relationship)}</p>
                    </div>
                    {c.verified ? <Badge variant="success">Verified</Badge> : <Badge variant="warning">Awaiting verification</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Contact">
            <DefList
              items={[
                { label: 'Mobile', value: g.phone },
                { label: 'Email', value: g.email },
                { label: 'Address', value: addr },
              ]}
            />
            {g.phone === null && g.email === null && <p className="t-caption mt-3 text-ink-3">Contact details are hidden unless your role includes parent records.</p>}
          </Panel>
          <Panel title="Sign-in">
            {g.hasLogin ? (
              <DefList items={[{ label: 'Login', value: <Badge variant="success">Has a login</Badge> }, { label: 'Username', value: g.username ? <span className="font-mono text-[13px]">{g.username}</span> : null }]} />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-2">This parent has no login yet, so they cannot see anything in the app.</p>
                {acc.can('guardians:edit', 'school') && (
                  <Button size="sm" onClick={() => { setActionError(null); setLoginOpen(true); }} disabled={!canEdit} title={acc.hint('guardians:edit', 'school')}>
                    <KeyRound /> Create login
                  </Button>
                )}
              </div>
            )}
            <p className="t-caption mt-3 text-ink-2">To reset a forgotten password, use <Link href={paths.users} className="text-brand-ink hover:underline">Settings → Users</Link>.</p>
          </Panel>
        </div>
      </div>

      {editing && (
        <FormDrawer open onOpenChange={setEditing} title="Edit parent" description={g.name}>
          <GuardianEditForm guardian={g} onSaved={() => setEditing(false)} />
        </FormDrawer>
      )}
      <ConfirmDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        title={`Create a login for ${g.name}?`}
        description={
          <>
            <p>The username is their mobile number{g.phone ? ` (${g.phone})` : ' or email'}. A temporary password is shown once, and they must change it when they first sign in.</p>
            {!!actionError && <div className="mt-3"><ErrorBanner error={actionError} /></div>}
          </>
        }
        confirmLabel="Create login"
        loading={createLogin.isPending}
        onConfirm={async () => {
          setActionError(null);
          try {
            const c = await createLogin.mutateAsync();
            setLoginOpen(false);
            setCreds([{ label: `Parent (${g.name})`, username: c.username, temporaryPassword: c.temporaryPassword }]);
          } catch (e) {
            setActionError(e);
          }
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Remove ${g.name}?`}
        description={`${g.name}’s record is removed and their login is switched off. This is only possible because no student is linked to them. It cannot be undone.`}
        confirmLabel="Remove parent"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          const r = await remove.run(undefined);
          if (r.ok) router.push(paths.guardians);
          else setDeleting(false);
        }}
      />
      <CredentialsDialog open={!!creds} onOpenChange={(o) => !o && setCreds(null)} logins={creds ?? []} title="Parent sign-in details" />
      {hasChildren && !g.hasLogin && g.children.every((c) => !c.verified) && <div className="mt-6"><Banner tone="info">None of this parent’s links is verified yet, so a login would show them no children until you verify a link.</Banner></div>}
    </>
  );
}
