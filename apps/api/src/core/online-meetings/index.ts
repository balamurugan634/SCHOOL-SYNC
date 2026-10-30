export { addCleanup, runCleanup } from './cleanup';
export { ProviderError, errorText, safeMessage } from './errors';
export { assertProviderUsable, defaultProvider, getIntegration, usableProviders } from './integrations';
export { joinUrlOf, presentOnline } from './present';
export { syncOnline, type SyncKind, type SyncOptions } from './sync';

/** Columns the sync worker owns. An edit must never write them back from a stale copy of the row. */
const RUNTIME_KEYS = ['onlineStatus', 'onlineRemoteProvider', 'onlineMeetingId', 'onlineJoinUrl', 'onlineStartUrlEnc', 'onlinePasscode', 'onlineError', 'onlineFailedAt', 'onlineSyncSig', 'onlineLeaseUntil'] as const;
export function withoutOnlineRuntime<T extends object>(row: T): Omit<T, (typeof RUNTIME_KEYS)[number]> {
  const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const k of RUNTIME_KEYS) delete copy[k];
  return copy as Omit<T, (typeof RUNTIME_KEYS)[number]>;
}
