import { and, asc, count, eq, gt, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { InsuranceStatus, TransportAllocation, TransportManifest, TransportMyBusItem, TransportRoute, TransportStop, TransportVehicle } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { conflict, notFound, unprocessable } from '../../core/errors';
import { addDaysIso, ilikeAny, todayIn } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import { assertStudentAccess } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { grades, sections, studentTransport, students, transportRoutes, transportStops, transportVehicles } from '../../db/tenant/schema';

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const fullName = (a: string, b: string | null) => [a, b].filter(Boolean).join(' ');

// ── vehicles ────────────────────────────────────────────────────────────────────────────────────

export function insuranceStatus(expiry: string | null, today: string): InsuranceStatus {
  if (!expiry) return 'unknown';
  if (expiry < today) return 'expired';
  return expiry <= addDaysIso(today, 30) ? 'expiring' : 'valid';
}

type VehicleRow = typeof transportVehicles.$inferSelect;
const toVehicle = (v: VehicleRow, routeCount: number, today: string): TransportVehicle => ({
  id: v.id,
  registrationNo: v.registrationNo,
  model: v.model,
  capacity: v.capacity,
  driverName: v.driverName,
  driverPhone: v.driverPhone,
  attendantName: v.attendantName,
  insuranceExpiry: v.insuranceExpiry,
  insuranceStatus: insuranceStatus(v.insuranceExpiry, today),
  isActive: v.isActive,
  routeCount,
  createdAt: v.createdAt.toISOString(),
});

const activeRoutesOf = sql<number>`(select count(*)::int from ${transportRoutes} where ${transportRoutes.vehicleId} = ${transportVehicles.id} and ${transportRoutes.isActive})`;

export async function listVehicles(db: Executor, tenant: TenantInfo, q: { page: number; pageSize: number; q?: string; active?: boolean; insuranceAlert?: boolean }) {
  const today = todayIn(tenant.timezone);
  const where = and(
    q.active === undefined ? undefined : eq(transportVehicles.isActive, q.active),
    q.insuranceAlert ? and(sql`${transportVehicles.insuranceExpiry} is not null`, sql`${transportVehicles.insuranceExpiry} <= ${addDaysIso(today, 30)}`) : undefined,
    q.q ? ilikeAny(q.q, transportVehicles.registrationNo, transportVehicles.model, transportVehicles.driverName) : undefined,
  );
  const [rows, totalRow] = await Promise.all([
    db.select({ v: transportVehicles, routes: activeRoutesOf }).from(transportVehicles).where(where).orderBy(asc(transportVehicles.registrationNo)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(transportVehicles).where(where),
  ]);
  return { items: rows.map((r) => toVehicle(r.v, r.routes, today)), total: totalRow[0]?.n ?? 0 };
}

async function getVehicle(db: Executor, tenant: TenantInfo, id: string): Promise<TransportVehicle> {
  const [r] = await db.select({ v: transportVehicles, routes: activeRoutesOf }).from(transportVehicles).where(eq(transportVehicles.id, id)).limit(1);
  if (!r) throw notFound('Vehicle');
  return toVehicle(r.v, r.routes, todayIn(tenant.timezone));
}

export async function createVehicle(db: Executor, tenant: TenantInfo, actor: AuditActor, body: { registrationNo: string; model?: string | null; capacity: number; driverName?: string | null; driverPhone?: string | null; attendantName?: string | null; insuranceExpiry?: string | null }) {
  const registrationNo = body.registrationNo.toUpperCase();
  const [dup] = await db.select({ id: transportVehicles.id }).from(transportVehicles).where(eq(transportVehicles.registrationNo, registrationNo)).limit(1);
  if (dup) throw conflict('A vehicle with this registration number already exists', 'VEHICLE_EXISTS');
  const id = await db.transaction(async (tx) => {
    const [v] = await tx
      .insert(transportVehicles)
      .values({ registrationNo, model: body.model ?? null, capacity: body.capacity, driverName: body.driverName ?? null, driverPhone: body.driverPhone ?? null, attendantName: body.attendantName ?? null, insuranceExpiry: body.insuranceExpiry ?? null })
      .returning();
    await audit(tx, actor, { action: 'transport.vehicle_create', entity: 'transport_vehicle', entityId: v!.id, summary: registrationNo, after: v });
    return v!.id;
  });
  return getVehicle(db, tenant, id);
}

export async function updateVehicle(db: Executor, tenant: TenantInfo, actor: AuditActor, id: string, body: Partial<{ registrationNo: string; model: string | null; capacity: number; driverName: string | null; driverPhone: string | null; attendantName: string | null; insuranceExpiry: string | null; isActive: boolean }>) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(transportVehicles).where(eq(transportVehicles.id, id)).limit(1).for('update');
    if (!before) throw notFound('Vehicle');
    const set = { ...body, registrationNo: body.registrationNo?.toUpperCase() };
    if (set.registrationNo && set.registrationNo !== before.registrationNo) {
      const [dup] = await tx.select({ id: transportVehicles.id }).from(transportVehicles).where(and(eq(transportVehicles.registrationNo, set.registrationNo), ne(transportVehicles.id, id))).limit(1);
      if (dup) throw conflict('A vehicle with this registration number already exists', 'VEHICLE_EXISTS');
    }
    if (body.capacity !== undefined) {
      // a smaller bus cannot carry the students already allocated to its routes
      const peak = await tx.execute<{ n: number }>(
        sql`select coalesce(max(c.n), 0)::int as n from (select count(*) as n from student_transport st join transport_routes r on r.id = st.route_id where r.vehicle_id = ${id} group by st.route_id) c`,
      );
      const peakN = peak.rows[0]?.n ?? 0;
      if (peakN > body.capacity) throw conflict(`${peakN} students are already allocated to a route using this vehicle`, 'VEHICLE_CAPACITY_BELOW_ALLOCATIONS');
    }
    if (body.isActive === false) {
      const [r] = await tx.select({ n: count() }).from(transportRoutes).where(and(eq(transportRoutes.vehicleId, id), eq(transportRoutes.isActive, true)));
      if ((r?.n ?? 0) > 0) throw conflict('This vehicle is assigned to an active route; reassign the route first', 'VEHICLE_IN_USE');
    }
    await tx.update(transportVehicles).set(set).where(eq(transportVehicles.id, id));
    await audit(tx, actor, { action: 'transport.vehicle_update', entity: 'transport_vehicle', entityId: id, summary: before.registrationNo, before, after: body });
  });
  return getVehicle(db, tenant, id);
}

