import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { AnnouncementCreateBody, AnnouncementItem, AnnouncementState, AnnouncementStats, AnnouncementUpdateBody } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { ilikeAny } from '../../core/http';
import { notify } from '../../core/notify';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { announcementReceipts, announcements, audienceTargets, notifications, users } from '../../db/tenant/schema';
import { audienceMatchesPrincipal, audienceUsersSql, resolveAudienceUserIds } from './audience';
import { attachmentRefsFor, loadAudience, normalizeTargets, replaceTargets, snippet, toAttachments } from './common';

export type AnnouncementRow = typeof announcements.$inferSelect;

// ── visibility & ownership ──────────────────────────────────────────────────────────────────────

/** Published, already live, not expired, and the caller belongs to its audience. */
export function visibleCond(p: Principal, now = new Date()): SQL {
  return and(
    eq(announcements.status, 'published'),
    or(isNull(announcements.publishAt), lte(announcements.publishAt, now)),
    or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
    audienceMatchesPrincipal(p, 'announcement', announcements.id),
  )!;
}

/** Editors with school scope manage every announcement; others (teachers) only their own. */
export const canManage = (p: Principal, row: Pick<AnnouncementRow, 'createdBy'>): boolean => {
  const scope = p.scope('announcements:edit');
  return scope === 'school' || (!!scope && row.createdBy === p.userId);
};
const manageCond = (p: Principal): SQL | undefined => (p.scope('announcements:edit') === 'school' ? undefined : eq(announcements.createdBy, p.userId));

export function stateOf(row: Pick<AnnouncementRow, 'status' | 'publishAt' | 'expiresAt'>, now = new Date()): AnnouncementState {
  if (row.status === 'archived') return 'archived';
  if (row.status === 'published') return row.expiresAt && row.expiresAt <= now ? 'expired' : 'published';
  return row.publishAt ? 'scheduled' : 'draft';
}

function stateCond(state: AnnouncementState, now: Date): SQL {
  switch (state) {
    case 'draft':
      return and(eq(announcements.status, 'draft'), isNull(announcements.publishAt))!;
    case 'scheduled':
      return and(eq(announcements.status, 'draft'), isNotNull(announcements.publishAt))!;
    case 'published':
      return and(eq(announcements.status, 'published'), or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)))!;
    case 'expired':
      return and(eq(announcements.status, 'published'), lte(announcements.expiresAt, now))!;
    case 'archived':
      return eq(announcements.status, 'archived');
  }
}

// ── mapping ─────────────────────────────────────────────────────────────────────────────────────

interface Extras {
  readAt?: Date | null;
  ackedAt?: Date | null;
  authorName?: string | null;
  audience?: AnnouncementItem['audience'];
  counts?: { read: number; ack: number };
}
export function toItem(row: AnnouncementRow, p: Principal, x: Extras = {}, now = new Date()): AnnouncementItem {
  const manage = canManage(p, row);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    priority: row.priority,
    status: row.status,
    state: stateOf(row, now),
    requiresAck: row.requiresAck,
    attachments: toAttachments(row.attachments),
    publishAt: row.publishAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    author: { id: row.createdBy, name: x.authorName ?? 'School' },
    read: !!x.readAt,
    readAt: x.readAt?.toISOString() ?? null,
    acknowledged: !!x.ackedAt,
    ackedAt: x.ackedAt?.toISOString() ?? null,
    canManage: manage,
    audience: manage ? (x.audience ?? []) : [],
    readCount: x.counts?.read ?? null,
    ackCount: x.counts?.ack ?? null,
  };
}

const receiptJoin = (userId: string) => and(eq(announcementReceipts.announcementId, announcements.id), eq(announcementReceipts.userId, userId));

// ── queries ─────────────────────────────────────────────────────────────────────────────────────

