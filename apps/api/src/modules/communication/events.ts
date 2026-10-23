import { and, asc, count, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { EventChildResponse, EventCounts, EventCreateBody, EventItem, EventResponse, EventUpdateBody } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { ilikeAny, todayIn } from '../../core/http';
import { notify } from '../../core/notify';
import type { Principal } from '../../core/rbac/principal';
import { assertStudentAccess } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { audienceTargets, eventRegistrations, events } from '../../db/tenant/schema';
import { audienceMatchesPrincipal, audienceStudentsSql, resolveAudienceUserIds } from './audience';
import { loadAudience, normalizeTargets, replaceTargets, snippet } from './common';

export type EventRow = typeof events.$inferSelect;

const POSITIVE: EventResponse[] = ['going', 'consent_given'];

// ── visibility ──────────────────────────────────────────────────────────────────────────────────

export const canManageEvent = (p: Principal, ev: Pick<EventRow, 'createdBy'>): boolean => {
  const scope = p.scope('events:edit');
  return scope === 'school' || (!!scope && ev.createdBy === p.userId);
};

/** School-scope editors see everything; everyone else sees published / cancelled events of their audience, plus their own drafts. */
export function visibleCond(p: Principal): SQL {
  if (p.scope('events:edit') === 'school') return sql`true`;
  return or(eq(events.createdBy, p.userId), and(inArray(events.status, ['published', 'cancelled']), audienceMatchesPrincipal(p, 'event', events.id, { staffBySection: true })))!;
}

const needsResponse = (ev: Pick<EventRow, 'registrationRequired' | 'consentRequired'>) => ev.registrationRequired || ev.consentRequired;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

// ── mapping ─────────────────────────────────────────────────────────────────────────────────────

export function toItem(ev: EventRow, p: Principal, today: string, x: { children?: EventChildResponse[]; audience?: EventItem['audience']; counts?: EventCounts | null } = {}, now = new Date()): EventItem {
  const manage = canManageEvent(p, ev);
  return {
    id: ev.id,
    title: ev.title,
    description: ev.description,
    kind: ev.kind,
    status: ev.status,
    startDate: ev.startDate,
    endDate: ev.endDate,
    startTime: hhmm(ev.startTime),
    endTime: hhmm(ev.endTime),
    allDay: ev.allDay,
    location: ev.location,
    registrationRequired: ev.registrationRequired,
    consentRequired: ev.consentRequired,
    consentText: ev.consentText,
    registrationDeadline: ev.registrationDeadline?.toISOString() ?? null,
    capacity: ev.capacity,
    createdAt: ev.createdAt.toISOString(),
    canManage: manage,
    responseOpen: ev.status === 'published' && needsResponse(ev) && ev.endDate >= today && (!ev.registrationDeadline || ev.registrationDeadline >= now),
    children: x.children ?? [],
    audience: manage ? (x.audience ?? []) : [],
    counts: manage ? (x.counts ?? null) : null,
  };
}

/** For parents / students: each child in the audience of the given events that asks for an answer, with the answer so far. */
async function loadChildren(db: Executor, p: Principal, evs: EventRow[]): Promise<Map<string, EventChildResponse[]>> {
  const out = new Map<string, EventChildResponse[]>();
  const mine = p.userType === 'student' ? (p.studentId ? [p.studentId] : []) : p.userType === 'parent' ? p.linkedStudentIds : [];
  const ask = evs.filter((e) => needsResponse(e) && e.status !== 'draft');
  if (!mine.length || !ask.length) return out;
  const res = await db.execute<{ event_id: string; student_id: string; first_name: string; last_name: string | null; response: EventResponse | null; note: string | null; responded_at: Date | null }>(sql`
    select e.id as event_id, s.id as student_id, s.first_name, s.last_name, er.response, er.note, er.responded_at
    from events e
    join students s on s.id in (${sql.join(mine.map((m) => sql`${m}`), sql`, `)})
    left join event_registrations er on er.event_id = e.id and er.student_id = s.id
    where e.id in (${sql.join(ask.map((e) => sql`${e.id}`), sql`, `)}) and exists (
      select 1 from audience_targets t
      where t.owner_type = 'event' and t.owner_id = e.id and (
        t.target_type = 'all'
        or (t.target_type = 'user_type' and t.target_id in ('student', 'parent'))
        or (t.target_type = 'role' and t.target_id in ('student', 'parent'))
        or (t.target_type = 'grade' and t.target_id = s.current_grade_id::text)
        or (t.target_type = 'section' and t.target_id = s.current_section_id::text)
      ))
    order by s.first_name, s.id`);
  for (const r of res.rows) {
    const list = out.get(r.event_id) ?? [];
    list.push({ studentId: r.student_id, studentName: [r.first_name, r.last_name].filter(Boolean).join(' '), response: r.response, note: r.note, respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null });
    out.set(r.event_id, list);
  }
  return out;
}

export async function eventCounts(db: Executor, ev: Pick<EventRow, 'id' | 'capacity'>): Promise<EventCounts> {
  const res = await db.execute<{ eligible: number; going: number; not_going: number; consent_given: number; consent_denied: number; responded: number }>(sql`
    with elig as (${audienceStudentsSql(ev.id)})
    select (select count(*) from elig)::int as eligible,
      count(*) filter (where er.response = 'going')::int as going,
      count(*) filter (where er.response = 'not_going')::int as not_going,
      count(*) filter (where er.response = 'consent_given')::int as consent_given,
      count(*) filter (where er.response = 'consent_denied')::int as consent_denied,
      count(*)::int as responded
    from event_registrations er where er.event_id = ${ev.id} and er.student_id in (select student_id from elig)`);
  const r = res.rows[0] ?? { eligible: 0, going: 0, not_going: 0, consent_given: 0, consent_denied: 0, responded: 0 };
  const taken = r.going + r.consent_given;
  return { eligible: r.eligible, going: r.going, notGoing: r.not_going, consentGiven: r.consent_given, consentDenied: r.consent_denied, pending: Math.max(0, r.eligible - r.responded), capacity: ev.capacity, seatsLeft: ev.capacity === null ? null : Math.max(0, ev.capacity - taken) };
}

// ── reads ───────────────────────────────────────────────────────────────────────────────────────

export async function listEvents(db: Executor, tenant: TenantInfo, p: Principal, q: { page: number; pageSize: number; q?: string; from?: string; to?: string; kind?: EventRow['kind']; status?: EventRow['status'] }) {
  const today = todayIn(tenant.timezone);
  const where = and(
    visibleCond(p),
    q.kind ? eq(events.kind, q.kind) : undefined,
    q.status ? eq(events.status, q.status) : undefined,
    q.from ? gte(events.endDate, q.from) : undefined,
    q.to ? lte(events.startDate, q.to) : undefined,
    !q.from && !q.to ? gte(events.endDate, today) : undefined,
    q.q ? ilikeAny(q.q, events.title, events.location, events.description) : undefined,
  );
  const [rows, totalRow] = await Promise.all([
    db.select().from(events).where(where).orderBy(asc(events.startDate), sql`${events.startTime} asc nulls first`, asc(events.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(events).where(where),
  ]);
  const [children, audience] = await Promise.all([loadChildren(db, p, rows), loadAudience(db, 'event', rows.filter((e) => canManageEvent(p, e)).map((e) => e.id))]);
  return { items: rows.map((e) => toItem(e, p, today, { children: children.get(e.id), audience: audience.get(e.id) })), total: totalRow[0]?.n ?? 0 };
}

export async function getEvent(db: Executor, tenant: TenantInfo, p: Principal, id: string): Promise<EventItem> {
  const [ev] = await db.select().from(events).where(and(eq(events.id, id), visibleCond(p))).limit(1);
  if (!ev) throw notFound('Event');
  const manage = canManageEvent(p, ev);
  const [children, audience, counts] = await Promise.all([loadChildren(db, p, [ev]), manage ? loadAudience(db, 'event', [id]) : new Map(), manage && needsResponse(ev) ? eventCounts(db, ev) : Promise.resolve(null)]);
  return toItem(ev, p, todayIn(tenant.timezone), { children: children.get(id), audience: audience.get(id), counts });
}

// ── writes ──────────────────────────────────────────────────────────────────────────────────────

type Shape = Pick<EventRow, 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'allDay' | 'registrationRequired' | 'consentRequired' | 'consentText' | 'registrationDeadline' | 'capacity' | 'kind'>;

function validateShape(e: Shape, tenant: TenantInfo): void {
  if (e.endDate < e.startDate) throw unprocessable('endDate cannot be before startDate', 'EVENT_DATES_INVALID');
  if (!e.allDay && !e.startTime) throw unprocessable('A timed event needs a startTime (or mark it all-day)', 'EVENT_TIME_REQUIRED');
  if (e.startTime && e.endTime && e.endDate === e.startDate && hhmm(e.endTime)! <= hhmm(e.startTime)!) throw unprocessable('endTime must be after startTime', 'EVENT_TIME_INVALID');
  if (e.consentRequired && !e.consentText?.trim()) throw unprocessable('Add the consent text parents will agree to', 'CONSENT_TEXT_REQUIRED');
  if (!needsResponse(e) && (e.capacity !== null || e.registrationDeadline !== null)) throw unprocessable('capacity and registrationDeadline only apply to events with registration or consent', 'RESPONSE_SETTINGS_WITHOUT_REGISTRATION');
  if (e.registrationDeadline && todayIn(tenant.timezone, e.registrationDeadline) > e.endDate) throw unprocessable('The deadline must be on or before the last day of the event', 'DEADLINE_AFTER_EVENT');
}

const fromRow = (r: EventRow): Shape => r;

export async function createEvent(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, body: EventCreateBody): Promise<{ id: string; notify: boolean }> {
  if (body.publish && !p.scope('events:publish')) throw forbidden('You may not publish events');
  const shape: Shape = {
    kind: body.kind,
    startDate: body.startDate,
    endDate: body.endDate ?? body.startDate,
    startTime: body.startTime ?? null,
    endTime: body.endTime ?? null,
    allDay: body.allDay ?? !body.startTime,
    registrationRequired: body.registrationRequired,
    consentRequired: body.consentRequired,
    consentText: body.consentText ?? null,
    registrationDeadline: body.registrationDeadline ? new Date(body.registrationDeadline) : null,
    capacity: body.capacity ?? null,
  };
  validateShape(shape, tenant);
  const id = await db.transaction(async (tx) => {
    const targets = await normalizeTargets(tx, p, 'events:create', body.audience);
    const [ev] = await tx
      .insert(events)
      .values({ ...shape, title: body.title, description: body.description ?? null, location: body.location ?? null, audienceAll: targets.some((t) => t.type === 'all'), status: body.publish ? 'published' : 'draft', createdBy: p.userId })
      .returning();
    await replaceTargets(tx, 'event', ev!.id, targets);
    await audit(tx, actor, { action: body.publish ? 'event.publish' : 'event.create', entity: 'event', entityId: ev!.id, summary: ev!.title, after: { kind: ev!.kind, startDate: ev!.startDate, endDate: ev!.endDate, audience: targets, status: ev!.status } });
    return ev!.id;
  });
  return { id, notify: !!body.publish };
}

export async function updateEvent(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, body: EventUpdateBody): Promise<{ notifyChange: boolean }> {
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(events).where(eq(events.id, id)).limit(1).for('update');
    if (!ev || !canManageEvent(p, ev)) throw notFound('Event');
    if (ev.status === 'cancelled') throw conflict('A cancelled event cannot be edited', 'EVENT_CANCELLED');
    const next: EventRow = {
      ...ev,
      title: body.title ?? ev.title,
      description: body.description === undefined ? ev.description : body.description,
      kind: body.kind ?? ev.kind,
      startDate: body.startDate ?? ev.startDate,
      endDate: body.endDate ?? (body.startDate && body.startDate > ev.endDate ? body.startDate : ev.endDate),
      startTime: body.startTime === undefined ? ev.startTime : body.startTime,
      endTime: body.endTime === undefined ? ev.endTime : body.endTime,
      allDay: body.allDay ?? (body.startTime ? false : ev.allDay),
      location: body.location === undefined ? ev.location : body.location,
      registrationRequired: body.registrationRequired ?? ev.registrationRequired,
      consentRequired: body.consentRequired ?? ev.consentRequired,
      consentText: body.consentText === undefined ? ev.consentText : body.consentText,
      registrationDeadline: body.registrationDeadline === undefined ? ev.registrationDeadline : body.registrationDeadline ? new Date(body.registrationDeadline) : null,
      capacity: body.capacity === undefined ? ev.capacity : body.capacity,
    };
    validateShape(fromRow(next), tenant);
    if (next.capacity !== null && next.capacity !== ev.capacity) {
      const [taken] = await tx.select({ n: count() }).from(eventRegistrations).where(and(eq(eventRegistrations.eventId, id), inArray(eventRegistrations.response, POSITIVE)));
      if ((taken?.n ?? 0) > next.capacity) throw conflict(`${taken?.n} children are already registered; capacity cannot go below that`, 'CAPACITY_BELOW_REGISTRATIONS');
    }
    if (body.audience !== undefined) {
      const targets = await normalizeTargets(tx, p, 'events:create', body.audience);
      await replaceTargets(tx, 'event', id, targets);
      next.audienceAll = targets.some((t) => t.type === 'all');
    }
    const { id: _id, createdAt: _c, updatedAt: _u, createdBy: _b, status: _s, ...set } = next;
    await tx.update(events).set(set).where(eq(events.id, id));
    await audit(tx, actor, { action: 'event.update', entity: 'event', entityId: id, summary: next.title, before: { title: ev.title, startDate: ev.startDate, endDate: ev.endDate, startTime: ev.startTime, location: ev.location }, after: { ...body, audience: body.audience } });
    const moved = next.startDate !== ev.startDate || next.endDate !== ev.endDate || next.startTime !== ev.startTime || next.location !== ev.location;
    return { notifyChange: ev.status === 'published' && moved };
  });
}

export async function publishEvent(db: Executor, p: Principal, actor: AuditActor, id: string): Promise<EventRow> {
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(events).where(eq(events.id, id)).limit(1).for('update');
    if (!ev || !canManageEvent(p, ev)) throw notFound('Event');
    if (ev.status !== 'draft') throw conflict('Only a draft can be published', 'EVENT_NOT_DRAFT');
    const [t] = await tx.select({ n: count() }).from(audienceTargets).where(and(eq(audienceTargets.ownerType, 'event'), eq(audienceTargets.ownerId, id)));
    if (!(t?.n ?? 0)) throw unprocessable('Choose who this is for before publishing', 'AUDIENCE_EMPTY');
    const [row] = await tx.update(events).set({ status: 'published' }).where(eq(events.id, id)).returning();
    await audit(tx, actor, { action: 'event.publish', entity: 'event', entityId: id, summary: ev.title, before: { status: 'draft' }, after: { status: 'published' } });
    return row!;
  });
}

