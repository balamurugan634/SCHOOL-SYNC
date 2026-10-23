import { and, asc, eq, inArray, lt, lte, or } from 'drizzle-orm';
import { devices, notificationPreferences, notifications, users } from '../../db/tenant/schema';
import { sendMail } from '../mailer';
import { getSetting } from '../settings';
import type { Executor } from '../tenancy/pools';
import type { TenantInfo } from '../tenancy/registry';
import { enqueuePush } from './queue';

export interface NotifyInput {
  userIds: string[];
  /** dotted category: attendance.absent, homework.assigned, marks.published, fees.due … The first segment is the preference category. */
  type: string;
  title: string;
  body?: string;
  /** deep-link payload for clients, e.g. { route: '/homework/…', id: '…' }. Don't put private data here. */
  data?: Record<string, unknown>;
  priority?: 'normal' | 'high';
}

/** Preference categories (first segment of a notification `type`). Anything else is delivered with defaults. */
export const NOTIFICATION_CATEGORIES = ['attendance', 'homework', 'marks', 'fees', 'announcement', 'event', 'meeting', 'leave', 'tasks', 'system'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

const INSERT_CHUNK = 500;

/**
 * Write inbox rows for the recipients, then hand them to the push queue.
 * Call this AFTER your transaction commits. When you must call it inside a transaction (e.g. a background job whose
 * rows and state change have to commit atomically) pass `{ deferPush: true }`: the rows are written with the caller's
 * executor and the push is queued a couple of seconds later, by which time the transaction has normally committed
 * (and if not, the sweeper delivers them within ~90 s).
 * Inserts are chunked (≤500 rows) so announcing to thousands of recipients stays below the PostgreSQL parameter limit.
 */
export async function notify(db: Executor, tenant: TenantInfo, input: NotifyInput, opts: { deferPush?: boolean; noQueue?: boolean } = {}): Promise<string[]> {
  const userIds = [...new Set(input.userIds)];
  if (!userIds.length) return [];
  const ids: string[] = [];
  for (let i = 0; i < userIds.length; i += INSERT_CHUNK) {
    const rows = await db
      .insert(notifications)
      .values(userIds.slice(i, i + INSERT_CHUNK).map((userId) => ({ userId, type: input.type, title: input.title, body: input.body ?? null, data: input.data ?? {}, priority: input.priority ?? 'normal' })))
      .returning({ id: notifications.id });
    ids.push(...rows.map((r) => r.id));
  }
  if (opts.noQueue) return ids; // caller dispatches itself (e.g. the "send me a test push" endpoint)
  if (opts.deferPush) deferPush(tenant, ids);
  else enqueuePush(tenant, ids);
  return ids;
}

/** Queue the push for rows written inside a transaction that has not committed yet. */
export function deferPush(tenant: TenantInfo, ids: string[], afterMs = 2000): void {
  if (!ids.length) return;
  setTimeout(() => enqueuePush(tenant, ids), afterMs).unref();
}

// ── dispatcher ──────────────────────────────────────────────────────────────────────────────────

function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  return h * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
}
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export function inQuietHours(now: number, from: string, to: string): boolean {
  const f = toMinutes(from);
  const t = toMinutes(to);
  return f <= t ? now >= f && now < t : now >= f || now < t;
}
/** Absolute time at which the quiet window ending at local `to` closes, given the current local minute-of-day. */
export function quietEndsAt(nowMin: number, to: string, now = Date.now()): Date {
  const delta = (toMinutes(to) - nowMin + 1440) % 1440;
  return new Date(now - (now % 60_000) + delta * 60_000);
}

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
  /** postponed to the end of the user's quiet hours */
  held: number;
}
const BATCH = 500;

/**
 * Send push (and email, where the user opted in) for the given notifications, or — without `ids` — for the oldest
 * pending ones plus held ones whose quiet hours have ended. Idempotent per notification (only `pending`/due `held` rows
 * are touched). Honours, per user and category: `push` off → not pushed; quiet hours → held until they end (priority
 * `high` ignores quiet hours); no registered device → skipped; private categories → generic lock-screen text.
 */
export async function dispatchPush(db: Executor, tenant: TenantInfo, ids?: string[], limit = BATCH): Promise<DispatchResult> {
  const total: DispatchResult = { sent: 0, failed: 0, skipped: 0, held: 0 };
  const add = (r: DispatchResult) => {
    total.sent += r.sent;
    total.failed += r.failed;
    total.skipped += r.skipped;
    total.held += r.held;
  };
  if (ids) {
    // every given id is processed (a 5 000-recipient announcement is not left to the sweeper at 500 per tick)
    for (let i = 0; i < ids.length; i += BATCH) add(await dispatchBatch(db, tenant, { ids: ids.slice(i, i + BATCH) }));
  } else {
    add(await dispatchBatch(db, tenant, { limit }));
  }
  return total;
}

