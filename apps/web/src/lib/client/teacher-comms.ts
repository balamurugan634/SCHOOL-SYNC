'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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
  NotificationItem,
  NotificationPreferences,
  announcementRecipient,
  eventResponseRow,
  notificationPreferencesUpdateBody,
  notificationTestResponse,
  meetingCancelBody,
  meetingCompleteBody,
  meetingConfirmBody,
  meetingDeclineBody,
  meetingRescheduleBody,
} from '@school-sync/shared';
import { ApiError } from '../problem';
import { bff } from './fetcher';
import type { Paged } from './hooks';
import { teacherError } from './teacher-errors';

/** Wording for the codes only the communication endpoints answer with; everything else falls through to `teacherError`. */
const COMMS_MESSAGES: Record<string, string> = {
  AUDIENCE_NOT_ALLOWED: 'You can only address classes you teach or lead. Remove any other class and try again.',
  AUDIENCE_INVALID: 'One of the chosen classes isn’t valid. Pick your classes again.',
  AUDIENCE_EMPTY: 'Choose at least one class to send this to.',
  ATTACHMENT_NOT_FOUND: 'One of the attachments could not be found. Remove it and upload it again.',
  PUBLISH_AT_IN_PAST: 'The send time must be in the future. Pick a later time, or publish now.',
  EXPIRES_BEFORE_PUBLISH: 'The expiry must be after the time it is sent.',
  EXPIRES_IN_PAST: 'The expiry must be in the future. Use “End now” to end it immediately.',
  ANNOUNCEMENT_NOT_SCHEDULED: 'This announcement isn’t scheduled any more. Refresh to see its state.',
  ANNOUNCEMENT_NOT_PUBLISHED: 'Only a published announcement can be ended.',
  ANNOUNCEMENT_NOT_DRAFT: 'Only a draft can be edited, scheduled or published. Refresh to see its current state.',
  ANNOUNCEMENT_NOT_EDITABLE: 'A published announcement can only change when it expires. To change the text, archive it and post a new one.',
  ACK_NOT_REQUIRED: 'This announcement doesn’t ask for acknowledgement.',
  EVENT_CANCELLED: 'This event was cancelled, so it can’t be changed.',
  EVENT_NOT_DRAFT: 'Only a draft event can be published. Refresh to see its current state.',
  EVENT_HAS_RESPONSES: 'This event already has responses, so it can’t be deleted. Cancel it instead.',
  EVENT_DATES_INVALID: 'The end date can’t be before the start date.',
  EVENT_TIME_REQUIRED: 'Add a start time, or mark it as an all-day event.',
  EVENT_TIME_INVALID: 'The end time must be after the start time.',
  ONLINE_MEETING_NEEDS_TIME: 'An online meeting needs a start time and an end time. Set the times, or choose “No online meeting”.',
  ONLINE_MEETING_MULTI_DAY: 'An online meeting must be on a single day. Use one day, or choose “No online meeting”.',
  ONLINE_PROVIDER_NOT_CONNECTED: 'That meeting service is not connected for your school. Choose another option, or ask the school office.',
  ONLINE_MEETING_NOT_FAILED: 'There is nothing to retry: the online meeting is fine.',
  ONLINE_MEETING_BUSY: 'The online meeting is being updated right now. Try again in a moment.',
  CONSENT_TEXT_REQUIRED: 'Write what parents are agreeing to in the permission slip.',
  DEADLINE_AFTER_EVENT: 'The answer-by deadline must be on or before the last day of the event.',
  RESPONSE_SETTINGS_WITHOUT_REGISTRATION: 'Places and a deadline only apply when you ask for registration or permission.',
  CAPACITY_BELOW_REGISTRATIONS: 'More children have already registered than that, so the places can’t go lower.',
  PROPOSED_AT_IN_PAST: 'The proposed time is in the past.',
  QUIET_HOURS_PAIR: 'Set both a start and an end for quiet hours, or use the school default.',
  DUPLICATE_CATEGORY: 'A category was listed twice. Reload the page and try again.',
  TEACHER_NOT_ASSIGNED: 'You aren’t assigned to teach this student’s class.',
};

/** A clear sentence for any error from a communication or "Me" action. */
export function commsError(e: unknown, fallback?: string): string {
  if (e instanceof ApiError && COMMS_MESSAGES[e.code]) return COMMS_MESSAGES[e.code]!;
  return teacherError(e, fallback);
}

export type AnnouncementRecipient = z.infer<typeof announcementRecipient>;
export type EventResponseRow = z.infer<typeof eventResponseRow>;
export type NotificationTestResult = z.infer<typeof notificationTestResponse>;
export type NotificationPreferencesBody = z.input<typeof notificationPreferencesUpdateBody>;

/** Every communication query lives under `['comms', …]` so one invalidation refreshes all of them (and the home dashboard). */
const refreshAll = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: ['comms'] });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
};

function useWrite<V, R>(fn: (v: V) => Promise<R>, scope: 'all' | 'notifications' = 'all') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (scope === 'notifications') void qc.invalidateQueries({ queryKey: ['comms', 'notifications'] });
      else refreshAll(qc);
    },
  });
}

