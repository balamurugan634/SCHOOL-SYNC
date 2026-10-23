'use client';

import * as React from 'react';
import { Archive, BookUp, Pencil, Plus } from 'lucide-react';
import { z } from 'zod';
import { libraryBookCreateBody, type LibraryBook } from '@school-sync/shared';
import { useArchiveBook, useBookCategories, useBooks, useCreateBook, useUpdateBook } from '@/lib/client/operations';
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
import { AsyncConfirm } from '../common/dialogs';
import { ClearFilters, FilterBar, FilterChips, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

export function CatalogueTab({ onIssue }: { onIssue: (book: LibraryBook) => void }) {
  const { writeBlock, can } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const category = ls.get('category');
  const availableOnly = ls.get('avail') === '1';
  const archived = ls.get('archived') === '1';
  const cats = useBookCategories();
  const q = useBooks({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, category: category || undefined, available: availableOnly ? 'true' : undefined, includeArchived: archived ? 'true' : undefined });
  const [edit, setEdit] = React.useState<LibraryBook | 'new' | null>(null);
  const [arch, setArch] = React.useState<LibraryBook | null>(null);
  const archive = useArchiveBook();
  const createBlock = writeBlock('library:create', 'school');
  const editBlock = writeBlock('library:edit', 'school');
  const filtered = !!ls.q || !!category || availableOnly || archived;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <GuardedButton blocked={createBlock} onClick={() => setEdit('new')}>
          <Plus /> Add book
        </GuardedButton>
      </div>
      <DataTable<LibraryBook>
        id="ops-books"
        caption="Library catalogue"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        filters={
          <FilterBar>
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Title, author, ISBN or accession no." className="w-full sm:w-72" />
            <FilterSelect label="Category" value={category} onChange={(v) => ls.set({ category: v })} options={(cats.data?.data ?? []).map((c) => ({ value: c, label: c }))} />
            <button type="button" aria-pressed={availableOnly} onClick={() => ls.set({ avail: availableOnly ? null : '1' })} className={`tr-colors inline-flex h-11 items-center rounded-md border px-3 text-[13px] font-medium sm:h-9 ${availableOnly ? 'border-brand bg-brand-soft text-brand-ink' : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-subtle'}`}>
              On the shelf only
            </button>
            {can('library:edit', 'school') && (
              <button type="button" aria-pressed={archived} onClick={() => ls.set({ archived: archived ? null : '1' })} className={`tr-colors inline-flex h-11 items-center rounded-md border px-3 text-[13px] font-medium sm:h-9 ${archived ? 'border-brand bg-brand-soft text-brand-ink' : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-subtle'}`}>
                Include archived
              </button>
            )}
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No books match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(category ? [{ label: 'Category', value: category }] : []), ...(availableOnly ? [{ label: 'Availability', value: 'on the shelf' }] : []), ...(archived ? [{ label: 'Archived', value: 'included' }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="The catalogue is empty" description="Add the first book to start lending." action={<GuardedButton blocked={createBlock} onClick={() => setEdit('new')}>Add book</GuardedButton>} />
          )
        }
        columns={[
          { id: 'title', header: 'Book', cell: (r) => (<><span className="block max-w-[40ch] truncate font-medium">{r.title}</span><span className="t-caption block text-ink-3">{r.author ?? 'Unknown author'}</span></>), sortable: true, sortValue: (r) => r.title, mobile: 'title' },
          { id: 'acc', header: 'Accession no.', cell: (r) => <span className="tnum">{r.accessionNo}</span>, sortable: true, sortValue: (r) => r.accessionNo, mobile: 'sub' },
          { id: 'cat', header: 'Category', cell: (r) => r.category ?? '—', mobile: 'detail', label: 'Category' },
          { id: 'shelf', header: 'Shelf', cell: (r) => r.shelf ?? '—', mobile: 'hide' },
          { id: 'isbn', header: 'ISBN', cell: (r) => r.isbn ?? '—', defaultHidden: true, mobile: 'hide' },
          { id: 'copies', header: 'On the shelf', cell: (r) => <span className="tnum">{r.availableCopies} of {r.totalCopies}</span>, align: 'right', sortable: true, sortValue: (r) => r.availableCopies, mobile: 'value' },
          { id: 'status', header: 'Status', cell: (r) => (r.archived ? <Badge variant="neutral">Archived</Badge> : r.available ? <Badge variant="success">Available</Badge> : <Badge variant="warning">All out</Badge>), mobile: 'status' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            label: 'Actions',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) =>
              r.archived ? null : (
                <div className="flex justify-end gap-1">
                  <IconButton label={`Issue ${r.title}`} size="icon-sm" disabled={!r.available || !!createBlock} onClick={() => onIssue(r)}>
                    <BookUp />
                  </IconButton>
                  <IconButton label={`Edit ${r.title}`} size="icon-sm" disabled={!!editBlock} onClick={() => setEdit(r)}>
                    <Pencil />
                  </IconButton>
                  <IconButton label={`Archive ${r.title}`} size="icon-sm" disabled={!!writeBlock('library:delete', 'school')} onClick={() => setArch(r)}>
                    <Archive />
                  </IconButton>
                </div>
              ),
          },
        ]}
      />
      <BookDialog target={edit} categories={cats.data?.data ?? []} onClose={() => setEdit(null)} />
      <AsyncConfirm
        open={!!arch}
        onOpenChange={(o) => !o && setArch(null)}
        title={`Archive “${arch?.title ?? ''}”?`}
        description="It leaves the catalogue and can no longer be issued. Loan history is kept. A book with a copy still out cannot be archived until it comes back."
        confirmLabel="Archive book"
        destructive
        onConfirm={async () => {
          if (!arch) return;
          await archive.mutateAsync({ id: arch.id });
          toast.success('Book archived');
        }}
      />
    </div>
  );
}