export async function cancelEvent(db: Executor, p: Principal, actor: AuditActor, id: string): Promise<EventRow> {
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(events).where(eq(events.id, id)).limit(1).for('update');
    if (!ev || !canManageEvent(p, ev)) throw notFound('Event');
    if (ev.status === 'cancelled') throw conflict('Already cancelled', 'EVENT_CANCELLED');
    const [row] = await tx.update(events).set({ status: 'cancelled' }).where(eq(events.id, id)).returning();
    await audit(tx, actor, { action: 'event.cancel', entity: 'event', entityId: id, summary: ev.title, before: { status: ev.status }, after: { status: 'cancelled' } });
    return row!;
  });
}

export async function deleteEvent(db: Executor, p: Principal, actor: AuditActor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [ev] = await tx.select().from(events).where(eq(events.id, id)).limit(1).for('update');
    if (!ev || !(canManageEvent(p, ev) || p.scope('events:delete'))) throw notFound('Event');
    if (ev.status !== 'draft') {
      if (!p.scope('events:delete')) throw forbidden('Only drafts can be deleted; cancel the event instead');
      const [regs] = await tx.select({ n: count() }).from(eventRegistrations).where(eq(eventRegistrations.eventId, id));
      if ((regs?.n ?? 0) > 0) throw conflict('This event has registrations; cancel it instead of deleting', 'EVENT_HAS_RESPONSES');
    }
    await tx.delete(audienceTargets).where(and(eq(audienceTargets.ownerType, 'event'), eq(audienceTargets.ownerId, id)));
    await tx.delete(events).where(eq(events.id, id));
    await audit(tx, actor, { action: 'event.delete', entity: 'event', entityId: id, summary: ev.title, before: { status: ev.status, startDate: ev.startDate } });
  });
}