export async function listFeed(db: Executor, p: Principal, q: { page: number; pageSize: number; q?: string; unread?: boolean; priority?: AnnouncementItem['priority'] }) {
  const now = new Date();
  const where = and(
    visibleCond(p, now),
    q.unread ? isNull(announcementReceipts.readAt) : undefined,
    q.priority ? eq(announcements.priority, q.priority) : undefined,
    q.q ? ilikeAny(q.q, announcements.title, announcements.body) : undefined,
  );
  const [rows, totalRow] = await Promise.all([
    db
      .select({ a: announcements, readAt: announcementReceipts.readAt, ackedAt: announcementReceipts.ackedAt, authorName: users.displayName })
      .from(announcements)
      .leftJoin(announcementReceipts, receiptJoin(p.userId))
      .leftJoin(users, eq(users.id, announcements.createdBy))
      .where(where)
      .orderBy(desc(announcements.publishAt), desc(announcements.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(announcements).leftJoin(announcementReceipts, receiptJoin(p.userId)).where(where),
  ]);
  return { items: rows.map((r) => toItem(r.a, p, { readAt: r.readAt, ackedAt: r.ackedAt, authorName: r.authorName }, now)), total: totalRow[0]?.n ?? 0 };
}

export async function unreadCounts(db: Executor, p: Principal): Promise<{ unread: number; pendingAck: number }> {
  const res = await db
    .select({
      unread: sql<number>`count(*) filter (where ${announcementReceipts.readAt} is null)::int`,
      pendingAck: sql<number>`count(*) filter (where ${announcements.requiresAck} and ${announcementReceipts.ackedAt} is null)::int`,
    })
    .from(announcements)
    .leftJoin(announcementReceipts, receiptJoin(p.userId))
    .where(visibleCond(p));
  return { unread: res[0]?.unread ?? 0, pendingAck: res[0]?.pendingAck ?? 0 };
}

export async function listManaged(db: Executor, p: Principal, q: { page: number; pageSize: number; q?: string; state?: AnnouncementState; mine?: boolean }) {
  const now = new Date();
  const where = and(
    manageCond(p),
    q.mine ? eq(announcements.createdBy, p.userId) : undefined,
    q.state ? stateCond(q.state, now) : sql`${announcements.status} <> 'archived'`,
    q.q ? ilikeAny(q.q, announcements.title, announcements.body) : undefined,
  );
  const [rows, totalRow] = await Promise.all([
    db
      .select({ a: announcements, authorName: users.displayName, readAt: announcementReceipts.readAt, ackedAt: announcementReceipts.ackedAt })
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.createdBy))
      .leftJoin(announcementReceipts, receiptJoin(p.userId))
      .where(where)
      .orderBy(desc(announcements.createdAt), desc(announcements.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(announcements).where(where),
  ]);
  const ids = rows.map((r) => r.a.id);
  const [audience, counts] = await Promise.all([
    loadAudience(db, 'announcement', ids),
    ids.length
      ? db
          .select({ id: announcementReceipts.announcementId, read: sql<number>`count(${announcementReceipts.readAt})::int`, ack: sql<number>`count(${announcementReceipts.ackedAt})::int` })
          .from(announcementReceipts)
          .where(inArray(announcementReceipts.announcementId, ids))
          .groupBy(announcementReceipts.announcementId)
      : [],
  ]);
  const cMap = new Map(counts.map((c) => [c.id, { read: c.read, ack: c.ack }]));
  return { items: rows.map((r) => toItem(r.a, p, { readAt: r.readAt, ackedAt: r.ackedAt, authorName: r.authorName, audience: audience.get(r.a.id) ?? [], counts: cMap.get(r.a.id) ?? { read: 0, ack: 0 } }, now)), total: totalRow[0]?.n ?? 0 };
}

/** Recipient or manager; anything else (including drafts of other authors) is a 404. */
export async function getVisible(db: Executor, p: Principal, id: string): Promise<AnnouncementItem> {
  const now = new Date();
  const [row] = await db
    .select({ a: announcements, readAt: announcementReceipts.readAt, ackedAt: announcementReceipts.ackedAt, authorName: users.displayName })
    .from(announcements)
    .leftJoin(announcementReceipts, receiptJoin(p.userId))
    .leftJoin(users, eq(users.id, announcements.createdBy))
    .where(and(eq(announcements.id, id), or(visibleCond(p, now), p.scope('announcements:edit') ? (p.scope('announcements:edit') === 'school' ? sql`true` : eq(announcements.createdBy, p.userId)) : sql`false`)))
    .limit(1);
  if (!row) throw notFound('Announcement');
  const audience = canManage(p, row.a) ? ((await loadAudience(db, 'announcement', [id])).get(id) ?? []) : [];
  return toItem(row.a, p, { readAt: row.readAt, ackedAt: row.ackedAt, authorName: row.authorName, audience }, now);
}

async function loadManageable(db: Executor, p: Principal, id: string, lock = false): Promise<AnnouncementRow> {
  const q = db.select().from(announcements).where(and(eq(announcements.id, id), manageCond(p))).limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw notFound('Announcement');
  return row;
}

// ── writes ──────────────────────────────────────────────────────────────────────────────────────

function assertTimes(publishAt: Date | null | undefined, expiresAt: Date | null | undefined, now: Date) {
  if (publishAt && publishAt.getTime() <= now.getTime()) throw unprocessable('publishAt must be in the future (use the publish action to publish now)', 'PUBLISH_AT_IN_PAST');
  if (expiresAt && expiresAt.getTime() <= (publishAt ?? now).getTime()) throw unprocessable('expiresAt must be after the publish time', 'EXPIRES_BEFORE_PUBLISH');
}

export async function createAnnouncement(db: Executor, p: Principal, actor: AuditActor, body: AnnouncementCreateBody): Promise<AnnouncementItem> {
  const now = new Date();
  const publishAt = body.publishAt ? new Date(body.publishAt) : null;
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (publishAt && !p.scope('announcements:publish')) throw forbidden('You may not schedule announcements');
  assertTimes(publishAt, expiresAt, now);
  const id = await db.transaction(async (tx) => {
    const targets = await normalizeTargets(tx, p, 'announcements:create', body.audience);
    const attachments = await attachmentRefsFor(tx, p.userId, body.attachmentFileIds);
    const [row] = await tx
      .insert(announcements)
      .values({ title: body.title, body: body.body, priority: body.priority, requiresAck: body.requiresAck, attachments, publishAt, expiresAt, createdBy: p.userId })
      .returning();
    await replaceTargets(tx, 'announcement', row!.id, targets);
    await audit(tx, actor, { action: 'announcement.create', entity: 'announcement', entityId: row!.id, summary: row!.title, after: { priority: row!.priority, audience: targets, requiresAck: row!.requiresAck, publishAt } });
    return row!.id;
  });
  return getVisible(db, p, id);
}

export async function updateAnnouncement(db: Executor, p: Principal, actor: AuditActor, id: string, body: AnnouncementUpdateBody): Promise<AnnouncementItem> {
  const now = new Date();
  await db.transaction(async (tx) => {
    const row = await loadManageable(tx, p, id, true);
    if (row.status === 'archived') throw conflict('Archived announcements cannot be edited', 'ANNOUNCEMENT_NOT_EDITABLE');
    if (row.status === 'published') {
      const other = Object.keys(body).filter((k) => k !== 'expiresAt');
      if (other.length) throw conflict('A published announcement can only change its expiry; archive it and post a new one to change the content', 'ANNOUNCEMENT_NOT_EDITABLE');
    }
    const publishAt = body.publishAt === undefined ? row.publishAt : body.publishAt ? new Date(body.publishAt) : null;
    const expiresAt = body.expiresAt === undefined ? row.expiresAt : body.expiresAt ? new Date(body.expiresAt) : null;
    if (row.status === 'draft') {
      if (body.publishAt && !p.scope('announcements:publish')) throw forbidden('You may not schedule announcements');
      assertTimes(body.publishAt === undefined ? null : publishAt, expiresAt, now);
    } else if (expiresAt && expiresAt <= now) {
      throw unprocessable('expiresAt must be in the future (use the expire action to end it now)', 'EXPIRES_IN_PAST');
    }
    const set: Partial<typeof announcements.$inferInsert> = { publishAt, expiresAt };
    if (body.title !== undefined) set.title = body.title;
    if (body.body !== undefined) set.body = body.body;
    if (body.priority !== undefined) set.priority = body.priority;
    if (body.requiresAck !== undefined) set.requiresAck = body.requiresAck;
    if (body.attachmentFileIds !== undefined) set.attachments = await attachmentRefsFor(tx, p.userId, body.attachmentFileIds);
    if (body.audience !== undefined) await replaceTargets(tx, 'announcement', id, await normalizeTargets(tx, p, 'announcements:create', body.audience));
    await tx.update(announcements).set(set).where(eq(announcements.id, id));
    await audit(tx, actor, { action: 'announcement.update', entity: 'announcement', entityId: id, summary: row.title, before: { title: row.title, priority: row.priority, publishAt: row.publishAt, expiresAt: row.expiresAt }, after: { ...body, attachmentFileIds: undefined } });
  });
  return getVisible(db, p, id);
}

async function audienceCount(db: Executor, id: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(audienceTargets).where(and(eq(audienceTargets.ownerType, 'announcement'), eq(audienceTargets.ownerId, id)));
  return r?.n ?? 0;
}

/** draft → published now. Returns the row so the caller can fan out notifications after commit. */
export async function publishNow(tx: Executor, p: Principal, actor: AuditActor, id: string): Promise<AnnouncementRow> {
  const now = new Date();
  const row = await loadManageable(tx, p, id, true);
  if (row.status !== 'draft') throw conflict('Only a draft can be published', 'ANNOUNCEMENT_NOT_DRAFT');
  if (!(await audienceCount(tx, id))) throw unprocessable('Choose who this is for before publishing', 'AUDIENCE_EMPTY');
  if (row.expiresAt && row.expiresAt <= now) throw unprocessable('This announcement has already expired; change its expiry first', 'EXPIRES_IN_PAST');
  if (p.scope('announcements:create') !== 'school') {
    // a teacher who has since lost a section must not publish to it
    const targets = await tx.select().from(audienceTargets).where(and(eq(audienceTargets.ownerType, 'announcement'), eq(audienceTargets.ownerId, id)));
    await normalizeTargets(tx, p, 'announcements:create', targets.map((t) => ({ type: t.targetType, id: t.targetId })));
  }
  const [updated] = await tx.update(announcements).set({ status: 'published', publishAt: now, publishedBy: p.userId }).where(eq(announcements.id, id)).returning();
  await audit(tx, actor, { action: 'announcement.publish', entity: 'announcement', entityId: id, summary: row.title, before: { status: row.status, publishAt: row.publishAt }, after: { status: 'published', publishAt: now } });
  return updated!;
}

export async function schedule(db: Executor, p: Principal, actor: AuditActor, id: string, publishAtIso: string): Promise<AnnouncementItem> {
  const now = new Date();
  const publishAt = new Date(publishAtIso);
  await db.transaction(async (tx) => {
    const row = await loadManageable(tx, p, id, true);
    if (row.status !== 'draft') throw conflict('Only a draft can be scheduled', 'ANNOUNCEMENT_NOT_DRAFT');
    if (!(await audienceCount(tx, id))) throw unprocessable('Choose who this is for before scheduling', 'AUDIENCE_EMPTY');
    assertTimes(publishAt, row.expiresAt, now);
    await tx.update(announcements).set({ publishAt }).where(eq(announcements.id, id));
    await audit(tx, actor, { action: 'announcement.schedule', entity: 'announcement', entityId: id, summary: row.title, before: { publishAt: row.publishAt }, after: { publishAt } });
  });
  return getVisible(db, p, id);
}

export async function unschedule(db: Executor, p: Principal, actor: AuditActor, id: string): Promise<AnnouncementItem> {
  await db.transaction(async (tx) => {
    const row = await loadManageable(tx, p, id, true);
    if (row.status !== 'draft' || !row.publishAt) throw conflict('This announcement is not scheduled', 'ANNOUNCEMENT_NOT_SCHEDULED');
    await tx.update(announcements).set({ publishAt: null }).where(eq(announcements.id, id));
    await audit(tx, actor, { action: 'announcement.unschedule', entity: 'announcement', entityId: id, summary: row.title, before: { publishAt: row.publishAt } });
  });
  return getVisible(db, p, id);
}

export async function expire(db: Executor, p: Principal, actor: AuditActor, id: string): Promise<AnnouncementItem> {
  await db.transaction(async (tx) => {
    const row = await loadManageable(tx, p, id, true);
    if (row.status !== 'published') throw conflict('Only a published announcement can be expired', 'ANNOUNCEMENT_NOT_PUBLISHED');
    const now = new Date();
    await tx.update(announcements).set({ expiresAt: now }).where(eq(announcements.id, id));
    await audit(tx, actor, { action: 'announcement.expire', entity: 'announcement', entityId: id, summary: row.title, before: { expiresAt: row.expiresAt }, after: { expiresAt: now } });
  });
  return getVisible(db, p, id);
}

export async function archive(db: Executor, p: Principal, actor: AuditActor, id: string): Promise<AnnouncementItem> {
  await db.transaction(async (tx) => {
    const row = await loadManageable(tx, p, id, true);
    if (row.status === 'archived') throw conflict('Already archived', 'ANNOUNCEMENT_ARCHIVED');
    await tx.update(announcements).set({ status: 'archived' }).where(eq(announcements.id, id));
    await audit(tx, actor, { action: 'announcement.archive', entity: 'announcement', entityId: id, summary: row.title, before: { status: row.status }, after: { status: 'archived' } });
  });
  return getVisible(db, p, id);
}

/** Drafts are deleted outright (author, or `announcements:delete`); published ones are archived (`announcements:delete` only). */
export async function remove(db: Executor, p: Principal, actor: AuditActor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(announcements).where(eq(announcements.id, id)).limit(1).for('update');
    if (!row) throw notFound('Announcement');
    const mayDelete = !!p.scope('announcements:delete');
    const isAuthorOfDraft = row.createdBy === p.userId && row.status === 'draft' && !!p.scope('announcements:edit');
    if (!mayDelete && !isAuthorOfDraft) throw notFound('Announcement');
    if (row.status === 'draft') {
      await tx.delete(audienceTargets).where(and(eq(audienceTargets.ownerType, 'announcement'), eq(audienceTargets.ownerId, id)));
      await tx.delete(announcements).where(eq(announcements.id, id));
    } else if (row.status === 'published') {
      await tx.update(announcements).set({ status: 'archived' }).where(eq(announcements.id, id));
    } else {
      throw conflict('Already archived', 'ANNOUNCEMENT_ARCHIVED');
    }
    await audit(tx, actor, { action: 'announcement.delete', entity: 'announcement', entityId: id, summary: row.title, before: { status: row.status } });
  });
}