async function dispatchBatch(db: Executor, tenant: TenantInfo, sel: { ids?: string[]; limit?: number }): Promise<DispatchResult> {
  const { pushProvider } = await import('./push');
  const out: DispatchResult = { sent: 0, failed: 0, skipped: 0, held: 0 };
  const now = new Date();
  const pending = await db
    .select()
    .from(notifications)
    .where(
      sel.ids
        ? and(eq(notifications.pushStatus, 'pending'), inArray(notifications.id, sel.ids))
        : or(and(eq(notifications.pushStatus, 'pending'), lt(notifications.createdAt, new Date(now.getTime() - 60_000))), and(eq(notifications.pushStatus, 'held'), lte(notifications.deliverAfter, now))),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(sel.limit ?? BATCH);
  if (!pending.length) return out;

  const userIds = [...new Set(pending.map((n) => n.userId))];
  const [deviceRows, prefRows, notifSettings] = await Promise.all([
    db.select().from(devices).where(and(inArray(devices.userId, userIds), eq(devices.enabled, true))),
    db.select().from(notificationPreferences).where(inArray(notificationPreferences.userId, userIds)),
    getSetting(db, 'notifications'),
  ]);
  const devByUser = Map.groupBy(deviceRows, (d) => d.userId);
  const prefByKey = new Map(prefRows.map((p) => [`${p.userId}:${p.category}`, p]));
  const nowMin = localMinutes(now, tenant.timezone);

  const skipIds: string[] = [];
  const held = new Map<number, string[]>(); // deliverAfter (ms) → ids
  const emailIds = new Set<string>(); // rows that will reach a final state in this run and whose user wants email
  const toSend: { notifId: string; msgs: Parameters<ReturnType<typeof pushProvider>['send']>[0] }[] = [];

  for (const n of pending) {
    const category = n.type.split('.')[0]!;
    const pref = prefByKey.get(`${n.userId}:${category}`);
    const userDevices = devByUser.get(n.userId) ?? [];
    // a user's own window wins only when both ends are set; otherwise the school default applies
    const [qFrom, qTo] = pref?.quietFrom && pref?.quietTo ? [pref.quietFrom, pref.quietTo] : [notifSettings.quietFrom, notifSettings.quietTo];
    const quiet = n.priority !== 'high' && inQuietHours(nowMin, qFrom, qTo);
    if (pref?.push === false || !userDevices.length) {
      skipIds.push(n.id);
      if (pref?.email) emailIds.add(n.id);
      continue;
    }
    if (quiet) {
      const at = quietEndsAt(nowMin, qTo, now.getTime()).getTime();
      held.set(at, [...(held.get(at) ?? []), n.id]);
      continue;
    }
    if (pref?.email) emailIds.add(n.id);
    // Private categories show a generic line on the lock screen; details are visible only after opening the app.
    const isPrivate = notifSettings.privateCategories.includes(category);
    const data: Record<string, string> = { notificationId: n.id, type: n.type };
    for (const [k, v] of Object.entries(n.data ?? {})) if (v != null) data[k] = String(v);
    toSend.push({
      notifId: n.id,
      msgs: userDevices.map((d) => ({ token: d.pushToken, title: isPrivate ? tenant.name : n.title, body: isPrivate ? 'You have a new update. Open the app to view.' : (n.body ?? ''), data, priority: n.priority, channel: n.priority === 'high' ? 'urgent' : 'general' })),
    });
  }

  for (const [at, hid] of held) {
    await db.update(notifications).set({ pushStatus: 'held', deliverAfter: new Date(at) }).where(inArray(notifications.id, hid));
    out.held += hid.length;
  }
  if (skipIds.length) {
    await db.update(notifications).set({ pushStatus: 'skipped' }).where(inArray(notifications.id, skipIds));
    out.skipped += skipIds.length;
  }
  if (toSend.length) {
    const flat = toSend.flatMap((t) => t.msgs.map((m) => ({ notifId: t.notifId, m })));
    let results: Awaited<ReturnType<ReturnType<typeof pushProvider>['send']>>;
    try {
      results = await pushProvider().send(flat.map((f) => f.m));
    } catch (e) {
      // provider outage: leave as pending so the sweeper retries (rows already decided above are not re-sent)
      console.error(`[push:${tenant.code}] provider error`, e instanceof Error ? e.message : e);
      for (const t of toSend) emailIds.delete(t.notifId);
      await sendEmails(db, tenant, pending, emailIds, notifSettings.privateCategories);
      return out;
    }
    const okIds = new Set<string>();
    const failIds = new Set<string>();
    const dead: string[] = [];
    results.forEach((r, i) => {
      const f = flat[i]!;
      if (r.ok) okIds.add(f.notifId);
      else {
        failIds.add(f.notifId);
        if (r.invalidToken) dead.push(f.m.token);
      }
    });
    for (const id of okIds) failIds.delete(id); // at least one device received it
    const at = new Date();
    if (okIds.size) await db.update(notifications).set({ pushStatus: 'sent', pushedAt: at }).where(inArray(notifications.id, [...okIds]));
    if (failIds.size) await db.update(notifications).set({ pushStatus: 'failed' }).where(inArray(notifications.id, [...failIds]));
    if (dead.length) await db.update(devices).set({ enabled: false }).where(inArray(devices.pushToken, dead));
    out.sent += okIds.size;
    out.failed += failIds.size;
  }
  await sendEmails(db, tenant, pending, emailIds, notifSettings.privateCategories);
  return out;
}

/** Email channel for users who switched `email` on for the category. Private categories carry no details. */
async function sendEmails(db: Executor, tenant: TenantInfo, rows: (typeof notifications.$inferSelect)[], ids: Set<string>, privateCategories: string[]): Promise<void> {
  if (!ids.size) return;
  const wanted = rows.filter((n) => ids.has(n.id));
  const addr = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, [...new Set(wanted.map((n) => n.userId))]));
  const emailOf = new Map(addr.map((u) => [u.id, u.email]));
  for (const n of wanted) {
    const to = emailOf.get(n.userId);
    if (!to) continue;
    const isPrivate = privateCategories.includes(n.type.split('.')[0]!);
    const subject = isPrivate ? `${tenant.name}: you have a new update` : n.title;
    const text = isPrivate ? 'You have a new update. Sign in to the app to view it.' : [n.body, 'Open the app for details.'].filter(Boolean).join('\n\n');
    await sendMail({ to, subject, text }).catch((e) => console.error(`[mail:${tenant.code}] notification email failed`, e instanceof Error ? e.message : e));
  }
}
