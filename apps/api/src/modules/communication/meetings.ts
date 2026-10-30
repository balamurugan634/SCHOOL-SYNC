import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { MeetingAction, MeetingItem, OnlineProvider } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { notify } from '../../core/notify';
import { assertProviderUsable, defaultProvider, presentOnline, syncOnline } from '../../core/online-meetings';
import type { Principal } from '../../core/rbac/principal';
import { assertStudentAccess, studentIdScope } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { grades, guardians, meetings, sections, staff, studentGuardians, students, subjects, teachingAssignments } from '../../db/tenant/schema';
import { snippet } from './common';

/**
 * Parent–teacher meeting state machine
 *
 *   requested ──confirm──▶ confirmed ──complete──▶ completed
 *       │  └──decline──▶ declined          │  └──reschedule──▶ confirmed (new slot, parent notified)
 *       └──────cancel───────────┴──────────cancel──▶ cancelled
 *
 * Parents (meetings:create, linked children) request and may cancel. The addressed teacher, the class teacher of the
 * child's section and school-scope approvers decide (confirm / decline / reschedule / complete / cancel).
 */

type Row = typeof meetings.$inferSelect;
const fullName = (a: string, b: string | null) => [a, b].filter(Boolean).join(' ');

// ── scope ───────────────────────────────────────────────────────────────────────────────────────

/** Which meetings may this caller see? parent → their linked children's; teacher → addressed to them or in a section they lead; school → all. */
function scopeCond(p: Principal): SQL {
  switch (p.scope('meetings:view')) {
    case 'school':
      return sql`true`;
    case 'assigned': {
      const parts: SQL[] = [];
      if (p.staffId) parts.push(eq(meetings.staffId, p.staffId));
      if (p.classTeacherSectionIds.length) parts.push(sql`${meetings.studentId} in (select ${students.id} from ${students} where ${inArray(students.currentSectionId, p.classTeacherSectionIds)})`);
      return parts.length ? or(...parts)! : sql`false`;
    }
    case 'linked':
      return studentIdScope(p, 'meetings:view', meetings.studentId);
    // `own` (students): meetings are between parents and teachers, and may discuss the child candidly — never shown to the child
    default:
      return sql`false`;
  }
}

/** May the caller decide on (confirm / decline / reschedule / complete) this meeting? */
function canDecide(p: Principal, m: Pick<Row, 'staffId'>, sectionId: string | null): boolean {
  if (p.can('meetings:approve', 'school')) return true;
  if (p.staffId && p.staffId === m.staffId && p.scope('meetings:edit')) return true;
  return !!sectionId && !!p.scope('meetings:approve') && p.leadsSection(sectionId);
}

function actionsFor(p: Principal, m: Row, sectionId: string | null): MeetingAction[] {
  const out: MeetingAction[] = [];
  const decider = canDecide(p, m, sectionId);
  const requester = m.requestedBy === p.userId;
  if (m.status === 'requested') {
    if (decider) out.push('confirm', 'decline');
    if (decider || requester) out.push('cancel');
  } else if (m.status === 'confirmed') {
    if (decider) out.push('reschedule', 'complete');
    if (decider || requester) out.push('cancel');
  }
  return out;
}

// ── reads ───────────────────────────────────────────────────────────────────────────────────────

const select = (db: Executor) =>
  db
    .select({
      m: meetings,
      sFirst: students.firstName,
      sLast: students.lastName,
      admissionNo: students.admissionNo,
      sectionId: students.currentSectionId,
      sectionName: sections.name,
      gradeName: grades.name,
      tFirst: staff.firstName,
      tLast: staff.lastName,
      designation: staff.designation,
      gFirst: guardians.firstName,
      gLast: guardians.lastName,
    })
    .from(meetings)
    .innerJoin(students, eq(students.id, meetings.studentId))
    .innerJoin(staff, eq(staff.id, meetings.staffId))
    .leftJoin(sections, eq(sections.id, students.currentSectionId))
    .leftJoin(grades, eq(grades.id, students.currentGradeId))
    .leftJoin(guardians, eq(guardians.id, meetings.guardianId));

type Joined = Awaited<ReturnType<ReturnType<typeof select>['execute']>>[number];

