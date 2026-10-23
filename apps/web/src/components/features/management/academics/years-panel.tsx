'use client';

import * as React from 'react';
import { CalendarPlus, Copy, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { copySectionsBody } from '@school-sync/shared';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FormCheckbox, FormDate, FormInput, FormSelect } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toaster';
import { useYearList, yearOptions } from '@/lib/client/options';
import { useYearMutations, type AcademicYearOut } from '@/lib/client/academics';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { fmtDate } from '@/lib/format';
import { useAccess } from '../shared/access';
import { paths } from '../shared/paths';
import { DialogButtons, FormBanner, ModalForm } from './form-shell';
import { yearSchema } from './schemas';
import { TermsPanel } from './terms-panel';
import Link from 'next/link';

const copyBody = copySectionsBody.extend({ fromYearId: z.uuid('Choose a year to copy from') });

export function YearsPanel({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const access = useAccess();
  const q = useYearList();
  const m = useYearMutations();
  const [dialog, setDialog] = React.useState<null | { kind: 'create' } | { kind: 'edit'; year: AcademicYearOut } | { kind: 'copy'; year: AcademicYearOut }>(null);
  const [current, setCurrent] = React.useState<AcademicYearOut | null>(null);
  const [removing, setRemoving] = React.useState<AcademicYearOut | null>(null);

  const years = q.data;
  const selected = years?.find((y) => y.id === selectedId) ?? years?.find((y) => y.isCurrent) ?? years?.[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">The school has one current year. Terms sit inside a year; years cannot overlap each other.</p>
        <Button onClick={() => setDialog({ kind: 'create' })} disabled={!access.ok('academics:create')} title={access.hint('academics:create')}>
          <CalendarPlus /> Add academic year
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <DataTable
          id="academics-years"
          caption="Academic years"
          rows={years}
          rowKey={(y) => y.id}
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          activeRowKey={selected?.id ?? null}
          onRowClick={(y) => onSelect(y.id)}
          columns={[
            { id: 'name', header: 'Year', hideable: false, cell: (y) => <span className="font-medium">{y.name}</span>, sortValue: (y) => y.startDate, sortable: true, mobile: 'title' },
            { id: 'dates', header: 'Dates', cell: (y) => `${fmtDate(y.startDate)} – ${fmtDate(y.endDate)}`, mobile: 'sub' },
            { id: 'status', header: 'Status', cell: (y) => (y.isCurrent ? <StatusChip status="active" label="Current" /> : <Badge variant="neutral">Not current</Badge>), mobile: 'status' },
            {
              id: 'actions',
              header: <span className="sr-only">Actions</span>,
              hideable: false,
              align: 'right',
              mobile: 'hide',
              cell: (y) => (
                <span onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton label={`Actions for ${y.name}`} size="icon-sm" type="button">
                        <MoreHorizontal />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem disabled={!access.ok('academics:edit')} onSelect={() => setDialog({ kind: 'edit', year: y })}>
                        <Pencil /> Edit name and dates
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={y.isCurrent || !access.ok('academics:edit')} onSelect={() => setCurrent(y)}>
                        <Star /> Make current
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={(years?.length ?? 0) < 2 || !access.ok('academics:create')} onSelect={() => setDialog({ kind: 'copy', year: y })}>
                        <Copy /> Copy sections from another year
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem danger disabled={!access.ok('academics:delete')} onSelect={() => setRemoving(y)}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              ),
            },
          ]}
          empty={<EmptyState illustration="first-use" title="No academic year yet" description="Create the current academic year with its start and end dates. Terms, sections and the subscription all hang from it." action={access.ok('academics:create') ? <Button onClick={() => setDialog({ kind: 'create' })}>Add academic year</Button> : undefined} compact />}
        />
        <TermsPanel year={selected} />
      </div>

      {dialog?.kind === 'create' && <YearDialog onClose={() => setDialog(null)} onSaved={(y) => onSelect(y.id)} />}
      {dialog?.kind === 'edit' && <YearDialog year={dialog.year} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'copy' && <CopySectionsDialog year={dialog.year} years={years ?? []} onClose={() => setDialog(null)} />}

      <ConfirmDialog
        open={!!current}
        onOpenChange={(o) => !o && setCurrent(null)}
        title={current ? `Make ${current.name} the current year?` : ''}
        description={
          <div className="space-y-2">
            <p>
              Only one year is current. It decides which classes teachers see as theirs, which year new students are enrolled in, and which year attendance, the timetable and the subscription seat count use.
            </p>
            <p>Teachers’ access to classes refreshes straight away. The previous year stays in history and can be made current again.</p>
          </div>
        }
        confirmLabel="Make current"
        loading={m.setCurrent.isPending}
        onConfirm={async () => {
          if (!current) return;
          const r = await m.setCurrent.run(current.id);
          if (r.ok) {
            setCurrent(null);
            onSelect(current.id);
          }
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Delete ${removing.name}?` : ''}
        description={
          <div className="space-y-2">
            <p>This removes the year and its terms. It is refused if the year is current or already has sections or enrolments.</p>
            <p>This cannot be undone.</p>
          </div>
        }
        confirmLabel="Delete year"
        destructive
        loading={m.remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          // stop querying the terms of the year that is about to disappear
          if (selected?.id === removing.id) onSelect('');
          const r = await m.remove.run(removing.id);
          if (r.ok) setRemoving(null);
        }}
      />
    </div>
  );
}

function YearDialog({ year, onClose, onSaved }: { year?: AcademicYearOut; onClose: () => void; onSaved?: (y: AcademicYearOut) => void }) {
  const m = useYearMutations();
  const editing = !!year;
  const form = useZodForm(yearSchema, { defaultValues: editing ? { name: year.name, startDate: year.startDate, endDate: year.endDate } : { name: '', startDate: '', endDate: '', makeCurrent: false } });
  const [err, setErr] = React.useState<string | null>(null);
  const makeCurrent = form.watch('makeCurrent') === true;
  return (
    <ModalForm title={editing ? `Edit ${year.name}` : 'Add academic year'} description={editing ? 'Changing the dates keeps the terms, but every term must still fall inside the new dates.' : 'Dates may not overlap another academic year.'} dirty={hasDirtyFields(form.formState)} onClose={onClose}>
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          setErr(null);
          try {
            const y = editing ? await m.update.mutateAsync({ id: year.id, body: { name: v.name, startDate: v.startDate, endDate: v.endDate } }) : await m.create.mutateAsync(v);
            onSaved?.(y);
            onClose();
          } catch (e) {
            setErr(applyApiErrors(form, e));
          }
        })}
      >
        <FormInput control={form.control} name="name" label="Name" required hint="For example 2027-28" />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormDate control={form.control} name="startDate" label="Starts" required />
          <FormDate control={form.control} name="endDate" label="Ends" required />
        </div>
        {!editing && (
          <>
            <FormCheckbox control={form.control} name="makeCurrent" label="Make this the current year now" hint="Switches the school over immediately. Leave it off to prepare the next year first." />
            {makeCurrent && <Banner tone="warning">Teachers’ class access and new enrolments move to this year as soon as you save.</Banner>}
          </>
        )}
        <FormBanner message={err} />
        <DialogButtons onCancel={onClose} submitLabel={editing ? 'Save changes' : 'Add year'} loading={form.formState.isSubmitting} />
      </form>
    </ModalForm>
  );
}

function CopySectionsDialog({ year, years, onClose }: { year: AcademicYearOut; years: AcademicYearOut[]; onClose: () => void }) {
  const m = useYearMutations();
  const others = years.filter((y) => y.id !== year.id);
  const previous = [...others].filter((y) => y.startDate < year.startDate).sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? others[0];
  const form = useZodForm(copyBody, { defaultValues: { fromYearId: previous?.id ?? '', copyClassTeachers: false, copyTeachingAssignments: false } });
  const [err, setErr] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ created: number; skipped: number; assignmentsCopied: number } | null>(null);
  return (
    <ModalForm title={`Copy sections into ${year.name}`} description="Creates this year’s sections from an earlier year. Sections that already exist (same grade and name) are skipped." dirty={hasDirtyFields(form.formState) && !result} onClose={onClose}>
      {result ? (
        <div className="mt-4 space-y-4">
          <Banner tone="success" title="Sections copied">
            {result.created} created, {result.skipped} skipped because they already existed, {result.assignmentsCopied} teaching assignments copied.
          </Banner>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" asChild>
              <Link href={paths.classes}>View classes and sections</Link>
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-4 space-y-4"
          noValidate
          onSubmit={form.handleSubmit(async (v) => {
            setErr(null);
            try {
              const r = await m.copySections.mutateAsync({ id: year.id, body: v });
              setResult(r);
              toast.success(r.created ? `${r.created} sections created in ${year.name}` : 'Nothing new to copy');
            } catch (e) {
              setErr(applyApiErrors(form, e));
            }
          })}
        >
          <FormSelect control={form.control} name="fromYearId" label="Copy from" required options={yearOptions(others)} placeholder="Choose a year" />
          <FormCheckbox control={form.control} name="copyClassTeachers" label="Keep the same class teachers" hint="Each new section gets the class teacher of the old one." />
          <FormCheckbox control={form.control} name="copyTeachingAssignments" label="Copy subject teachers too" hint="Copies the section by subject grid of every copied section." />
          <FormBanner message={err} />
          <DialogButtons onCancel={onClose} submitLabel="Copy sections" loading={form.formState.isSubmitting} />
        </form>
      )}
    </ModalForm>
  );
}

