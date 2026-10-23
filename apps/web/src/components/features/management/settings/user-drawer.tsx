'use client';

import * as React from 'react';
import Link from 'next/link';
import { KeyRound, LogOut, Lock, Power, ShieldCheck } from 'lucide-react';
import type { RoleOut, UserDetailOut } from '@school-sync/shared';
import { useMe } from '@/components/me-context';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, SheetBody } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { RunResult } from '@/lib/client/mutations';
import { useRoles, useUserActions, useUserDetail, useUserSessions } from '@/lib/client/settings';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { errorMessage } from '@/lib/problem';
import { useAccess } from '../shared/access';
import { CredentialsDialog, type IssuedLogin } from '../shared/dialogs';
import { DefList, ErrorPanel } from '../shared/detail';
import { paths } from '../shared/paths';
import { accessErrorMessage, USER_TYPE_LABEL, UserStatus } from './user-bits';

/** Which roles may be held by which kind of login (the API refuses the rest). */
function assignable(role: RoleOut, userType: string): boolean {
  if (role.key === 'student') return userType === 'student';
  if (role.key === 'parent') return userType === 'parent';
  return userType === 'staff';
}

const fmtStamp = (iso: string | null) => (iso ? fmtDateTime(iso) : null);

function RolesBlock({ user, canEditRoles }: { user: UserDetailOut; canEditRoles: boolean }) {
  const access = useAccess();
  const roles = useRoles(canEditRoles);
  const actions = useUserActions(user.id);
  const [editing, setEditing] = React.useState(false);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const eligible = (roles.data ?? []).filter((r) => assignable(r, user.userType));
  const start = () => {
    setSel(new Set(user.roles.map((r) => r.id)));
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    setError(null);
    try {
      await actions.setRoles.mutateAsync([...sel]);
      setEditing(false);
    } catch (e) {
      setError(accessErrorMessage(e) ?? errorMessage(e));
    }
  };
  const hint = access.hint('users:edit', 'school') ?? (canEditRoles ? undefined : 'Changing roles needs the “edit roles” permission.');
  return (
    <section aria-labelledby="user-roles-h" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="user-roles-h" className="t-section">Roles</h3>
        {!editing && user.userType === 'staff' && (
          <Button size="sm" variant="secondary" onClick={start} disabled={!canEditRoles || !access.ok('users:edit', 'school')} title={hint}>
            Change roles
          </Button>
        )}
      </div>
      {!editing ? (
        user.roles.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {user.roles.map((r) => (
              <li key={r.id}><Badge variant="primary" icon={<ShieldCheck aria-hidden />}>{r.name}</Badge></li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">No roles. This person can sign in but sees nothing.</p>
        )
      ) : roles.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : roles.isError ? (
        <ErrorPanel error={roles.error} onRetry={() => void roles.refetch()} title="We couldn’t load the roles" />
      ) : (
        <div className="space-y-3">
          <ul className="space-y-1 rounded-lg border border-border p-2">
            {eligible.map((r) => {
              const id = `urole-${r.id}`;
              return (
                <li key={r.id} className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-subtle">
                  <Checkbox id={id} className="mt-0.5" checked={sel.has(r.id)} onCheckedChange={(c) => setSel((s) => { const n = new Set(s); if (c === true) n.add(r.id); else n.delete(r.id); return n; })} />
                  <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{r.name}</span>
                    {r.isSystem ? null : <span className="t-caption ml-2 text-ink-3">custom</span>}
                    {r.description && <span className="t-caption block text-ink-2">{r.description}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="t-caption text-ink-2">Their access changes the next time their app refreshes (within a few minutes), without signing them out.</p>
          {error && <Banner tone="danger">{error}</Banner>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} loading={actions.setRoles.isPending}>Save roles</Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={actions.setRoles.isPending}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SessionsBlock({ user, canEdit }: { user: UserDetailOut; canEdit: boolean }) {
  const q = useUserSessions(user.id);
  const actions = useUserActions(user.id);
  const [busy, setBusy] = React.useState<string | null>(null);
  return (
    <section aria-labelledby="user-sessions-h" className="space-y-3">
      <h3 id="user-sessions-h" className="t-section">Signed-in devices</h3>
      {q.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the devices" />
      ) : q.data.length === 0 ? (
        <p className="text-sm text-ink-2">Not signed in on any device.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {q.data.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.deviceName ?? s.platform}{s.appVersion ? <span className="t-caption ml-2 text-ink-3">v{s.appVersion}</span> : null}</p>
                <p className="t-caption text-ink-2">{s.platform} · {s.ip ?? 'unknown address'} · active {fmtDateTime(s.lastUsedAt)}</p>
              </div>
              <Button size="sm" variant="ghost" disabled={!canEdit} loading={busy === s.id} onClick={async () => { setBusy(s.id); await actions.revokeSession.run(s.id); setBusy(null); }} aria-label={`Sign out ${s.deviceName ?? s.platform}`}>
                Sign out
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Confirm = 'reset' | 'unlock' | 'logout' | 'deactivate' | 'reactivate' | null;

/** One account: details, roles, devices and the support actions (reset password, unlock, sign out everywhere, deactivate). */
export function UserDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const me = useMe();
  const access = useAccess();
  const q = useUserDetail(id);
  const u = q.data;
  const actions = useUserActions(id ?? '');
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [creds, setCreds] = React.useState<IssuedLogin[] | null>(null);

  const isSelf = !!u && u.id === me.id;
  const targetIsSuper = !!u && u.roles.some((r) => r.key === 'super_admin');
  const iAmSuper = me.roles.includes('super_admin');
  const blocked = isSelf ? 'You cannot do this to your own account. Ask another administrator.' : targetIsSuper && !iAmSuper ? 'Only a super administrator can manage a super administrator account.' : null;
  const edit = access.hint('users:edit', 'school') ?? blocked ?? undefined;
  const del = access.hint('users:delete', 'school') ?? blocked ?? undefined;

  async function run<R>(fn: () => Promise<RunResult<R>>): Promise<RunResult<R>> {
    const r = await fn();
    if (r.ok) setConfirm(null);
    return r;
  }

  return (
    <>
      <Drawer open={!!id} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent title={u?.displayName ?? 'Account'} description={u ? `${USER_TYPE_LABEL[u.userType]} · ${u.username}` : 'Account details'} showTitle>
          <SheetBody>
            {q.isPending ? (
              <div className="space-y-3" aria-busy aria-label="Loading account"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-32 w-full" /></div>
            ) : q.isError || !u ? (
              <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this account" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2"><UserStatus user={u} />{u.mustChangePassword && <Badge variant="warning">Must change password</Badge>}</div>
                {u.locked && <Banner tone="warning" title="Signed-in attempts are locked">Too many wrong passwords. {u.lockedUntil ? `The lock clears by itself at ${fmtDateTime(u.lockedUntil)}, or you can unlock it now.` : 'Unlock it to let them try again.'}</Banner>}
                {blocked && <Banner tone="info">{blocked}</Banner>}

                <DefList
                  items={[
                    { label: 'Name', value: u.displayName },
                    { label: 'Username', value: <code className="text-[13px]">{u.username}</code> },
                    { label: 'Account type', value: USER_TYPE_LABEL[u.userType] },
                    { label: 'Email', value: u.email },
                    { label: 'Phone', value: u.phone },
                    { label: 'Last signed in', value: fmtStamp(u.lastLoginAt) ?? 'Never' },
                    { label: 'Password changed', value: fmtStamp(u.passwordChangedAt) ?? 'Never (still the temporary one)' },
                    { label: 'Created', value: fmtDate(u.createdAt) },
                    { label: 'Open sessions', value: u.activeSessions },
                    {
                      label: 'Record',
                      value: u.staffId ? <Link className="text-brand-ink underline-offset-4 hover:underline" href={paths.staffMember(u.staffId)}>Open staff record</Link> : u.studentId ? <Link className="text-brand-ink underline-offset-4 hover:underline" href={paths.student(u.studentId)}>Open student record</Link> : u.guardianId ? <Link className="text-brand-ink underline-offset-4 hover:underline" href={paths.guardian(u.guardianId)}>Open parent record</Link> : null,
                    },
                  ]}
                />

                <RolesBlock user={u} canEditRoles={access.can('roles:edit', 'school') && !blocked} />

                <section aria-labelledby="user-actions-h" className="space-y-3">
                  <h3 id="user-actions-h" className="t-section">Account actions</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setConfirm('reset')} disabled={!!edit || u.status === 'deactivated'} title={edit}><KeyRound /> Reset password</Button>
                    {u.locked && <Button variant="secondary" size="sm" onClick={() => setConfirm('unlock')} disabled={!!edit} title={edit}><Lock /> Unlock</Button>}
                    <Button variant="secondary" size="sm" onClick={() => setConfirm('logout')} disabled={!!edit || u.activeSessions === 0} title={edit ?? (u.activeSessions === 0 ? 'Not signed in anywhere.' : undefined)}><LogOut /> Sign out everywhere</Button>
                    {u.status === 'deactivated' ? (
                      <Button variant="secondary" size="sm" onClick={() => setConfirm('reactivate')} disabled={!!edit} title={edit}><Power /> Reactivate</Button>
                    ) : (
                      <Button variant="danger" size="sm" onClick={() => setConfirm('deactivate')} disabled={!!del} title={del}><Power /> Deactivate</Button>
                    )}
                  </div>
                </section>

                <SessionsBlock user={u} canEdit={!edit} />
              </>
            )}
          </SheetBody>
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={confirm === 'reset'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Reset the password for ${u?.displayName ?? 'this account'}?`}
        description="A new temporary password is created and shown once. Every device is signed out right away, and they must choose a new password at their next sign-in. The old password stops working."
        confirmLabel="Reset password"
        destructive
        loading={actions.resetPassword.isPending}
        onConfirm={async () => {
          const r = await run(() => actions.resetPassword.run());
          if (r.ok && u) setCreds([{ label: `${u.displayName} (${USER_TYPE_LABEL[u.userType]})`, username: r.data.username, temporaryPassword: r.data.temporaryPassword }]);
        }}
      />
      <ConfirmDialog open={confirm === 'unlock'} onOpenChange={(o) => !o && setConfirm(null)} title="Unlock this account?" description="The wrong-password lock is cleared so they can try again straight away. Their password is not changed." confirmLabel="Unlock" loading={actions.unlock.isPending} onConfirm={() => void run(() => actions.unlock.run())} />
      <ConfirmDialog open={confirm === 'logout'} onOpenChange={(o) => !o && setConfirm(null)} title={`Sign ${u?.displayName ?? 'this person'} out everywhere?`} description={`They are signed out of all ${u?.activeSessions ?? ''} open sessions at once (web and mobile) and must sign in again. Nothing else changes.`} confirmLabel="Sign out everywhere" destructive loading={actions.forceLogout.isPending} onConfirm={() => void run(() => actions.forceLogout.run())} />
      <ConfirmDialog
        open={confirm === 'deactivate'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Deactivate ${u?.displayName ?? 'this account'}?`}
        description={u?.userType === 'student' ? 'The student is signed out of every device and cannot sign in. Their record and history stay. You can reactivate the account later.' : 'They are signed out of every device and cannot sign in until the account is reactivated. Their records and history stay. The last super administrator cannot be deactivated.'}
        confirmLabel="Deactivate account"
        destructive
        loading={actions.deactivate.isPending}
        onConfirm={() => void run(() => actions.deactivate.run())}
      />
      <ConfirmDialog open={confirm === 'reactivate'} onOpenChange={(o) => !o && setConfirm(null)} title={`Reactivate ${u?.displayName ?? 'this account'}?`} description="They can sign in again with their existing password. If they have forgotten it, reset it afterwards." confirmLabel="Reactivate" loading={actions.reactivate.isPending} onConfirm={() => void run(() => actions.reactivate.run())} />
      {creds && <CredentialsDialog open onOpenChange={(o) => !o && setCreds(null)} title="New temporary password" logins={creds} />}
    </>
  );
}
