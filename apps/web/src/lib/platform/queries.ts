'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  PlatformAuditEntry,
  PlatformBillingOverview,
  PlatformConsoleConfig,
  PlatformInvoice,
  PlatformInvoiceIssueBody,
  PlatformMigrateOut,
  PlatformOperator,
  PlatformSubscription,
  PlatformSubscriptionBody,
  PlatformTenantCreateBody,
  PlatformTenantCreateOut,
  PlatformTenantDetail,
  PlatformTenantSummary,
  PlatformTenantUpdateBody,
  PlatformUsagePoint,
  PlatformSeats,
} from '@school-sync/shared';
import { useApiMutation } from '../client/mutations';
import { pbff } from './client';

type Paged<T> = { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };

// ── console ──────────────────────────────────────────────────────────────────────────────────────
export const usePlatformConfig = () => useQuery({ queryKey: ['platform', 'config'], queryFn: ({ signal }) => pbff<PlatformConsoleConfig>('/config', { signal }), staleTime: 10 * 60_000 });

// ── schools ──────────────────────────────────────────────────────────────────────────────────────
export interface TenantFilters {
  q?: string;
  status?: string;
  license?: string;
  page: number;
  pageSize: number;
}
export type TenantList = Paged<PlatformTenantSummary> & { facets: { status: Record<string, number>; license: Record<string, number>; updates: number } };
export const useTenants = (f: TenantFilters) =>
  useQuery({
    queryKey: ['platform', 'tenants', 'list', f],
    queryFn: ({ signal }) => pbff<TenantList>('/tenants', { query: { q: f.q, status: f.status, license: f.license, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
export const useTenant = (code: string) => useQuery({ queryKey: ['platform', 'tenants', 'detail', code], queryFn: ({ signal }) => pbff<PlatformTenantDetail>(`/tenants/${code}`, { signal }), staleTime: 10_000 });
export const useTenantUsage = (code: string, days = 365) =>
  useQuery({ queryKey: ['platform', 'tenants', 'usage', code, days], queryFn: ({ signal }) => pbff<{ data: PlatformUsagePoint[]; peakBillable: number; academicYear: string | null }>(`/tenants/${code}/usage`, { query: { days }, signal }), staleTime: 30_000 });
export const useTenantInvoices = (code: string) => useQuery({ queryKey: ['platform', 'invoices', 'tenant', code], queryFn: ({ signal }) => pbff<{ data: PlatformInvoice[] }>(`/tenants/${code}/invoices`, { signal }).then((r) => r.data), staleTime: 10_000 });
export const checkSiteCode = (code: string, signal?: AbortSignal) => pbff<{ available: boolean; reason: 'invalid' | 'reserved' | 'taken' | null; message: string | null }>('/tenants/check-code', { query: { code }, signal });

const TENANTS = [['platform', 'tenants'], ['platform', 'billing'], ['platform', 'audit']] as const;
const MONEY = [['platform', 'tenants'], ['platform', 'invoices'], ['platform', 'billing'], ['platform', 'audit']] as const;

export const useCreateTenant = () => useApiMutation((body: PlatformTenantCreateBody) => pbff<PlatformTenantCreateOut>('/tenants', { method: 'POST', body }), { invalidate: TENANTS });
export const useUpdateTenant = (code: string) => useApiMutation((body: PlatformTenantUpdateBody) => pbff<PlatformTenantDetail>(`/tenants/${code}`, { method: 'PATCH', body }), { invalidate: TENANTS, success: 'School updated.' });
/** Bring one school (or, with no code, every school) to the newest database structure: no command line needed. */
export const useMigrateSchools = () =>
  useApiMutation((code?: string) => pbff<PlatformMigrateOut>(code ? `/tenants/${code}/migrate` : '/tenants/migrate-all', { method: 'POST' }), {
    invalidate: TENANTS,
    success: (r) => (r.failed ? null : r.updated === 1 ? 'The school is up to date.' : `${r.updated} schools are up to date.`),
  });
export const useSetTenantStatus = (code: string) =>
  useApiMutation((v: { status: 'active' | 'suspended'; reason?: string }) => pbff<{ ok: true; status: string }>(`/tenants/${code}/status`, { method: 'POST', body: v }), { invalidate: TENANTS, success: (_r, v) => (v.status === 'suspended' ? 'School suspended. Its users now see a suspended notice.' : 'School resumed.') });
export const useUpsertSubscription = (code: string) =>
  useApiMutation((body: PlatformSubscriptionBody) => pbff<{ id: string; academicYear: string; subscription: PlatformSubscription }>(`/tenants/${code}/subscription`, { method: 'PUT', body }), { invalidate: MONEY, success: (r) => `Subscription ${r.academicYear} saved.` });
export const useMeterTenant = (code: string) => useApiMutation(() => pbff<{ usage: PlatformUsagePoint; seats: PlatformSeats }>(`/tenants/${code}/usage/snapshot`, { method: 'POST' }), { invalidate: [...TENANTS, ['platform', 'invoices']], success: (r) => `Metered: ${r.usage.billableStudents.toLocaleString()} billable students.` });
export const useIssueInvoice = (code: string) =>
  useApiMutation((body: PlatformInvoiceIssueBody) => pbff<{ invoice: PlatformInvoice | null; message: string | null }>(`/tenants/${code}/invoices`, { method: 'POST', body }), { invalidate: MONEY });

// ── billing ──────────────────────────────────────────────────────────────────────────────────────
export const useBillingOverview = () => useQuery({ queryKey: ['platform', 'billing', 'overview'], queryFn: ({ signal }) => pbff<PlatformBillingOverview>('/billing/overview', { signal }), staleTime: 15_000 });
export const useMeterAll = () =>
  useApiMutation(() => pbff<{ data: { code: string; ok: boolean; billableStudents?: number; error?: string }[] }>('/billing/snapshot', { method: 'POST' }), {
    invalidate: [...TENANTS, ['platform', 'invoices']],
    success: (r) => {
      const failed = r.data.filter((x) => !x.ok).length;
      return failed ? `Metered ${r.data.length - failed} schools; ${failed} failed.` : `Metered ${r.data.length} ${r.data.length === 1 ? 'school' : 'schools'}.`;
    },
  });

export interface InvoiceFilters {
  q?: string;
  status?: string;
  kind?: string;
  overdue?: boolean;
  tenant?: string;
  page: number;
  pageSize: number;
}
export const useInvoices = (f: InvoiceFilters) =>
  useQuery({
    queryKey: ['platform', 'invoices', 'list', f],
    queryFn: ({ signal }) => pbff<Paged<PlatformInvoice>>('/invoices', { query: { q: f.q, status: f.status, kind: f.kind, tenant: f.tenant, overdue: f.overdue ? 'true' : undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
export const usePayInvoice = () => useApiMutation((v: { id: string; paidOn: string; reference?: string }) => pbff<PlatformInvoice>(`/invoices/${v.id}/pay`, { method: 'POST', body: { paidOn: v.paidOn, reference: v.reference || undefined } }), { invalidate: MONEY, success: (r) => `${r.number} marked as paid.` });
export const useVoidInvoice = () => useApiMutation((v: { id: string; reason: string }) => pbff<PlatformInvoice>(`/invoices/${v.id}/void`, { method: 'POST', body: { reason: v.reason } }), { invalidate: MONEY, success: (r) => `${r.number} voided.` });

// ── operators ────────────────────────────────────────────────────────────────────────────────────
export const useOperators = () => useQuery({ queryKey: ['platform', 'operators'], queryFn: ({ signal }) => pbff<{ data: PlatformOperator[] }>('/operators', { signal }).then((r) => r.data), staleTime: 10_000 });
const OPS = [['platform', 'operators'], ['platform', 'audit']] as const;
export const useCreateOperator = () => useApiMutation((body: { email: string; displayName: string }) => pbff<{ operator: PlatformOperator; temporaryPassword: string | null }>('/operators', { method: 'POST', body }), { invalidate: OPS });
export const useOperatorAction = () =>
  useApiMutation((v: { id: string; action: 'disable' | 'enable' }) => pbff<PlatformOperator>(`/operators/${v.id}/${v.action}`, { method: 'POST' }), { invalidate: OPS, success: (r, v) => (v.action === 'disable' ? `${r.displayName} is disabled and signed out.` : `${r.displayName} can sign in again.`) });
export const useResetOperatorPassword = () => useApiMutation((id: string) => pbff<{ operator: PlatformOperator; temporaryPassword: string }>(`/operators/${id}/reset-password`, { method: 'POST' }), { invalidate: OPS });

// ── audit ────────────────────────────────────────────────────────────────────────────────────────
export interface AuditFilters {
  tenant?: string;
  action?: string;
  actor?: string;
}
export const useAuditLog = (f: AuditFilters) =>
  useInfiniteQuery({
    queryKey: ['platform', 'audit', f],
    queryFn: ({ pageParam, signal }) => pbff<{ data: PlatformAuditEntry[]; nextCursor: string | null }>('/audit', { query: { ...f, cursor: pageParam, limit: 50 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
  });
