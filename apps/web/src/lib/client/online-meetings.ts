'use client';

import { useQuery } from '@tanstack/react-query';
import type { GoogleSettingsBody, MeetingSettingsOut, MeetingTestOut, OnlineProvider, OnlineProvidersOut, ZoomSettingsBody } from '@school-sync/shared';
import { bff } from './fetcher';
import { useApiMutation } from './mutations';

/**
 * Online meetings (Zoom / Google Meet). The school's own connections live under Settings; credentials are write-only:
 * no response carries a secret. Event and meeting forms ask `useOnlineProviders` which providers they may offer.
 */
const SETTINGS = ['meeting-settings'] as const;
const PROVIDERS = ['online-providers'] as const;
const INVALIDATE = [SETTINGS, PROVIDERS, ['audit']] as const;

export const useMeetingSettings = () => useQuery({ queryKey: SETTINGS, queryFn: ({ signal }) => bff<MeetingSettingsOut>('/settings/meetings', { signal }), staleTime: 15_000 });

/** For event / meeting forms (people who may create events, not only settings administrators). */
export const useOnlineProviders = (enabled = true) => useQuery({ queryKey: PROVIDERS, queryFn: ({ signal }) => bff<OnlineProvidersOut>('/events/online-providers', { signal }), staleTime: 30_000, enabled, retry: false });

export const useSaveZoom = () => useApiMutation((body: ZoomSettingsBody) => bff<MeetingSettingsOut>('/settings/meetings/zoom', { method: 'PUT', body }), { invalidate: INVALIDATE, success: 'Zoom settings saved.' });
export const useSaveGoogle = () => useApiMutation((body: GoogleSettingsBody) => bff<MeetingSettingsOut>('/settings/meetings/google', { method: 'PUT', body }), { invalidate: INVALIDATE, success: 'Google Meet settings saved.' });
export const useDisconnectProvider = () => useApiMutation((provider: OnlineProvider) => bff<MeetingSettingsOut>(`/settings/meetings/${provider}`, { method: 'DELETE' }), { invalidate: INVALIDATE, success: (_r, p) => `${p === 'zoom' ? 'Zoom' : 'Google Meet'} disconnected.` });
export const useSetDefaultProvider = () => useApiMutation((provider: OnlineProvider) => bff<MeetingSettingsOut>('/settings/meetings/default', { method: 'PUT', body: { provider } }), { invalidate: INVALIDATE, success: (_r, p) => `${p === 'zoom' ? 'Zoom' : 'Google Meet'} is now the default.` });
export const useTestProvider = () => useApiMutation((provider: OnlineProvider) => bff<MeetingTestOut>(`/settings/meetings/${provider}/test`, { method: 'POST' }), { invalidate: INVALIDATE, toastError: false });