export const retireVehicle = (db: Executor, tenant: TenantInfo, actor: AuditActor, id: string) => updateVehicle(db, tenant, actor, id, { isActive: false });

// ── routes & stops ──────────────────────────────────────────────────────────────────────────────

type RouteJoin = { r: typeof transportRoutes.$inferSelect; v: VehicleRow | null; stops: number; students: number };

const routeSelect = (db: Executor) =>
  db
    .select({
      r: transportRoutes,
      v: transportVehicles,
      stops: sql<number>`(select count(*)::int from ${transportStops} where ${transportStops.routeId} = ${transportRoutes.id})`,
      students: sql<number>`(select count(*)::int from ${studentTransport} where ${studentTransport.routeId} = ${transportRoutes.id})`,
    })
    .from(transportRoutes)
    .leftJoin(transportVehicles, eq(transportVehicles.id, transportRoutes.vehicleId));

function toRoute(x: RouteJoin): TransportRoute {
  const capacity = x.v?.capacity ?? null;
  return {
    id: x.r.id,
    name: x.r.name,
    vehicle: x.v ? { id: x.v.id, registrationNo: x.v.registrationNo, capacity: x.v.capacity, driverName: x.v.driverName, driverPhone: x.v.driverPhone } : null,
    pickupStartTime: hhmm(x.r.pickupStartTime),
    dropStartTime: hhmm(x.r.dropStartTime),
    isActive: x.r.isActive,
    stopCount: x.stops,
    studentCount: x.students,
    capacity,
    seatsLeft: capacity === null ? null : Math.max(0, capacity - x.students),
    createdAt: x.r.createdAt.toISOString(),
  };
}

export async function listRoutes(db: Executor, q: { page: number; pageSize: number; q?: string; active?: boolean }) {
  const where = and(q.active === undefined ? undefined : eq(transportRoutes.isActive, q.active), q.q ? ilikeAny(q.q, transportRoutes.name) : undefined);
  const [rows, totalRow] = await Promise.all([routeSelect(db).where(where).orderBy(asc(transportRoutes.name)).limit(q.pageSize).offset((q.page - 1) * q.pageSize), db.select({ n: count() }).from(transportRoutes).where(where)]);
  return { items: rows.map(toRoute), total: totalRow[0]?.n ?? 0 };
}