function toItem(r: Joined, p: Principal, tenantId?: string): MeetingItem {
  const m = r.m;
  return {
    id: m.id,
    status: m.status,
    student: { id: m.studentId, name: fullName(r.sFirst, r.sLast), admissionNo: r.admissionNo, grade: r.gradeName, section: r.sectionName },
    teacher: { staffId: m.staffId, name: fullName(r.tFirst, r.tLast), designation: r.designation },
    guardian: m.guardianId ? { id: m.guardianId, name: fullName(r.gFirst ?? '', r.gLast) } : null,
    topic: m.topic,
    proposedAt: m.proposedAt?.toISOString() ?? null,
    scheduledAt: m.scheduledAt?.toISOString() ?? null,
    durationMin: m.durationMin,
    mode: m.mode,
    locationOrLink: m.locationOrLink,
    outcomeNotes: m.outcomeNotes,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    availableActions: actionsFor(p, m, r.sectionId),
    onlineMeeting: presentOnline(m, 'meeting', { canEdit: canDecide(p, m, r.sectionId), tenantId }),
  };
}

export async function listMeetings(db: Executor, p: Principal, q: { page: number; pageSize: number; q?: string; status?: Row['status']; studentId?: string; from?: string; to?: string }, tenantId?: string) {
  const where = and(
    scopeCond(p),
    q.status ? eq(meetings.status, q.status) : undefined,
    q.studentId ? eq(meetings.studentId, q.studentId) : undefined,
    q.from ? gte(sql`coalesce(${meetings.scheduledAt}, ${meetings.proposedAt}, ${meetings.createdAt})`, new Date(`${q.from}T00:00:00Z`)) : undefined,
    q.to ? lte(sql`coalesce(${meetings.scheduledAt}, ${meetings.proposedAt}, ${meetings.createdAt})`, new Date(`${q.to}T23:59:59Z`)) : undefined,
    q.q ? sql`${meetings.topic} ilike ${`%${q.q.replace(/[\\%_]/g, '\\$&')}%`}` : undefined,
  );
  const [rows, totalRow] = await Promise.all([
    select(db).where(where).orderBy(desc(meetings.createdAt), desc(meetings.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(meetings).where(where),
  ]);
  return { items: rows.map((r) => toItem(r, p, tenantId)), total: totalRow[0]?.n ?? 0 };
}

/** Confirmed meetings from now on (soonest first), plus requests still waiting for an answer. */
export async function upcoming(db: Executor, p: Principal, limit = 20, tenantId?: string): Promise<MeetingItem[]> {
  const now = new Date();
  const rows = await select(db)
    .where(and(scopeCond(p), or(and(eq(meetings.status, 'confirmed'), gte(meetings.scheduledAt, now)), eq(meetings.status, 'requested'))))
    .orderBy(sql`case when ${meetings.status} = 'confirmed' then 0 else 1 end`, asc(meetings.scheduledAt), desc(meetings.createdAt))
    .limit(limit);
  return rows.map((r) => toItem(r, p, tenantId));
}

async function load(db: Executor, p: Principal, id: string): Promise<Joined> {
  const [r] = await select(db).where(and(eq(meetings.id, id), scopeCond(p))).limit(1);
  if (!r) throw notFound('Meeting');
  return r;
}
export async function getMeeting(db: Executor, p: Principal, id: string, tenantId?: string): Promise<MeetingItem> {
  return toItem(await load(db, p, id), p, tenantId);
}

/** Teachers a parent may ask for a meeting about this child: the class teacher and everyone teaching the section. */
export async function teacherOptions(db: Executor, p: Principal, studentId: string) {
  await assertStudentAccess(db, p, 'meetings:view', studentId);
  const [s] = await db.select({ sectionId: students.currentSectionId }).from(students).where(eq(students.id, studentId)).limit(1);
  if (!s?.sectionId) return [];
  const [led, taught] = await Promise.all([
    db.select({ staffId: sections.classTeacherId }).from(sections).where(eq(sections.id, s.sectionId)).limit(1),
    db
      .select({ staffId: teachingAssignments.staffId, subject: subjects.name })
      .from(teachingAssignments)
      .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
      .where(eq(teachingAssignments.sectionId, s.sectionId)),
  ]);
  const classTeacherId = led[0]?.staffId ?? null;
  const bySubject = Map.groupBy(taught, (t) => t.staffId);
  const ids = [...new Set([...(classTeacherId ? [classTeacherId] : []), ...bySubject.keys()])];
  if (!ids.length) return [];
  const rows = await db.select({ id: staff.id, first: staff.firstName, last: staff.lastName, designation: staff.designation }).from(staff).where(and(inArray(staff.id, ids), eq(staff.status, 'active')));
  return rows
    .map((r) => ({ staffId: r.id, name: fullName(r.first, r.last), designation: r.designation, isClassTeacher: r.id === classTeacherId, subjects: (bySubject.get(r.id) ?? []).map((x) => x.subject) }))
    .sort((a, b) => Number(b.isClassTeacher) - Number(a.isClassTeacher) || a.name.localeCompare(b.name));
}

// ── transitions ─────────────────────────────────────────────────────────────────────────────────

async function userIdOfStaff(db: Executor, staffId: string): Promise<string | null> {
  const [r] = await db.select({ userId: staff.userId }).from(staff).where(eq(staff.id, staffId)).limit(1);
  return r?.userId ?? null;
}

/** The requesting parent's account — only while that guardian is still a verified link of the child. */
async function requesterRecipient(db: Executor, m: Row): Promise<string[]> {
  if (!m.guardianId) return [];
  const [g] = await db
    .select({ userId: guardians.userId })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(and(eq(studentGuardians.studentId, m.studentId), eq(studentGuardians.guardianId, m.guardianId), sql`${studentGuardians.verifiedAt} is not null`))
    .limit(1);
  return g?.userId ? [g.userId] : [];
}

async function notifyMeeting(db: Executor, tenant: TenantInfo, userIds: string[], type: string, title: string, meetingId: string, body?: string) {
  // titles stay neutral (meeting is a "private" push category: lock screens only show a generic line anyway)
  if (userIds.length) await notify(db, tenant, { userIds, type, title, body, data: { route: `/meetings/${meetingId}`, meetingId } });
}

export async function requestMeeting(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, body: { studentId: string; staffId: string; topic: string; proposedAt?: string }): Promise<MeetingItem> {
  if (!p.guardianId) throw forbidden('Only a parent or guardian can request a meeting');
  await assertStudentAccess(db, p, 'meetings:create', body.studentId);
  const proposedAt = body.proposedAt ? new Date(body.proposedAt) : null;
  if (proposedAt && proposedAt.getTime() < Date.now()) throw unprocessable('Choose a time in the future', 'PROPOSED_AT_IN_PAST');
  const allowed = await teacherOptions(db, p, body.studentId);
  if (!allowed.some((t) => t.staffId === body.staffId)) throw unprocessable('That teacher does not teach or lead your child’s class', 'TEACHER_NOT_ASSIGNED');
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`meeting-request:${body.studentId}:${body.staffId}`}))`);
    const [open] = await tx.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.studentId, body.studentId), eq(meetings.staffId, body.staffId), eq(meetings.status, 'requested'))).limit(1);
    if (open) throw conflict('You already have a pending request with this teacher', 'MEETING_ALREADY_REQUESTED');
    const [m] = await tx
      .insert(meetings)
      .values({ studentId: body.studentId, guardianId: p.guardianId, staffId: body.staffId, requestedBy: p.userId, topic: body.topic, proposedAt })
      .returning();
    await audit(tx, actor, { action: 'meeting.request', entity: 'meeting', entityId: m!.id, summary: snippet(body.topic, 80), after: { studentId: body.studentId, staffId: body.staffId, proposedAt } });
    return m!;
  });
  const teacherUser = await userIdOfStaff(db, body.staffId);
  await notifyMeeting(db, tenant, teacherUser ? [teacherUser] : [], 'meeting.requested', 'New meeting request', created.id);
  return getMeeting(db, p, created.id, tenant.id);
}

interface Slot {
  scheduledAt: string;
  durationMin?: number;
  mode?: Row['mode'];
  locationOrLink?: string;
  /** zoom / google: the provider creates the meeting; null: the teacher types a link; omitted: keep the meeting's provider, or use the school's default */
  provider?: OnlineProvider | null;
}

/** Which provider (if any) handles an online meeting. Only `online` meetings have one. */
async function chooseProvider(db: Executor, base: Pick<Row, 'mode' | 'onlineProvider'>, mode: Row['mode'], requested: OnlineProvider | null | undefined): Promise<OnlineProvider | null> {
  if (mode !== 'online' || requested === null) return null;
  if (requested) {
    if (requested !== base.onlineProvider) await assertProviderUsable(db, requested, 'provider');
    return requested;
  }
  if (base.mode === 'online') return base.onlineProvider; // rescheduling: keep what the meeting already has
  return defaultProvider(db); // null when nothing is connected: the teacher types a link, as before
}

async function resolveSlot(db: Executor, base: Pick<Row, 'durationMin' | 'mode' | 'locationOrLink' | 'onlineProvider'>, slot: Slot): Promise<{ scheduledAt: Date; durationMin: number; mode: Row['mode']; locationOrLink: string | null; onlineProvider: OnlineProvider | null }> {
  const scheduledAt = new Date(slot.scheduledAt);
  if (scheduledAt.getTime() < Date.now() - 60_000) throw unprocessable('Choose a time in the future', 'SCHEDULED_AT_IN_PAST');
  const mode = slot.mode ?? base.mode;
  const onlineProvider = await chooseProvider(db, base, mode, slot.provider);
  const locationOrLink = slot.locationOrLink ?? (slot.mode && slot.mode !== base.mode ? null : base.locationOrLink);
  // a provider creates the link itself; without one the teacher has to give it
  if (mode === 'online' && !onlineProvider && !locationOrLink) throw unprocessable('An online meeting needs a link', 'MEETING_LINK_REQUIRED');
  return { scheduledAt, durationMin: slot.durationMin ?? base.durationMin, mode, locationOrLink, onlineProvider };
}

/** Lock the teacher's calendar and make sure no other confirmed meeting overlaps the slot. */
async function assertSlotFree(tx: Executor, staffId: string, meetingId: string, slot: { scheduledAt: Date; durationMin: number }) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`meeting-slot:${staffId}`}))`);
  const end = new Date(slot.scheduledAt.getTime() + slot.durationMin * 60_000);
  const [clash] = await tx
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(eq(meetings.staffId, staffId), eq(meetings.status, 'confirmed'), sql`${meetings.id} <> ${meetingId}`, sql`${meetings.scheduledAt} < ${end}`, sql`${meetings.scheduledAt} + (${meetings.durationMin} * interval '1 minute') > ${slot.scheduledAt}`))
    .limit(1);
  if (clash) throw conflict('The teacher already has a meeting at that time', 'MEETING_SLOT_TAKEN');
}

