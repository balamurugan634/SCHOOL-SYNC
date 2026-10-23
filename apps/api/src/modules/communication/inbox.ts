import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { NOTIFICATION_CATEGORY_LIST, type NotificationCategoryKey, type NotificationItem, type NotificationPreferences } from '@school-sync/shared';
import { decodeCursor, encodeCursor } from '../../core/http';
import { notify, dispatchPush } from '../../core/notify';
import { getSetting } from '../../core/settings';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { badRequest, unprocessable } from '../../core/errors';
import { devices, notificationPreferences, notifications } from '../../db/tenant/schema';

const LABELS: Record<NotificationCategoryKey, string> = {
  attendance: 'Attendance',
  homework: 'Homework',
  marks: 'Marks & results',
  fees: 'Fees & payments',
  announcement: 'Announcements',
  event: 'Events & calendar',
  meeting: 'Parent–teacher meetings',
  leave: 'Leave',
  tasks: 'Tasks & reminders',
  system: 'School & system',
};

type Row = typeof notifications.$inferSelect;
const toItem = (n: Row): NotificationItem => ({
  id: n.id,
  type: n.type,
  category: n.type.split('.')[0]!,
  title: n.title,
  body: n.body,
  data: n.data,
  priority: n.priority,
  read: !!n.readAt,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

/**
 * Keyset page, newest first. The cursor carries the row's *database* timestamp as text (microsecond precision) so
 * pages never skip or repeat rows that share a millisecond.
 */
export async function listInbox(db: Executor, userId: string, q: { cursor?: string; limit: number; unread?: boolean; category?: NotificationCategoryKey }) {
  const cur = decodeCursor<{ at: string; id: string }>(q.cursor);
  if (q.cursor && !cur) throw badRequest('Invalid cursor', 'INVALID_CURSOR');
  const where = and(
    eq(notifications.userId, userId),
    q.unread ? isNull(notifications.readAt) : undefined,
    q.category ? sql`${notifications.type} like ${`${q.category}.%`}` : undefined,
    cur ? sql`(${notifications.createdAt}, ${notifications.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)` : undefined,
  );
  const rows = await db
    .select({ n: notifications, cursorAt: sql<string>`${notifications.createdAt}::text` })
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return { data: page.map((r) => toItem(r.n)), nextCursor: rows.length > q.limit && last ? encodeCursor({ at: last.cursorAt, id: last.n.id }) : null };
}

export async function unreadCount(db: Executor, userId: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function markRead(db: Executor, userId: string, id: string): Promise<NotificationItem | null> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning();
  return row ? toItem(row) : null;
}

export async function markAllRead(db: Executor, userId: string, category?: NotificationCategoryKey): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), category ? sql`${notifications.type} like ${`${category}.%`}` : undefined))
    .returning({ id: notifications.id });
  return rows.length;
}

export async function deleteOne(db: Executor, userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).returning({ id: notifications.id });
  return rows.length > 0;
}

// ── preferences ────────────────────────────────────────────────────────────────────────────────

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

export async function getPreferences(db: Executor, tenant: TenantInfo, userId: string): Promise<NotificationPreferences> {
  const [rows, defaults] = await Promise.all([db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)), getSetting(db, 'notifications')]);
  const byCat = new Map(rows.map((r) => [r.category, r]));
  return {
    categories: NOTIFICATION_CATEGORY_LIST.map((category) => {
      const r = byCat.get(category);
      return { category, label: LABELS[category], push: r?.push ?? true, email: r?.email ?? false, quietFrom: hhmm(r?.quietFrom), quietTo: hhmm(r?.quietTo) };
    }),
    schoolDefaults: { quietFrom: defaults.quietFrom, quietTo: defaults.quietTo },
    timezone: tenant.timezone,
  };
}

export async function updatePreferences(
  db: Executor,
  tenant: TenantInfo,
  userId: string,
  items: { category: NotificationCategoryKey; push?: boolean; email?: boolean; quietFrom?: string | null; quietTo?: string | null }[],
): Promise<NotificationPreferences> {
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.category)) throw unprocessable(`Category "${i.category}" appears twice`, 'DUPLICATE_CATEGORY');
    seen.add(i.category);
    // a quiet window needs both ends (or neither, to fall back to the school default)
    const hasFrom = i.quietFrom !== undefined;
    const hasTo = i.quietTo !== undefined;
    if (hasFrom !== hasTo || (hasFrom && (i.quietFrom === null) !== (i.quietTo === null))) {
      throw unprocessable('Send quietFrom and quietTo together (both times, or both null for the school default)', 'QUIET_HOURS_PAIR');
    }
  }
  await db.transaction(async (tx) => {
    for (const i of items) {
      const set: Partial<typeof notificationPreferences.$inferInsert> = {};
      if (i.push !== undefined) set.push = i.push;
      if (i.email !== undefined) set.email = i.email;
      if (i.quietFrom !== undefined) {
        set.quietFrom = i.quietFrom;
        set.quietTo = i.quietTo ?? null;
      }
      await tx
        .insert(notificationPreferences)
        .values({ userId, category: i.category, ...set })
        .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.category], set: Object.keys(set).length ? set : { category: i.category } });
    }
  });
  return getPreferences(db, tenant, userId);
}

// ── test push ──────────────────────────────────────────────────────────────────────────────────

/** Send "this is a test" through the real pipeline (preferences apply, so the answer explains why nothing arrived). */
export async function sendTest(db: Executor, tenant: TenantInfo, userId: string) {
  const [deviceCount] = await db.select({ n: count() }).from(devices).where(and(eq(devices.userId, userId), eq(devices.enabled, true)));
  const [id] = await notify(db, tenant, { userIds: [userId], type: 'system.test', title: 'Test notification', body: 'If you can read this, notifications work on this device.', priority: 'high', data: { route: '/notifications' } }, { noQueue: true });
  await dispatchPush(db, tenant, [id!]);
  const [row] = await db.select({ status: notifications.pushStatus }).from(notifications).where(eq(notifications.id, id!)).limit(1);
  return { notificationId: id!, status: row?.status ?? ('pending' as const), devices: deviceCount?.n ?? 0 };
}