export async function getRoute(db: Executor, id: string): Promise<TransportRoute> {
  const [x] = await routeSelect(db).where(eq(transportRoutes.id, id)).limit(1);
  if (!x) throw notFound('Route');
  return toRoute(x);
}

async function stopsOf(db: Executor, routeId: string): Promise<TransportStop[]> {
  const rows = await db
    .select({ s: transportStops, n: sql<number>`(select count(*)::int from ${studentTransport} where ${studentTransport.stopId} = ${transportStops.id})` })
    .from(transportStops)
    .where(eq(transportStops.routeId, routeId))
    .orderBy(asc(transportStops.ordinal), asc(transportStops.id));
  return rows.map(({ s, n }) => ({ id: s.id, routeId: s.routeId, name: s.name, ordinal: s.ordinal, pickupTime: hhmm(s.pickupTime), dropTime: hhmm(s.dropTime), lat: s.lat, lng: s.lng, feeMinor: s.feeMinor, studentCount: n }));
}

export async function routeDetail(db: Executor, id: string) {
  const [route, stops] = await Promise.all([getRoute(db, id), stopsOf(db, id)]);
  return { ...route, stops };
}

async function assertVehicleFits(db: Executor, vehicleId: string | null | undefined, routeId: string | null): Promise<void> {
  if (!vehicleId) return;
  const [v] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, vehicleId)).limit(1);
  if (!v) throw unprocessable('Unknown vehicle', 'VEHICLE_NOT_FOUND');
  if (!v.isActive) throw unprocessable('That vehicle is not in service', 'VEHICLE_INACTIVE');
  if (routeId) {
    const [n] = await db.select({ n: count() }).from(studentTransport).where(eq(studentTransport.routeId, routeId));
    if ((n?.n ?? 0) > v.capacity) throw conflict(`${n?.n} students are allocated to this route but the vehicle seats ${v.capacity}`, 'VEHICLE_CAPACITY_BELOW_ALLOCATIONS');
  }
}

export async function createRoute(db: Executor, actor: AuditActor, body: { name: string; vehicleId?: string | null; pickupStartTime?: string | null; dropStartTime?: string | null }) {
  const id = await db.transaction(async (tx) => {
    await assertVehicleFits(tx, body.vehicleId, null);
    const [r] = await tx.insert(transportRoutes).values({ name: body.name, vehicleId: body.vehicleId ?? null, pickupStartTime: body.pickupStartTime ?? null, dropStartTime: body.dropStartTime ?? null }).returning();
    await audit(tx, actor, { action: 'transport.route_create', entity: 'transport_route', entityId: r!.id, summary: r!.name, after: r });
    return r!.id;
  });
  return routeDetail(db, id);
}

export async function updateRoute(db: Executor, actor: AuditActor, id: string, body: Partial<{ name: string; vehicleId: string | null; pickupStartTime: string | null; dropStartTime: string | null; isActive: boolean }>) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(transportRoutes).where(eq(transportRoutes.id, id)).limit(1).for('update');
    if (!before) throw notFound('Route');
    if (body.vehicleId !== undefined) await assertVehicleFits(tx, body.vehicleId, id);
    if (body.isActive === false) {
      const [n] = await tx.select({ n: count() }).from(studentTransport).where(eq(studentTransport.routeId, id));
      if ((n?.n ?? 0) > 0) throw conflict(`${n?.n} students are still allocated to this route`, 'ROUTE_HAS_STUDENTS');
    }
    await tx.update(transportRoutes).set(body).where(eq(transportRoutes.id, id));
    await audit(tx, actor, { action: 'transport.route_update', entity: 'transport_route', entityId: id, summary: before.name, before, after: body });
  });
  return routeDetail(db, id);
}

/** Lock the route row so stop / allocation changes on it are serialised. */
async function lockRoute(tx: Executor, id: string) {
  const [r] = await tx.select().from(transportRoutes).where(eq(transportRoutes.id, id)).limit(1).for('update');
  if (!r) throw notFound('Route');
  return r;
}