type Log = { error(o: unknown, m?: string): void };
const syncMeeting = (db: Executor, tenant: TenantInfo, actor: AuditActor, id: string, log?: Log) => syncOnline(tenant, db, 'meeting', id, { actor, log });

export async function confirm(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, body: Slot, log?: Log): Promise<MeetingItem> {
  const m = await db.transaction(async (tx) => {
    const r = await load(tx, p, id);
    const m = r.m;
    if (!canDecide(p, m, r.sectionId)) throw forbidden('Only the teacher, the class teacher or the school office can confirm');
    if (m.status !== 'requested') throw conflict(`A ${m.status} meeting cannot be confirmed`, 'MEETING_INVALID_STATE');
    const slot = await resolveSlot(tx, m, body);
    await assertSlotFree(tx, m.staffId, id, slot);
    await tx.update(meetings).set({ status: 'confirmed', ...slot, decidedBy: p.userId }).where(eq(meetings.id, id));
    await audit(tx, actor, { action: 'meeting.confirm', entity: 'meeting', entityId: id, before: { status: m.status }, after: { status: 'confirmed', ...slot } });
    return m;
  });
  await syncMeeting(db, tenant, actor, id, log); // the provider meeting exists (or its failure is recorded) before the parent is told
  await notifyMeeting(db, tenant, await requesterRecipient(db, m), 'meeting.confirmed', 'Meeting confirmed', id);
  return getMeeting(db, p, id, tenant.id);
}

