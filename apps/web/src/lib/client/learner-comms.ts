'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnnouncementItem,
  CalendarItem,
  EventItem,
  EventRespondBody,
  MeetingItem,
  NotificationItem,
  NotificationPreferences,
} from '@school-sync/shared';
import { bff } from './fetcher';
import type { Paged } from './hooks';

/** Communication domain (announcements, events, calendar, meetings, notifications). Keys are domain-first: ['comms', …]. */
export const ck = {
  announcements: (f: object) => ['comms', 'announcements', f] as const,
  announcement: (id: string) => ['comms', 'announcement', id] as const,
  annUnread: ['comms', 'announcements-unread'] as const,
  events: (f: object) => ['comms', 'events', f] as const,
  event: (id: string) => ['comms', 'event', id] as const,
  calendar: (studentId: string | null, from: string, to: string) => ['comms', 'calendar', studentId ?? 'me', from, to] as const,
  meetings: (f: object) => ['comms', 'meetings', f] as const,
  meetingsUpcoming: (studentId: string | null) => ['comms', 'meetings-upcoming', studentId ?? 'all'] as const,
  meetingTeachers: (studentId: string) => ['comms', 'meeting-teachers', studentId] as const,
  notifications: (f: object) => ['comms', 'notifications', f] as const,
  notifLatest: ['comms', 'notifications-latest'] as const,
  notifUnread: ['comms', 'notif-unread'] as const,
  notifPrefs: ['comms', 'notif-prefs'] as const,
};

// ───────────────────────────── announcements ─────────────────────────────

export interface AnnouncementFilters {
  page: number;
  pageSize: number;
  unread?: boolean;
  priority?: string;
}

