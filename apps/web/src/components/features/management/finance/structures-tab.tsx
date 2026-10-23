'use client';

import * as React from 'react';
import { Copy, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { structureCreateBody, type StructureOut, type StructureItemOut } from '@school-sync/shared';
import { useAddStructureItem, useCreateStructure, useDeleteStructureItem, useFeeCategories, useStructures, useUpdateStructure, useUpdateStructureItem } from '@/lib/client/finance';
import { amountText, minorToText, parseMinor, useAcademicYears, useGetQuery, useGradeList } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormActions, FormDate, FormInput, FormSection, FormSelect } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { AsyncConfirm } from '../common/dialogs';
import { ClearFilters, FilterBar, FilterChips, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { ErrorPanel } from '../common/states';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

const dueDateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a due date');
const itemFields = {
  categoryId: z.string().min(1, 'Choose a category'),
  label: z.string().trim().min(1, 'Name this fee').max(120, 'Keep it under 120 characters'),
  amount: amountText('the amount'),
  dueDate: dueDateField,
};
const structureForm = z.object({
  name: z.string().trim().min(2, 'Give the structure a name (at least 2 characters)').max(120),
  academicYearId: z.string(),
  gradeId: z.string(),
  items: z.array(z.object(itemFields)).min(1, 'Add at least one instalment').max(60),
});

const distinctDates = (s: StructureOut) => new Set(s.items.map((i) => i.dueDate)).size;

export function StructuresTab() {
  const { writeBlock, money } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const grade = ls.get('grade');
  const active = ls.get('active');
  const grades = useGradeList();
  const q = useStructures({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, gradeId: grade || undefined, active: active || undefined });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const createBlock = writeBlock('fees:create');
  const filtered = ls.hasFilters(['grade', 'active']);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">A fee structure lists what a grade pays and when: each instalment has a category, an amount and a due date. Assign it to students as a plan, then generate dues.</p>
        <GuardedButton blocked={createBlock} onClick={() => setCreating(true)}>
          <Plus /> New fee structure
        </GuardedButton>
      </div>
      <DataTable<StructureOut>
        id="fees-structures"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        caption="Fee structures"
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        onRowClick={(r) => setOpenId(r.id)}
        activeRowKey={openId}
        filters={
          <FilterBar>
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search structures" />
            <FilterSelect label="Grade" value={grade} onChange={(v) => ls.set({ grade: v })} options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))} />
            <FilterSelect label="Status" value={active} onChange={(v) => ls.set({ active: v })} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} />
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState
              illustration="no-results"
              title="No fee structures match"
              filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(grade ? [{ label: 'Grade', value: grades.data?.find((g) => g.id === grade)?.name ?? '…' }] : []), ...(active ? [{ label: 'Status', value: active === 'true' ? 'Active' : 'Inactive' }] : [])]} />}
              action={<ClearFilters onClear={() => ls.clear()} />}
            />
          ) : (
            <EmptyState illustration="empty-generic" title="No fee structures yet" description="Create one for a grade (or for every grade), list its instalments with due dates, then assign it to students." action={<GuardedButton blocked={createBlock} onClick={() => setCreating(true)}>New fee structure</GuardedButton>} />
          )
        }
        columns={[
          { id: 'name', header: 'Structure', cell: (r) => <span className="font-medium">{r.name}</span>, sortable: true, sortValue: (r) => r.name, mobile: 'title' },
          { id: 'year', header: 'Year', cell: (r) => r.academicYearName ?? '—', mobile: 'sub' },
          { id: 'grade', header: 'Grade', cell: (r) => r.gradeName ?? 'All grades', sortable: true, sortValue: (r) => r.gradeName ?? '', mobile: 'detail' },
          { id: 'inst', header: 'Instalments', cell: (r) => `${distinctDates(r)} due ${distinctDates(r) === 1 ? 'date' : 'dates'}`, align: 'right', mobile: 'detail', label: 'Instalments' },
          { id: 'total', header: 'Per student', cell: (r) => money(r.totalMinor), align: 'right', sortable: true, sortValue: (r) => r.totalMinor, mobile: 'value' },
          { id: 'plans', header: 'Students', cell: (r) => r.planCount.toLocaleString(), align: 'right', sortable: true, sortValue: (r) => r.planCount, mobile: 'detail', label: 'Students with a plan' },
          { id: 'status', header: 'Status', cell: (r) => <Badge variant={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>, mobile: 'status' },
        ]}
      />
      <StructureDrawer id={openId} onClose={() => setOpenId(null)} />
      <StructureFormDrawer open={creating} onClose={() => setCreating(false)} onCreated={(s) => setOpenId(s.id)} />
    </div>
  );
}

// ── create ──────────────────────────────────────────────────────────────────────────────────

function StructureFormDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: StructureOut) => void }) {
  const { money } = useMgmt();
  const cats = useFeeCategories(open);
  const years = useAcademicYears(open);
  const grades = useGradeList(open);
  const create = useCreateStructure();
  const form = useZodForm(structureForm, { defaultValues: { name: '', academicYearId: '', gradeId: 'all', items: [{ categoryId: '', label: '', amount: '', dueDate: '' }] } });
  const arr = useFieldArray({ control: form.control, name: 'items' });
  const { guard, dialog } = useUnsavedGuard(form.formState.isDirty);
  const [err, setErr] = React.useState<string | null>(null);
  const items = form.watch('items');
  const total = (items ?? []).reduce((t, i) => t + (parseMinor(i?.amount) ?? 0), 0);
  const catOptions = (cats.data?.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }));

  React.useEffect(() => {
    if (open) {
      form.reset({ name: '', academicYearId: '', gradeId: 'all', items: [{ categoryId: '', label: '', amount: '', dueDate: '' }] });
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (v) => {
    setErr(null);
    try {
      const body = structureCreateBody.parse({
        name: v.name,
        academicYearId: v.academicYearId || undefined,
        gradeId: v.gradeId === 'all' ? null : v.gradeId,
        items: v.items.map((it, i) => ({ categoryId: it.categoryId, label: it.label, amountMinor: parseMinor(it.amount)!, dueDate: it.dueDate, ordinal: i })),
      });
      const s = await create.mutateAsync(body);
      toast.success('Fee structure created', { description: `${s.name} · ${money(s.totalMinor)} per student` });
      form.reset(form.getValues());
      onClose();
      onCreated(s);
    } catch (e) {
      setErr(applyApiErrors(form, e));
    }
  });

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => !o && guard(onClose)}>
        <DrawerContent title="New fee structure" description="What a grade pays, instalment by instalment" showTitle onInteractOutside={(e) => form.formState.isDirty && e.preventDefault()}>
          <form onSubmit={submit} noValidate className="flex h-full min-h-0 flex-col">
            <SheetBody className="flex-1">
              <FormSection title="Structure">
                <FormInput control={form.control} name="name" label="Name" required placeholder="Grade 6 fees 2026-27" maxLength={120} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormSelect control={form.control} name="academicYearId" label="Academic year" options={[{ value: '', label: 'Current year' }, ...(years.data ?? []).map((y) => ({ value: y.id, label: y.isCurrent ? `${y.name} (current)` : y.name }))].filter((o) => o.value !== '')} placeholder="Current year" hint="Leave empty for the current year." />
                  <FormSelect control={form.control} name="gradeId" label="Applies to" options={[{ value: 'all', label: 'Every grade' }, ...(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))]} />
                </div>
              </FormSection>

              <FormSection title="Instalments" description="One line per fee per due date. Lines with the same due date become one invoice.">
                <div className="space-y-3">
                  {arr.fields.map((f, i) => (
                    <fieldset key={f.id} className="space-y-3 rounded-lg border border-border p-3">
                      <legend className="sr-only">Instalment {i + 1}</legend>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormSelect control={form.control} name={`items.${i}.categoryId`} label="Category" required options={catOptions} placeholder={cats.isPending ? 'Loading…' : 'Choose'} />
                        <FormInput control={form.control} name={`items.${i}.label`} label="Name on the invoice" required placeholder="Tuition - Instalment 1" maxLength={120} />
                        <FormInput control={form.control} name={`items.${i}.amount`} label="Amount" required inputMode="decimal" autoComplete="off" placeholder="16000" />
                        <FormDate control={form.control} name={`items.${i}.dueDate`} label="Due date" required />
                      </div>
                      <div className="flex justify-end gap-1">
                        <IconButton label={`Duplicate instalment ${i + 1}`} type="button" size="icon-sm" onClick={() => arr.insert(i + 1, { ...form.getValues(`items.${i}`), dueDate: '' })}>
                          <Copy />
                        </IconButton>
                        <IconButton label={`Remove instalment ${i + 1}`} type="button" size="icon-sm" disabled={arr.fields.length === 1} onClick={() => arr.remove(i)}>
                          <Trash2 />
                        </IconButton>
                      </div>
                    </fieldset>
                  ))}
                </div>
                {form.formState.errors.items?.message && (
                  <p role="alert" className="t-caption text-danger">
                    {form.formState.errors.items.message}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="secondary" size="sm" onClick={() => arr.append({ categoryId: '', label: '', amount: '', dueDate: '' })} disabled={arr.fields.length >= 60}>
                    <Plus /> Add instalment
                  </Button>
                  <p className="text-sm text-ink-2">
                    Per student: <span className="figure text-[18px] text-ink">{money(total)}</span>
                  </p>
                </div>
              </FormSection>
              {err && <Banner tone="danger">{err}</Banner>}
            </SheetBody>
            <FormActions>
              <Button variant="secondary" type="button" onClick={() => guard(onClose)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Create structure
              </Button>
            </FormActions>
          </form>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}

// ── detail ──────────────────────────────────────────────────────────────────────────────────

function StructureDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { writeBlock, money } = useMgmt();
  const q = useGetQuery<StructureOut>(['fees', 'structure', id], id ? `/fees/structures/${id}` : null, undefined, { staleTime: 10_000 });
  const s = q.data;
  const [editItem, setEditItem] = React.useState<StructureItemOut | 'new' | null>(null);
  const [removeItem, setRemoveItem] = React.useState<StructureItemOut | null>(null);
  const [rename, setRename] = React.useState(false);
  const [toggle, setToggle] = React.useState(false);
  const del = useDeleteStructureItem();
  const upd = useUpdateStructure();
  const editBlock = writeBlock('fees:edit');

  const byDate = React.useMemo(() => {
    const m = new Map<string, StructureItemOut[]>();
    for (const it of s?.items ?? []) m.set(it.dueDate, [...(m.get(it.dueDate) ?? []), it]);
    return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [s]);

  return (
    <>
      <Drawer open={!!id} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent title={s?.name ?? 'Fee structure'} description={s ? `${s.academicYearName ?? ''} · ${s.gradeName ?? 'every grade'}` : undefined} showTitle>
          {q.isPending ? (
            <SheetBody aria-busy>
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </SheetBody>
          ) : q.isError || !s ? (
            <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this structure" />
          ) : (
            <>
              <SheetBody>
                <dl className="grid grid-cols-3 gap-4 rounded-lg border border-border p-4">
                  <div>
                    <dt className="t-caption text-ink-2">Per student</dt>
                    <dd className="figure text-[20px] leading-7">{money(s.totalMinor)}</dd>
                  </div>
                  <div>
                    <dt className="t-caption text-ink-2">Students</dt>
                    <dd className="figure text-[20px] leading-7">{s.planCount}</dd>
                  </div>
                  <div>
                    <dt className="t-caption text-ink-2">Status</dt>
                    <dd className="mt-1">
                      <Badge variant={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
                    </dd>
                  </div>
                </dl>
                {s.planCount > 0 && (
                  <Banner tone="info" title="Billed instalments are locked">
                    {s.planCount} student{s.planCount === 1 ? ' has' : 's have'} this structure. Once dues are generated for an instalment, its category, amount and due date cannot change; the line can only be left as is.
                  </Banner>
                )}
                {!s.isActive && <Banner tone="warning">This structure is inactive: it cannot be assigned to students or used to generate dues. Existing invoices are not affected.</Banner>}

                <section aria-labelledby="st-items">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 id="st-items" className="t-section">
                      Instalments
                    </h3>
                    <GuardedButton blocked={editBlock} size="sm" variant="secondary" onClick={() => setEditItem('new')}>
                      <Plus /> Add instalment
                    </GuardedButton>
                  </div>
                  <div className="space-y-4">
                    {byDate.map(([date, list]) => (
                      <div key={date}>
                        <p className="t-caption mb-1 font-medium text-ink-2">
                          Due {fmtDate(date)} · {money(list.reduce((t, i) => t + i.amountMinor, 0))}
                        </p>
                        <ul className="divide-y divide-border rounded-lg border border-border">
                          {list.map((it) => (
                            <li key={it.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm">{it.label}</p>
                                <p className="t-caption text-ink-3">{it.categoryName}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <span className="tnum mr-1 text-sm">{money(it.amountMinor)}</span>
                                <IconButton label={`Edit ${it.label}`} size="icon-sm" disabled={!!editBlock} onClick={() => setEditItem(it)}>
                                  <Pencil />
                                </IconButton>
                                <IconButton label={`Remove ${it.label}`} size="icon-sm" disabled={!!editBlock || s.items.length <= 1} onClick={() => setRemoveItem(it)}>
                                  <Trash2 />
                                </IconButton>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              </SheetBody>
              <SheetFooter>
                <GuardedButton blocked={editBlock} variant="secondary" onClick={() => setRename(true)}>
                  Rename
                </GuardedButton>
                <GuardedButton blocked={editBlock} variant={s.isActive ? 'danger' : 'secondary'} onClick={() => setToggle(true)}>
                  {s.isActive ? 'Deactivate' : 'Activate'}
                </GuardedButton>
                <Button onClick={onClose}>Done</Button>
              </SheetFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>

      {s && <ItemDialog structure={s} target={editItem} onClose={() => setEditItem(null)} />}
      {s && <RenameDialog structure={s} open={rename} onClose={() => setRename(false)} />}
      <AsyncConfirm
        open={!!removeItem}
        onOpenChange={(o) => !o && setRemoveItem(null)}
        title={`Remove “${removeItem?.label ?? ''}”?`}
        description="It is taken off this structure. Dues already generated from it are not changed, and an instalment that has been billed cannot be removed."
        confirmLabel="Remove instalment"
        destructive
        onConfirm={async () => {
          if (!s || !removeItem) return;
          await del.mutateAsync({ structureId: s.id, itemId: removeItem.id });
          toast.success('Instalment removed');
        }}
      />
      <AsyncConfirm
        open={toggle}
        onOpenChange={setToggle}
        title={s?.isActive ? `Deactivate ${s.name}?` : `Activate ${s?.name ?? ''}?`}
        description={s?.isActive ? 'It can no longer be assigned to students or used to generate dues. Existing plans and invoices stay as they are.' : 'It can be assigned to students and used to generate dues again.'}
        confirmLabel={s?.isActive ? 'Deactivate' : 'Activate'}
        destructive={!!s?.isActive}
        onConfirm={async () => {
          if (!s) return;
          await upd.mutateAsync({ id: s.id, isActive: !s.isActive });
          toast.success(s.isActive ? 'Structure deactivated' : 'Structure activated');
        }}
      />
    </>
  );
}

const renameForm = z.object({ name: z.string().trim().min(2, 'At least 2 characters').max(120) });
function RenameDialog({ structure, open, onClose }: { structure: StructureOut; open: boolean; onClose: () => void }) {
  const upd = useUpdateStructure();
  const form = useZodForm(renameForm, { defaultValues: { name: structure.name } });
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      form.reset({ name: structure.name });
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Rename fee structure">
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await upd.mutateAsync({ id: structure.id, name: v.name });
              toast.success('Structure renamed');
              onClose();
            } catch (e) {
              setErr(applyApiErrors(form, e));
            }
          })}
        >
          <FormInput control={form.control} name="name" label="Name" required maxLength={120} />
          {err && <Banner tone="danger">{err}</Banner>}
          <FormActions className="-mx-5 -mb-5 mt-2 border-t px-5">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={upd.isPending}>
              Save
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const itemForm = z.object(itemFields);
function ItemDialog({ structure, target, onClose }: { structure: StructureOut; target: StructureItemOut | 'new' | null; onClose: () => void }) {
  const isNew = target === 'new';
  const cats = useFeeCategories(!!target);
  const add = useAddStructureItem();
  const upd = useUpdateStructureItem();
  const form = useZodForm(itemForm, { defaultValues: { categoryId: '', label: '', amount: '', dueDate: '' } });
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (target) {
      form.reset(target === 'new' ? { categoryId: '', label: '', amount: '', dueDate: '' } : { categoryId: target.categoryId, label: target.label, amount: minorToText(target.amountMinor), dueDate: target.dueDate });
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const options = (cats.data?.data ?? []).filter((c) => c.isActive || (target && target !== 'new' && c.id === target.categoryId)).map((c) => ({ value: c.id, label: c.name }));
  const submit = form.handleSubmit(async (v) => {
    setErr(null);
    const item = { categoryId: v.categoryId, label: v.label, amountMinor: parseMinor(v.amount)!, dueDate: v.dueDate };
    try {
      if (isNew) await add.mutateAsync({ structureId: structure.id, item });
      else if (target) await upd.mutateAsync({ structureId: structure.id, itemId: target.id, item });
      toast.success(isNew ? 'Instalment added' : 'Instalment updated');
      onClose();
    } catch (e) {
      setErr(applyApiErrors(form, e, { amountMinor: 'amount' }));
    }
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={isNew ? 'Add an instalment' : 'Edit instalment'} description={structure.name}>
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <FormSelect control={form.control} name="categoryId" label="Category" required options={options} placeholder="Choose" />
          <FormInput control={form.control} name="label" label="Name on the invoice" required maxLength={120} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={form.control} name="amount" label="Amount" required inputMode="decimal" autoComplete="off" />
            <FormDate control={form.control} name="dueDate" label="Due date" required />
          </div>
          {!isNew && (
            <p className="t-caption flex items-start gap-1.5 text-ink-3">
              <Lock className="mt-px size-3.5 shrink-0" aria-hidden /> If dues were already generated for this instalment, its category, amount and due date are locked.
            </p>
          )}
          {err && <Banner tone="danger">{err}</Banner>}
          <FormActions className="-mx-5 -mb-5 mt-2 border-t px-5">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending || upd.isPending}>
              {isNew ? 'Add instalment' : 'Save'}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