const bookForm = z.object({
  accessionNo: z.string().trim().min(1, 'Enter the accession number').max(40),
  title: z.string().trim().min(1, 'Enter the title').max(250),
  author: z.string().trim().max(200),
  publisher: z.string().trim().max(200),
  isbn: z.string().trim().max(20),
  category: z.string().trim().max(80),
  shelf: z.string().trim().max(40),
  totalCopies: z.string().regex(/^[1-9]\d{0,3}$/, 'Number of copies, 1 to 1000').refine((v) => Number(v) <= 1000, 'At most 1000 copies'),
});
const blank = { accessionNo: '', title: '', author: '', publisher: '', isbn: '', category: '', shelf: '', totalCopies: '1' };

function BookDialog({ target, categories, onClose }: { target: LibraryBook | 'new' | null; categories: string[]; onClose: () => void }) {
  const isNew = target === 'new';
  const create = useCreateBook();
  const update = useUpdateBook();
  const f = useZodForm(bookForm, { defaultValues: blank });
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!target) return;
    f.reset(target === 'new' ? blank : { accessionNo: target.accessionNo, title: target.title, author: target.author ?? '', publisher: target.publisher ?? '', isbn: target.isbn ?? '', category: target.category ?? '', shelf: target.shelf ?? '', totalCopies: String(target.totalCopies) });
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try {
      const body = { accessionNo: v.accessionNo, title: v.title, author: v.author || null, publisher: v.publisher || null, isbn: v.isbn || null, category: v.category || null, shelf: v.shelf || null, totalCopies: Number(v.totalCopies) };
      if (isNew) await create.mutateAsync(libraryBookCreateBody.parse(body));
      else if (target) await update.mutateAsync({ id: target.id, body });
      toast.success(isNew ? 'Book added' : 'Book updated');
      onClose();
    } catch (e) {
      setErr(applyApiErrors(f, e));
    }
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={isNew ? 'Add a book' : 'Edit book'} size="lg" description={!isNew ? 'Changing the number of copies changes the stock on the shelf by the same amount; it cannot go below the copies on loan.' : undefined}>
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <FormInput control={f.control} name="title" label="Title" required maxLength={250} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={f.control} name="author" label="Author" maxLength={200} />
            <FormInput control={f.control} name="publisher" label="Publisher" maxLength={200} />
            <FormInput control={f.control} name="accessionNo" label="Accession number" required maxLength={40} placeholder="LB-0151" />
            <FormInput control={f.control} name="isbn" label="ISBN" maxLength={20} />
            <FormInput control={f.control} name="category" label="Category" maxLength={80} list="library-categories" />
            <FormInput control={f.control} name="shelf" label="Shelf" maxLength={40} placeholder="F-3" />
            <FormInput control={f.control} name="totalCopies" label="Copies" required inputMode="numeric" maxLength={4} />
          </div>
          <datalist id="library-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {err && <Banner tone="danger">{err}</Banner>}
          <FormActions className="-mx-5 -mb-5 mt-2 border-t px-5">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {isNew ? 'Add book' : 'Save'}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
