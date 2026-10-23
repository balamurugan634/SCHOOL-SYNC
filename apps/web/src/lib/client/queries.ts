'use client';

import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { licenseResponse, sessionInfo } from '@school-sync/shared';
import { bff } from './fetcher';

export type License = z.infer<typeof licenseResponse>;
export type SessionInfo = z.infer<typeof sessionInfo>;

export const qk = {
  license: ['license'] as const,
  sessions: ['sessions'] as const,
  setup: (id: string) => ['setup-probe', id] as const,
};

/** Seats used vs licensed for the current academic year (needs `settings:view`). */
export function useLicense(enabled = true) {
  return useQuery({ queryKey: qk.license, queryFn: ({ signal }) => bff<License>('/license', { signal }), enabled, staleTime: 60_000 });
}

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: ({ signal }) => bff<{ data: SessionInfo[] }>('/auth/sessions', { signal }).then((r) => r.data) });
}
