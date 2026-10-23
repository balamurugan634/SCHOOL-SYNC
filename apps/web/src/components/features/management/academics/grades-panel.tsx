'use client';

import * as React from 'react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FormCheckbox, FormInput } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { useGradeMutations, type GradeOut } from '@/lib/client/academics';
import { useGradeList } from '@/lib/client/options';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useAccess } from '../shared/access';
import { FormNumber } from './fields';
import { DialogButtons, FormBanner, ModalForm } from './form-shell';
import { gradeSchema } from './schemas';

export function GradesPanel() {
  const access = useAccess();
  const q = useGradeList();
  const m = useGradeMutations();
  const [dialog, setDialog] = React.useState<null | { grade?: GradeOut }>(null);
  const [removing, setRemoving] = React.useState<GradeOut | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">Grades run in the order of their position. Year-end promotion moves students to the next position; the highest grade graduates.</p>
        <Button onClick={() => setDialog({})} disabled={!access.ok('academics:create')} title={access.hint('academics:create')}>
          <Plus /> Add grade
        </Button>
      </div>
      <DataTable
        id="academics-grades"
        caption="Grades"
        rows={q.data}
        rowKey={(g) => g.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          { id: 'ordinal', header: 'Position', cell: (g) => g.ordinal, sortable: true, sortValue: (g) => g.ordinal, className: 'w-24', mobile: 'detail' },
          { id: 'name', header: 'Grade', hideable: false, cell: (g) => <span className="font-medium">{g.name}</span>, sortable: true, sortValue: (g) => g.name, mobile: 'title' },
          { id: 'status', header: 'Status', cell: (g) => (g.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>), mobile: 'status' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (g) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Actions for ${g.name}`} size="icon-sm" type="button">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem disabled={!access.ok('academics:edit')} onSelect={() => setDialog({ grade: g })}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem danger disabled={!access.ok('academics:delete')} onSelect={() => setRemoving(g)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
        empty={<EmptyState illustration="first-use" title="No grades yet" description="Add each grade (Grade 6, Grade 7 …), then the sections inside it." compact action={access.ok('academics:create') ? <Button size="sm" onClick={() => setDialog({})}>Add grade</Button> : undefined} />}
      />
      {dialog && <GradeDialog grade={dialog.grade} next={(q.data?.reduce((n, g) => Math.max(n, g.ordinal), 0) ?? 0) + 1} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Delete ${removing.name}?` : ''}
        description="A grade that has sections or students cannot be deleted; mark it inactive instead. This cannot be undone."
        confirmLabel="Delete grade"
        destructive
        loading={m.remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          const r = await m.remove.run(removing.id);
          if (r.ok) setRemoving(null);
        }}
      />
    </div>
  );
}

function GradeDialog({ grade, next, onClose }: { grade?: GradeOut; next: number; onClose: () => void }) {
  const m = useGradeMutations();
  const form = useZodForm(gradeSchema, { defaultValues: grade ? { name: grade.name, ordinal: grade.ordinal, isActive: grade.isActive } : { name: '', ordinal: next, isActive: true } });
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <ModalForm title={grade ? `Edit ${grade.name}` : 'Add grade'} dirty={hasDirtyFields(form.formState)} onClose={onClose}>
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          setErr(null);
          try {
            if (grade) await m.update.mutateAsync({ id: grade.id, body: v });
            else await m.create.mutateAsync(v);
            onClose();
          } catch (e) {
            setErr(applyApiErrors(form, e));
          }
        })}
      >
        <FormInput control={form.control} name="name" label="Name" required hint="For example Grade 6 or Class VI" />
        <FormNumber control={form.control} name="ordinal" label="Position" required min={-5} max={30} hint="Promotion moves students to the next higher position. Positions must be unique." />
        <FormCheckbox control={form.control} name="isActive" label="Active" hint="Inactive grades stay in history but are skipped by promotion and new sections." />
        <FormBanner message={err} />
        <DialogButtons onCancel={onClose} submitLabel={grade ? 'Save changes' : 'Add grade'} loading={form.formState.isSubmitting} />
      </form>
    </ModalForm>
  );
}