export async function createStop(db: Executor, actor: AuditActor, routeId: string, body: { name: string; ordinal?: number; pickupTime?: string | null; dropTime?: string | null; lat?: number | null; lng?: number | null; feeMinor?: number | null }) {
  await db.transaction(async (tx) => {
    await lockRoute(tx, routeId);
    const [max] = await tx.select({ m: sql<number>`coalesce(max(${transportStops.ordinal}), 0)::int` }).from(transportStops).where(eq(transportStops.routeId, routeId));
    const last = max?.m ?? 0;
    const ordinal = Math.min(body.ordinal ?? last + 1, last + 1);
    if (ordinal <= last) await tx.update(transportStops).set({ ordinal: sql`${transportStops.ordinal} + 1` }).where(and(eq(transportStops.routeId, routeId), gte(transportStops.ordinal, ordinal)));
    const [s] = await tx
      .insert(transportStops)
      .values({ routeId, name: body.name, ordinal, pickupTime: body.pickupTime ?? null, dropTime: body.dropTime ?? null, lat: body.lat ?? null, lng: body.lng ?? null, feeMinor: body.feeMinor ?? null })
      .returning();
    await audit(tx, actor, { action: 'transport.stop_create', entity: 'transport_stop', entityId: s!.id, summary: `${s!.name} (route ${routeId})`, after: s });
  });
  return routeDetail(db, routeId);
}

async function loadStop(tx: Executor, id: string) {
  const [s] = await tx.select().from(transportStops).where(eq(transportStops.id, id)).limit(1);
  if (!s) throw notFound('Stop');
  return s;
}

export async function updateStop(db: Executor, actor: AuditActor, id: string, body: Partial<{ name: string; pickupTime: string | null; dropTime: string | null; lat: number | null; lng: number | null; feeMinor: number | null }>) {
  const routeId = await db.transaction(async (tx) => {
    const before = await loadStop(tx, id);
    await tx.update(transportStops).set(body).where(eq(transportStops.id, id));
    await audit(tx, actor, { action: 'transport.stop_update', entity: 'transport_stop', entityId: id, summary: before.name, before, after: body });
    return before.routeId;
  });
  return routeDetail(db, routeId);
}

export async function deleteStop(db: Executor, actor: AuditActor, id: string) {
  const routeId = await db.transaction(async (tx) => {
    const before = await loadStop(tx, id);
    await lockRoute(tx, before.routeId);
    const [n] = await tx.select({ n: count() }).from(studentTransport).where(eq(studentTransport.stopId, id));
    if ((n?.n ?? 0) > 0) throw conflict(`${n?.n} students board at this stop; move them first`, 'STOP_HAS_STUDENTS');
    await tx.delete(transportStops).where(eq(transportStops.id, id));
    await tx.update(transportStops).set({ ordinal: sql`${transportStops.ordinal} - 1` }).where(and(eq(transportStops.routeId, before.routeId), gt(transportStops.ordinal, before.ordinal)));
    await audit(tx, actor, { action: 'transport.stop_delete', entity: 'transport_stop', entityId: id, summary: before.name, before });
    return before.routeId;
  });
  return routeDetail(db, routeId);
}

export async function reorderStops(db: Executor, actor: AuditActor, routeId: string, stopIds: string[]) {
  await db.transaction(async (tx) => {
    await lockRoute(tx, routeId);
    const current = await tx.select({ id: transportStops.id }).from(transportStops).where(eq(transportStops.routeId, routeId));
    const want = new Set(stopIds);
    if (want.size !== stopIds.length || current.length !== want.size || current.some((c) => !want.has(c.id))) throw unprocessable('Send every stop of the route exactly once', 'STOP_ORDER_INVALID');
    for (const [i, id] of stopIds.entries()) await tx.update(transportStops).set({ ordinal: i + 1 }).where(eq(transportStops.id, id));
    await audit(tx, actor, { action: 'transport.stops_reorder', entity: 'transport_route', entityId: routeId, after: { stopIds } });
  });
  return routeDetail(db, routeId);
}

// ── allocation ──────────────────────────────────────────────────────────────────────────────────

