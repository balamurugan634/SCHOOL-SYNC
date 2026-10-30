import type { OnlineMeetingOut, OnlineProvider, OnlineStatus } from '@school-sync/shared';
import { openStartUrl } from './secret';

/** The online-meeting columns every event / meeting row carries. */
export interface OnlineFields {
  id: string;
  onlineProvider: OnlineProvider | null;
  onlineStatus: OnlineStatus;
  onlineRemoteProvider: OnlineProvider | null;
  onlineJoinUrl: string | null;
  onlineStartUrlEnc: string | null;
  onlinePasscode: string | null;
  onlineError: string | null;
}

/**
 * The `onlineMeeting` object of the API contract. `null` while nothing exists at a provider (no meeting wanted, or a draft event).
 * `joinUrl` / `passcode` only while `scheduled`; the host link (`startUrl`) and the failure reason (`error`) only for `canEdit`.
 * `tenantId` is needed to open the sealed host link; without it the host link is simply left out.
 */
export function presentOnline(row: OnlineFields, kind: 'event' | 'meeting', opts: { canEdit: boolean; tenantId?: string }): OnlineMeetingOut | null {
  if (row.onlineStatus === 'none') return null;
  const provider = row.onlineRemoteProvider ?? row.onlineProvider;
  if (!provider) return null;
  const live = row.onlineStatus === 'scheduled';
  const out: OnlineMeetingOut = { provider, status: row.onlineStatus, joinUrl: live ? row.onlineJoinUrl : null, passcode: live ? row.onlinePasscode : null };
  if (opts.canEdit) {
    out.startUrl = live && row.onlineStartUrlEnc && opts.tenantId ? openStartUrl(row.onlineStartUrlEnc, opts.tenantId, kind, row.id) : null;
    if (row.onlineStatus === 'failed') out.error = row.onlineError;
  }
  return out;
}

/** A published/active row's join link for list screens that only need the button. */
export const joinUrlOf = (row: Pick<OnlineFields, 'onlineStatus' | 'onlineJoinUrl'>): string | null => (row.onlineStatus === 'scheduled' ? row.onlineJoinUrl : null);
