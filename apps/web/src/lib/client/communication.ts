'use client';

/** Communication hooks: announcements, events and the calendar, meetings, notification preferences. */
import type { z } from 'zod';
import type {
  AnnouncementCreateBody,
  AnnouncementItem,
  AnnouncementStats,
  AnnouncementUpdateBody,
  CalendarItem,
  EventCreateBody,
  EventItem,
  EventUpdateBody,
  MeetingItem,
  NotificationPreferences,
  announcementRecipient,
  eventResponseRow,
  notificationPreferencesUpdateBody,
  notificationTestResponse,
} from '@school-sync/shared';
import { useApiMutation, useGetQuery, usePagedQuery, type Query } from './mgmt';

export type AnnouncementRecipient = z.infer<typeof announcementRecipient>;
export type EventResponseRow = z.infer<typeof eventResponseRow>;
export type PreferencesUpdate = z.infer<typeof notificationPreferencesUpdateBody>;
export type TestPushResult = z.infer<typeof notificationTestResponse>;

const ANN: string[][] = [['announcements'], ['dashboard']];
const EVT: string[][] = [['events'], ['calendar'], ['dashboard']];

// ── announcements ───────────────────────────────────────────────────────────────────────────
export const useManagedAnnouncements = (query: Query, enabled = true) => usePagedQuery<AnnouncementItem>(['announcements', 'manage'], '/announcements/manage', query, { enabled });
export const useAnnouncement = (id: string | null) => useGetQuery<AnnouncementItem>(['announcements', 'one', id], id ? `/announcements/${id}` : null, undefined, { staleTime: 10_000 });
export const useAnnouncementStats = (id: string | null, enabled = true) => useGetQuery<AnnouncementStats>(['announcements', 'stats', id], id ? `/announcements/${id}/stats` : null, undefined, { enabled, staleTime: 15_000 });
export const useAnnouncementRecipients = (id: string | null, query: Query, enabled = true) => usePagedQuery<AnnouncementRecipient>(['announcements', 'recipients', id], `/announcements/${id}/recipients`, query, { enabled: enabled && !!id });

export const useCreateAnnouncement = () => useApiMutation<AnnouncementCreateBody, AnnouncementItem>({ path: () => '/announcements', body: (v) => v, invalidate: ANN });
export const useUpdateAnnouncement = () => useApiMutation<{ id: string; body: AnnouncementUpdateBody }, AnnouncementItem>({ method: 'PATCH', path: (v) => `/announcements/${v.id}`, body: (v) => v.body, invalidate: ANN });
export const useAnnouncementAction = () =>
  useApiMutation<{ id: string; action: 'publish' | 'expire' | 'archive' | 'unschedule' | 'schedule'; publishAt?: string }, AnnouncementItem>({
    path: (v) => `/announcements/${v.id}/${v.action}`,
    body: (v) => (v.action === 'schedule' ? { publishAt: v.publishAt } : undefined),
    invalidate: ANN,
  });
export const useDeleteAnnouncement = () => useApiMutation<{ id: string }, { ok: true } | null>({ method: 'DELETE', path: (v) => `/announcements/${v.id}`, invalidate: ANN });

// ── events & calendar ───────────────────────────────────────────────────────────────────────
export const useEventList = (query: Query, enabled = true) => usePagedQuery<EventItem>(['events', 'list'], '/events', query, { enabled });
export const useEvent = (id: string | null) => useGetQuery<EventItem>(['events', 'one', id], id ? `/events/${id}` : null, undefined, { staleTime: 10_000 });
export const useEventResponses = (id: string | null, query: Query, enabled = true) => usePagedQuery<EventResponseRow>(['events', 'responses', id], `/events/${id}/responses`, query, { enabled: enabled && !!id });
export const useCalendar = (range: { from: string; to: string }, enabled = true) => useGetQuery<{ from: string; to: string; data: CalendarItem[] }>(['calendar', 'range'], '/calendar', range, { enabled, staleTime: 30_000, keepPrevious: true });

export const useCreateEvent = () => useApiMutation<EventCreateBody, EventItem>({ path: () => '/events', body: (v) => v, invalidate: EVT });
export const useUpdateEvent = () => useApiMutation<{ id: string; body: EventUpdateBody }, EventItem>({ method: 'PATCH', path: (v) => `/events/${v.id}`, body: (v) => v.body, invalidate: EVT });
export const useEventAction = () => useApiMutation<{ id: string; action: 'publish' | 'cancel' }, EventItem>({ path: (v) => `/events/${v.id}/${v.action}`, invalidate: EVT });
export const useDeleteEvent = () => useApiMutation<{ id: string }, { ok: true } | null>({ method: 'DELETE', path: (v) => `/events/${v.id}`, invalidate: EVT });

// ── meetings ────────────────────────────────────────────────────────────────────────────────
export const useMeetings = (query: Query, enabled = true) => usePagedQuery<MeetingItem>(['meetings', 'list'], '/meetings', query, { enabled });
export type MeetingActionVars =
  | { id: string; action: 'confirm'; scheduledAt: string; durationMin: number; mode: 'in_person' | 'online' | 'phone'; locationOrLink?: string }
  | { id: string; action: 'reschedule'; scheduledAt: string; durationMin?: number; mode?: 'in_person' | 'online' | 'phone'; locationOrLink?: string }
  | { id: string; action: 'decline'; reason: string }
  | { id: string; action: 'complete'; outcomeNotes: string }
  | { id: string; action: 'cancel'; reason?: string };
export const useMeetingAction = () =>
  useApiMutation<MeetingActionVars, MeetingItem>({
    path: (v) => `/meetings/${v.id}/${v.action}`,
    body: (v) => {
      const { id: _id, action: _a, ...rest } = v;
      return rest;
    },
    invalidate: [['meetings'], ['dashboard'], ['calendar']],
  });

// ── notification preferences ────────────────────────────────────────────────────────────────
export const useNotificationPreferences = () => useGetQuery<NotificationPreferences>(['notifications', 'preferences'], '/notifications/preferences', undefined, { staleTime: 60_000 });
export const useSavePreferences = () => useApiMutation<PreferencesUpdate, NotificationPreferences>({ method: 'PUT', path: () => '/notifications/preferences', body: (v) => v, invalidate: [['notifications']] });
export const useSendTestPush = () => useApiMutation<void, TestPushResult>({ path: () => '/notifications/test' });
