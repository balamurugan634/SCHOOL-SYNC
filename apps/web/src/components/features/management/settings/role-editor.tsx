'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { scopeAtLeast, type PermissionCatalogOut, type RoleDetailOut, type Scope } from '@school-sync/shared';
import { useMe } from '@/components/me-context';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { usePermissionCatalog, useRoleDetail, useDeleteRole, useSaveRoleGrants } from '@/lib/client/settings';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/format';
import { useAccess } from '../shared/access';
import { SearchBox } from '../shared/controls';
import { ErrorPanel } from '../shared/detail';
import { paths } from '../shared/paths';
import { EditRoleDialog } from './role-dialogs';
import { accessErrorMessage } from './user-bits';

const SCOPE_LABEL: Record<string, string> = { own: 'Own', linked: 'Linked', assigned: 'Assigned', school: 'Whole school' };
const SCOPE_HELP: Record<string, string> = {
  own: 'only the person’s own records',
  linked: 'records of linked people, such as a parent’s children',
  assigned: 'records of the classes and sections assigned to the person',
  school: 'every record in the school',
};
const ACTION_LABEL: Record<string, string> = { view: 'View', create: 'Create', edit: 'Edit', approve: 'Approve', publish: 'Publish', export: 'Export', delete: 'Delete' };
const NONE = 'none';

type Draft = Record<string, Scope | null>;