/* ───────────────────────── announcements ───────────────────────── */

export interface AnnouncementFilters {
  state?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export const useManagedAnnouncements = (f: AnnouncementFilters) =>
  useQuery({
    queryKey: ['comms', 'announcements', 'manage', f],
    queryFn: ({ signal }) => bff<Paged<AnnouncementItem>>('/announcements/manage', { query: { state: f.state || undefined, q: f.q || undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useReceivedAnnouncements = (f: { unread: boolean; page: number; pageSize: number }) =>
  useQuery({
    queryKey: ['comms', 'announcements', 'received', f],
    queryFn: ({ signal }) => bff<Paged<AnnouncementItem>>('/announcements', { query: { unread: f.unread ? 'true' : undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useAnnouncement = (id: string | null) =>
  useQuery({ queryKey: ['comms', 'announcement', id], queryFn: ({ signal }) => bff<AnnouncementItem>(`/announcements/${id}`, { signal }), enabled: !!id, staleTime: 10_000 });

export const useAnnouncementStats = (id: string | null, enabled: boolean) =>
  useQuery({ queryKey: ['comms', 'announcement-stats', id], queryFn: ({ signal }) => bff<AnnouncementStats>(`/announcements/${id}/stats`, { signal }), enabled: !!id && enabled, staleTime: 10_000 });

export const useAnnouncementRecipients = (id: string | null, f: { status: string; page: number; pageSize: number }, enabled: boolean) =>
  useQuery({
    queryKey: ['comms', 'announcement-recipients', id, f],
    queryFn: ({ signal }) => bff<Paged<AnnouncementRecipient>>(`/announcements/${id}/recipients`, { query: { status: f.status, page: f.page, pageSize: f.pageSize }, signal }),
    enabled: !!id && enabled,
    placeholderData: keepPreviousData,
  });

export const useSaveAnnouncement = () =>
  useWrite(({ id, body }: { id?: string; body: AnnouncementCreateBody | AnnouncementUpdateBody }) =>
    id ? bff<AnnouncementItem>(`/announcements/${id}`, { method: 'PATCH', body }) : bff<AnnouncementItem>('/announcements', { method: 'POST', body }),
  );

export type AnnouncementAction = 'publish' | 'schedule' | 'unschedule' | 'expire' | 'archive' | 'read' | 'ack';
export const useAnnouncementAction = () =>
  useWrite(({ id, action, body }: { id: string; action: AnnouncementAction; body?: { publishAt: string } }) => bff<unknown>(`/announcements/${id}/${action}`, { method: 'POST', body }));

export const useDeleteAnnouncement = () => useWrite((id: string) => bff<null>(`/announcements/${id}`, { method: 'DELETE' }));

/* ───────────────────────── events & calendar ───────────────────────── */

export interface EventFilters {
  from?: string;
  to?: string;
  kind?: string;
  status?: string;
  page: number;
  pageSize: number;
}

export const useEvents = (f: EventFilters) =>
  useQuery({
    queryKey: ['comms', 'events', f],
    queryFn: ({ signal }) => bff<Paged<EventItem>>('/events', { query: { from: f.from, to: f.to, kind: f.kind || undefined, status: f.status || undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const useEvent = (id: string | null) => useQuery({ queryKey: ['comms', 'event', id], queryFn: ({ signal }) => bff<EventItem>(`/events/${id}`, { signal }), enabled: !!id, staleTime: 10_000 });

export const useEventResponses = (id: string | null, f: { response: string; page: number; pageSize: number }, enabled: boolean) =>
  useQuery({
    queryKey: ['comms', 'event-responses', id, f],
    queryFn: ({ signal }) => bff<Paged<EventResponseRow>>(`/events/${id}/responses`, { query: { response: f.response || undefined, page: f.page, pageSize: f.pageSize }, signal }),
    enabled: !!id && enabled,
    placeholderData: keepPreviousData,
  });

/** Homework due dates and exam papers for the next days (events themselves come from /events). */
export const useCalendar = (from: string, to: string) =>
  useQuery({ queryKey: ['comms', 'calendar', from, to], queryFn: ({ signal }) => bff<{ from: string; to: string; data: CalendarItem[] }>('/calendar', { query: { from, to }, signal }).then((r) => r.data), staleTime: 60_000 });

export const useSaveEvent = () =>
  useWrite(({ id, body }: { id?: string; body: EventCreateBody | EventUpdateBody }) => (id ? bff<EventItem>(`/events/${id}`, { method: 'PATCH', body }) : bff<EventItem>('/events', { method: 'POST', body })));
export const useEventAction = () => useWrite(({ id, action }: { id: string; action: 'publish' | 'cancel' }) => bff<EventItem>(`/events/${id}/${action}`, { method: 'POST' }));
export const useDeleteEvent = () => useWrite((id: string) => bff<null>(`/events/${id}`, { method: 'DELETE' }));
/** Retry the event's Zoom / Google Meet meeting after a failure. */
export const useRetryEventOnline = () => useWrite((id: string) => bff<EventItem>(`/events/${id}/online-meeting/retry`, { method: 'POST' }));

/* ───────────────────────── meetings ───────────────────────── */

export const useMeetings = (f: { status?: string; page: number; pageSize: number }) =>
  useQuery({
    queryKey: ['comms', 'meetings', f],
    queryFn: ({ signal }) => bff<Paged<MeetingItem>>('/meetings', { query: { status: f.status || undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useUpcomingMeetings = () => useQuery({ queryKey: ['comms', 'meetings-upcoming'], queryFn: ({ signal }) => bff<{ data: MeetingItem[] }>('/meetings/upcoming', { signal }).then((r) => r.data), staleTime: 15_000 });

export type MeetingActionInput =
  | { id: string; action: 'confirm'; body: z.input<typeof meetingConfirmBody> }
  | { id: string; action: 'reschedule'; body: z.input<typeof meetingRescheduleBody> }
  | { id: string; action: 'decline'; body: z.input<typeof meetingDeclineBody> }
  | { id: string; action: 'complete'; body: z.input<typeof meetingCompleteBody> }
  | { id: string; action: 'cancel'; body: z.input<typeof meetingCancelBody> };
/** Retry a meeting's Zoom / Google Meet room after a failure. */
export const useRetryMeetingOnline = () => useWrite((id: string) => bff<MeetingItem>(`/meetings/${id}/online-meeting/retry`, { method: 'POST' }));
export const useMeetingAction = () => useWrite(({ id, action, body }: MeetingActionInput) => bff<MeetingItem>(`/meetings/${id}/${action}`, { method: 'POST', body }));

/* ───────────────────────── notifications ───────────────────────── */

export interface NotificationFilters {
  unread: boolean;
  category: string;
}

export const useNotifications = (f: NotificationFilters) =>
  useInfiniteQuery({
    queryKey: ['comms', 'notifications', 'list', f],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      bff<{ data: NotificationItem[]; nextCursor: string | null }>('/notifications', { query: { cursor: pageParam, limit: 20, unread: f.unread ? 'true' : undefined, category: f.category || undefined }, signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });

export const useNotificationUnread = () => useQuery({ queryKey: ['comms', 'notifications', 'unread'], queryFn: ({ signal }) => bff<{ unread: number }>('/notifications/unread-count', { signal }), staleTime: 15_000 });

export const useMarkNotificationRead = () => useWrite((id: string) => bff<NotificationItem>(`/notifications/${id}/read`, { method: 'POST' }), 'notifications');
export const useMarkAllNotificationsRead = () => useWrite((category?: string) => bff<{ updated: number }>('/notifications/read-all', { method: 'POST', body: category ? { category } : {} }), 'notifications');
export const useDeleteNotification = () => useWrite((id: string) => bff<null>(`/notifications/${id}`, { method: 'DELETE' }), 'notifications');

export const useNotificationPreferences = () => useQuery({ queryKey: ['comms', 'notifications', 'preferences'], queryFn: ({ signal }) => bff<NotificationPreferences>('/notifications/preferences', { signal }), staleTime: 60_000 });
export const useSaveNotificationPreferences = () => useWrite((body: NotificationPreferencesBody) => bff<NotificationPreferences>('/notifications/preferences', { method: 'PUT', body }), 'notifications');
export const useSendTestNotification = () => useWrite(() => bff<NotificationTestResult>('/notifications/test', { method: 'POST' }), 'notifications');

/**
 * API-style deep link (`/homework/<id>`, `/meetings`, …) → the teacher route that shows it. `null` = nothing to open.
 * Sibling screens own these routes; unknown prefixes simply render as plain text.
 */
export function teacherRouteFor(route: unknown): string | null {
  if (typeof route !== 'string' || !route.startsWith('/')) return null;
  const [path] = route.split('?');
  const seg = path!.split('/').filter(Boolean);
  switch (seg[0]) {
    case 'homework':
      return seg[1] ? `/teacher/homework/${seg[1]}` : '/teacher/homework';
    case 'submissions':
      return '/teacher/homework';
    case 'meetings':
      return '/teacher/messages/meetings';
    case 'announcements':
      return seg[1] ? `/teacher/messages?view=${seg[1]}` : '/teacher/messages';
    case 'events':
      return seg[1] ? `/teacher/messages/events?view=${seg[1]}` : '/teacher/messages/events';
    case 'calendar':
      return '/teacher/messages/events';
    case 'exams':
    case 'marks':
    case 'results':
    case 'report-cards':
      return '/teacher/marks';
    case 'leave':
      return '/teacher/attendance/leave';
    case 'staff-leave':
      return '/teacher/me/leave';
    case 'staff-attendance':
      return '/teacher/me';
    case 'attendance':
      return '/teacher/attendance';
    case 'timetable':
      return '/teacher/timetable';
    case 'syllabus':
      return '/teacher/syllabus';
    case 'materials':
      return '/teacher/syllabus/materials';
    case 'notifications':
      return '/teacher/messages/notifications';
    default:
      return null;
  }
}
