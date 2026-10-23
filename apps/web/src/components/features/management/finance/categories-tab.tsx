'use client';

import * as React from 'react';
import { Pencil, Plus } from 'lucide-react';
import { feeCategoryCreateBody, feeCategoryUpdateBody, type FeeCategoryOut } from '@school-sync/shared';
import { useCreateCategory, useFeeCategories, useUpdateCategory } from '@/lib/client/finance';
import { friendlyError } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormActions, FormInput } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toaster';
import { GuardedButton } from '../common/guarded';
import { useMgmt } from '../common/use-mgmt';

export function CategoriesTab() {
  const { writeBlock } = useMgmt();
  const q = useFeeCategories();
  const [editing, setEditing] = React.useState<FeeCategoryOut | 'new' | null>(null);
  const update = useUpdateCategory();
  const createBlock = writeBlock('fees:create');
  const editBlock = writeBlock('fees:edit');
  const rows = q.data?.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[60ch] text-sm text-ink-2">Categories group what you charge (tuition, transport, lab …). They appear on every invoice and in the collection report.</p>
        <GuardedButton blocked={createBlock} onClick={() => setEditing('new')}>
          <Plus /> New category
        </GuardedButton>
      </div>
      <DataTable<FeeCategoryOut>
        id="fees-categories"
        rows={rows}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        caption="Fee categories"
        empty={<EmptyState illustration="empty-generic" title="No fee categories yet" description="Add the first category (for example Tuition), then build a fee structure from it." action={<GuardedButton blocked={createBlock} onClick={() => setEditing('new')}>New category</GuardedButton>} />}
        columns={[
          { id: 'code', header: 'Code', cell: (r) => <span className="font-medium tabular-nums">{r.code}</span>, sortable: true, sortValue: (r) => r.code, mobile: 'sub' },
          { id: 'name', header: 'Name', cell: (r) => r.name, sortable: true, sortValue: (r) => r.name, mobile: 'title' },
          { id: 'status', header: 'Status', cell: (r) => <Badge variant={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>, mobile: 'status' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            label: 'Actions',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <IconButton label={`Rename ${r.name}`} size="icon-sm" disabled={!!editBlock} onClick={() => setEditing(r)}>
                  <Pencil />
                </IconButton>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!editBlock || update.isPending}
                  onClick={async () => {
                    try {
                      await update.mutateAsync({ id: r.id, isActive: !r.isActive });
                      toast.success(r.isActive ? `${r.name} deactivated` : `${r.name} activated`, { description: r.isActive ? 'It can no longer be added to new fee structures.' : undefined });
                    } catch (e) {
                      toast.error(friendlyError(e), { duration: 8000 });
                    }
                  }}
                >
                  {r.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            ),
          },
        ]}
      />
      <CategoryDialog target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CategoryDialog({ target, onClose }: { target: FeeCategoryOut | 'new' | null; onClose: () => void }) {
  const isNew = target === 'new';
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const schema = isNew ? feeCategoryCreateBody : feeCategoryUpdateBody.required({ name: true });
  const form = useZodForm(schema as typeof feeCategoryCreateBody, { defaultValues: { code: '', name: '' } });
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (target) {
      form.reset(target === 'new' ? { code: '', name: '' } : { code: target.code, name: target.name });
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const submit = form.handleSubmit(async (v) => {
    setErr(null);
    try {
      if (isNew) await create.mutateAsync({ code: v.code, name: v.name });
      else if (target) await update.mutateAsync({ id: target.id, name: v.name });
      toast.success(isNew ? 'Category added' : 'Category renamed');
      onClose();
    } catch (e) {
      setErr(applyApiErrors(form, e));
    }
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={isNew ? 'New fee category' : 'Rename fee category'} description={isNew ? 'The code is short and cannot be changed later.' : undefined}>
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <FormInput control={form.control} name="code" label="Code" required disabled={!isNew} placeholder="TUI" maxLength={20} hint="2 to 20 letters, digits, - or _" style={{ textTransform: 'uppercase' }} />
          <FormInput control={form.control} name="name" label="Name" required maxLength={80} placeholder="Tuition" />
          {err && <Banner tone="danger">{err}</Banner>}
          <FormActions className="-mx-5 -mb-5 mt-2 border-t px-5">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {isNew ? 'Add category' : 'Save'}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