function ScopeCell({ perm, label, value, original, preset, options, disabled, onChange }: { perm: string; label: string; value: Scope | null; original: Scope | null; preset: Scope | null | undefined; options: { value: string; label: string; disabled?: boolean }[]; disabled: boolean; onChange: (v: Scope | null) => void }) {
  const changed = (value ?? null) !== (original ?? null);
  const differs = preset !== undefined && (preset ?? null) !== (value ?? null);
  return (
    <span className="relative block">
      <Select
        aria-label={label}
        value={value ?? NONE}
        disabled={disabled}
        onValueChange={(v) => onChange(v === NONE ? null : (v as Scope))}
        options={options}
        className={cn('!h-9 !px-2 text-[13px] sm:!h-8', !value && 'text-ink-3', changed && 'border-brand shadow-[0_0_0_1px_var(--brand)]')}
        data-perm={perm}
      />
      {differs && !changed && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent ring-2 ring-surface" title="Differs from the built-in setting" aria-hidden />}
    </span>
  );
}

/** The permission matrix of one role: resources × actions, a scope per cell, grouped by module. */
export function RoleEditor({ id }: { id: string }) {
  const router = useRouter();
  const me = useMe();
  const access = useAccess();
  const role = useRoleDetail(id);
  const catalog = usePermissionCatalog();
  const save = useSaveRoleGrants(id);
  const del = useDeleteRole(id);
  const [draft, setDraft] = React.useState<Draft>({});
  const [filter, setFilter] = React.useState('');
  const [onlyGranted, setOnlyGranted] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [reviewing, setReviewing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const r = role.data;
  const original = React.useMemo(() => (r?.grants ?? {}) as Record<string, Scope>, [r]);
  // a fresh copy from the server (first load, after saving) replaces the draft
  React.useEffect(() => {
    setDraft({});
    setSaveError(null);
  }, [r]);

  const value = (perm: string): Scope | null => (perm in draft ? draft[perm]! : (original[perm] ?? null));
  const changes = Object.keys(draft).filter((k) => (draft[k] ?? null) !== (original[k] ?? null));
  const { guard, dialog } = useUnsavedGuard(changes.length > 0);

  const iAmSuper = me.roles.includes('super_admin');
  const locked = r?.key === 'super_admin';
  const canEdit = access.ok('roles:edit', 'school') && !locked;
  const preset = catalog.data?.systemRoles.find((s) => s.key === r?.key)?.grants as Record<string, Scope> | undefined;

  const optionsFor = React.useCallback(
    (perm: string, scopes: PermissionCatalogOut['scopes']) => [
      { value: NONE, label: 'No access' },
      ...scopes.map((s) => ({ value: s, label: SCOPE_LABEL[s] ?? s, disabled: !iAmSuper && !scopeAtLeast(me.permissions[perm], s) })),
    ],
    [iAmSuper, me.permissions],
  );

  const set = (perm: string, v: Scope | null) =>
    setDraft((d) => {
      const n = { ...d, [perm]: v };
      if ((v ?? null) === (original[perm] ?? null)) delete n[perm];
      return n;
    });

  const submit = async () => {
    setSaveError(null);
    const patch: Record<string, Scope | null> = {};
    for (const k of changes) patch[k] = draft[k] ?? null;
    try {
      await save.mutateAsync(patch);
      setReviewing(false);
      router.refresh();
    } catch (e) {
      setSaveError(accessErrorMessage(e) ?? (e instanceof Error ? e.message : 'We could not save the changes.'));
    }
  };

  const resetToDefault = () => {
    if (!preset || !r) return;
    const next: Draft = {};
    const keys = new Set([...Object.keys(original), ...Object.keys(preset)]);
    for (const k of keys) {
      const want = (preset[k] ?? null) as Scope | null;
      if ((original[k] ?? null) !== want) next[k] = want;
    }
    setDraft(next);
    setConfirmReset(false);
  };

  if (role.isPending || catalog.isPending) {
    return (
      <>
        <PageHeader title="Role" crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Roles', href: paths.roles }, { label: 'Loading' }]} />
        <div className="space-y-4" aria-busy aria-label="Loading role"><Skeleton className="h-24 w-full rounded-lg" /><Skeleton className="h-96 w-full rounded-lg" /></div>
      </>
    );
  }
  if (role.isError || catalog.isError || !r || !catalog.data) {
    return (
      <>
        <PageHeader title="Role" crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Roles', href: paths.roles }]} />
        <ErrorPanel error={role.error ?? catalog.error} onRetry={() => { void role.refetch(); void catalog.refetch(); }} title="We couldn’t load this role" />
      </>
    );
  }

  const cat = catalog.data;
  const needle = filter.trim().toLowerCase();
  const modules = cat.modules
    .map((m) => ({ ...m, resources: m.resources.filter((res) => (!needle || res.label.toLowerCase().includes(needle) || res.key.includes(needle)) && (!onlyGranted || res.actions.some((a) => value(a.permission)))) }))
    .filter((m) => m.resources.length > 0);
  const grantedCount = Object.keys(original).length;
  const deleteBlock = r.isSystem ? 'Built-in roles cannot be deleted.' : r.userCount > 0 ? `${plural(r.userCount, 'person', 'people')} still hold this role. Remove it from them first.` : access.hint('roles:delete', 'school');

  return (
    <>
      {dialog}
      <PageHeader
        title={r.name}
        description={r.description ?? undefined}
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Roles', href: paths.roles }, { label: r.name }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={!access.ok('roles:edit', 'school') || locked} title={locked ? 'The super administrator role cannot be edited.' : access.hint('roles:edit', 'school')}><Pencil /> Edit details</Button>
            {r.isSystem && preset && (
              <Button variant="secondary" onClick={() => setConfirmReset(true)} disabled={!canEdit} title={locked ? undefined : access.hint('roles:edit', 'school')}><RotateCcw /> Reset to built-in</Button>
            )}
            {!r.isSystem && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={!!deleteBlock} title={deleteBlock}><Trash2 /> Delete</Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant={r.isSystem ? 'neutral' : 'primary'}>{r.isSystem ? 'Built in' : 'Custom'}</Badge>
        <span className="t-caption text-ink-2">Key <code>{r.key}</code></span>
        <span className="t-caption text-ink-2">·</span>
        <Link className="t-caption text-brand-ink underline-offset-4 hover:underline" href={`${paths.users}?role=${r.id}`}>{plural(r.userCount, 'person', 'people')}</Link>
        <span className="t-caption text-ink-2">· {plural(grantedCount, 'permission')}</span>
      </div>

      <div className="mb-4 space-y-3">
        {locked && <Banner tone="locked" title="This role is locked"><Lock className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />The super administrator role always keeps every permission at whole-school scope so the school can never be locked out. You can see it here but not change it.</Banner>}
        {!locked && !access.can('roles:edit', 'school') && <Banner tone="info">You can see what this role allows but not change it. Only people with the “edit roles” permission can.</Banner>}
        {!locked && access.can('roles:edit', 'school') && access.readOnly && <Banner tone="locked">The school is in read-only mode, so changes are switched off until the subscription is renewed.</Banner>}
        {canEdit && !iAmSuper && <Banner tone="info" title="You can only give access you hold yourself">Options wider than your own scope for a permission are greyed out. Ask a super administrator for those.</Banner>}
        <details className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm">
          <summary className="cursor-pointer font-medium">How scopes work</summary>
          <ul className="mt-2 space-y-1 text-ink-2">
            {cat.scopes.map((s) => (
              <li key={s}><span className="font-medium text-ink">{SCOPE_LABEL[s] ?? s}</span>: {SCOPE_HELP[s] ?? ''}</li>
            ))}
            <li>Someone with several roles gets the widest scope of each permission. Changes reach people the next time their app refreshes, without signing them out.</li>
            {preset && <li><span className="mr-1.5 inline-block size-2 rounded-full bg-accent align-middle" aria-hidden />A dot on a cell means it differs from the built-in setting.</li>}
          </ul>
        </details>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBox value={filter} onChange={setFilter} placeholder="Find a permission, e.g. fees" delay={150} />
        <div className="flex items-center gap-2">
          <Checkbox id="only-granted" checked={onlyGranted} onCheckedChange={(c) => setOnlyGranted(c === true)} />
          <label htmlFor="only-granted" className="text-sm">Only what this role grants</label>
        </div>
      </div>

      {modules.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-2">No permission matches “{filter}”.</Card>
      ) : (
        <div className="space-y-6">
          {modules.map((m) => {
            const granted = m.resources.reduce((n, res) => n + res.actions.filter((a) => value(a.permission)).length, 0);
            return (
              <section key={m.key} aria-labelledby={`mod-${m.key}`}>
                <Card>
                  <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3 max-sm:px-4">
                    <h2 id={`mod-${m.key}`} className="t-section">{m.label}</h2>
                    <span className="t-caption text-ink-2">{plural(granted, 'permission')} granted</span>
                  </div>
                  <div className="hidden grid-cols-[minmax(13rem,1.5fr)_repeat(7,minmax(5.5rem,1fr))] gap-x-2 border-b border-border bg-surface-subtle px-5 py-2 md:grid" aria-hidden>
                    <span className="t-colhead text-ink-2">What</span>
                    {cat.actions.map((a) => <span key={a} className="t-colhead text-ink-2">{ACTION_LABEL[a] ?? a}</span>)}
                  </div>
                  <ul className="divide-y divide-border">
                    {m.resources.map((res) => {
                      const have = new Map(res.actions.map((a) => [a.action, a.permission]));
                      return (
                        <li key={res.key} className="px-5 py-3 max-sm:px-4 md:grid md:grid-cols-[minmax(13rem,1.5fr)_repeat(7,minmax(5.5rem,1fr))] md:items-center md:gap-x-2">
                          <p className="mb-2 text-sm font-medium md:mb-0" id={`res-${res.key}`}>{res.label}</p>
                          {cat.actions.map((a) => {
                            const perm = have.get(a);
                            if (!perm) return <span key={a} className="hidden text-center text-ink-disabled md:block" aria-hidden>·</span>;
                            return (
                              <div key={a} className="mb-2 flex items-center justify-between gap-3 last:mb-0 md:mb-0 md:block">
                                <span className="t-caption text-ink-2 md:sr-only">{ACTION_LABEL[a] ?? a}</span>
                                <div className="w-36 md:w-full">
                                  <ScopeCell perm={perm} label={`${res.label}: ${ACTION_LABEL[a] ?? a}`} value={value(perm)} original={original[perm] ?? null} preset={preset ? (preset[perm] ?? null) : undefined} options={optionsFor(perm, cat.scopes)} disabled={!canEdit || save.isPending} onChange={(v) => set(perm, v)} />
                                </div>
                              </div>
                            );
                          })}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>
            );
          })}
        </div>
      )}

      {changes.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised px-4 py-2.5 shadow-pop" role="region" aria-label="Unsaved permission changes">
          <span className="text-sm font-medium" aria-live="polite">{plural(changes.length, 'change')} not saved yet</span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => guard(() => setDraft({}))}>Discard</Button>
            <Button size="sm" onClick={() => setReviewing(true)}>Review and save</Button>
          </div>
        </div>
      )}

      <EditRoleDialog open={editing} onOpenChange={setEditing} role={r} />

      <ReviewDialog open={reviewing} onOpenChange={(o) => !save.isPending && setReviewing(o)} role={r} changes={changes} draft={draft} original={original} catalog={cat} saving={save.isPending} error={saveError} onConfirm={() => void submit()} />

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`Reset ${r.name} to the built-in setting?`}
        description="This loads the factory permissions into the matrix so you can review them. Nothing is saved until you press Review and save."
        confirmLabel="Load built-in permissions"
        onConfirm={resetToDefault}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete the role “${r.name}”?`}
        description="The role and its permissions are removed for good. Nobody holds it, so nobody loses access. This cannot be undone."
        confirmLabel="Delete role"
        destructive
        loading={del.isPending}
        onConfirm={async () => {
          const res = await del.run();
          if (res.ok) router.replace(paths.roles);
        }}
      />
    </>
  );
}

/** Lists every change (from → to) and what it means for the people who hold the role before it is saved. */
function ReviewDialog({ open, onOpenChange, role, changes, draft, original, catalog, saving, error, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; role: RoleDetailOut; changes: string[]; draft: Draft; original: Record<string, Scope>; catalog: PermissionCatalogOut; saving: boolean; error: string | null; onConfirm: () => void }) {
  const label = (perm: string) => {
    const [res, action] = perm.split(':');
    const def = catalog.modules.flatMap((m) => m.resources).find((x) => x.key === res);
    return `${def?.label ?? res} · ${ACTION_LABEL[action ?? ''] ?? action}`;
  };
  const show = (s: Scope | null | undefined) => (s ? (SCOPE_LABEL[s] ?? s) : 'No access');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Save ${plural(changes.length, 'change')} to ${role.name}?`} description={role.userCount > 0 ? `${plural(role.userCount, 'person', 'people')} hold this role. Their access changes the next time their app refreshes.` : 'Nobody holds this role yet.'} size="lg">
        <ul className="mt-4 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
          {changes.map((k) => (
            <li key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-2">
              <span>{label(k)}</span>
              <span className="tnum"><span className="text-ink-3 line-through">{show(original[k])}</span> <span aria-hidden>→</span><span className="sr-only">changed to</span> <span className="font-medium">{show(draft[k])}</span></span>
            </li>
          ))}
        </ul>
        {error && <Banner tone="danger" className="mt-4">{error}</Banner>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Keep editing</Button>
          <Button onClick={onConfirm} loading={saving}>Save changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
