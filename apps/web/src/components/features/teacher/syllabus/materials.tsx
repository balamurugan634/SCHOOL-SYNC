'use client';

import * as React from 'react';
import { Controller } from 'react-hook-form';
import { Archive, ExternalLink, FileText, Link2, Pencil, Plus } from 'lucide-react';
import { materialCreateBody, materialUpdateBody, type LearningAttachmentRef, type MaterialItem } from '@school-sync/shared';
import { sectionOutLabel, useMyTeaching, useMySections, type TeachPair } from '@/lib/client/teacher';
import { teacherError } from '@/lib/client/teacher-errors';
import { useArchiveMaterial, useCreateMaterial, useMaterials, useUpdateMaterial, type MaterialFilters } from '@/lib/client/teacher-learning';
import { fileHref } from '@/lib/client/teacher-upload';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input, SearchField } from '@/components/ui/input';
import { FormInput, FormTextarea } from '@/components/ui/form';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { PageHeader } from '@/components/shell/page-header';
import { useMe, usePermissions } from '@/components/me-context';
import { AttachmentPicker, FilterSelect, useUrlState, useWriteGate } from '../common';

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Study materials for the classes I teach: share a link or a file, edit it, archive it. */
export function MaterialsScreen() {
  const me = useMe();
  const { can } = usePermissions();
  const gate = useWriteGate();
  const url = useUrlState();
  const sections = useMySections();
  const teaching = useMyTeaching();
  const archive = useArchiveMaterial();
  const [q, setQ] = React.useState(url.get('q'));
  const dq = useDebounced(q);
  React.useEffect(() => {
    if (dq !== url.get('q')) url.set({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const filters: MaterialFilters = { sectionId: url.get('section'), subjectId: url.get('subject'), q: url.get('q'), archived: url.get('archived') === '1', page: url.num('page', 1), pageSize: url.num('size', 25) };
  const list = useMaterials(filters);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<MaterialItem | null>(null);
  const [archiving, setArchiving] = React.useState<MaterialItem | null>(null);
  const subjects = [...new Map(teaching.pairs.map((p) => [p.subjectId, p.subjectName])).entries()].map(([value, label]) => ({ value, label }));
  const filtered = !!(filters.sectionId || filters.subjectId || filters.q || filters.archived);

  const columns: Column<MaterialItem>[] = [
    {
      id: 'title',
      header: 'Material',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.title}</p>
          {r.description && <p className="t-caption line-clamp-1 text-ink-3">{r.description}</p>}
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.title,
      mobile: 'title',
    },
    { id: 'subject', header: 'Subject', cell: (r) => r.subjectName, sortable: true, sortValue: (r) => r.subjectName, mobile: 'sub' },
    { id: 'audience', header: 'Shared with', cell: (r) => (r.sectionName ? `${r.gradeName ?? ''} ${r.sectionName}`.trim() : `Every class of ${r.gradeName ?? 'the grade'}`), mobile: 'detail' },
    {
      id: 'type',
      header: 'Type',
      cell: (r) => (
        <Badge variant="neutral" icon={r.fileId ? <FileText aria-hidden /> : <Link2 aria-hidden />}>
          {r.fileId ? 'File' : 'Link'}
        </Badge>
      ),
      mobile: 'status',
    },
    {
      id: 'added',
      header: 'Added',
      cell: (r) => (
        <span className="text-ink-2">
          {fmtDate(r.createdAt, { day: 'numeric', month: 'short' })}
          {r.createdByName ? ` · ${r.createdByName}` : ''}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.createdAt,
      mobile: 'hide',
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      label: 'Actions',
      hideable: false,
      align: 'right',
      mobile: 'hide',
      cell: (r) => {
        const mine = r.createdBy === me.id;
        return (
          <span className="inline-flex items-center gap-0.5">
            {r.archivedAt && <Badge variant="neutral">Archived</Badge>}
            <IconButton label={`Open ${r.title}`} asChild size="icon-sm">
              <a href={r.fileId ? fileHref(r.fileId) : (r.url ?? '#')} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                <ExternalLink />
              </a>
            </IconButton>
            {mine && !r.archivedAt && can('materials:edit') && (
              <IconButton label={`Edit ${r.title}`} size="icon-sm" disabled={gate.readOnly} onClick={(e) => { e.stopPropagation(); setEditing(r); }}>
                <Pencil />
              </IconButton>
            )}
            {mine && !r.archivedAt && can('materials:delete') && (
              <IconButton label={`Archive ${r.title}`} size="icon-sm" disabled={gate.readOnly} onClick={(e) => { e.stopPropagation(); setArchiving(r); }}>
                <Archive />
              </IconButton>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Study materials"
        description="Share links and files with the classes you teach. Students and parents see them under Learning."
        actions={
          can('materials:create') && (
            <Button onClick={() => setCreating(true)} disabled={gate.readOnly} title={gate.reason}>
              <Plus /> Add material
            </Button>
          )
        }
      />
      <DataTable<MaterialItem>
        id="teacher-materials"
        caption="Study materials"
        rows={list.data?.data}
        rowKey={(r) => r.id}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        page={filters.page}
        pageSize={filters.pageSize}
        total={list.data?.meta.total}
        onPageChange={(p) => url.set({ page: p }, { keepPage: true })}
        onPageSizeChange={(n) => url.set({ size: n })}
        filters={
          <>
            <SearchField className="w-full sm:w-64" value={q} onChange={setQ} placeholder="Search materials" hint={null} />
            <FilterSelect label="Class" value={filters.sectionId} allLabel="All my classes" onChange={(v) => url.set({ section: v })} options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionOutLabel(s) }))} />
            <FilterSelect label="Subject" value={filters.subjectId} allLabel="All subjects" onChange={(v) => url.set({ subject: v })} options={subjects} />
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <Checkbox checked={filters.archived} onCheckedChange={(v) => url.set({ archived: v === true ? '1' : null })} aria-label="Show archived materials" />
              Show archived
            </label>
          </>
        }
        columns={columns}
        empty={
          filtered ? (
            <EmptyState illustration="no-results" compact title="No materials match" action={<Button variant="secondary" size="sm" onClick={() => { setQ(''); url.set({ q: null, section: null, subject: null, archived: null }); }}>Clear filters</Button>} />
          ) : (
            <EmptyState illustration="empty-generic" compact title="No study materials yet" description="Share a worksheet, a revision note or a useful link with a class." action={can('materials:create') ? <Button size="sm" onClick={() => setCreating(true)} disabled={gate.readOnly}>Add material</Button> : undefined} />
          )
        }
      />

      <CreateDrawer open={creating} onOpenChange={setCreating} pairs={teaching.pairs} loadingPairs={teaching.isPending} />
      <EditDialog item={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive “${archiving?.title ?? ''}”?`}
        description="Students and parents will no longer see it. It stays in the school’s records."
        confirmLabel="Archive"
        destructive
        loading={archive.isPending}
        onConfirm={() => {
          if (!archiving) return;
          archive.mutate(archiving.id, {
            onSuccess: () => {
              toast.success('Material archived');
              setArchiving(null);
            },
            onError: (e) => {
              toast.error(teacherError(e), { duration: 8000 });
              setArchiving(null);
            },
          });
        }}
      />
    </>
  );
}

/* ───────────────────────── create ───────────────────────── */

function CreateDrawer({ open, onOpenChange, pairs, loadingPairs }: { open: boolean; onOpenChange: (o: boolean) => void; pairs: TeachPair[]; loadingPairs: boolean }) {
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Discard this material?', description: 'What you entered has not been saved.', confirmLabel: 'Discard' });
  const close = () => {
    setDirty(false);
    onOpenChange(false);
  };
  return (
    <>
      <Drawer open={open} onOpenChange={(o) => !o && guard(close)}>
        <DrawerContent title="Add a study material" description="Share a link or a file with a class" showTitle>
          {open && <CreateForm pairs={pairs} loadingPairs={loadingPairs} onDirty={setDirty} onClose={close} onCancel={() => guard(close)} />}
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}

function CreateForm({ pairs, loadingPairs, onDirty, onClose, onCancel }: { pairs: TeachPair[]; loadingPairs: boolean; onDirty: (d: boolean) => void; onClose: () => void; onCancel: () => void }) {
  const form = useZodForm(materialCreateBody, { defaultValues: { title: '', description: '', sectionId: null, gradeId: null, fileId: null, url: null } });
  const create = useCreateMaterial();
  const gate = useWriteGate();
  const [pairKey, setPairKey] = React.useState('');
  const [wholeGrade, setWholeGrade] = React.useState(false);
  const [source, setSource] = React.useState<'link' | 'file'>('link');
  const [files, setFiles] = React.useState<LearningAttachmentRef[]>([]);
  const [formError, setFormError] = React.useState<string | null>(null);
  const dirty = form.formState.isDirty || !!pairKey || files.length > 0;
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const errors = form.formState.errors;

  const apply = (key: string, whole: boolean) => {
    const p = pairs.find((x) => `${x.sectionId}:${x.subjectId}` === key);
    form.setValue('subjectId', (p?.subjectId ?? '') as string, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    form.setValue('sectionId', whole ? null : (p?.sectionId ?? null), { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    form.setValue('gradeId', whole ? (p?.gradeId ?? null) : null, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  };

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await create.mutateAsync({ ...v, description: v.description?.trim() || null, url: source === 'link' ? v.url : null, fileId: source === 'file' ? v.fileId : null });
      toast.success('Material added', { description: wholeGrade ? 'Every class of the grade can see it now.' : 'The class can see it now.' });
      onClose();
    } catch (e) {
      setFormError(applyApiErrors(form, e) ?? teacherError(e));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="flex-1 space-y-5">
        <FormInput control={form.control} name="title" label="Title" required maxLength={200} placeholder="e.g. Chapter 4 revision notes" />
        <FormTextarea control={form.control} name="description" label="Description" rows={3} maxLength={2000} hint="Optional. A line about what it covers." />

        <Field label="Class and subject" htmlFor="material-pair" required error={errors.subjectId || errors.sectionId ? 'Choose the class and subject this is for.' : null} hint={pairs.some((p) => p.via === 'lead') ? 'As class teacher you can share for any subject of the class you lead.' : undefined}>
          <Select
            id="material-pair"
            value={pairKey || undefined}
            placeholder={loadingPairs ? 'Loading…' : 'Choose class and subject'}
            invalid={!!(errors.subjectId || errors.sectionId)}
            onValueChange={(v) => {
              setPairKey(v);
              apply(v, wholeGrade);
            }}
            options={pairs.map((p) => ({ value: `${p.sectionId}:${p.subjectId}`, label: p.via === 'lead' ? `${p.label} (class teacher)` : p.label }))}
          />
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={wholeGrade}
            disabled={!pairKey}
            onCheckedChange={(v) => {
              setWholeGrade(v === true);
              apply(pairKey, v === true);
            }}
          />
          <span>
            Share with every class of this grade
            <span className="t-caption block text-ink-3">Otherwise only the chosen class sees it. You must teach the subject in that grade.</span>
          </span>
        </label>

        <div className="space-y-3">
          <div role="radiogroup" aria-label="What are you sharing" className="inline-flex rounded-md border border-border bg-surface-subtle p-0.5">
            {(['link', 'file'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={source === s}
                onClick={() => setSource(s)}
                className={cn('tr-colors inline-flex h-9 items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium', source === s ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]' : 'text-ink-2 hover:text-ink')}
              >
                {s === 'link' ? <Link2 className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                {s === 'link' ? 'A link' : 'A file'}
              </button>
            ))}
          </div>
          {source === 'link' ? (
            <Controller
              control={form.control}
              name="url"
              render={({ field, fieldState }) => (
                <Field label="Link" htmlFor="material-url" required error={fieldState.error?.message ?? null} hint="Starts with https://">
                  <Input id="material-url" type="url" inputMode="url" placeholder="https://" value={field.value ?? ''} onBlur={field.onBlur} onChange={(e) => field.onChange(e.target.value.trim() === '' ? null : e.target.value)} invalid={!!fieldState.error} />
                </Field>
              )}
            />
          ) : (
            <div>
              <AttachmentPicker
                label="File"
                purpose="material"
                max={1}
                value={files}
                onChange={(v) => {
                  setFiles(v);
                  form.setValue('fileId', v[0]?.fileId ?? null, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
                }}
                hint="Documents, images and PDFs up to 10 MB."
              />
              {errors.url && !files.length && <p role="alert" className="t-caption mt-1 text-danger">Add a file or switch to a link.</p>}
            </div>
          )}
        </div>
        {formError && <Banner tone="danger">{formError}</Banner>}
        {gate.readOnly && <Banner tone="locked">{gate.reason}</Banner>}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} disabled={gate.readOnly}>
          Add material
        </Button>
      </SheetFooter>
    </form>
  );
}

/* ───────────────────────── edit ───────────────────────── */

function EditDialog({ item, onClose }: { item: MaterialItem | null; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      {item && <EditForm key={item.id} item={item} onClose={onClose} />}
    </Dialog>
  );
}

function EditForm({ item, onClose }: { item: MaterialItem; onClose: () => void }) {
  const form = useZodForm(materialUpdateBody, { defaultValues: { title: item.title, description: item.description ?? '', url: item.url } });
  const update = useUpdateMaterial();
  const gate = useWriteGate();
  const [formError, setFormError] = React.useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await update.mutateAsync({ id: item.id, body: { title: v.title, description: v.description?.trim() ? v.description : null, ...(item.url ? { url: v.url } : {}) } });
      toast.success('Material updated');
      onClose();
    } catch (e) {
      setFormError(applyApiErrors(form, e) ?? teacherError(e));
    }
  });
  return (
    <DialogContent title="Edit material" description={`${item.subjectName} · ${item.sectionName ? sectionLabelOf(item) : `every class of ${item.gradeName ?? 'the grade'}`}`} size="md">
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <FormInput control={form.control} name="title" label="Title" required maxLength={200} />
        <FormTextarea control={form.control} name="description" label="Description" rows={3} maxLength={2000} />
        {item.url && (
          <Controller
            control={form.control}
            name="url"
            render={({ field, fieldState }) => (
              <Field label="Link" htmlFor="edit-material-url" required error={fieldState.error?.message ?? null}>
                <Input id="edit-material-url" type="url" inputMode="url" value={field.value ?? ''} onBlur={field.onBlur} onChange={(e) => field.onChange(e.target.value)} invalid={!!fieldState.error} />
              </Field>
            )}
          />
        )}
        {item.fileId && <p className="t-caption text-ink-2">The attached file can’t be replaced. Archive this material and add a new one instead.</p>}
        {formError && <Banner tone="danger">{formError}</Banner>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting} disabled={gate.readOnly || !form.formState.isDirty}>
            Save changes
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

const sectionLabelOf = (m: MaterialItem) => `${m.gradeName ?? ''} ${m.sectionName ?? ''}`.trim();
