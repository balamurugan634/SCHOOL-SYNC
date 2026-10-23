'use client';

import * as React from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { z } from 'zod';
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES, expenseCreateBody, type ExpenseOut } from '@school-sync/shared';
import { useCreateExpense, useDecideExpense, useDeleteExpense, useExpenses, useExpenseSummary, useUpdateExpense } from '@/lib/client/finance';
import { amountText, fileHref, minorToText, parseMinor, useGetQuery } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { useUrlState } from '@/lib/client/use-url-state';
import { fmtDate, fmtMonth, fmtMonthShort, percent, todayIso } from '@/lib/format';
import { PageHeader } from '@/components/shell/page-header';
import { BarSeries } from '@/components/charts/series-charts';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ChartCard } from '@/components/ui/chart';
import { DataTable } from '@/components/ui/data-table';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/input';
import { FormActions, FormDate, FormInput, FormSection, FormTextarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { AsyncConfirm, ReasonDialog } from '../common/dialogs';
import { ExportButton } from '../common/exports';
import { FileUploader, type UploadedFile } from '../common/file-uploader';
import { ClearFilters, FilterBar, FilterChips, FilterDate, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { ErrorPanel } from '../common/states';
import { useListState, useTabParam } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

const STATUS_LABEL: Record<string, string> = { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected' };

export function ExpensesPage() {
  const { base, can, writeBlock } = useMgmt();
  const pending = useExpenses({ status: 'pending', pageSize: 1, page: 1 });
  const tabs = [
    { value: 'expenses', label: 'All expenses' },
    { value: 'approvals', label: pending.data && pending.data.meta.total > 0 ? `Approval queue (${pending.data.meta.total})` : 'Approval queue' },
    { value: 'summary', label: 'Summary' },
  ];
  const [tab, setTab] = useTabParam(tabs.map((t) => t.value));
  const [creating, setCreating] = React.useState(false);
  return (
    <>
      <PageHeader
        title="Expenses"
        description="What the school spends, with receipts. Larger expenses wait for approval before they count."
        crumbs={[{ label: 'Finance', href: `${base}/finance` }, { label: 'Expenses' }]}
        actions={
          <GuardedButton blocked={writeBlock('expenses:create', 'school')} onClick={() => setCreating(true)}>
            <Plus /> New expense
          </GuardedButton>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Expense sections">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="expenses">
          <ExpenseList mode="all" onCreate={() => setCreating(true)} />
        </TabsContent>
        <TabsContent value="approvals">
          <ExpenseList mode="queue" onCreate={() => setCreating(true)} />
        </TabsContent>
        <TabsContent value="summary">
          <ExpenseSummaryTab />
        </TabsContent>
      </Tabs>
      <ExpenseFormDrawer target={creating ? 'new' : null} onClose={() => setCreating(false)} />
      {!can('expenses:create', 'school') && <p className="t-caption mt-6 text-ink-3">Your role can view expenses. Recording and approving them is done by the accounts team.</p>}
    </>
  );
}

// ── list / queue ────────────────────────────────────────────────────────────────────────────

function ExpenseList({ mode, onCreate }: { mode: 'all' | 'queue'; onCreate: () => void }) {
  const { writeBlock, money } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const url = useUrlState();
  const category = ls.get('category');
  const status = mode === 'queue' ? 'pending' : ls.get('estatus');
  const from = ls.get('from');
  const to = ls.get('to');
  const openId = ls.get('expense') || null;
  const query = { page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, category: category || undefined, status: status || undefined, from: from || undefined, to: to || undefined };
  const q = useExpenses(query);
  const [decide, setDecide] = React.useState<{ row: ExpenseOut; decision: 'approve' | 'reject' } | null>(null);
  const [edit, setEdit] = React.useState<ExpenseOut | null>(null);
  const decideMut = useDecideExpense();
  const approveBlock = writeBlock('expenses:approve', 'school');
  const filtered = ls.hasFilters(['category', 'estatus', 'from', 'to']);
  const inList = q.data?.data.find((r) => r.id === openId) ?? null;
  const one = useGetQuery<ExpenseOut>(['expenses', 'one', openId], openId && !inList && !q.isPending ? `/expenses/${openId}` : null);
  const open = inList ?? one.data ?? null;

  return (
    <div className="space-y-4">
      {mode === 'queue' && <p className="max-w-[66ch] text-sm text-ink-2">Expenses above the school’s approval threshold are held here. They only count towards spending once approved.</p>}
      <DataTable<ExpenseOut>
        id={mode === 'queue' ? 'expenses-queue' : 'expenses-all'}
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        caption={mode === 'queue' ? 'Expenses waiting for approval' : 'Expenses'}
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        onRowClick={(r) => url.set({ expense: r.id }, { resetPage: false })}
        activeRowKey={openId}
        filters={
          <FilterBar>
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search description or payee" />
            <FilterSelect label="Category" value={category} onChange={(v) => ls.set({ category: v })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            {mode === 'all' && <FilterSelect label="Status" value={status} onChange={(v) => ls.set({ estatus: v })} options={EXPENSE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }))} />}
            <FilterDate label="Spent from" value={from} onChange={(v) => ls.set({ from: v })} max={to || undefined} />
            <FilterDate label="Spent to" value={to} onChange={(v) => ls.set({ to: v })} min={from || undefined} />
          </FilterBar>
        }
        toolbar={<ExportButton path="/expenses/export" query={{ q: query.q, category: query.category, status: query.status, from: query.from, to: query.to }} filename="expenses.csv" perm="expenses:export" />}
        empty={
          filtered ? (
            <EmptyState
              illustration="no-results"
              title="No expenses match"
              filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(category ? [{ label: 'Category', value: category }] : []), ...(mode === 'all' && status ? [{ label: 'Status', value: STATUS_LABEL[status] ?? status }] : []), ...(from ? [{ label: 'From', value: fmtDate(from) }] : []), ...(to ? [{ label: 'To', value: fmtDate(to) }] : [])]} />}
              action={<ClearFilters onClear={() => ls.clear()} />}
            />
          ) : mode === 'queue' ? (
            <EmptyState illustration="success" title="Nothing is waiting for approval" description="New expenses above the approval threshold will show up here." />
          ) : (
            <EmptyState illustration="empty-generic" title="No expenses recorded yet" description="Record what the school spends, with the bill attached." action={<GuardedButton blocked={writeBlock('expenses:create', 'school')} onClick={onCreate}>New expense</GuardedButton>} />
          )
        }
        columns={[
          { id: 'desc', header: 'Expense', cell: (r) => (<><span className="block max-w-[36ch] truncate font-medium">{r.description}</span><span className="t-caption block text-ink-3">{r.category}{r.paidTo ? ` · ${r.paidTo}` : ''}</span></>), mobile: 'title' },
          { id: 'date', header: 'Spent on', cell: (r) => fmtDate(r.spentOn), sortable: true, sortValue: (r) => r.spentOn, mobile: 'sub' },
          { id: 'amount', header: 'Amount', cell: (r) => <span className="font-medium">{money(r.amountMinor)}</span>, align: 'right', sortable: true, sortValue: (r) => r.amountMinor, mobile: 'value' },
          { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
          { id: 'by', header: 'Recorded by', cell: (r) => r.createdByName ?? '—', defaultHidden: true, mobile: 'hide' },
          {
            id: 'actions',
            header: <span className="sr-only">Decide</span>,
            label: 'Decide',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) =>
              r.status === 'pending' ? (
                <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <GuardedButton blocked={approveBlock} size="sm" variant="secondary" onClick={() => setDecide({ row: r, decision: 'approve' })}>
                    <Check /> Approve
                  </GuardedButton>
                  <GuardedButton blocked={approveBlock} size="sm" variant="danger" onClick={() => setDecide({ row: r, decision: 'reject' })}>
                    <X /> Reject
                  </GuardedButton>
                </div>
              ) : null,
          },
        ]}
      />
      <ExpenseDetailDrawer expense={open} loading={!!openId && (q.isPending || one.isPending) && !one.isError} onClose={() => url.set({ expense: null }, { resetPage: false })} onEdit={(e) => setEdit(e)} onDecide={(row, decision) => setDecide({ row, decision })} />
      <ExpenseFormDrawer target={edit} onClose={() => setEdit(null)} />
      <ReasonDialog
        open={!!decide}
        onOpenChange={(o) => !o && setDecide(null)}
        title={decide?.decision === 'approve' ? 'Approve this expense?' : 'Reject this expense?'}
        description={
          decide?.decision === 'approve' ? (
            <>
              {money(decide.row.amountMinor)} for “{decide.row.description}” will count as spent in the finance summary and reports.
            </>
          ) : (
            <>“{decide?.row.description}” will not count towards spending. {decide?.row.createdByName ?? 'The person who recorded it'} can edit and resubmit it.</>
          )
        }
        label="Note"
        hint="Optional."
        required={false}
        confirmLabel={decide?.decision === 'approve' ? 'Approve expense' : 'Reject expense'}
        destructive={decide?.decision === 'reject'}
        onConfirm={async (note) => {
          if (!decide) return;
          await decideMut.mutateAsync({ id: decide.row.id, decision: decide.decision, note });
          toast.success(decide.decision === 'approve' ? 'Expense approved' : 'Expense rejected');
        }}
      />
    </div>
  );
}