/** Tell the audience (minus the actor). Holidays are on the calendar but never pushed. */
export async function announceEvent(db: Executor, tenant: TenantInfo, ev: EventRow, actorUserId: string, kind: 'new' | 'updated' | 'cancelled'): Promise<number> {
  if (ev.kind === 'holiday' && kind === 'new') return 0;
  const audience = (await resolveAudienceUserIds(db, 'event', ev.id)).filter((u) => u !== actorUserId);
  if (!audience.length) return 0;
  const when = ev.startDate === ev.endDate ? ev.startDate : `${ev.startDate} – ${ev.endDate}`;
  const title = kind === 'new' ? `New: ${ev.title}` : kind === 'updated' ? `Updated: ${ev.title}` : `Cancelled: ${ev.title}`;
  const body = kind === 'new' && needsResponse(ev) ? snippet(`${when}. Your response is needed${ev.registrationDeadline ? ` by ${ev.registrationDeadline.toISOString().slice(0, 10)}` : ''}.`) : snippet(`${when}${ev.location ? ` · ${ev.location}` : ''}`);
  const ids = await notify(db, tenant, { userIds: audience, type: `event.${kind}`, title, body, data: { route: `/events/${ev.id}`, eventId: ev.id } });
  return ids.length;
}

// ── registration & consent ──────────────────────────────────────────────────────────────────────