export async function decline(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, reason: string): Promise<MeetingItem> {
  const m = await db.transaction(async (tx) => {
    const r = await load(tx, p, id);
    if (!canDecide(p, r.m, r.sectionId)) throw forbidden('Only the teacher, the class teacher or the school office can decline');
    if (r.m.status !== 'requested') throw conflict(`A ${r.m.status} meeting cannot be declined`, 'MEETING_INVALID_STATE');
    await tx.update(meetings).set({ status: 'declined', outcomeNotes: reason, decidedBy: p.userId }).where(eq(meetings.id, id));
    await audit(tx, actor, { action: 'meeting.decline', entity: 'meeting', entityId: id, before: { status: r.m.status }, after: { status: 'declined', reason } });
    return r.m;
  });
  await notifyMeeting(db, tenant, await requesterRecipient(db, m), 'meeting.declined', 'Meeting request declined', id);
  return getMeeting(db, p, id, tenant.id);
}

export async function reschedule(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, body: Slot, log?: Log): Promise<MeetingItem> {
  const m = await db.transaction(async (tx) => {
    const r = await load(tx, p, id);
    if (!canDecide(p, r.m, r.sectionId)) throw forbidden('Only the teacher, the class teacher or the school office can reschedule');
    if (r.m.status !== 'confirmed') throw conflict('Only a confirmed meeting can be rescheduled', 'MEETING_INVALID_STATE');
    const slot = await resolveSlot(tx, r.m, body);
    await assertSlotFree(tx, r.m.staffId, id, slot);
    await tx.update(meetings).set({ ...slot, decidedBy: p.userId }).where(eq(meetings.id, id));
    await audit(tx, actor, { action: 'meeting.reschedule', entity: 'meeting', entityId: id, before: { scheduledAt: r.m.scheduledAt, mode: r.m.mode }, after: slot });
    return r.m;
  });
  await syncMeeting(db, tenant, actor, id, log); // moves / switches / cancels the provider meeting to match
  await notifyMeeting(db, tenant, await requesterRecipient(db, m), 'meeting.rescheduled', 'Meeting rescheduled', id);
  return getMeeting(db, p, id, tenant.id);
}