const allocationSelect = (db: Executor) =>
  db
    .select({
      studentId: students.id,
      first: students.firstName,
      last: students.lastName,
      admissionNo: students.admissionNo,
      grade: grades.name,
      section: sections.name,
      routeId: transportRoutes.id,
      routeName: transportRoutes.name,
      stopId: transportStops.id,
      stopName: transportStops.name,
      pickup: transportStops.pickupTime,
      drop: transportStops.dropTime,
      startDate: studentTransport.startDate,
    })
    .from(studentTransport)
    .innerJoin(students, eq(students.id, studentTransport.studentId))
    .innerJoin(transportRoutes, eq(transportRoutes.id, studentTransport.routeId))
    .leftJoin(transportStops, eq(transportStops.id, studentTransport.stopId))
    .leftJoin(sections, eq(sections.id, students.currentSectionId))
    .leftJoin(grades, eq(grades.id, students.currentGradeId));

type AllocRow = Awaited<ReturnType<ReturnType<typeof allocationSelect>['execute']>>[number];
const toAllocation = (r: AllocRow): TransportAllocation => ({
  studentId: r.studentId,
  studentName: fullName(r.first, r.last),
  admissionNo: r.admissionNo,
  grade: r.grade,
  section: r.section,
  routeId: r.routeId,
  routeName: r.routeName,
  stopId: r.stopId,
  stopName: r.stopName,
  pickupTime: hhmm(r.pickup),
  dropTime: hhmm(r.drop),
  startDate: r.startDate,
});

export async function assignStudent(db: Executor, p: Principal, actor: AuditActor, studentId: string, body: { routeId: string; stopId?: string | null; startDate?: string }): Promise<TransportAllocation> {
  await assertStudentAccess(db, p, 'students:view', studentId);
  await db.transaction(async (tx) => {
    const route = await lockRoute(tx, body.routeId); // serialises seat counting for this route
    if (!route.isActive) throw unprocessable('This route is not in service', 'ROUTE_INACTIVE');
    const [st] = await tx.select({ status: students.status, archivedAt: students.archivedAt }).from(students).where(eq(students.id, studentId)).limit(1);
    if (!st || st.archivedAt || st.status !== 'active') throw unprocessable('Only active students can use the school bus', 'STUDENT_NOT_ACTIVE');
    if (body.stopId) {
      const [stop] = await tx.select({ routeId: transportStops.routeId }).from(transportStops).where(eq(transportStops.id, body.stopId)).limit(1);
      if (!stop || stop.routeId !== body.routeId) throw unprocessable('That stop is not on this route', 'STOP_NOT_ON_ROUTE');
    }
    if (route.vehicleId) {
      const [v] = await tx.select({ capacity: transportVehicles.capacity }).from(transportVehicles).where(eq(transportVehicles.id, route.vehicleId)).limit(1);
      const [n] = await tx.select({ n: count() }).from(studentTransport).where(and(eq(studentTransport.routeId, body.routeId), ne(studentTransport.studentId, studentId)));
      if (v && (n?.n ?? 0) >= v.capacity) throw conflict(`The bus on this route is full (${v.capacity} seats)`, 'ROUTE_FULL');
    }
    const [prev] = await tx.select().from(studentTransport).where(eq(studentTransport.studentId, studentId)).limit(1);
    const values = { studentId, routeId: body.routeId, stopId: body.stopId ?? null, startDate: body.startDate ?? null };
    await tx.insert(studentTransport).values(values).onConflictDoUpdate({ target: studentTransport.studentId, set: { routeId: values.routeId, stopId: values.stopId, startDate: values.startDate } });
    await audit(tx, actor, { action: 'transport.assign', entity: 'student', entityId: studentId, before: prev ?? null, after: values });
  });
  const [r] = await allocationSelect(db).where(eq(studentTransport.studentId, studentId)).limit(1);
  return toAllocation(r!);
}

export async function unassignStudent(db: Executor, p: Principal, actor: AuditActor, studentId: string): Promise<void> {
  await assertStudentAccess(db, p, 'students:view', studentId);
  await db.transaction(async (tx) => {
    const [prev] = await tx.delete(studentTransport).where(eq(studentTransport.studentId, studentId)).returning();
    if (!prev) throw notFound('Allocation');
    await audit(tx, actor, { action: 'transport.unassign', entity: 'student', entityId: studentId, before: prev });
  });
}