// ── receipts ────────────────────────────────────────────────────────────────────────────────────

async function assertRecipient(db: Executor, p: Principal, id: string): Promise<AnnouncementRow> {
  const [row] = await db.select().from(announcements).where(and(eq(announcements.id, id), visibleCond(p))).limit(1);
  if (!row) throw notFound('Announcement');
  return row;
}

async function markNotificationRead(db: Executor, userId: string, announcementId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), eq(notifications.type, 'announcement.new'), sql`${notifications.data}->>'announcementId' = ${announcementId}`));
}

export async function markRead(db: Executor, p: Principal, id: string): Promise<{ announcementId: string; readAt: string; ackedAt: string | null }> {
  await assertRecipient(db, p, id);
  const now = new Date();
  const [r] = await db
    .insert(announcementReceipts)
    .values({ announcementId: id, userId: p.userId, readAt: now })
    .onConflictDoUpdate({ target: [announcementReceipts.announcementId, announcementReceipts.userId], set: { readAt: sql`coalesce(${announcementReceipts.readAt}, ${now})` } })
    .returning();
  await markNotificationRead(db, p.userId, id);
  return { announcementId: id, readAt: r!.readAt!.toISOString(), ackedAt: r!.ackedAt?.toISOString() ?? null };
}

export async function acknowledge(db: Executor, p: Principal, actor: AuditActor, id: string): Promise<{ announcementId: string; readAt: string; ackedAt: string }> {
  const row = await assertRecipient(db, p, id);
  if (!row.requiresAck) throw conflict('This announcement does not ask for acknowledgement', 'ACK_NOT_REQUIRED');
  const now = new Date();
  const r = await db.transaction(async (tx) => {
    const [x] = await tx
      .insert(announcementReceipts)
      .values({ announcementId: id, userId: p.userId, readAt: now, ackedAt: now })
      .onConflictDoUpdate({ target: [announcementReceipts.announcementId, announcementReceipts.userId], set: { readAt: sql`coalesce(${announcementReceipts.readAt}, ${now})`, ackedAt: sql`coalesce(${announcementReceipts.ackedAt}, ${now})` } })
      .returning();
    await audit(tx, actor, { action: 'announcement.ack', entity: 'announcement', entityId: id, summary: row.title });
    return x!;
  });
  await markNotificationRead(db, p.userId, id);
  return { announcementId: id, readAt: r.readAt!.toISOString(), ackedAt: r.ackedAt!.toISOString() };
}