export async function complete(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, outcomeNotes: string, log?: Log): Promise<MeetingItem> {
  await db.transaction(async (tx) => {
    const r = await load(tx, p, id);
    if (!canDecide(p, r.m, r.sectionId)) throw forbidden('Only the teacher, the class teacher or the school office can complete a meeting');
    if (r.m.status !== 'confirmed') throw conflict('Only a confirmed meeting can be completed', 'MEETING_INVALID_STATE');
    // a finished meeting no longer needs its room at the provider: no provider wanted from now on (the sync below removes it)
    await tx.update(meetings).set({ status: 'completed', outcomeNotes, decidedBy: p.userId, onlineProvider: null }).where(eq(meetings.id, id));
    await audit(tx, actor, { action: 'meeting.complete', entity: 'meeting', entityId: id, before: { status: r.m.status }, after: { status: 'completed' } });
  });
  await syncMeeting(db, tenant, actor, id, log);
  return getMeeting(db, p, id, tenant.id);
}

export async function cancel(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, reason?: string, log?: Log): Promise<MeetingItem> {
  const { m, byRequester } = await db.transaction(async (tx) => {
    const r = await load(tx, p, id);
    const requester = r.m.requestedBy === p.userId;
    if (!requester && !canDecide(p, r.m, r.sectionId)) throw forbidden('You cannot cancel this meeting');
    if (r.m.status !== 'requested' && r.m.status !== 'confirmed') throw conflict(`A ${r.m.status} meeting cannot be cancelled`, 'MEETING_INVALID_STATE');
    await tx.update(meetings).set({ status: 'cancelled', outcomeNotes: reason ?? null, decidedBy: p.userId }).where(eq(meetings.id, id));
    await audit(tx, actor, { action: 'meeting.cancel', entity: 'meeting', entityId: id, before: { status: r.m.status }, after: { status: 'cancelled', reason } });
    return { m: r.m, byRequester: requester };
  });
  await syncMeeting(db, tenant, actor, id, log); // cancels the provider meeting (a failure is recorded and retried; the cancellation itself stands)
  if (byRequester) {
    const teacherUser = await userIdOfStaff(db, m.staffId);
    await notifyMeeting(db, tenant, teacherUser ? [teacherUser] : [], 'meeting.cancelled', 'Meeting cancelled', id);
  } else {
    await notifyMeeting(db, tenant, await requesterRecipient(db, m), 'meeting.cancelled', 'Meeting cancelled', id);
  }
  return getMeeting(db, p, id, tenant.id);
}

/** Retry button: finish creating, updating or cancelling the meeting's online room (only while it is in the `failed` state). */
export async function retryOnline(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, log?: Log): Promise<MeetingItem> {
  const r = await load(db, p, id);
  if (!canDecide(p, r.m, r.sectionId)) throw forbidden('Only the teacher, the class teacher or the school office can retry the online meeting');
  if (r.m.onlineStatus !== 'failed') throw conflict('There is nothing to retry for this meeting’s online room', 'ONLINE_MEETING_NOT_FAILED');
  await audit(db, actor, { action: 'meeting.online_retry', entity: 'meeting', entityId: id });
  const outcome = await syncOnline(tenant, db, 'meeting', id, { manual: true, actor, log });
  if (outcome === 'busy') throw conflict('The online meeting is being updated right now. Try again in a moment.', 'ONLINE_MEETING_BUSY');
  return getMeeting(db, p, id, tenant.id);
}
