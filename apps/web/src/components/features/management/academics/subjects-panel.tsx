'use client';

import * as React from 'react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FormCheckbox, FormInput, FormSelect } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { useSubjectMutations, type SubjectOut } from '@/lib/client/academics';
import { useSubjectList } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { SUBJECT_TYPE_OPTIONS, TYPE_LABEL } from './fields';
import { DialogButtons, FormBanner, ModalForm } from './form-shell';
import { subjectSchema } from './schemas';

export function SubjectsPanel() {
  const access = useAccess();
  const q = useSubjectList();
  const m = useSubjectMutations();
  const [f, set, reset] = useUrlState({ sq: '', stype: '', sstatus: '' });
  const [dialog, setDialog] = React.useState<null | { subject?: SubjectOut }>(null);
  const [removing, setRemoving] = React.useState<SubjectOut | null>(null);

  const rows = React.useMemo(() => {
    const needle = f.sq.trim().toLowerCase();
    return q.data?.filter((s) => (!needle || s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle)) && (!f.stype || s.type === f.stype) && (!f.sstatus || (f.sstatus === 'active' ? s.isActive : !s.isActive)));
  }, [q.data, f.sq, f.stype, f.sstatus]);
  const filtered = !!(f.sq || f.stype || f.sstatus);
  const clear = () => reset(['sq', 'stype', 'sstatus']);

  return (
    <div className="space-y-4">
      <DataTable
        id="academics-subjects"
        caption="Subjects"
        rows={rows}
        rowKey={(s) => s.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        pageSize={100}
        filters={
          <>
            <SearchBox value={f.sq} onChange={(v) => set({ sq: v })} placeholder="Search subjects" />
            <FilterSelect label="Type" value={f.stype} onChange={(v) => set({ stype: v })} options={SUBJECT_TYPE_OPTIONS} allLabel="All types" />
            <FilterSelect label="Status" value={f.sstatus} onChange={(v) => set({ sstatus: v })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} allLabel="Any status" />
            {f.stype && <FilterChip label={TYPE_LABEL[f.stype] ?? f.stype} onRemove={() => set({ stype: '' })} />}
            {f.sstatus && <FilterChip label={f.sstatus === 'active' ? 'Active' : 'Inactive'} onRemove={() => set({ sstatus: '' })} />}
            {filtered && <ClearFiltersButton onClick={clear} />}
          </>
        }
        toolbar={
          <Button onClick={() => setDialog({})} disabled={!access.ok('academics:create')} title={access.hint('academics:create')}>
            <Plus /> Add subject
          </Button>
        }
        columns={[
          { id: 'code', header: 'Code', cell: (s) => <span className="font-mono text-[13px]">{s.code}</span>, sortable: true, sortValue: (s) => s.code, className: 'w-28', mobile: 'sub' },
          { id: 'name', header: 'Subject', hideable: false, cell: (s) => <span className="font-medium">{s.name}</span>, sortable: true, sortValue: (s) => s.name, mobile: 'title' },
          { id: 'type', header: 'Type', cell: (s) => TYPE_LABEL[s.type] ?? s.type, sortable: true, sortValue: (s) => s.type, mobile: 'detail', label: 'Type' },
          { id: 'status', header: 'Status', cell: (s) => (s.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>), mobile: 'status' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (s) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Actions for ${s.name}`} size="icon-sm" type="button">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem disabled={!access.ok('academics:edit')} onSelect={() => setDialog({ subject: s })}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem danger disabled={!access.ok('academics:delete')} onSelect={() => setRemoving(s)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
        onRowClick={access.ok('academics:edit') ? (s) => setDialog({ subject: s }) : undefined}
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No subjects match" description="Try a different search or clear the filters." action={<ClearFiltersButton onClick={clear} />} compact />
          ) : (
            <EmptyState illustration="empty-homework" title="No subjects yet" description="Add the subjects the school teaches (Mathematics, Science, English …). Then choose which grades offer them." compact action={access.ok('academics:create') ? <Button size="sm" onClick={() => setDialog({})}>Add subject</Button> : undefined} />
          )
        }
      />
      {dialog && <SubjectDialog subject={dialog.subject} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Delete ${removing.name}?` : ''}
        description="A subject that a grade offers or a teacher is assigned to cannot be deleted; mark it inactive instead. This cannot be undone."
        confirmLabel="Delete subject"
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

function SubjectDialog({ subject, onClose }: { subject?: SubjectOut; onClose: () => void }) {
  const m = useSubjectMutations();
  const form = useZodForm(subjectSchema, { defaultValues: subject ? { code: subject.code, name: subject.name, type: subject.type, isActive: subject.isActive } : { code: '', name: '', type: 'core', isActive: true } });
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <ModalForm title={subject ? `Edit ${subject.name}` : 'Add subject'} dirty={hasDirtyFields(form.formState)} onClose={onClose}>
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          setErr(null);
          try {
            if (subject) await m.update.mutateAsync({ id: subject.id, body: v });
            else await m.create.mutateAsync(v);
            onClose();
          } catch (e) {
            setErr(applyApiErrors(form, e));
          }
        })}
      >
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <FormInput control={form.control} name="code" label="Code" required hint="MAT, ENG…" />
          <FormInput control={form.control} name="name" label="Name" required />
        </div>
        <FormSelect control={form.control} name="type" label="Type" options={SUBJECT_TYPE_OPTIONS} hint="Core subjects are compulsory; co-scholastic ones (art, sport) are graded separately." />
        <FormCheckbox control={form.control} name="isActive" label="Active" hint="Inactive subjects stay in history but cannot be offered to grades." />
        <FormBanner message={err} />
        <DialogButtons onCancel={onClose} submitLabel={subject ? 'Save changes' : 'Add subject'} loading={form.formState.isSubmitting} />
      </form>
    </ModalForm>
  );
}
