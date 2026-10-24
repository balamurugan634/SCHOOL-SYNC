'use client';

import * as React from 'react';
import { KeyRound, Plus, UserCheck, UserX } from 'lucide-react';
import { z } from 'zod';
import type { PlatformOperator } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormInput } from '@/components/ui/form';
import { PersonCell } from '@/components/features/management/shared/detail';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { fmtDateTime } from '@/lib/format';
import { useCreateOperator, useOperatorAction, useOperators, useResetOperatorPassword } from '@/lib/platform/queries';
import { SecretDialog, type Secret } from './bits';

const createSchema = z.object({ displayName: z.string().trim().min(2, 'Enter the operator’s name').max(80), email: z.email('Enter a valid email address').max(200) });

/** People who can sign in to this console. Anyone listed here can onboard schools and issue invoices. */
export function OperatorsScreen({ meId }: { meId: string }) {
  const q = useOperators();
  const action = useOperatorAction();
  const reset = useResetOperatorPassword();
  const [adding, setAdding] = React.useState(false);
  const [secret, setSecret] = React.useState<{ title: string; secrets: Secret[] } | null>(null);
  const [confirm, setConfirm] = React.useState<{ op: PlatformOperator; kind: 'disable' | 'reset' } | null>(null);

  const columns: Column<PlatformOperator>[] = [
    { id: 'name', header: 'Operator', mobile: 'title', className: 'min-w-[14rem]', cell: (o) => <PersonCell name={o.displayName} sub={o.email} /> },
    { id: 'status', header: 'Status', mobile: 'status', cell: (o) => <span className="flex flex-wrap gap-1"><StatusChip status={o.status === 'active' ? 'active' : 'suspended'} label={o.status === 'active' ? 'Active' : 'Disabled'} />{o.lockedUntil && <Badge variant="warning">Locked</Badge>}{o.mustChangePassword && o.status === 'active' && <Badge variant="outline">Temporary password</Badge>}{o.id === meId && <Badge variant="primary">You</Badge>}</span> },
    { id: 'last', header: 'Last signed in', label: 'Last signed in', mobile: 'detail', cell: (o) => (o.lastLoginAt ? <span className="tnum text-ink-2">{fmtDateTime(o.lastLoginAt)}</span> : <span className="text-ink-3">Never</span>) },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      label: 'Actions',
      hideable: false,
      align: 'right',
      mobile: 'detail',
      cell: (o) =>
        o.id === meId ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="inline-flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setConfirm({ op: o, kind: 'reset' })} aria-label={`Reset the password of ${o.displayName}`}><KeyRound /> Reset password</Button>
            {o.status === 'active' ? (
              <Button size="sm" variant="danger" onClick={() => setConfirm({ op: o, kind: 'disable' })} aria-label={`Disable ${o.displayName}`}><UserX /> Disable</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void action.run({ id: o.id, action: 'enable' })} aria-label={`Enable ${o.displayName}`}><UserCheck /> Enable</Button>
            )}
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Operators"
        description="The people who can sign in to this console. Every change they make is recorded in the audit log."
        actions={<Button onClick={() => setAdding(true)}><Plus /> Add operator</Button>}
      />
      <DataTable<PlatformOperator>
        memoRows
        id="platform-operators"
        caption="Operators"
        rows={q.data}
        rowKey={(o) => o.id}
        columns={columns}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        empty={<EmptyState illustration="empty-generic" title="No operators" description="Add the first operator." compact />}
      />
      <AddOperatorDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(o, pw) => setSecret({ title: `${o.displayName} can now sign in`, secrets: [{ label: 'Operator', username: o.email, password: pw }] })}
      />
      <ConfirmDialog
        open={confirm?.kind === 'disable'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Disable ${confirm?.op.displayName ?? 'operator'}?`}
        description="They are signed out at once and cannot sign in until you enable them again. Their past actions stay in the audit log."
        confirmLabel="Disable operator"
        destructive
        loading={action.isPending}
        onConfirm={async () => {
          if (confirm && (await action.run({ id: confirm.op.id, action: 'disable' })).ok) setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'reset'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Reset the password of ${confirm?.op.displayName ?? 'operator'}?`}
        description="A new temporary password is generated and shown once. They are signed out everywhere and must choose their own password at the next sign-in. Any sign-in lock is cleared."
        confirmLabel="Reset password"
        loading={reset.isPending}
        onConfirm={async () => {
          if (!confirm) return;
          const r = await reset.run(confirm.op.id);
          if (r.ok) {
            setSecret({ title: `New password for ${r.data.operator.displayName}`, secrets: [{ label: 'Operator', username: r.data.operator.email, password: r.data.temporaryPassword }] });
            setConfirm(null);
          }
        }}
      />
      {secret && <SecretDialog open onOpenChange={(o) => !o && setSecret(null)} title={secret.title} secrets={secret.secrets} />}
    </>
  );
}

function AddOperatorDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (o: PlatformOperator, password: string) => void }) {
  const create = useCreateOperator();
  const [banner, setBanner] = React.useState<string | null>(null);
  const form = useZodForm(createSchema, { defaultValues: { displayName: '', email: '' } });
  const { control, handleSubmit, reset, formState } = form;
  React.useEffect(() => {
    if (open) {
      reset({ displayName: '', email: '' });
      setBanner(null);
    }
  }, [open, reset]);
  const onSubmit = handleSubmit(async (v) => {
    setBanner(null);
    try {
      const r = await create.mutateAsync({ displayName: v.displayName, email: v.email });
      onOpenChange(false);
      if (r.temporaryPassword) onCreated(r.operator, r.temporaryPassword);
    } catch (e) {
      setBanner(applyApiErrors(form, e) ?? 'Please check the highlighted fields.');
    }
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent title="Add an operator" description="They get a temporary password (shown once) and choose their own at first sign-in.">
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          <FormInput control={control} name="displayName" label="Full name" required autoComplete="off" />
          <FormInput control={control} name="email" label="Email" type="email" required autoComplete="off" />
          {banner && <Banner tone="danger" role="alert">{banner}</Banner>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>Cancel</Button>
            <Button type="submit" loading={formState.isSubmitting}>Add operator</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