export async function respond(db: Executor, tenant: TenantInfo, p: Principal, id: string, body: { studentId: string; response: EventResponse; note?: string }): Promise<EventChildResponse> {
  // 404 unless the child is the caller's own / a verified linked child
  await assertStudentAccess(db, p, 'event_responses:create', body.studentId);
  const now = new Date();
  return db.transaction(async (tx) => {
    // the event row lock serialises concurrent answers, so the capacity check below cannot be raced past
    const [ev] = await tx.select().from(events).where(and(eq(events.id, id), inArray(events.status, ['published', 'cancelled']))).limit(1).for('update');
    if (!ev) throw notFound('Event');
    const inAudience = await tx.execute<{ ok: boolean }>(sql`select exists (select 1 from (${audienceStudentsSql(id)}) a where a.student_id = ${body.studentId}) as ok`);
    if (!inAudience.rows[0]?.ok) throw notFound('Event');
    if (ev.status === 'cancelled') throw conflict('This event has been cancelled', 'EVENT_CANCELLED');
    if (!needsResponse(ev)) throw unprocessable('This event does not ask for a response', 'NO_RESPONSE_REQUIRED');
    const consent = ev.consentRequired;
    const allowed: EventResponse[] = consent ? ['consent_given', 'consent_denied'] : ['going', 'not_going'];
    if (!allowed.includes(body.response)) throw unprocessable(consent ? 'This event needs consent: answer consent_given or consent_denied' : 'This event needs registration: answer going or not_going', 'RESPONSE_NOT_ALLOWED');
    if (consent && p.userType === 'student') throw new AppError(403, 'CONSENT_REQUIRES_GUARDIAN', 'A parent or guardian must give consent');
    if (ev.endDate < todayIn(tenant.timezone, now)) throw conflict('This event is over', 'EVENT_ENDED');
    if (ev.registrationDeadline && ev.registrationDeadline < now) throw conflict('The deadline to respond has passed', 'REGISTRATION_CLOSED');
    if (ev.capacity !== null && POSITIVE.includes(body.response)) {
      const [taken] = await tx
        .select({ n: count() })
        .from(eventRegistrations)
        .where(and(eq(eventRegistrations.eventId, id), inArray(eventRegistrations.response, POSITIVE), sql`${eventRegistrations.studentId} <> ${body.studentId}`));
      if ((taken?.n ?? 0) >= ev.capacity) throw conflict('This event is full', 'EVENT_FULL');
    }
    const [row] = await tx
      .insert(eventRegistrations)
      .values({ eventId: id, studentId: body.studentId, respondedBy: p.userId, response: body.response, note: body.note ?? null, respondedAt: now })
      .onConflictDoUpdate({ target: [eventRegistrations.eventId, eventRegistrations.studentId], set: { respondedBy: p.userId, response: body.response, note: body.note ?? null, respondedAt: now } })
      .returning();
    await audit(tx, { userId: p.userId, name: p.displayName }, { action: consent ? 'event.consent' : 'event.register', entity: 'event', entityId: id, summary: ev.title, after: { studentId: body.studentId, response: body.response } });
    const res = await tx.execute<{ first_name: string; last_name: string | null }>(sql`select first_name, last_name from students where id = ${body.studentId}`);
    const s = res.rows[0];
    return { studentId: body.studentId, studentName: [s?.first_name, s?.last_name].filter(Boolean).join(' '), response: row!.response, note: row!.note, respondedAt: row!.respondedAt.toISOString() };
  });
}

