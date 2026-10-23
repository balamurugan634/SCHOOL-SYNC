'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from '@/components/ui/toaster';
import { errorMessage } from '../problem';

export interface ApiMutationOptions<V, R> {
  /** query-key prefixes to invalidate after success, e.g. `[['people', 'students']]` */
  invalidate?: readonly QueryKey[];
  /** toast on success (string, or a function of the result / variables; null = none) */
  success?: string | ((data: R, vars: V) => string | null);
  /** toast the error from `run()` (default true). `mutateAsync()` always throws so a form can use applyApiErrors */
  toastError?: boolean;
  onSuccess?: (data: R, vars: V) => void;
}

export type RunResult<R> = { ok: true; data: R } | { ok: false; error: unknown };

/**
 * TanStack mutation with the app's conventions: invalidate by prefix, success toast, and a `run()` that never throws
 * (it toasts the problem+json message and returns `{ ok: false, error }`). Use `mutateAsync` + `applyApiErrors` for forms.
 */
export function useApiMutation<V = void, R = unknown>(fn: (vars: V) => Promise<R>, opts: ApiMutationOptions<V, R> = {}) {
  const qc = useQueryClient();
  const m = useMutation<R, unknown, V>({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      const msg = typeof opts.success === 'function' ? opts.success(data, vars) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(data, vars);
    },
  });
  const run = async (vars: V): Promise<RunResult<R>> => {
    try {
      return { ok: true, data: await m.mutateAsync(vars) };
    } catch (error) {
      if (opts.toastError !== false) toast.error(errorMessage(error), { duration: 8000 });
      return { ok: false, error };
    }
  };
  return Object.assign(m, { run });
}