// ── delivery stats ──────────────────────────────────────────────────────────────────────────────

export async function stats(db: Executor, p: Principal, id: string): Promise<AnnouncementStats> {
  const row = await loadManageable(db, p, id);
  const aud = audienceUsersSql('announcement', sql`t.owner_id = ${id}`);
  const [totals, byType, bySection] = await Promise.all([
    db.execute<{ audience: number; read: number; acked: number }>(sql`
      with aud as (${aud})
      select count(*)::int as audience, count(r.read_at)::int as read, count(r.acked_at)::int as acked
      from aud left join announcement_receipts r on r.announcement_id = ${id} and r.user_id = aud.uid`),
    db.execute<{ user_type: 'student' | 'parent' | 'staff'; audience: number; read: number; acked: number }>(sql`
      with aud as (${aud})
      select u.user_type, count(*)::int as audience, count(r.read_at)::int as read, count(r.acked_at)::int as acked
      from aud join users u on u.id = aud.uid left join announcement_receipts r on r.announcement_id = ${id} and r.user_id = aud.uid
      group by u.user_type order by u.user_type`),
    db.execute<{ section_id: string; grade_name: string; section_name: string; audience: number; read: number; acked: number }>(sql`
      with aud as (${aud}),
      su as (
        select s.current_section_id as sid, s.user_id as uid from students s
          where s.user_id is not null and s.status = 'active' and s.archived_at is null and s.current_section_id is not null
        union
        select s.current_section_id, g.user_id from student_guardians sg
          join students s on s.id = sg.student_id and s.status = 'active' and s.archived_at is null and s.current_section_id is not null
          join guardians g on g.id = sg.guardian_id and g.user_id is not null
          where sg.verified_at is not null
      )
      select sec.id as section_id, gr.name as grade_name, sec.name as section_name, count(*)::int as audience, count(r.read_at)::int as read, count(r.acked_at)::int as acked
      from su join aud on aud.uid = su.uid
      join sections sec on sec.id = su.sid join grades gr on gr.id = sec.grade_id
      left join announcement_receipts r on r.announcement_id = ${id} and r.user_id = su.uid
      where exists (
        select 1 from audience_targets t where t.owner_type = 'announcement' and t.owner_id = ${id}
          and (t.target_type in ('all', 'user_type', 'role') or (t.target_type = 'grade' and t.target_id = sec.grade_id::text) or (t.target_type = 'section' and t.target_id = sec.id::text))
      )
      group by sec.id, gr.name, gr.ordinal, sec.name order by gr.ordinal, sec.name`),
  ]);
  const t = totals.rows[0] ?? { audience: 0, read: 0, acked: 0 };
  return {
    announcementId: id,
    requiresAck: row.requiresAck,
    audienceSize: t.audience,
    readCount: t.read,
    ackCount: t.acked,
    unreadCount: t.audience - t.read,
    pendingAckCount: row.requiresAck ? t.audience - t.acked : 0,
    byUserType: byType.rows.map((r) => ({ userType: r.user_type, audience: r.audience, read: r.read, acked: r.acked })),
    bySection: bySection.rows.map((r) => ({ sectionId: r.section_id, gradeName: r.grade_name, sectionName: r.section_name, audience: r.audience, read: r.read, acked: r.acked })),
  };
}