// ── detail ──────────────────────────────────────────────────────────────────────────────────

function ExpenseDetailDrawer({ expense, loading, onClose, onEdit, onDecide }: { expense: ExpenseOut | null; loading: boolean; onClose: () => void; onEdit: (e: ExpenseOut) => void; onDecide: (e: ExpenseOut, d: 'approve' | 'reject') => void }) {
  const { money, writeBlock } = useMgmt();
  const [del, setDel] = React.useState(false);
  const delMut = useDeleteExpense();
  const e = expense;
  return (
    <>
      <Drawer open={!!e || loading} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent title={e?.description ?? 'Expense'} description={e ? `${e.category} · ${fmtDate(e.spentOn)}` : undefined} showTitle>
          {!e ? (
            <SheetBody aria-busy>
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-32 w-full" />
            </SheetBody>
          ) : (
            <>
              <SheetBody>
                <div className="flex items-center justify-between gap-2">
                  <p className="figure text-[28px] leading-9">{money(e.amountMinor)}</p>
                  <StatusChip status={e.status} />
                </div>
                {e.status === 'pending' && <Banner tone="warning">Waiting for approval. It does not count towards spending yet.</Banner>}
                {e.status === 'rejected' && <Banner tone="danger">Rejected. Editing and saving it sends it for approval again.</Banner>}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-border p-4 text-sm">
                  <Info label="Category" value={e.category} />
                  <Info label="Spent on" value={fmtDate(e.spentOn)} />
                  <Info label="Paid to" value={e.paidTo ?? '—'} />
                  <Info label="Reference" value={e.reference ?? '—'} />
                  <Info label="Recorded by" value={e.createdByName ?? '—'} />
                  <Info label="Decided by" value={e.approvedByName ?? '—'} />
                </dl>
                <section aria-labelledby="ex-rc">
                  <h3 id="ex-rc" className="t-section mb-2">
                    Bill or receipt
                  </h3>
                  {e.receiptFileId ? (
                    <Button asChild variant="secondary" size="sm">
                      <a href={fileHref(e.receiptFileId)} target="_blank" rel="noreferrer">
                        Open the attached receipt
                      </a>
                    </Button>
                  ) : (
                    <p className="text-sm text-ink-2">No receipt was attached.</p>
                  )}
                </section>
              </SheetBody>
              <SheetFooter>
                <GuardedButton blocked={writeBlock('expenses:delete', 'school')} variant="danger" onClick={() => setDel(true)}>
                  <Trash2 /> Delete
                </GuardedButton>
                <GuardedButton blocked={writeBlock('expenses:edit', 'school')} variant="secondary" onClick={() => onEdit(e)}>
                  <Pencil /> Edit
                </GuardedButton>
                {e.status === 'pending' && (
                  <>
                    <GuardedButton blocked={writeBlock('expenses:approve', 'school')} variant="secondary" onClick={() => onDecide(e, 'reject')}>
                      Reject
                    </GuardedButton>
                    <GuardedButton blocked={writeBlock('expenses:approve', 'school')} onClick={() => onDecide(e, 'approve')}>
                      Approve
                    </GuardedButton>
                  </>
                )}
              </SheetFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
      <AsyncConfirm
        open={del}
        onOpenChange={setDel}
        title="Delete this expense?"
        description={
          <>
            {e ? `“${e.description}” (${money(e.amountMinor)})` : 'This expense'} is removed from the totals and reports. A snapshot is kept in the audit log, but the record cannot be restored.
          </>
        }
        confirmLabel="Delete expense"
        destructive
        onConfirm={async () => {
          if (!e) return;
          await delMut.mutateAsync({ id: e.id });
          toast.success('Expense deleted');
          onClose();
        }}
      />
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="t-caption text-ink-2">{label}</dt>
      <dd className="mt-0.5 truncate">{value}</dd>
    </div>
  );
}

// ── create / edit ───────────────────────────────────────────────────────────────────────────

const form = z.object({
  category: z.string().trim().min(2, 'Choose or type a category').max(60),
  description: z.string().trim().min(2, 'Describe what it was for (at least 2 characters)').max(300),
  amount: amountText('the amount'),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date it was spent'),
  paidTo: z.string().trim().max(120),
  reference: z.string().trim().max(100),
});

function ExpenseFormDrawer({ target, onClose }: { target: ExpenseOut | 'new' | null; onClose: () => void }) {
  const isNew = target === 'new';
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const f = useZodForm(form, { defaultValues: { category: '', description: '', amount: '', spentOn: todayIso(), paidTo: '', reference: '' } });
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [filesDirty, setFilesDirty] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const { guard, dialog } = useUnsavedGuard(f.formState.isDirty || filesDirty);
  const { money } = useMgmt();

  React.useEffect(() => {
    if (!target) return;
    if (target === 'new') f.reset({ category: '', description: '', amount: '', spentOn: todayIso(), paidTo: '', reference: '' });
    else f.reset({ category: target.category, description: target.description, amount: minorToText(target.amountMinor), spentOn: target.spentOn, paidTo: target.paidTo ?? '', reference: target.reference ?? '' });
    setFiles(target !== 'new' && target.receiptFileId ? [{ fileId: target.receiptFileId, name: 'Attached receipt' }] : []);
    setFilesDirty(false);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try {
      const body = expenseCreateBody.parse({ category: v.category, description: v.description, amountMinor: parseMinor(v.amount)!, spentOn: v.spentOn, paidTo: v.paidTo || null, reference: v.reference || null, receiptFileId: files[0]?.fileId ?? null });
      const out = isNew ? await create.mutateAsync(body) : await update.mutateAsync({ id: (target as ExpenseOut).id, body });
      toast.success(isNew ? (out.status === 'pending' ? 'Expense sent for approval' : 'Expense recorded') : 'Expense updated', { description: out.status === 'pending' ? `${money(out.amountMinor)} is above the approval threshold, so it waits for an approver.` : `${money(out.amountMinor)} · ${out.category}` });
      f.reset(f.getValues());
      setFilesDirty(false);
      onClose();
    } catch (e) {
      setErr(applyApiErrors(f, e, { amountMinor: 'amount' }));
    }
  });

  return (
    <>
      <Drawer open={!!target} onOpenChange={(o) => !o && guard(onClose)}>
        <DrawerContent title={isNew ? 'New expense' : 'Edit expense'} description="Record what was spent and attach the bill" showTitle onInteractOutside={(e) => (f.formState.isDirty || filesDirty) && e.preventDefault()}>
          <form onSubmit={submit} noValidate className="flex h-full min-h-0 flex-col">
            <SheetBody className="flex-1">
              <FormSection title="Expense">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormInput control={f.control} name="category" label="Category" required list="expense-categories" maxLength={60} placeholder="Maintenance" hint="Pick one or type your own." />
                  <FormInput control={f.control} name="amount" label="Amount" required inputMode="decimal" autoComplete="off" placeholder="1850" />
                </div>
                <datalist id="expense-categories">
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <FormTextarea control={f.control} name="description" label="What was it for" required rows={2} maxLength={300} />
                <FormDate control={f.control} name="spentOn" label="Spent on" required max={todayIso()} />
              </FormSection>
              <FormSection title="Payee and proof">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormInput control={f.control} name="paidTo" label="Paid to" maxLength={120} />
                  <FormInput control={f.control} name="reference" label="Reference" maxLength={100} hint="Bill, cheque or transaction number." />
                </div>
                <Field label="Bill or receipt" hint="Image or PDF.">
                  <FileUploader
                    purpose="receipt"
                    value={files}
                    onChange={(v) => {
                      setFiles(v);
                      setFilesDirty(true);
                    }}
                    accept="image/*,application/pdf"
                    label="Attach bill or receipt"
                  />
                </Field>
              </FormSection>
              {err && <Banner tone="danger">{err}</Banner>}
            </SheetBody>
            <FormActions>
              <Button variant="secondary" type="button" onClick={() => guard(onClose)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending || update.isPending}>
                {isNew ? 'Record expense' : 'Save changes'}
              </Button>
            </FormActions>
          </form>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}

// ── summary ─────────────────────────────────────────────────────────────────────────────────

function ExpenseSummaryTab() {
  const { money, moneyCompact } = useMgmt();
  const url = useUrlState();
  const from = url.get('from');
  const to = url.get('to');
  const q = useExpenseSummary({ from: from || undefined, to: to || undefined });
  const d = q.data;
  const byMonth = (d?.byMonth ?? []).map((m) => ({ ...m }));
  const byCat = (d?.byCategory ?? []).map((c) => ({ ...c }));
  const top = byCat[0];

  return (
    <div className="space-y-6">
      <FilterBar>
        <FilterDate label="From" value={from} onChange={(v) => url.set({ from: v })} max={to || undefined} />
        <FilterDate label="To" value={to} onChange={(v) => url.set({ to: v })} min={from || undefined} />
        {(from || to) && (
          <Button variant="ghost" size="sm" onClick={() => url.set({ from: null, to: null })}>
            Reset period
          </Button>
        )}
        <div className="ml-auto">
          <ExportButton path="/expenses/export" query={{ from: from || undefined, to: to || undefined }} filename="expenses.csv" perm="expenses:export" />
        </div>
      </FilterBar>
      {q.isError && !d ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the expense summary" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Approved spending" value={d ? moneyCompact(d.totalMinor) : undefined} hint={d ? `${fmtDate(d.from)} – ${fmtDate(d.to)}` : undefined} state={q.isPending ? 'loading' : 'ready'} />
            <StatTile label="Waiting for approval" value={d ? moneyCompact(d.pendingMinor) : undefined} hint="not counted yet" state={q.isPending ? 'loading' : 'ready'} />
            <StatTile label="Top category" value={top?.category ?? (d ? '—' : undefined)} hint={top && d && d.totalMinor > 0 ? `${percent((top.totalMinor / d.totalMinor) * 100, 0)} of spending` : undefined} state={q.isPending ? 'loading' : 'ready'} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Spending by month"
              description="Approved expenses"
              height={260}
              loading={q.isPending}
              error={q.isError ? q.error : undefined}
              onRetry={() => void q.refetch()}
              empty={!!d && byMonth.length === 0}
              summary={d && byMonth.length ? `${money(d.totalMinor)} across ${byMonth.length} month${byMonth.length === 1 ? '' : 's'}; the highest was ${fmtMonth(byMonth.reduce((a, b) => (b.totalMinor > a.totalMinor ? b : a)).month)}.` : undefined}
              table={{ columns: [{ key: 'month', label: 'Month' }, { key: 'totalMinor', label: 'Spent', align: 'right', format: (v) => money(Number(v)) }], rows: byMonth.map((m) => ({ ...m, month: fmtMonth(m.month) })) }}
            >
              <BarSeries data={byMonth} xKey="month" yKey="totalMinor" label="Spent" height={260} xFormat={(v) => fmtMonthShort(String(v))} tooltipLabel={(v) => fmtMonth(String(v))} yFormat={(v) => moneyCompact(v)} valueFormat={(v) => money(v)} />
            </ChartCard>
            <ChartCard
              title="Spending by category"
              description="Largest first"
              height={Math.max(220, byCat.length * 36)}
              loading={q.isPending}
              error={q.isError ? q.error : undefined}
              onRetry={() => void q.refetch()}
              empty={!!d && byCat.length === 0}
              summary={top && d ? `${top.category} is the largest category at ${money(top.totalMinor)} (${top.count} expense${top.count === 1 ? '' : 's'}).` : undefined}
              table={{ columns: [{ key: 'category', label: 'Category' }, { key: 'count', label: 'Expenses', align: 'right' }, { key: 'totalMinor', label: 'Spent', align: 'right', format: (v) => money(Number(v)) }], rows: byCat }}
            >
              <BarSeries data={byCat} xKey="category" yKey="totalMinor" label="Spent" horizontal height={Math.max(220, byCat.length * 36)} yFormat={(v) => moneyCompact(v)} valueFormat={(v) => money(v)} />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
