'use client';

import * as React from 'react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FormDate, FormInput } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { useTermMutations, useTerms, type AcademicYearOut, type TermOut } from '@/lib/client/academics';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { fmtDate } from '@/lib/format';
import { useAccess } from '../shared/access';
import { FormNumber } from './fields';
import { DialogButtons, FormBanner, ModalForm } from './form-shell';
import { termSchema } from './schemas';

export function TermsPanel({ year }: { year: AcademicYearOut | null }) {
  const access = useAccess();
  const q = useTerms(year?.id ?? null);
  const m = useTermMutations();
  const [dialog, setDialog] = React.useState<null | { term?: TermOut }>(null);
  const [removing, setRemoving] = React.useState<TermOut | null>(null);

  if (!year) {
    return (
      <Card>
        <EmptyState icon={<Plus />} title="Select an academic year" description="Its terms appear here." compact />
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title={`Terms in ${year.name}`}
        description={`${fmtDate(year.startDate)} – ${fmtDate(year.endDate)}. Terms stay inside the year and cannot overlap.`}
        action={
          <Button size="sm" variant="secondary" onClick={() => setDialog({})} disabled={!access.ok('academics:create')} title={access.hint('academics:create')}>
            <Plus /> Add term
          </Button>
        }
      />
      <CardBody className="pt-4">
        <DataTable
          id="academics-terms"
          caption={`Terms in ${year.name}`}
          rows={q.data}
          rowKey={(t) => t.id}
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          compact
          columns={[
            { id: 'ordinal', header: '#', cell: (t) => t.ordinal, className: 'w-12', mobile: 'hide' },
            { id: 'name', header: 'Term', hideable: false, cell: (t) => <span className="font-medium">{t.name}</span>, mobile: 'title' },
            { id: 'dates', header: 'Dates', cell: (t) => `${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}`, mobile: 'sub' },
            {
              id: 'actions',
              header: <span className="sr-only">Actions</span>,
              hideable: false,
              align: 'right',
              mobile: 'hide',
              cell: (t) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label={`Actions for ${t.name}`} size="icon-sm" type="button">
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem disabled={!access.ok('academics:edit')} onSelect={() => setDialog({ term: t })}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem danger disabled={!access.ok('academics:delete')} onSelect={() => setRemoving(t)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            },
          ]}
          empty={<EmptyState illustration="empty-events" title="No terms yet" description="Add the terms or semesters of this year, for example Term 1 and Term 2." compact action={access.ok('academics:create') ? <Button size="sm" onClick={() => setDialog({})}>Add term</Button> : undefined} />}
        />
      </CardBody>
      {dialog && <TermDialog year={year} term={dialog.term} nextOrdinal={(q.data?.reduce((m2, t) => Math.max(m2, t.ordinal), 0) ?? 0) + 1} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Delete ${removing.name}?` : ''}
        description="Exams that use this term keep their results but lose the term label. This cannot be undone."
        confirmLabel="Delete term"
        destructive
        loading={m.remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          const r = await m.remove.run(removing.id);
          if (r.ok) setRemoving(null);
        }}
      />
    </Card>
  );
}

function TermDialog({ year, term, nextOrdinal, onClose }: { year: AcademicYearOut; term?: TermOut; nextOrdinal: number; onClose: () => void }) {
  const m = useTermMutations();
  const form = useZodForm(termSchema, { defaultValues: term ? { name: term.name, ordinal: term.ordinal, startDate: term.startDate, endDate: term.endDate } : { name: `Term ${nextOrdinal}`, ordinal: nextOrdinal, startDate: year.startDate, endDate: year.endDate } });
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <ModalForm title={term ? `Edit ${term.name}` : `Add a term to ${year.name}`} description={`Dates must fall between ${fmtDate(year.startDate)} and ${fmtDate(year.endDate)}.`} dirty={hasDirtyFields(form.formState)} onClose={onClose}>
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          setErr(null);
          try {
            if (term) await m.update.mutateAsync({ id: term.id, body: v });
            else await m.create.mutateAsync({ yearId: year.id, body: v });
            onClose();
          } catch (e) {
            setErr(applyApiErrors(form, e));
          }
        })}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <FormInput control={form.control} name="name" label="Name" required />
          <FormNumber control={form.control} name="ordinal" label="Number" min={1} max={12} hint="1, 2, 3…" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormDate control={form.control} name="startDate" label="Starts" required min={year.startDate} max={year.endDate} />
          <FormDate control={form.control} name="endDate" label="Ends" required min={year.startDate} max={year.endDate} />
        </div>
        <FormBanner message={err} />
        <DialogButtons onCancel={onClose} submitLabel={term ? 'Save changes' : 'Add term'} loading={form.formState.isSubmitting} />
      </form>
    </ModalForm>
  );
}
