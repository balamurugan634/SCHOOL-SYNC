'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  EmailAccountCreateBody,
  EmailAccountOut,
  EmailAccountUpdateBody,
  EmailAccountsOut,
  EmailQueueAction,
  EmailQueueDetail,
  EmailQueueStatus,
  EmailQueueSummaryOut,
  EmailTestOut,
  emailQueueBulkOut,
  emailQueueClearBody,
  emailQueueListOut,
} from '@school-sync/shared';
import { bff } from './fetcher';
import { useApiMutation } from './mutations';

/** Outgoing email: the school's own mail accounts and the email queue. The SMTP password is write-only: no response carries it. */

export type EmailQueueList = z.infer<typeof emailQueueListOut>;
export type EmailQueueClearBody = z.infer<typeof emailQueueClearBody>;
export type EmailBulkResult = z.infer<typeof emailQueueBulkOut>;

const ACCOUNTS = ['email', 'accounts'] as const;
const QUEUE = ['email', 'queue'] as const;

// ── accounts ─────────────────────────────────────────────────────────────────────────────────────
export const useEmailAccounts = () => useQuery({ queryKey: ACCOUNTS, queryFn: ({ signal }) => bff<EmailAccountsOut>('/settings/email/accounts', { signal }), staleTime: 15_000 });

const ACCOUNT_INVALIDATE = [ACCOUNTS, ['audit']] as const;
export const useCreateEmailAccount = () =>
  useApiMutation((body: EmailAccountCreateBody) => bff<EmailAccountOut>('/settings/email/accounts', { method: 'POST', body }), { invalidate: ACCOUNT_INVALIDATE, success: (a) => `Saved “${a.name}”.` });
export const useUpdateEmailAccount = (id: string) =>
  useApiMutation((body: EmailAccountUpdateBody) => bff<EmailAccountOut>(`/settings/email/accounts/${id}`, { method: 'PATCH', body }), { invalidate: ACCOUNT_INVALIDATE, success: (a) => `Saved “${a.name}”.` });

/** Row actions on any account (the id is the variable, so one hook serves the whole list). */
export function useEmailAccountActions() {
  return {
    setEnabled: useApiMutation((v: { id: string; enabled: boolean }) => bff<EmailAccountOut>(`/settings/email/accounts/${v.id}`, { method: 'PATCH', body: { enabled: v.enabled } }), {
      invalidate: ACCOUNT_INVALIDATE,
      success: (a) => (a.enabled ? `“${a.name}” is switched on.` : `“${a.name}” is switched off.`),
    }),
    setDefault: useApiMutation((id: string) => bff<EmailAccountOut>(`/settings/email/accounts/${id}/default`, { method: 'POST' }), { invalidate: ACCOUNT_INVALIDATE, success: (a) => `“${a.name}” is now the default account for outgoing email.` }),
    usePlatform: useApiMutation(() => bff<{ ok: true }>('/settings/email/use-platform-default', { method: 'POST' }), { invalidate: ACCOUNT_INVALIDATE, success: 'Outgoing email now goes through the SchoolSync default sender.' }),
    remove: useApiMutation((id: string) => bff<{ ok: true }>(`/settings/email/accounts/${id}`, { method: 'DELETE' }), { invalidate: [...ACCOUNT_INVALIDATE, QUEUE], success: 'Email account deleted.' }),
  };
}

/** `accountId: null` tests the SchoolSync default sender (always to the signed-in admin's own address). */
export const useSendTestEmail = () =>
  useApiMutation(
    (v: { accountId: string | null; to?: string }) =>
      v.accountId ? bff<EmailTestOut>(`/settings/email/accounts/${v.accountId}/test`, { method: 'POST', body: v.to ? { to: v.to } : {} }) : bff<EmailTestOut>('/settings/email/platform/test', { method: 'POST' }),
    { invalidate: [ACCOUNTS, ['audit']], toastError: false },
  );

// ── queue ────────────────────────────────────────────────────────────────────────────────────────
export interface QueueFilters {
  status?: EmailQueueStatus;
  accountId?: string;
  q?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/** Re-checks every few seconds while anything is waiting or being sent, so the screen follows the worker without a reload. */
const live = (active: boolean) => (active ? 4000 : false);

export const useEmailQueueSummary = () =>
  useQuery({
    queryKey: [...QUEUE, 'summary'],
    queryFn: ({ signal }) => bff<EmailQueueSummaryOut>('/settings/email/queue/summary', { signal }),
    staleTime: 3_000,
    refetchInterval: (q) => live(!!q.state.data && q.state.data.counts.not_sent + q.state.data.counts.sending > 0),
  });

export const useEmailQueue = (f: QueueFilters, polling: boolean) =>
  useQuery({
    queryKey: [...QUEUE, 'list', f],
    queryFn: ({ signal }) => bff<EmailQueueList>('/settings/email/queue', { query: { status: f.status, accountId: f.accountId, q: f.q, from: f.from, to: f.to, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 3_000,
    refetchInterval: live(polling),
  });

export const useEmailQueueItem = (id: string | null) =>
  useQuery({
    queryKey: [...QUEUE, 'item', id],
    queryFn: ({ signal }) => bff<EmailQueueDetail>(`/settings/email/queue/${id}`, { signal }),
    enabled: !!id,
    staleTime: 2_000,
    refetchInterval: (q) => live(q.state.data?.status === 'not_sent' || q.state.data?.status === 'sending'),
  });

const QUEUE_INVALIDATE = [QUEUE, ACCOUNTS, ['audit']] as const;
const VERB: Record<EmailQueueAction, string> = { send_now: 'Sending now. It goes out as soon as the worker reaches it.', retry: 'Put back in the queue.', cancel: 'Cancelled.', delete: 'Deleted.' };

export function useEmailQueueActions() {
  return {
    one: useApiMutation<{ id: string; action: EmailQueueAction }, unknown>(
      (v) =>
        v.action === 'delete'
          ? bff<{ ok: true }>(`/settings/email/queue/${v.id}`, { method: 'DELETE' })
          : bff<EmailQueueDetail>(`/settings/email/queue/${v.id}/${v.action.replace('_', '-')}`, { method: 'POST' }),
      { invalidate: QUEUE_INVALIDATE, success: (_r, v) => VERB[v.action] },
    ),
    bulk: useApiMutation((v: { action: EmailQueueAction; ids: string[] }) => bff<EmailBulkResult>('/settings/email/queue/bulk', { method: 'POST', body: v }), {
      invalidate: QUEUE_INVALIDATE,
      success: (r, v) => `${r.affected} email${r.affected === 1 ? '' : 's'} ${v.action === 'send_now' ? 'sent now' : v.action === 'retry' ? 'put back in the queue' : v.action === 'cancel' ? 'cancelled' : 'deleted'}${r.skipped ? `, ${r.skipped} skipped because of their status` : ''}.`,
    }),
    flush: useApiMutation(() => bff<{ ok: true; due: number }>('/settings/email/queue/flush', { method: 'POST' }), { invalidate: QUEUE_INVALIDATE, success: (r) => (r.due ? `Flushing: ${r.due} waiting email${r.due === 1 ? '' : 's'} will go out now, one at a time.` : 'Nothing is waiting in the queue.') }),
    clear: useApiMutation((body: EmailQueueClearBody) => bff<{ deleted: number }>('/settings/email/queue/clear', { method: 'POST', body }), { invalidate: QUEUE_INVALIDATE, success: (r) => `${r.deleted} email${r.deleted === 1 ? '' : 's'} removed from the queue.` }),
  };
}
