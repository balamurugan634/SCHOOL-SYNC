'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InvoiceDetailOut, InvoiceOut, PayOnlineOut, PaymentOut, ReceiptOut } from '@school-sync/shared';
import { bff } from './fetcher';
import type { Paged } from './hooks';

/** Fees & payments seen by a student (read only) or a parent. `studentId = null` for a parent means "all my children". Keys: ['fees', …]. */
export const fk = {
  invoices: (studentId: string | null, f: object) => ['fees', 'learner-invoices', studentId ?? 'all', f] as const,
  summary: (studentId: string | null) => ['fees', 'learner-summary', studentId ?? 'all'] as const,
  invoice: (id: string) => ['fees', 'learner-invoice', id] as const,
  payments: (studentId: string | null, f: object) => ['fees', 'learner-payments', studentId ?? 'all', f] as const,
  receipt: (id: string) => ['fees', 'learner-receipt', id] as const,
  payment: (id: string) => ['fees', 'learner-payment', id] as const,
};

export interface FeeFilters {
  page: number;
  pageSize: number;
  /** unpaid | partial | paid | overdue (overdue maps to ?overdue=true) */
  status?: string;
}

const statusQuery = (s?: string) => (s === 'overdue' ? { overdue: 'true' } : s ? { status: s } : {});

export const useLearnerInvoices = (studentId: string | null, parent: boolean, f: FeeFilters, enabled = true) =>
  useQuery({
    queryKey: fk.invoices(studentId, f),
    queryFn: ({ signal }) => bff<Paged<InvoiceOut>>('/fees/invoices', { query: { page: f.page, pageSize: f.pageSize, studentId: parent ? (studentId ?? undefined) : undefined, ...statusQuery(f.status) }, signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export interface FeeSummary {
  currency?: string;
  outstandingMinor: number;
  overdueMinor: number;
  overdueCount: number;
  openCount: number;
  next: InvoiceOut | null;
}

/** Totals computed from the learner's real invoices (up to 100; unpaid / part-paid ones carry the amount due now incl. late fee). */
export const useFeeSummary = (studentId: string | null, parent: boolean, enabled = true) =>
  useQuery({
    queryKey: fk.summary(parent ? studentId : null),
    queryFn: async ({ signal }): Promise<FeeSummary> => {
      const r = await bff<Paged<InvoiceOut>>('/fees/invoices', { query: { page: 1, pageSize: 100, studentId: parent ? (studentId ?? undefined) : undefined }, signal });
      const open = r.data.filter((i) => i.status === 'unpaid' || i.status === 'partial');
      const overdue = open.filter((i) => i.overdue);
      const upcoming = open.filter((i) => !i.overdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      return {
        outstandingMinor: open.reduce((s, i) => s + i.amountDueNowMinor, 0),
        overdueMinor: overdue.reduce((s, i) => s + i.amountDueNowMinor, 0),
        overdueCount: overdue.length,
        openCount: open.length,
        next: upcoming[0] ?? null,
      };
    },
    enabled,
    staleTime: 30_000,
  });

export const useLearnerInvoice = (id: string | null) =>
  useQuery({ queryKey: fk.invoice(id ?? ''), queryFn: ({ signal }) => bff<InvoiceDetailOut>(`/fees/invoices/${id}`, { signal }), enabled: !!id, staleTime: 15_000 });

export interface PaymentFilters {
  page: number;
  pageSize: number;
  status?: string;
}

export const useLearnerPayments = (studentId: string | null, parent: boolean, f: PaymentFilters, enabled = true) =>
  useQuery({
    queryKey: fk.payments(studentId, f),
    queryFn: ({ signal }) => bff<Paged<PaymentOut>>('/payments', { query: { page: f.page, pageSize: f.pageSize, status: f.status || undefined, studentId: parent ? (studentId ?? undefined) : undefined }, signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useReceipt = (paymentId: string | null) =>
  useQuery({ queryKey: fk.receipt(paymentId ?? ''), queryFn: ({ signal }) => bff<ReceiptOut>(`/payments/${paymentId}/receipt`, { signal }), enabled: !!paymentId, staleTime: 5 * 60_000 });

export const receiptPdfHref = (paymentId: string): string => `/api/bff/payments/${paymentId}/receipt/pdf`;

// ───────────────────────────── online payment ─────────────────────────────

/** POST /fees/invoices/:id/pay. The caller owns the Idempotency-Key (one per attempt, reused on retry). */
export function useStartOnlinePayment() {
  return useMutation({
    mutationFn: ({ invoiceId, amountMinor, idempotencyKey }: { invoiceId: string; amountMinor: number; idempotencyKey: string }) =>
      bff<PayOnlineOut>(`/fees/invoices/${invoiceId}/pay`, { method: 'POST', body: { amountMinor }, headers: { 'idempotency-key': idempotencyKey } }),
  });
}

/** Dev/mock gateway only: simulate the payer completing checkout (goes through the real webhook path). */
export const mockCompletePayment = (paymentId: string) => bff<PaymentOut>(`/payments/${paymentId}/mock-complete`, { method: 'POST', body: {} });
export const syncPayment = (paymentId: string) => bff<PaymentOut>(`/payments/${paymentId}/sync`, { method: 'POST', body: {} });
export const fetchPayment = (paymentId: string, signal?: AbortSignal) => bff<PaymentOut>(`/payments/${paymentId}`, { signal });

export function useInvalidateFees() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['fees'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}
