'use client';

import type { SiteInfo } from '@school-sync/shared';
import { SETUP_STEPS, type SetupStepDef, type StepStatus } from '../setup';
import { useSetupStatus } from './settings';

export interface StepState {
  def: SetupStepDef;
  status: StepStatus;
  loading: boolean;
  /** the API's hint for this step ("5 grades set up.", "Add the school address…") */
  detail: string | null;
  /** records that exist for the step */
  count: number;
}

/** The setup checklist from `GET /setup/status` joined with the guidance and deep links in `lib/setup.ts`. */
export function useSetupProgress(site: SiteInfo | null, enabled = true) {
  const q = useSetupStatus(enabled);
  const defs = SETUP_STEPS.filter((s) => !(s.requires === 'fees' && site && !site.features.fees));
  const states: StepState[] = defs.map((def) => {
    const s = q.data?.steps.find((x) => x.key === def.key);
    if (!s) return { def, status: 'todo', loading: q.isPending, detail: null, count: 0 };
    return { def, status: s.done ? 'done' : 'todo', loading: false, detail: s.hint, count: s.count };
  });
  const done = states.filter((s) => s.status === 'done').length;
  return {
    states,
    done,
    /** kept for older callers: every step now has a real check */
    soon: 0,
    todo: states.length - done,
    total: states.length,
    loading: q.isPending && enabled,
    error: q.error,
    refetch: q.refetch,
    isFetching: q.isFetching,
    license: q.data?.license ?? null,
    ready: !!q.data && states.length > 0 && done === states.length,
  };
}