/** Organisers: who answered what (and with `response=pending`, who has not answered yet). */
export async function listResponses(db: Executor, p: Principal, id: string, q: { page: number; pageSize: number; q?: string; response?: EventResponse | 'pending'; sectionId?: string }) {
  const [ev] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!ev) throw notFound('Event');
  const filters: SQL[] = [];
  if (!canManageEvent(p, ev)) {
    // a class teacher may chase answers from the sections they lead, for any event that includes them
    const led = p.scope('events:edit') || p.scope('events:create') ? p.classTeacherSectionIds : [];
    if (!led.length || !(await db.select({ id: events.id }).from(events).where(and(eq(events.id, id), visibleCond(p))).limit(1)).length) throw notFound('Event');
    filters.push(sql`s.current_section_id in (${sql.join(led.map((x) => sql`${x}`), sql`, `)})`);
  }
  if (q.response === 'pending') filters.push(sql`er.response is null`);
  else if (q.response) filters.push(sql`er.response = ${q.response}`);
  if (q.sectionId) filters.push(sql`s.current_section_id = ${q.sectionId}`);
  if (q.q) filters.push(sql`(s.first_name || ' ' || coalesce(s.last_name, '') ilike ${`%${q.q.replace(/[\\%_]/g, '\\$&')}%`} or s.admission_no ilike ${`%${q.q.replace(/[\\%_]/g, '\\$&')}%`})`);
  const where = filters.length ? sql`where ${sql.join(filters, sql` and `)}` : sql``;
  const from = sql`
    from (${audienceStudentsSql(id)}) a
    join students s on s.id = a.student_id
    left join sections sec on sec.id = s.current_section_id
    left join grades gr on gr.id = s.current_grade_id
    left join event_registrations er on er.event_id = ${id} and er.student_id = s.id
    left join users u on u.id = er.responded_by`;
  const [rows, total] = await Promise.all([
    db.execute<{ student_id: string; first_name: string; last_name: string | null; admission_no: string; grade: string | null; section: string | null; response: EventResponse | null; note: string | null; responded_by: string | null; responded_at: Date | null }>(sql`
      select s.id as student_id, s.first_name, s.last_name, s.admission_no, gr.name as grade, sec.name as section, er.response, er.note, u.display_name as responded_by, er.responded_at
      ${from} ${where} order by gr.ordinal nulls last, sec.name, s.roll_no nulls last, s.first_name, s.id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
    db.execute<{ n: number }>(sql`select count(*)::int as n ${from} ${where}`),
  ]);
  return {
    items: rows.rows.map((r) => ({
      studentId: r.student_id,
      studentName: [r.first_name, r.last_name].filter(Boolean).join(' '),
      admissionNo: r.admission_no,
      grade: r.grade,
      section: r.section,
      response: r.response,
      note: r.note,
      respondedBy: r.responded_by,
      respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null,
    })),
    total: total.rows[0]?.n ?? 0,
  };
}