export const useAnnouncements = (f: AnnouncementFilters) =>
  useQuery({
    queryKey: ck.announcements(f),
    queryFn: ({ signal }) => bff<Paged<AnnouncementItem>>('/announcements', { query: { page: f.page, pageSize: f.pageSize, unread: f.unread ? 'true' : undefined, priority: f.priority || undefined }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useAnnouncement = (id: string | null) =>
  useQuery({ queryKey: ck.announcement(id ?? ''), queryFn: ({ signal }) => bff<AnnouncementItem>(`/announcements/${id}`, { signal }), enabled: !!id, staleTime: 15_000 });

export const useAnnouncementUnread = (enabled = true) =>
  useQuery({ queryKey: ck.annUnread, queryFn: ({ signal }) => bff<{ unread: number; pendingAck: number }>('/announcements/unread-count', { signal }), enabled, staleTime: 30_000 });

function useInvalidateAnnouncements() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['comms', 'announcements'] });
    void qc.invalidateQueries({ queryKey: ['comms', 'announcement'] });
    void qc.invalidateQueries({ queryKey: ck.annUnread });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useMarkAnnouncementRead() {
  const done = useInvalidateAnnouncements();
  return useMutation({ mutationFn: (id: string) => bff<unknown>(`/announcements/${id}/read`, { method: 'POST', body: {} }), onSuccess: done });
}

export function useAckAnnouncement() {
  const done = useInvalidateAnnouncements();
  return useMutation({ mutationFn: (id: string) => bff<unknown>(`/announcements/${id}/ack`, { method: 'POST', body: {} }), onSuccess: done });
}

// ───────────────────────────── events & calendar ─────────────────────────────

export interface EventFilters {
  page: number;
  pageSize: number;
  kind?: string;
  /** upcoming (API default) or past (everything that ended before `pastTo`) */
  when: 'upcoming' | 'past';
  pastTo: string;
}

export const useEvents = (f: EventFilters) =>
  useQuery({
    queryKey: ck.events(f),
    queryFn: ({ signal }) => bff<Paged<EventItem>>('/events', { query: { page: f.page, pageSize: f.pageSize, kind: f.kind || undefined, to: f.when === 'past' ? f.pastTo : undefined }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useEvent = (id: string | null) => useQuery({ queryKey: ck.event(id ?? ''), queryFn: ({ signal }) => bff<EventItem>(`/events/${id}`, { signal }), enabled: !!id, staleTime: 10_000 });

export function useRespondEvent(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EventRespondBody) => bff<unknown>(`/events/${eventId}/respond`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['comms', 'event'] });
      void qc.invalidateQueries({ queryKey: ['comms', 'events'] });
      void qc.invalidateQueries({ queryKey: ['comms', 'calendar'] });
    },
  });
}

export const useCalendar = (studentId: string | null, from: string, to: string, enabled = true) =>
  useQuery<CalendarItem[]>({
    queryKey: ck.calendar(studentId, from, to),
    queryFn: ({ signal }) => bff<{ from: string; to: string; data: CalendarItem[] }>('/calendar', { query: { from, to, studentId: studentId ?? undefined }, signal }).then((r) => r.data),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

// ───────────────────────────── meetings ─────────────────────────────

export interface MeetingFilters {
  page: number;
  pageSize: number;
  status?: string;
  studentId?: string | null;
}

export const useMeetings = (f: MeetingFilters) =>
  useQuery({
    queryKey: ck.meetings(f),
    queryFn: ({ signal }) => bff<Paged<MeetingItem>>('/meetings', { query: { page: f.page, pageSize: f.pageSize, status: f.status || undefined, studentId: f.studentId ?? undefined }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useUpcomingMeetings = (studentId: string | null) =>
  useQuery({
    queryKey: ck.meetingsUpcoming(studentId),
    queryFn: ({ signal }) => bff<{ data: MeetingItem[] }>('/meetings/upcoming', { signal }).then((r) => r.data),
    staleTime: 15_000,
  });

export interface MeetingTeacher {
  staffId: string;
  name: string;
  designation: string | null;
  isClassTeacher: boolean;
  subjects: string[];
}

export const useMeetingTeachers = (studentId: string | null) =>
  useQuery({
    queryKey: ck.meetingTeachers(studentId ?? ''),
    queryFn: ({ signal }) => bff<{ data: MeetingTeacher[] }>('/meetings/teachers', { query: { studentId }, signal }).then((r) => r.data),
    enabled: !!studentId,
    staleTime: 5 * 60_000,
  });

function useInvalidateMeetings() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['comms', 'meetings'] });
    void qc.invalidateQueries({ queryKey: ['comms', 'meetings-upcoming'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useRequestMeeting() {
  const done = useInvalidateMeetings();
  return useMutation({ mutationFn: (body: { studentId: string; staffId: string; topic: string; proposedAt?: string }) => bff<MeetingItem>('/meetings', { method: 'POST', body }), onSuccess: done });
}

export function useCancelMeeting() {
  const done = useInvalidateMeetings();
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason?: string }) => bff<MeetingItem>(`/meetings/${id}/cancel`, { method: 'POST', body: reason ? { reason } : {} }), onSuccess: done });
}

// ───────────────────────────── notifications ─────────────────────────────

export type NotificationPage = { data: NotificationItem[]; nextCursor: string | null };

export interface NotificationFilters {
  unread?: boolean;
  category?: string;
}

/** Inbox with keyset pagination (cursor from the previous page's `nextCursor`). */
export const useNotificationsInbox = (f: NotificationFilters) =>
  useInfiniteQuery({
    queryKey: ck.notifications(f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => bff<NotificationPage>('/notifications', { query: { limit: 30, cursor: pageParam, unread: f.unread ? 'true' : undefined, category: f.category || undefined }, signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });

/** The few latest, for the top-bar bell popover (only fetched while it is open). */
export const useLatestNotifications = (enabled: boolean) =>
  useQuery({ queryKey: ck.notifLatest, queryFn: ({ signal }) => bff<NotificationPage>('/notifications', { query: { limit: 8 }, signal }).then((r) => r.data), enabled, staleTime: 0 });

export const useNotificationUnread = (enabled = true) =>
  useQuery({
    queryKey: ck.notifUnread,
    queryFn: ({ signal }) => bff<{ unread: number }>('/notifications/unread-count', { signal }).then((r) => r.unread),
    enabled,
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['comms', 'notifications'] });
    void qc.invalidateQueries({ queryKey: ck.notifLatest });
    void qc.invalidateQueries({ queryKey: ck.notifUnread });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useMarkNotificationRead() {
  const done = useInvalidateNotifications();
  return useMutation({ mutationFn: (id: string) => bff<NotificationItem>(`/notifications/${id}/read`, { method: 'POST', body: {} }), onSuccess: done });
}

export function useMarkAllNotificationsRead() {
  const done = useInvalidateNotifications();
  return useMutation({ mutationFn: (category?: string) => bff<{ updated: number }>('/notifications/read-all', { method: 'POST', body: category ? { category } : {} }), onSuccess: done });
}

export function useDeleteNotification() {
  const done = useInvalidateNotifications();
  return useMutation({ mutationFn: (id: string) => bff<{ ok: true }>(`/notifications/${id}`, { method: 'DELETE' }), onSuccess: done });
}

export const useNotificationPreferences = () =>
  useQuery({ queryKey: ck.notifPrefs, queryFn: ({ signal }) => bff<NotificationPreferences>('/notifications/preferences', { signal }), staleTime: 60_000 });

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { preferences: { category: string; push?: boolean; email?: boolean; quietFrom?: string | null; quietTo?: string | null }[] }) => bff<NotificationPreferences>('/notifications/preferences', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(ck.notifPrefs, data),
  });
}

export function useSendTestNotification() {
  const done = useInvalidateNotifications();
  return useMutation({ mutationFn: () => bff<{ notificationId: string; status: 'pending' | 'sent' | 'failed' | 'skipped' | 'held'; devices: number }>('/notifications/test', { method: 'POST', body: {} }), onSuccess: done });
}