export async function recipients(db: Executor, p: Principal, id: string, q: { page: number; pageSize: number; status: 'all' | 'unread' | 'unacknowledged' }) {
  await loadManageable(db, p, id);
  const aud = audienceUsersSql('announcement', sql`t.owner_id = ${id}`);
  const filter = q.status === 'unread' ? sql`and r.read_at is null` : q.status === 'unacknowledged' ? sql`and r.acked_at is null` : sql``;
  const [rows, total] = await Promise.all([
    db.execute<{ user_id: string; name: string; user_type: 'student' | 'parent' | 'staff'; read_at: Date | null; acked_at: Date | null }>(sql`
      with aud as (${aud})
      select u.id as user_id, u.display_name as name, u.user_type, r.read_at, r.acked_at
      from aud join users u on u.id = aud.uid left join announcement_receipts r on r.announcement_id = ${id} and r.user_id = aud.uid
      where true ${filter}
      order by u.display_name, u.id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
    db.execute<{ n: number }>(sql`
      with aud as (${aud})
      select count(*)::int as n from aud left join announcement_receipts r on r.announcement_id = ${id} and r.user_id = aud.uid where true ${filter}`),
  ]);
  return {
    items: rows.rows.map((r) => ({ userId: r.user_id, name: r.name, userType: r.user_type, readAt: r.read_at ? new Date(r.read_at).toISOString() : null, ackedAt: r.acked_at ? new Date(r.acked_at).toISOString() : null })),
    total: total.rows[0]?.n ?? 0,
  };
}

// ── notifications ───────────────────────────────────────────────────────────────────────────────

/** Fan out `announcement.new` to the resolved audience (minus the author). Call after the publishing transaction commits. */
export async function fanOut(db: Executor, tenant: TenantInfo, row: AnnouncementRow, opts: { deferPush?: boolean } = {}): Promise<number> {
  const audience = (await resolveAudienceUserIds(db, 'announcement', row.id)).filter((u) => u !== row.createdBy);
  if (!audience.length) return 0;
  const ids = await notify(
    db,
    tenant,
    {
      userIds: audience,
      type: 'announcement.new',
      title: row.title,
      body: snippet(row.body),
      data: { route: `/announcements/${row.id}`, announcementId: row.id, announcementPriority: row.priority },
      priority: row.priority === 'urgent' ? 'high' : 'normal',
    },
    opts,
  );
  return ids.length;
}

// ── scheduled publishing (job) ──────────────────────────────────────────────────────────────────

/**
 * Publish drafts whose `publishAt` has arrived and archive published ones past `expiresAt`.
 * Idempotent: the status flip is the claim (`UPDATE … WHERE status = 'draft'`), so a row is fanned out exactly once.
 */
export async function runScheduled(tenant: TenantInfo, db: Executor, now = new Date()): Promise<{ published: number; archived: number }> {
  const due = await db
    .update(announcements)
    .set({ status: 'published', publishedBy: sql`${announcements.createdBy}` })
    .where(
      and(
        eq(announcements.status, 'draft'),
        isNotNull(announcements.publishAt),
        lte(announcements.publishAt, now),
        sql`exists (select 1 from audience_targets t where t.owner_type = 'announcement' and t.owner_id = ${announcements.id})`,
      ),
    )
    .returning();
  for (const row of due) {
    await audit(db, { userId: row.createdBy, name: 'Scheduled publishing' }, { action: 'announcement.publish', entity: 'announcement', entityId: row.id, summary: row.title, before: { status: 'draft' }, after: { status: 'published', scheduled: true } });
    // rows commit together with the status flip; the push goes out a moment later
    await fanOut(db, tenant, row, { deferPush: true });
  }
  const expired = await db
    .update(announcements)
    .set({ status: 'archived' })
    .where(and(eq(announcements.status, 'published'), isNotNull(announcements.expiresAt), lte(announcements.expiresAt, now)))
    .returning({ id: announcements.id, title: announcements.title, createdBy: announcements.createdBy });
  for (const row of expired) await audit(db, { userId: row.createdBy, name: 'Scheduled publishing' }, { action: 'announcement.archive', entity: 'announcement', entityId: row.id, summary: row.title, after: { status: 'archived', reason: 'expired' } });
  return { published: due.length, archived: expired.length };
}
