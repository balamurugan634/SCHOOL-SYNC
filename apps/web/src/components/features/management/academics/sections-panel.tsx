'use client';

import * as React from 'react';
import Link from 'next/link';
import { Clock, ListChecks, MoreHorizontal, Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FormInput, FormSelect } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { ProgressBar } from '@/components/ui/progress';
import { StatTile } from '@/components/ui/stat-tile';
import { useOverview, useSectionMutations, useSections, type SectionOut } from '@/lib/client/academics';
import { gradeOptions, useCurrentYear, useGradeList, useStaffPicker, useYearList, yearOptions } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { paths } from '../shared/paths';
import { FormNumber } from './fields';
import { DialogButtons, FormBanner, ModalForm } from './form-shell';
import { sectionCreateSchema } from './schemas';
import { SectionDrawer } from './section-drawer';

export function SectionsPanel() {
  const access = useAccess();
  const [p, set, reset] = useUrlState({ year: '', grade: '', q: '', page: 1, size: 25 });
  const years = useYearList();
  const grades = useGradeList();
  const cur = useCurrentYear();
  const overview = useOverview();
  const q = useSections({ yearId: p.year || undefined, gradeId: p.grade || undefined, q: p.q || undefined, page: p.page, pageSize: p.size });
  const m = useSectionMutations();
  const [open, setOpen] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [removing, setRemoving] = React.useState<SectionOut | null>(null);

  const yearName = years.data?.find((y) => y.id === p.year)?.name;
  const gradeName = grades.data?.find((g) => g.id === p.grade)?.name;
  const filtered = !!(p.year || p.grade || p.q);
  const openSection = q.data?.data.find((s) => s.id === open) ?? null;
  const viewingCurrent = !p.year || p.year === cur.current?.id;

  return (
    <div className="space-y-4">
      {viewingCurrent && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Current year at a glance">
          <StatTile label="Sections" value={overview.data?.counts.sections} state={overview.isPending ? 'loading' : 'ready'} hint={cur.current?.name} />
          <StatTile label="Without a class teacher" value={overview.data?.counts.sectionsWithoutClassTeacher} state={overview.isPending ? 'loading' : 'ready'} hint={overview.data && overview.data.counts.sectionsWithoutClassTeacher > 0 ? 'Needs attention' : 'All covered'} />
          <StatTile label="Students" value={overview.data?.counts.students} state={overview.isPending ? 'loading' : 'ready'} />
          <StatTile label="Grades" value={overview.data?.counts.grades} state={overview.isPending ? 'loading' : 'ready'} />
        </div>
      )}

      <DataTable
        id="academics-sections"
        caption="Sections"
        rows={q.data?.data}
        rowKey={(s) => s.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        page={p.page}
        pageSize={p.size}
        total={q.data?.meta.total}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(size) => set({ size, page: 1 })}
        onRowClick={(s) => setOpen(s.id)}
        activeRowKey={open}
        filters={
          <>
            <SearchBox value={p.q} onChange={(v) => set({ q: v })} placeholder="Search sections" />
            <FilterSelect label="Academic year" value={p.year} onChange={(v) => set({ year: v })} options={yearOptions(years.data)} allLabel="Current year" />
            <FilterSelect label="Grade" value={p.grade} onChange={(v) => set({ grade: v })} options={gradeOptions(grades.data)} allLabel="All grades" />
            {p.year && yearName && <FilterChip label={yearName} onRemove={() => set({ year: '' })} />}
            {p.grade && gradeName && <FilterChip label={gradeName} onRemove={() => set({ grade: '' })} />}
            {filtered && <ClearFiltersButton onClick={() => reset(['year', 'grade', 'q', 'page'])} />}
          </>
        }
        toolbar={
          <Button onClick={() => setCreating(true)} disabled={!access.ok('academics:create')} title={access.hint('academics:create')}>
            <Plus /> Add section
          </Button>
        }
        columns={[
          { id: 'name', header: 'Class', hideable: false, cell: (s) => <span className="font-medium">{s.gradeName} {s.name}</span>, sortable: true, sortValue: (s) => s.gradeOrdinal * 1000 + s.name.charCodeAt(0), mobile: 'title' },
          { id: 'teacher', header: 'Class teacher', cell: (s) => (s.classTeacherName ? s.classTeacherName : <Badge variant="warning">Not assigned</Badge>), sortable: true, sortValue: (s) => s.classTeacherName ?? '', mobile: 'sub' },
          { id: 'room', header: 'Room', cell: (s) => s.room ?? <span className="text-ink-3">—</span>, mobile: 'detail', label: 'Room' },
          {
            id: 'students',
            header: 'Students',
            label: 'Students',
            align: 'right',
            sortable: true,
            sortValue: (s) => s.studentCount,
            mobile: 'value',
            cell: (s) => (
              <span className="inline-flex items-center justify-end gap-2.5">
                <span className="tnum">
                  {s.studentCount}
                  {s.capacity ? <span className="text-ink-3"> / {s.capacity}</span> : null}
                </span>
                {s.capacity ? <ProgressBar value={s.studentCount} max={s.capacity} tone={s.studentCount > s.capacity ? 'danger' : s.studentCount >= s.capacity ? 'warning' : 'brand'} label={`${s.gradeName} ${s.name} seats filled`} className="hidden w-16 lg:block" /> : null}
              </span>
            ),
          },
          { id: 'year', header: 'Year', cell: (s) => s.academicYearName, defaultHidden: !p.year, mobile: 'hide' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (s) => (
              <span onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label={`Actions for ${s.gradeName} ${s.name}`} size="icon-sm" type="button">
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setOpen(s.id)}>
                      <Pencil /> Edit and class teacher
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={paths.assignments(s.id)}>
                        <ListChecks /> Subject teachers
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={paths.timetable(s.id)}>
                        <Clock /> Timetable
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={paths.students({ sectionId: s.id })}>
                        <UsersRound /> Students
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger disabled={!access.ok('academics:delete')} onSelect={() => setRemoving(s)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            ),
          },
        ]}
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No sections match" description="Try another grade or year, or clear the search." filters={<>{p.q && <FilterChip label={`“${p.q}”`} onRemove={() => set({ q: '' })} />}{gradeName && <FilterChip label={gradeName} onRemove={() => set({ grade: '' })} />}</>} action={<ClearFiltersButton onClick={() => reset(['year', 'grade', 'q', 'page'])} />} compact />
          ) : (
            <EmptyState illustration="first-use" title="No sections yet" description="Add the sections of each grade (6-A, 6-B …), or copy last year’s sections from Academic years." compact action={access.ok('academics:create') ? <Button size="sm" onClick={() => setCreating(true)}>Add section</Button> : undefined} />
          )
        }
      />

      {creating && <SectionCreateDialog defaultYearId={p.year || cur.current?.id} onClose={() => setCreating(false)} />}
      {openSection && <SectionDrawer section={openSection} onClose={() => setOpen(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Delete ${removing.gradeName} ${removing.name}?` : ''}
        description={
          <div className="space-y-2">
            <p>This removes the section with its subject teachers and timetable. A section that has enrolled students cannot be deleted; move the students out first.</p>
            <p>This cannot be undone.</p>
          </div>
        }
        confirmLabel="Delete section"
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

function SectionCreateDialog({ defaultYearId, onClose }: { defaultYearId?: string; onClose: () => void }) {
  const m = useSectionMutations();
  const grades = useGradeList();
  const years = useYearList();
  const staff = useStaffPicker();
  const access = useAccess();
  const form = useZodForm(sectionCreateSchema, { defaultValues: { gradeId: '', academicYearId: defaultYearId, name: '', room: '', classTeacherId: undefined } });
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <ModalForm title="Add section" description="A section belongs to one grade and one academic year." dirty={hasDirtyFields(form.formState)} onClose={onClose}>
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          setErr(null);
          try {
            await m.create.mutateAsync({ ...v, room: v.room || null });
            onClose();
          } catch (e) {
            setErr(applyApiErrors(form, e));
          }
        })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormSelect
            control={form.control}
            name="gradeId"
            label="Grade"
            required
            options={gradeOptions(grades.data?.filter((g) => g.isActive))}
            placeholder="Choose a grade"
            hint={
              <>
                Only active grades are listed.{' '}
                {access.ok('academics:create') ? (
                  <Link href={`${paths.classes}?tab=grades`} className="font-medium text-brand-ink underline underline-offset-4">Add or reactivate a grade</Link>
                ) : (
                  'Ask an administrator to add a missing grade.'
                )}
              </>
            }
          />
          <FormSelect control={form.control} name="academicYearId" label="Academic year" options={yearOptions(years.data)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormInput control={form.control} name="name" label="Section name" required hint="A, B, Blue…" />
          <FormInput control={form.control} name="room" label="Room" />
          <FormNumber control={form.control} name="capacity" label="Capacity" min={1} max={500} hint="Seats" />
        </div>
        <FormSelect control={form.control} name="classTeacherId" label="Class teacher" options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder={staff.isPending ? 'Loading staff…' : 'Choose later'} hint={staff.isError ? 'The staff list could not be loaded; you can assign a class teacher afterwards.' : 'Only active staff with a login can lead a class.'} />
        <FormBanner message={err} />
        <DialogButtons onCancel={onClose} submitLabel="Add section" loading={form.formState.isSubmitting} />
      </form>
    </ModalForm>
  );
}