export async function listAllocations(db: Executor, q: { page: number; pageSize: number; q?: string; routeId?: string; stopId?: string; studentId?: string }) {
  const where = and(
    q.routeId ? eq(studentTransport.routeId, q.routeId) : undefined,
    q.stopId ? eq(studentTransport.stopId, q.stopId) : undefined,
    q.studentId ? eq(studentTransport.studentId, q.studentId) : undefined,
    q.q ? ilikeAny(q.q, students.firstName, students.lastName, students.admissionNo) : undefined,
  );
  const [rows, totalRow] = await Promise.all([
    allocationSelect(db).where(where).orderBy(asc(transportRoutes.name), asc(transportStops.ordinal), asc(students.firstName), asc(students.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(studentTransport).innerJoin(students, eq(students.id, studentTransport.studentId)).where(where),
  ]);
  return { items: rows.map(toAllocation), total: totalRow[0]?.n ?? 0 };
}

/** Everyone boarding the route, grouped by stop in driving order (students without a stop come last). */
export async function manifest(db: Executor, routeId: string): Promise<TransportManifest> {
  const [route, stops, rows] = await Promise.all([
    getRoute(db, routeId),
    stopsOf(db, routeId),
    allocationSelect(db).where(eq(studentTransport.routeId, routeId)).orderBy(asc(students.firstName), asc(students.id)),
  ]);
  const byStop = Map.groupBy(rows.map(toAllocation), (a) => a.stopId ?? '');
  const out: TransportManifest['stops'] = stops.map((stop) => ({ stop, students: byStop.get(stop.id) ?? [] }));
  if (byStop.get('')?.length) out.push({ stop: null, students: byStop.get('')! });
  return { route, stops: out };
}

// ── "my bus" ────────────────────────────────────────────────────────────────────────────────────

/** One entry per child in scope (own record for students, verified children for parents). */
export async function myBus(db: Executor, p: Principal): Promise<TransportMyBusItem[]> {
  const scope = p.scope('transport:view');
  const ids = scope === 'own' ? (p.studentId ? [p.studentId] : []) : scope === 'linked' ? p.linkedStudentIds : [];
  if (!ids.length) return [];
  const rows = await db
    .select({
      s: { id: students.id, first: students.firstName, last: students.lastName },
      routeId: transportRoutes.id,
      routeName: transportRoutes.name,
      pickupStart: transportRoutes.pickupStartTime,
      dropStart: transportRoutes.dropStartTime,
      stopId: transportStops.id,
      stopName: transportStops.name,
      pickup: transportStops.pickupTime,
      drop: transportStops.dropTime,
      v: transportVehicles,
    })
    .from(students)
    .leftJoin(studentTransport, eq(studentTransport.studentId, students.id))
    .leftJoin(transportRoutes, eq(transportRoutes.id, studentTransport.routeId))
    .leftJoin(transportStops, eq(transportStops.id, studentTransport.stopId))
    .leftJoin(transportVehicles, eq(transportVehicles.id, transportRoutes.vehicleId))
    .where(and(inArray(students.id, ids), isNull(students.archivedAt)))
    .orderBy(asc(students.firstName), asc(students.id));
  return rows.map((r) => ({
    studentId: r.s.id,
    studentName: fullName(r.s.first, r.s.last),
    allocated: !!r.routeId,
    route: r.routeId ? { id: r.routeId, name: r.routeName!, pickupStartTime: hhmm(r.pickupStart), dropStartTime: hhmm(r.dropStart) } : null,
    stop: r.stopId ? { id: r.stopId, name: r.stopName!, pickupTime: hhmm(r.pickup), dropTime: hhmm(r.drop) } : null,
    vehicle: r.v ? { registrationNo: r.v.registrationNo, model: r.v.model } : null,
    driver: r.v ? { name: r.v.driverName, phone: r.v.driverPhone } : null,
    attendantName: r.v?.attendantName ?? null,
  }));
}

/** Read-through of `students.authorizedPickups` for those who may see the student (active entries only; no ID-proof details). */
export async function authorizedPickups(db: Executor, p: Principal, studentId: string) {
  await assertStudentAccess(db, p, 'transport:view', studentId);
  const [s] = await db.select({ list: students.authorizedPickups }).from(students).where(eq(students.id, studentId)).limit(1);
  return (s?.list ?? []).filter((x) => x.active !== false).map((x) => ({ name: x.name, relationship: x.relationship ?? null, phone: x.phone, active: x.active !== false }));
}
