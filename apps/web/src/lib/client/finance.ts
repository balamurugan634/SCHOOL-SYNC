'use client';

/** Finance hooks (fees, payments, refunds, expenses, reports). Money is always integer minor units. */
import type { z } from 'zod';
import type {
  ConcessionOut,
  ExpenseOut,
  FeeCategoryOut,
  FinanceSummaryOut,
  InvoiceDetailOut,
  PaymentOut,
  PlanOut,
  ReceiptOut,
  RefundOut,
  StructureOut,
  collectionOut,
  defaulterOut,
  expenseSummaryOut,
  generateDuesBody,
  generateDuesOut,
  outstandingOut,
  planBulkBody,
  planBulkOut,
  planCreateBody,
  structureCreateBody,
  concessionCreateBody,
  invoiceCreateBody,
  expenseCreateBody,
  expenseUpdateBody,
  refundCreateBody,
  structureItemIn,
} from '@school-sync/shared';
import { useApiMutation, useGetQuery, usePagedQuery, type Paged, type Query } from './mgmt';

export type OutstandingReport = z.infer<typeof outstandingOut>;
export type CollectionReport = z.infer<typeof collectionOut>;
export type DefaulterRow = z.infer<typeof defaulterOut>;
export type ExpenseSummary = z.infer<typeof expenseSummaryOut>;
export type GenerateDuesBody = z.infer<typeof generateDuesBody>;
export type GenerateDuesResult = z.infer<typeof generateDuesOut>;
export type PlanBulkResult = z.infer<typeof planBulkOut>;

/** Prefixes refetched after any money-changing write. */
const MONEY: string[][] = [['fees'], ['payments'], ['expenses'], ['dashboard']];

// ── overview ────────────────────────────────────────────────────────────────────────────────
export const useFinanceOverview = (range: { from?: string; to?: string }, enabled = true) => useGetQuery<FinanceSummaryOut>(['fees', 'summary'], '/finance/summary', { from: range.from, to: range.to }, { enabled, staleTime: 60_000 });

// ── categories / structures / plans ─────────────────────────────────────────────────────────
export const useFeeCategories = (enabled = true) => useGetQuery<{ data: FeeCategoryOut[] }>(['fees', 'categories'], '/fees/categories', undefined, { enabled, staleTime: 60_000 });
export const useCreateCategory = () => useApiMutation<{ code: string; name: string }, FeeCategoryOut>({ path: () => '/fees/categories', body: (v) => v, invalidate: [['fees']] });
export const useUpdateCategory = () => useApiMutation<{ id: string; name?: string; isActive?: boolean }, FeeCategoryOut>({ method: 'PATCH', path: (v) => `/fees/categories/${v.id}`, body: ({ id: _id, ...b }) => b, invalidate: [['fees']] });

export const useStructures = (query: Query, enabled = true) => usePagedQuery<StructureOut>(['fees', 'structures'], '/fees/structures', query, { enabled });
export const useCreateStructure = () => useApiMutation<z.infer<typeof structureCreateBody>, StructureOut>({ path: () => '/fees/structures', body: (v) => v, invalidate: [['fees']] });
export const useUpdateStructure = () => useApiMutation<{ id: string; name?: string; isActive?: boolean }, StructureOut>({ method: 'PATCH', path: (v) => `/fees/structures/${v.id}`, body: ({ id: _id, ...b }) => b, invalidate: [['fees']] });
export const useAddStructureItem = () => useApiMutation<{ structureId: string; item: z.infer<typeof structureItemIn> }, StructureOut>({ path: (v) => `/fees/structures/${v.structureId}/items`, body: (v) => v.item, invalidate: [['fees']] });
export const useUpdateStructureItem = () =>
  useApiMutation<{ structureId: string; itemId: string; item: Partial<z.infer<typeof structureItemIn>> }, StructureOut>({ method: 'PATCH', path: (v) => `/fees/structures/${v.structureId}/items/${v.itemId}`, body: (v) => v.item, invalidate: [['fees']] });
export const useDeleteStructureItem = () => useApiMutation<{ structureId: string; itemId: string }, StructureOut>({ method: 'DELETE', path: (v) => `/fees/structures/${v.structureId}/items/${v.itemId}`, invalidate: [['fees']] });

export const usePlans = (query: Query, enabled = true) => usePagedQuery<PlanOut>(['fees', 'plans'], '/fees/plans', query, { enabled });
export const useCreatePlan = () => useApiMutation<z.infer<typeof planCreateBody>, PlanOut>({ path: () => '/fees/plans', body: (v) => v, invalidate: [['fees']] });
export const useBulkPlans = () => useApiMutation<z.infer<typeof planBulkBody>, PlanBulkResult>({ path: () => '/fees/plans/bulk', body: (v) => v, invalidate: [['fees']] });
export const useDeletePlan = () => useApiMutation<{ id: string }, { ok: true }>({ method: 'DELETE', path: (v) => `/fees/plans/${v.id}`, invalidate: [['fees']] });
export const useGenerateDues = () => useApiMutation<GenerateDuesBody, GenerateDuesResult>({ path: () => '/fees/dues/generate', body: (v) => v, invalidate: MONEY });

