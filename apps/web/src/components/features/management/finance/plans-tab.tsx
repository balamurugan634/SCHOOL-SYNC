'use client';

import * as React from 'react';
import { Plus, Trash2, UsersRound } from 'lucide-react';
import type { PlanOut } from '@school-sync/shared';
import { useBulkPlans, useCreatePlan, useDeletePlan, usePlans, useStructures, type PlanBulkResult } from '@/lib/client/finance';
import { friendlyError, useGradeList, useSectionList } from '@/lib/client/mgmt';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Textarea } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { AsyncConfirm } from '../common/dialogs';
import { ClearFilters, FilterBar, FilterChips, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { StudentPicker, type PickerOption } from '../common/picker';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

export function PlansTab() {
  const { writeBlock } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const structureId = ls.get('structure');
  const sectionId = ls.get('section');
  const structures = useStructures({ pageSize: 100 });
  const sections = useSectionList();
  const q = usePlans({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, structureId: structureId || undefined, sectionId: sectionId || undefined });
  const [assign, setAssign] = React.useState(false);
  const [bulk, setBulk] = React.useState(false);
  const [remove, setRemove] = React.useState<PlanOut | null>(null);
  const del = useDeletePlan();
  const createBlock = writeBlock('fees:create');
  const editBlock = writeBlock('fees:edit');
  const filtered = ls.hasFilters(['structure', 'section']);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">A plan ties a student to one fee structure for the year. Dues are generated from plans, so a student without a plan is never billed.</p>
        <div className="flex flex-wrap gap-2">
          <GuardedButton blocked={createBlock} variant="secondary" onClick={() => setBulk(true)}>
            <UsersRound /> Assign to a class
          </GuardedButton>
          <GuardedButton blocked={createBlock} onClick={() => setAssign(true)}>
            <Plus /> Assign to a student
          </GuardedButton>
        </div>
      </div>
      <DataTable<PlanOut>
        id="fees-plans"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        caption="Student fee plans"
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        filters={
          <FilterBar>
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search student" />
            <FilterSelect label="Structure" className="w-56" value={structureId} onChange={(v) => ls.set({ structure: v })} options={(structures.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
            <FilterSelect label="Class" value={sectionId} onChange={(v) => ls.set({ section: v })} options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.gradeName} ${s.name}` }))} />
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState
              illustration="no-results"
              title="No plans match"
              filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(structureId ? [{ label: 'Structure', value: structures.data?.data.find((s) => s.id === structureId)?.name ?? '…' }] : []), ...(sectionId ? [{ label: 'Class', value: (() => { const s = sections.data?.find((x) => x.id === sectionId); return s ? `${s.gradeName} ${s.name}` : '…'; })() }] : [])]} />}
              action={<ClearFilters onClear={() => ls.clear()} />}
            />
          ) : (
            <EmptyState illustration="empty-generic" title="No student has a fee plan yet" description="Assign a fee structure to a whole class at once, or to one student." action={<GuardedButton blocked={createBlock} onClick={() => setBulk(true)}>Assign to a class</GuardedButton>} />
          )
        }
        columns={[
          { id: 'student', header: 'Student', cell: (r) => <span className="font-medium">{r.studentName}</span>, sortable: true, sortValue: (r) => r.studentName, mobile: 'title' },
          { id: 'adm', header: 'Admission no.', cell: (r) => <span className="tabular-nums">{r.admissionNo}</span>, mobile: 'sub' },
          { id: 'class', header: 'Class', cell: (r) => [r.gradeName, r.sectionName].filter(Boolean).join(' ') || '—', mobile: 'detail' },
          { id: 'structure', header: 'Fee structure', cell: (r) => r.structureName, sortable: true, sortValue: (r) => r.structureName, mobile: 'detail' },
          { id: 'invoices', header: 'Invoices', cell: (r) => r.invoiceCount, align: 'right', sortable: true, sortValue: (r) => r.invoiceCount, mobile: 'value', label: 'Invoices' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            label: 'Actions',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) => (
              <IconButton label={`Remove plan for ${r.studentName}`} size="icon-sm" disabled={!!editBlock || r.invoiceCount > 0} onClick={() => setRemove(r)}>
                <Trash2 />
              </IconButton>
            ),
          },
        ]}
      />
      <AssignDialog open={assign} onClose={() => setAssign(false)} />
      <BulkDialog open={bulk} onClose={() => setBulk(false)} />
      <AsyncConfirm
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title={`Remove the plan for ${remove?.studentName ?? ''}?`}
        description={`${remove?.structureName ?? 'The structure'} is unassigned from this student and no further dues are generated for them. A plan that already has invoices cannot be removed.`}
        confirmLabel="Remove plan"
        destructive
        onConfirm={async () => {
          if (!remove) return;
          await del.mutateAsync({ id: remove.id });
          toast.success('Plan removed');
        }}
      />
    </div>
  );
}

function useActiveStructureOptions(enabled: boolean) {
  const s = useStructures({ pageSize: 100, active: 'true' }, enabled);
  return { query: s, options: (s.data?.data ?? []).map((x) => ({ value: x.id, label: `${x.name}${x.gradeName ? '' : ' (all grades)'}` })) };
}

function AssignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreatePlan();
  const { query, options } = useActiveStructureOptions(open);
  const [student, setStudent] = React.useState<PickerOption | null>(null);
  const [structureId, setStructureId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setStudent(null);
      setStructureId('');
      setNotes('');
      setErr(null);
      setTried(false);
    }
  }, [open]);
  const submit = async () => {
    setTried(true);
    if (!student || !structureId) return;
    setErr(null);
    try {
      await create.mutateAsync({ studentId: student.value, structureId, notes: notes.trim() || undefined });
      toast.success('Plan assigned', { description: `${student.label} now has a fee plan.` });
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Assign a fee structure to a student" description="A student has one plan per academic year.">
        <div className="mt-4 space-y-4">
          <Field label="Student" required error={tried && !student ? 'Choose a student' : null}>
            <StudentPicker selected={student} onSelect={setStudent} invalid={tried && !student} />
          </Field>
          <Field label="Fee structure" required error={tried && !structureId ? 'Choose a fee structure' : null}>
            <Select value={structureId} onValueChange={setStructureId} options={options} placeholder={query.isPending ? 'Loading…' : 'Choose a structure'} invalid={tried && !structureId} />
          </Field>
          <Field label="Notes" hint="Optional, visible to the accounts team.">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={300} />
          </Field>
          {err && <Banner tone="danger">{err}</Banner>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={create.isPending} onClick={() => void submit()}>
              Assign plan
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SCOPES = [
  { value: 'grade', label: 'Every student of a grade' },
  { value: 'section', label: 'Every student of a class (section)' },
];

function BulkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const bulk = useBulkPlans();
  const { query, options } = useActiveStructureOptions(open);
  const grades = useGradeList(open);
  const sections = useSectionList(null, open);
  const [structureId, setStructureId] = React.useState('');
  const [scope, setScope] = React.useState<'grade' | 'section'>('grade');
  const [target, setTarget] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  const [result, setResult] = React.useState<PlanBulkResult | null>(null);
  React.useEffect(() => {
    if (open) {
      setStructureId('');
      setScope('grade');
      setTarget('');
      setErr(null);
      setTried(false);
      setResult(null);
    }
  }, [open]);
  const targetLabel = scope === 'grade' ? grades.data?.find((g) => g.id === target)?.name : (() => { const s = sections.data?.find((x) => x.id === target); return s ? `${s.gradeName} ${s.name}` : undefined; })();
  const submit = async () => {
    setTried(true);
    if (!structureId || !target) return;
    setErr(null);
    try {
      const r = await bulk.mutateAsync({ structureId, ...(scope === 'grade' ? { gradeId: target } : { sectionId: target }) });
      setResult(r);
      toast.success(`${r.assigned} plan${r.assigned === 1 ? '' : 's'} assigned`);
    } catch (e) {
      setErr(friendlyError(e));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Assign a fee structure to a class" description="Students who already have a plan this year are skipped.">
        {result ? (
          <div className="mt-4 space-y-4">
            <Banner tone="success" title="Done">
              {result.assigned} assigned · {result.alreadyAssigned} already had a plan · {result.notEligible} not eligible (not an active student).
            </Banner>
            <div className="flex justify-end">
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <Field label="Fee structure" required error={tried && !structureId ? 'Choose a fee structure' : null}>
              <Select value={structureId} onValueChange={setStructureId} options={options} placeholder={query.isPending ? 'Loading…' : 'Choose a structure'} invalid={tried && !structureId} />
            </Field>
            <Field label="Who gets it">
              <Select
                value={scope}
                onValueChange={(v) => {
                  setScope(v as 'grade' | 'section');
                  setTarget('');
                }}
                options={SCOPES}
              />
            </Field>
            <Field label={scope === 'grade' ? 'Grade' : 'Class'} required error={tried && !target ? `Choose a ${scope === 'grade' ? 'grade' : 'class'}` : null}>
              <Select value={target} onValueChange={setTarget} placeholder="Choose" invalid={tried && !target} options={scope === 'grade' ? (grades.data ?? []).map((g) => ({ value: g.id, label: g.name })) : (sections.data ?? []).map((s) => ({ value: s.id, label: `${s.gradeName} ${s.name}` }))} />
            </Field>
            {structureId && target && (
              <p className="rounded-md bg-surface-subtle p-3 text-sm text-ink-2">
                This assigns <span className="font-medium text-ink">{options.find((o) => o.value === structureId)?.label}</span> to every active student of <span className="font-medium text-ink">{targetLabel ?? 'the selection'}</span> who does not have a plan yet.
              </p>
            )}
            {err && <Banner tone="danger">{err}</Banner>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button loading={bulk.isPending} onClick={() => void submit()}>
                Assign plans
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