// ── concessions ─────────────────────────────────────────────────────────────────────────────
export const useConcessions = (query: Query, enabled = true) => usePagedQuery<ConcessionOut>(['fees', 'concessions'], '/fees/concessions', query, { enabled });
export const useRequestConcession = () => useApiMutation<z.infer<typeof concessionCreateBody>, ConcessionOut>({ path: () => '/fees/concessions', body: (v) => v, invalidate: MONEY });
export const useDecideConcession = () =>
  useApiMutation<{ id: string; decision: 'approve' | 'reject'; note?: string }, ConcessionOut>({ path: (v) => `/fees/concessions/${v.id}/${v.decision}`, body: (v) => ({ note: v.note || undefined }), invalidate: MONEY });

// ── invoices ────────────────────────────────────────────────────────────────────────────────
export const useCreateInvoice = () => useApiMutation<z.infer<typeof invoiceCreateBody>, InvoiceDetailOut>({ path: () => '/fees/invoices', body: (v) => v, invalidate: MONEY });
export const useVoidInvoice = () => useApiMutation<{ id: string; reason: string }, InvoiceDetailOut>({ path: (v) => `/fees/invoices/${v.id}/void`, body: (v) => ({ reason: v.reason }), invalidate: MONEY });

// ── payments, receipts, refunds ─────────────────────────────────────────────────────────────
export const usePayments = (query: Query, enabled = true) => usePagedQuery<PaymentOut>(['payments', 'list'], '/payments', query, { enabled });
export const useReceipt = (paymentId: string | null) => useGetQuery<ReceiptOut>(['payments', 'receipt', paymentId], paymentId ? `/payments/${paymentId}/receipt` : null, undefined, { staleTime: 5 * 60_000 });
export const useRefunds = (query: Query, enabled = true) => usePagedQuery<RefundOut>(['payments', 'refunds'], '/payments/refunds', query, { enabled });
/** `idempotencyKey` is generated by the caller once per attempt so a retry replays instead of repeating. */
export const useRequestRefund = () =>
  useApiMutation<{ paymentId: string; body: z.infer<typeof refundCreateBody>; idempotencyKey: string }, RefundOut>({
    path: (v) => `/payments/${v.paymentId}/refunds`,
    body: (v) => v.body,
    headers: (v) => ({ 'idempotency-key': v.idempotencyKey }),
    invalidate: MONEY,
  });
export const useDecideRefund = () =>
  useApiMutation<{ id: string; action: 'approve' | 'reject' | 'process'; note?: string; reference?: string; process?: boolean; idempotencyKey: string }, RefundOut>({
    path: (v) => `/payments/refunds/${v.id}/${v.action}`,
    body: (v) => (v.action === 'approve' ? { note: v.note || undefined, reference: v.reference || undefined, process: v.process ?? true } : v.action === 'reject' ? { note: v.note } : { reference: v.reference || undefined }),
    headers: (v) => ({ 'idempotency-key': v.idempotencyKey }),
    invalidate: MONEY,
  });
export const useSyncPayment = () => useApiMutation<{ id: string }, PaymentOut>({ path: (v) => `/payments/${v.id}/sync`, invalidate: MONEY });

// ── expenses ────────────────────────────────────────────────────────────────────────────────
export const useExpenses = (query: Query, enabled = true) => usePagedQuery<ExpenseOut>(['expenses', 'list'], '/expenses', query, { enabled });
export const useExpenseSummary = (range: { from?: string; to?: string }, enabled = true) => useGetQuery<ExpenseSummary>(['expenses', 'summary'], '/expenses/summary', { from: range.from, to: range.to }, { enabled, staleTime: 60_000 });
export const useCreateExpense = () => useApiMutation<z.infer<typeof expenseCreateBody>, ExpenseOut>({ path: () => '/expenses', body: (v) => v, invalidate: MONEY });
export const useUpdateExpense = () => useApiMutation<{ id: string; body: z.infer<typeof expenseUpdateBody> }, ExpenseOut>({ method: 'PATCH', path: (v) => `/expenses/${v.id}`, body: (v) => v.body, invalidate: MONEY });
export const useDeleteExpense = () => useApiMutation<{ id: string }, { ok: true }>({ method: 'DELETE', path: (v) => `/expenses/${v.id}`, invalidate: MONEY });
export const useDecideExpense = () => useApiMutation<{ id: string; decision: 'approve' | 'reject'; note?: string }, ExpenseOut>({ path: (v) => `/expenses/${v.id}/${v.decision}`, body: (v) => ({ note: v.note || undefined }), invalidate: MONEY });

// ── fee reports ─────────────────────────────────────────────────────────────────────────────
export const useOutstandingReport = (query: Query, enabled = true) => useGetQuery<OutstandingReport>(['fees', 'report', 'outstanding'], '/fees/reports/outstanding', query, { enabled, staleTime: 60_000, keepPrevious: true });
export const useDefaulters = (query: Query, enabled = true) => usePagedQuery<DefaulterRow>(['fees', 'report', 'defaulters'], '/fees/reports/defaulters', query, { enabled, staleTime: 60_000 });
export const useCollectionReport = (query: Query, enabled = true) => useGetQuery<CollectionReport>(['fees', 'report', 'collection'], '/fees/reports/collection', query, { enabled, staleTime: 60_000, keepPrevious: true });

export type { Paged };
