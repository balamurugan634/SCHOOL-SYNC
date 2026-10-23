import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, libraryBooks, libraryIssues, notifications, staff, studentTransport, students, users } from '../src/db/tenant/schema';
import { tenants } from '../src/db/control/schema';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { invalidateLicense } from '../src/core/billing/license';
import { controlDb } from '../src/core/tenancy/control-db';
import { addDaysIso, todayIn } from '../src/core/http';
import { runJobOnce } from '../src/core/jobs';
import { invalidateTenant } from '../src/core/tenancy/registry';
import { jobs } from '../src/modules/operations/jobs';
import { createTestSchool, type TestSchool } from './helpers';

let s: TestSchool;
let today: string;
const tokens: Record<string, string> = {};
const tok = async (u: string) => (tokens[u] ??= await s.login(u));
const req = async (who: string | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => s.req(method, path, who ? await tok(who) : null, body);
const userIdOf = async (username: string) => (await s.db.select({ id: users.id }).from(users).where(eq(users.username, username)))[0]!.id;
const setFeatures = async (features: { transport?: boolean; library?: boolean }) => {
  const [t] = await controlDb().select().from(tenants).where(eq(tenants.id, s.tenant.id));
  await controlDb().update(tenants).set({ features: { ...t!.features, ...features } }).where(eq(tenants.id, s.tenant.id));
  invalidateTenant(s.tenant.code);
};

let kids: typeof s.ctx.students;
const guardianOf = (st: (typeof kids)[number]) => s.ctx.guardians.find((g) => g.id === st.guardianId)!;

beforeAll(async () => {
  s = await createTestSchool({ size: 'small' });
  today = todayIn(s.tenant.timezone);
  kids = s.ctx.students;
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('transport', () => {
  let vehicleId: string;
  let tinyVehicleId: string;
  let routeId: string;
  let stopIds: string[];

  it('permission matrix: management sees everything, others nothing (except their own bus)', async () => {
    for (const u of ['transport', 'principal']) expect((await req(u, 'GET', '/transport/routes')).status, u).toBe(200);
    for (const u of [kids[0]!.username, guardianOf(kids[0]!).username, 't001', 'office', 'accounts', 'librarian']) expect((await req(u, 'GET', '/transport/routes')).status, u).toBe(403);
    expect((await req(null, 'GET', '/transport/routes')).status).toBe(401);
    // principal can view but not change
    expect((await req('principal', 'POST', '/transport/vehicles', { registrationNo: 'KA01AB1234' })).status).toBe(403);
    expect((await req('office', 'POST', '/transport/vehicles', { registrationNo: 'KA01AB1234' })).status).toBe(403);
    expect((await req(kids[0]!.username, 'PUT', `/transport/students/${kids[0]!.id}`, { routeId: '0192e0f0-0000-7000-8000-000000000000' })).status).toBe(403);
    for (const u of [kids[0]!.username, guardianOf(kids[0]!).username, 'transport']) expect((await req(u, 'GET', '/transport/my-bus')).status, u).toBe(200);
  });

  it('vehicles: unique registration, insurance status and alerts, retire rules', async () => {
    const v = await req('transport', 'POST', '/transport/vehicles', { registrationNo: ' ka-01-ab-1234 ', model: 'Tata Starbus', capacity: 3, driverName: 'Ramesh', driverPhone: '9811111111', attendantName: 'Sita', insuranceExpiry: addDaysIso(today, 200) });
    expect(v.status).toBe(201);
    expect(v.body).toMatchObject({ registrationNo: 'KA-01-AB-1234', capacity: 3, insuranceStatus: 'valid', isActive: true, routeCount: 0 });
    vehicleId = v.body.id;
    const dup = await req('transport', 'POST', '/transport/vehicles', { registrationNo: 'KA-01-AB-1234' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('VEHICLE_EXISTS');
    const old = await req('transport', 'POST', '/transport/vehicles', { registrationNo: 'KA-01-ZZ-9999', capacity: 2, insuranceExpiry: addDaysIso(today, -3) });
    tinyVehicleId = old.body.id;
    expect(old.body.insuranceStatus).toBe('expired');
    const soon = await req('transport', 'POST', '/transport/vehicles', { registrationNo: 'KA-01-SS-0001', insuranceExpiry: addDaysIso(today, 10) });
    expect(soon.body.insuranceStatus).toBe('expiring');
    expect((await req('transport', 'POST', '/transport/vehicles', { registrationNo: 'KA-01-NN-0002' })).body.insuranceStatus).toBe('unknown');
    const alerts = await req('transport', 'GET', '/transport/vehicles?insuranceAlert=true');
    expect(alerts.body.data.map((x: any) => x.registrationNo).sort()).toEqual(['KA-01-SS-0001', 'KA-01-ZZ-9999']);
    expect((await req('transport', 'POST', '/transport/vehicles', { registrationNo: 'x', capacity: 0 })).status).toBe(422);
    expect((await req('transport', 'PATCH', `/transport/vehicles/${vehicleId}`, { insuranceExpiry: addDaysIso(today, 365) })).body.insuranceExpiry).toBe(addDaysIso(today, 365));
  });

  it('routes and stops: ordered, insertable, reorderable', async () => {
    const r = await req('transport', 'POST', '/transport/routes', { name: 'Route 1 – North', vehicleId, pickupStartTime: '07:00', dropStartTime: '15:30' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Route 1 – North', stopCount: 0, studentCount: 0, capacity: 3, seatsLeft: 3, stops: [] });
    expect(r.body.vehicle).toMatchObject({ id: vehicleId, driverPhone: '9811111111' });
    routeId = r.body.id;
    const add = async (body: object) => (await req('transport', 'POST', `/transport/routes/${routeId}/stops`, body)).body;
    await add({ name: 'Lake View', pickupTime: '07:10', dropTime: '15:45', feeMinor: 150_000, lat: 12.97, lng: 77.59 });
    await add({ name: 'Temple Road', pickupTime: '07:20', dropTime: '15:55' });
    const after = await add({ name: 'Market', ordinal: 2, pickupTime: '07:15', dropTime: '15:50' }); // inserted in the middle
    expect(after.stops.map((x: any) => [x.name, x.ordinal])).toEqual([['Lake View', 1], ['Market', 2], ['Temple Road', 3]]);
    stopIds = after.stops.map((x: any) => x.id);
    expect(after.stops[0]).toMatchObject({ feeMinor: 150_000, pickupTime: '07:10', studentCount: 0 });
    const bad = await req('transport', 'PUT', `/transport/routes/${routeId}/stops/order`, { stopIds: [stopIds[0], stopIds[1]] });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('STOP_ORDER_INVALID');
    const re = await req('transport', 'PUT', `/transport/routes/${routeId}/stops/order`, { stopIds: [stopIds[2], stopIds[0], stopIds[1]] });
    expect(re.body.stops.map((x: any) => x.name)).toEqual(['Temple Road', 'Lake View', 'Market']);
    stopIds = re.body.stops.map((x: any) => x.id);
    expect((await req('transport', 'PATCH', `/transport/stops/${stopIds[1]}`, { name: 'Lake View Gate', feeMinor: null })).body.stops[1]).toMatchObject({ name: 'Lake View Gate', feeMinor: null });
    expect((await req('transport', 'POST', `/transport/routes/${routeId}/stops`, { name: '' })).status).toBe(422);
    expect((await req('transport', 'POST', `/transport/routes/${routeId}/stops`, { name: 'x', pickupTime: '7am' })).status).toBe(422);
    expect((await req('transport', 'POST', '/transport/routes', { name: 'Bad', vehicleId: '0192e0f0-0000-7000-8000-000000000000' })).status).toBe(422);
    expect((await req('transport', 'GET', '/transport/routes?active=true')).body.meta.total).toBe(1);
    expect((await req('transport', 'DELETE', `/transport/vehicles/${vehicleId}`)).body.code).toBe('VEHICLE_IN_USE'); // an active route runs on it
  });

  it('allocation: seats are enforced, stops must belong to the route, every change is audited', async () => {
    const [a, b, c] = kids;
    const assign = (st: typeof a, body: object) => req('transport', 'PUT', `/transport/students/${st!.id}`, body);
    const one = await assign(a, { routeId, stopId: stopIds[1], startDate: today });
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ studentId: a!.id, routeId, stopId: stopIds[1], pickupTime: '07:10', startDate: today });
    expect((await assign(b, { routeId, stopId: stopIds[2] })).status).toBe(200);
    expect((await assign(a, { routeId, stopId: stopIds[0] })).body.stopId).toBe(stopIds[0]); // moving within the route does not need a new seat
    expect((await assign(c, { routeId })).status).toBe(200); // 3rd of 3 seats; a stop is optional
    const full = await assign(kids[3], { routeId });
    expect(full.status).toBe(409);
    expect(full.body.code).toBe('ROUTE_FULL');
    // another route: its stop is not valid for this one
    const r2 = await req('transport', 'POST', '/transport/routes', { name: 'Route 2 – South', vehicleId: tinyVehicleId });
    const wrongStop = await assign(kids[3], { routeId: r2.body.id, stopId: stopIds[0] });
    expect(wrongStop.status).toBe(422);
    expect(wrongStop.body.code).toBe('STOP_NOT_ON_ROUTE');
    expect((await assign(kids[3], { routeId: r2.body.id })).status).toBe(200);
    expect((await assign(kids[0], { routeId: r2.body.id })).status).toBe(200); // moved: leaves route 1, freeing a seat there
    expect((await assign(kids[3], { routeId })).status).toBe(200);
    expect((await req('transport', 'GET', `/transport/routes/${routeId}`)).body).toMatchObject({ studentCount: 3, seatsLeft: 0 });
    expect((await assign(kids[5], { routeId: '0192e0f0-0000-7000-8000-000000000000' })).status).toBe(404);
    await s.db.update(students).set({ status: 'withdrawn' }).where(eq(students.id, kids[11]!.id));
    expect((await assign(kids[11], { routeId: r2.body.id })).body.code).toBe('STUDENT_NOT_ACTIVE');

    // safety rules around what is allocated
    const smaller = await req('transport', 'PATCH', `/transport/vehicles/${vehicleId}`, { capacity: 2 });
    expect(smaller.status).toBe(409);
    expect(smaller.body.code).toBe('VEHICLE_CAPACITY_BELOW_ALLOCATIONS');
    expect((await req('transport', 'PATCH', `/transport/routes/${r2.body.id}`, { vehicleId: tinyVehicleId, isActive: false })).body.code).toBe('ROUTE_HAS_STUDENTS');
    expect((await req('transport', 'DELETE', `/transport/stops/${stopIds[2]}`)).body.code).toBe('STOP_HAS_STUDENTS'); // a student boards at Market
    const audit = await s.db.select().from(auditLogs).where(eq(auditLogs.action, 'transport.assign'));
    expect(audit.length).toBeGreaterThanOrEqual(6);
  });

  it('manifest and allocation list for management', async () => {
    const m = await req('transport', 'GET', `/transport/routes/${routeId}/manifest`);
    expect(m.status).toBe(200);
    expect(m.body.route.studentCount).toBe(3);
    expect(m.body.stops.map((x: any) => x.stop?.name ?? null)).toEqual(['Temple Road', 'Lake View Gate', 'Market', null]);
    const total = m.body.stops.reduce((n: number, x: any) => n + x.students.length, 0);
    expect(total).toBe(3);
    expect(m.body.stops.find((x: any) => x.stop === null).students).toHaveLength(2); // boarded without a stop
    const list = await req('transport', 'GET', `/transport/allocations?routeId=${routeId}&pageSize=2`);
    expect(list.body.meta).toMatchObject({ total: 3, pageSize: 2, totalPages: 2 });
    expect((await req('transport', 'GET', `/transport/allocations?stopId=${stopIds[0]}`)).body.data).toHaveLength(0);
    expect((await req('transport', 'GET', `/transport/allocations?q=${kids[1]!.admissionNo}`)).body.data.map((x: any) => x.studentId)).toEqual([kids[1]!.id]);
    expect((await req('principal', 'GET', `/transport/routes/${routeId}/manifest`)).status).toBe(200);
    expect((await req('transport', 'GET', '/transport/routes/0192e0f0-0000-7000-8000-000000000000/manifest')).status).toBe(404);
  });

  it('"my bus": own / linked children only, with driver contact; nothing for the unverified guardian', async () => {
    const stu = await req(kids[1]!.username, 'GET', '/transport/my-bus');
    expect(stu.body.data).toHaveLength(1);
    expect(stu.body.data[0]).toMatchObject({ studentId: kids[1]!.id, allocated: true, route: { name: 'Route 1 – North', pickupStartTime: '07:00' }, stop: { name: 'Market', pickupTime: '07:15', dropTime: '15:50' }, vehicle: { registrationNo: 'KA-01-AB-1234' }, driver: { name: 'Ramesh', phone: '9811111111' }, attendantName: 'Sita' });
    const notOnBus = await req(kids[8]!.username, 'GET', '/transport/my-bus');
    expect(notOnBus.body.data[0]).toMatchObject({ allocated: false, route: null, stop: null, driver: null });
    const g = guardianOf(kids[1]!);
    const par = await req(g.username, 'GET', '/transport/my-bus');
    expect(par.body.data.map((x: any) => x.studentId).sort()).toEqual([...g.studentIds].sort());
    expect(par.body.data.find((x: any) => x.studentId === kids[1]!.id).driver.phone).toBe('9811111111');
    expect((await req('9099999999', 'GET', '/transport/my-bus')).body.data).toEqual([]);
    expect((await req('transport', 'GET', '/transport/my-bus')).body.data).toEqual([]);
    // authorised pickups are a read-through of the student record
    const pick = await req(g.username, 'GET', `/transport/students/${kids[1]!.id}/authorized-pickups`);
    expect(pick.status).toBe(200);
    expect(pick.body.data[0]).toMatchObject({ name: g.name, relationship: 'parent', active: true });
    expect(pick.body.data[0].idProof).toBeUndefined();
    expect((await req(guardianOf(kids[7]!).username, 'GET', `/transport/students/${kids[1]!.id}/authorized-pickups`)).status).toBe(404); // someone else's child (kids[7] is in the other class)
    expect((await req('transport', 'GET', `/transport/students/${kids[1]!.id}/authorized-pickups`)).status).toBe(200);
    expect((await req('9099999999', 'GET', `/transport/students/${kids[0]!.id}/authorized-pickups`)).status).toBe(404);
    await s.db.update(students).set({ authorizedPickups: [{ name: 'Uncle Raj', relationship: 'uncle', phone: '9822222222', active: false, idProof: 'AADHAAR-123' }, { name: 'Aunt Mala', phone: '9833333333', active: true, idProof: 'PAN-9' }] }).where(eq(students.id, kids[1]!.id));
    const only = (await req(g.username, 'GET', `/transport/students/${kids[1]!.id}/authorized-pickups`)).body.data;
    expect(only).toEqual([{ name: 'Aunt Mala', relationship: null, phone: '9833333333', active: true }]); // inactive entries and ID proofs are not exposed
  });

  it('unassign, retire and the feature flag', async () => {
    expect((await req('transport', 'DELETE', `/transport/students/${kids[3]!.id}`)).status).toBe(200);
    expect((await req('transport', 'DELETE', `/transport/students/${kids[3]!.id}`)).status).toBe(404);
    expect(await s.db.select().from(studentTransport).where(eq(studentTransport.studentId, kids[3]!.id))).toHaveLength(0);
    await setFeatures({ transport: false });
    for (const [who, path] of [['transport', '/transport/routes'], ['transport', '/transport/vehicles'], [kids[1]!.username, '/transport/my-bus'], ['principal', `/transport/routes/${routeId}/manifest`]] as const) {
      const r = await req(who, 'GET', path);
      expect(r.status, path).toBe(403);
      expect(r.body.code).toBe('FEATURE_DISABLED');
    }
    expect((await req('librarian', 'GET', '/library/books')).status).toBe(200); // other features are unaffected
    await setFeatures({ transport: true });
    expect((await req('transport', 'GET', '/transport/routes')).status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('library', () => {
  let bookId: string;
  const mkBook = async (extra: Record<string, unknown> = {}) => {
    const n = Math.random().toString(36).slice(2, 8).toUpperCase();
    return req('librarian', 'POST', '/library/books', { accessionNo: `ACC-${n}`, title: `Book ${n}`, ...extra });
  };
  const issue = (who: string, body: object) => req(who, 'POST', '/library/issues', body);

  it('permission matrix', async () => {
    for (const u of ['librarian', 'principal', kids[0]!.username, guardianOf(kids[0]!).username, 't001']) expect((await req(u, 'GET', '/library/books')).status, u).toBe(200);
    for (const u of ['accounts', 'transport']) expect((await req(u, 'GET', '/library/books')).status, u).toBe(403);
    expect((await req(null, 'GET', '/library/books')).status).toBe(401);
    const book = { accessionNo: 'ACC-PERM', title: 'Permissions' };
    for (const u of [kids[0]!.username, guardianOf(kids[0]!).username, 't001', 'principal', 'office']) expect((await req(u, 'POST', '/library/books', book)).status, u).toBe(403);
    expect((await req('librarian', 'POST', '/library/books', book)).status).toBe(201);
    for (const u of [kids[0]!.username, 't001']) expect((await req(u, 'GET', '/library/issues')).status, u).toBe(403); // circulation is staff-only
    expect((await req('principal', 'GET', '/library/issues')).status).toBe(200);
    expect((await req('principal', 'POST', '/library/issues', { bookId: '0192e0f0-0000-7000-8000-000000000000', studentId: kids[0]!.id })).status).toBe(403);
    expect((await req(kids[0]!.username, 'PUT', '/library/policy', { loanDays: 100 })).status).toBe(403);
  });

  it('catalogue: search, availability filter, stock-safe edits, archive rules', async () => {
    const a = await req('librarian', 'POST', '/library/books', { accessionNo: 'LB-001', isbn: '9780140449136', title: 'The Odyssey', author: 'Homer', publisher: 'Penguin', category: 'Classics', shelf: 'C-3', totalCopies: 3 });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ totalCopies: 3, availableCopies: 3, available: true, archived: false });
    bookId = a.body.id;
    await req('librarian', 'POST', '/library/books', { accessionNo: 'LB-002', title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', category: 'Biography' });
    await req('librarian', 'POST', '/library/books', { accessionNo: 'LB-003', title: '100% Science Experiments', category: 'Science' });
    const dup = await req('librarian', 'POST', '/library/books', { accessionNo: 'LB-001', title: 'Dup' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('ACCESSION_EXISTS');
    const ids = async (qs: string) => (await req(kids[0]!.username, 'GET', `/library/books?${qs}`)).body.data.map((b: any) => b.accessionNo);
    expect(await ids('q=odyssey')).toEqual(['LB-001']);
    expect(await ids('q=HOMER')).toEqual(['LB-001']);
    expect(await ids('q=9780140449136')).toEqual(['LB-001']);
    expect(await ids('q=kalam')).toEqual(['LB-002']);
    expect(await ids('q=lb-003')).toEqual(['LB-003']);
    expect(await ids('category=Science')).toEqual(['LB-003']);
    expect(await ids('q=%25')).toEqual(['LB-003']); // a literal "%" matches only the title that contains one
    expect(await ids('q=zzzz')).toEqual([]);
    expect((await req(kids[0]!.username, 'GET', '/library/categories')).body.data).toEqual(['Biography', 'Classics', 'Science']);

    // stock moves with the total; copies on loan cannot be "removed"
    const loan = await issue('librarian', { bookId, studentId: kids[0]!.id });
    expect(loan.status).toBe(201);
    expect((await req('librarian', 'GET', `/library/books/${bookId}`)).body).toMatchObject({ totalCopies: 3, availableCopies: 2 });
    expect((await req('librarian', 'PATCH', `/library/books/${bookId}`, { totalCopies: 5 })).body).toMatchObject({ totalCopies: 5, availableCopies: 4 });
    expect((await req('librarian', 'PATCH', `/library/books/${bookId}`, { totalCopies: 1 })).body).toMatchObject({ totalCopies: 1, availableCopies: 0 });
    const below = await req('librarian', 'PATCH', `/library/books/${bookId}`, { totalCopies: 0 });
    expect(below.status).toBe(422);
    await issue('librarian', { bookId, studentId: kids[1]!.id }).then((r) => expect(r.body.code).toBe('NO_COPIES_AVAILABLE'));
    await req('librarian', 'PATCH', `/library/books/${bookId}`, { totalCopies: 3 });
    const two = await issue('librarian', { bookId, studentId: kids[1]!.id });
    expect(two.status).toBe(201);
    const shrink = await req('librarian', 'PATCH', `/library/books/${bookId}`, { totalCopies: 1 });
    expect(shrink.status).toBe(409);
    expect(shrink.body.code).toBe('COPIES_ON_LOAN');
    expect((await req('librarian', 'DELETE', `/library/books/${bookId}`)).body.code).toBe('BOOK_ON_LOAN');
    await req('librarian', 'POST', `/library/issues/${loan.body.id}/return`);
    await req('librarian', 'POST', `/library/issues/${two.body.id}/return`);
    expect((await req('librarian', 'GET', `/library/books/${bookId}`)).body).toMatchObject({ totalCopies: 3, availableCopies: 3 });
    expect((await ids('available=true')).length).toBeGreaterThan(0);
    // the database itself refuses impossible stock
    await expect(s.db.update(libraryBooks).set({ availableCopies: 99 }).where(eq(libraryBooks.id, bookId))).rejects.toThrow();
    await expect(s.db.update(libraryBooks).set({ availableCopies: -1 }).where(eq(libraryBooks.id, bookId))).rejects.toThrow();
    // archive hides it from students, librarians can still list it
    expect((await req('librarian', 'DELETE', `/library/books/${bookId}`)).status).toBe(200);
    expect(await ids('q=odyssey')).toEqual([]);
    expect((await req(kids[0]!.username, 'GET', `/library/books/${bookId}`)).status).toBe(404);
    expect((await req('librarian', 'GET', '/library/books?includeArchived=true&q=odyssey')).body.data[0].archived).toBe(true);
    expect((await issue('librarian', { bookId, studentId: kids[2]!.id })).status).toBe(404);
  });

  it('policy drives the due date and the fine; issue / return keep stock exact', async () => {
    const pol = await req('librarian', 'GET', '/library/policy');
    expect(pol.body).toEqual({ loanDays: 14, staffLoanDays: 30, finePerDayMinor: 100, maxLoansPerStudent: 3, maxLoansPerStaff: 5 });
    expect((await req('librarian', 'PUT', '/library/policy', { loanDays: 0 })).status).toBe(422);
    const upd = await req('librarian', 'PUT', '/library/policy', { loanDays: 7, finePerDayMinor: 250 });
    expect(upd.body).toMatchObject({ loanDays: 7, finePerDayMinor: 250, staffLoanDays: 30 });
    expect((await s.db.select().from(auditLogs).where(eq(auditLogs.action, 'library.policy_update'))).length).toBe(1);

    const b = (await mkBook({ totalCopies: 2 })).body;
    const l1 = await issue('librarian', { bookId: b.id, studentId: kids[2]!.id });
    expect(l1.body).toMatchObject({ status: 'borrowed', issuedOn: today, dueOn: addDaysIso(today, 7), returnedOn: null, daysOverdue: 0, fineMinor: 0 });
    expect(l1.body.borrower).toMatchObject({ type: 'student', id: kids[2]!.id, code: kids[2]!.admissionNo });
    const t001 = s.ctx.teachers[0]!;
    const l2 = await issue('librarian', { bookId: b.id, staffId: t001.id, dueOn: addDaysIso(today, 3) });
    expect(l2.body).toMatchObject({ dueOn: addDaysIso(today, 3), borrower: { type: 'staff', id: t001.id, code: expect.stringMatching(/^EMP/) } });
    expect((await issue('librarian', { bookId: b.id, studentId: kids[3]!.id })).body.code).toBe('NO_COPIES_AVAILABLE');
    expect((await issue('librarian', { bookId: b.id })).body.code).toBe('BORROWER_REQUIRED');
    expect((await issue('librarian', { bookId: b.id, studentId: kids[3]!.id, staffId: t001.id })).body.code).toBe('BORROWER_REQUIRED');
    const b2 = (await mkBook({ totalCopies: 2 })).body;
    expect((await issue('librarian', { bookId: b2.id, studentId: kids[2]!.id, dueOn: addDaysIso(today, -1) })).body.code).toBe('DUE_DATE_INVALID');
    expect((await issue('librarian', { bookId: b.id, studentId: kids[2]!.id })).body.code).toBe('ALREADY_BORROWED');
    expect((await issue('librarian', { bookId: b2.id, studentId: '0192e0f0-0000-7000-8000-000000000000' })).status).toBe(404);
    await s.db.update(staff).set({ status: 'resigned' }).where(eq(staff.id, s.ctx.teachers[3]!.id));
    expect((await issue('librarian', { bookId: b2.id, staffId: s.ctx.teachers[3]!.id })).body.code).toBe('BORROWER_NOT_ACTIVE');

    // per-student limit (3)
    const extra = [(await mkBook()).body, (await mkBook()).body];
    expect((await issue('librarian', { bookId: extra[0].id, studentId: kids[2]!.id })).status).toBe(201); // 2nd
    expect((await issue('librarian', { bookId: b2.id, studentId: kids[2]!.id })).status).toBe(201); // 3rd
    const lim = await issue('librarian', { bookId: extra[1].id, studentId: kids[2]!.id });
    expect(lim.status).toBe(409);
    expect(lim.body.code).toBe('LOAN_LIMIT_REACHED');
    expect((await req('librarian', 'GET', `/library/books/${extra[1].id}`)).body.availableCopies).toBe(1); // the refused issue took nothing

    // a late return is fined from the policy; waiving clears it; double return is refused and stock is not inflated
    await s.db.update(libraryIssues).set({ dueOn: addDaysIso(today, -5) }).where(eq(libraryIssues.id, l1.body.id));
    const overdue = await req('librarian', 'GET', '/library/overdue');
    expect(overdue.status).toBe(200);
    expect(overdue.body.totals).toEqual({ count: 1, fineMinor: 5 * 250 });
    expect(overdue.body.data[0]).toMatchObject({ id: l1.body.id, status: 'overdue', daysOverdue: 5, fineMinor: 1250 });
    const ret = await req('librarian', 'POST', `/library/issues/${l1.body.id}/return`);
    expect(ret.body).toMatchObject({ status: 'returned', returnedOn: today, fineMinor: 1250, daysOverdue: 0 });
    expect((await req('librarian', 'POST', `/library/issues/${l1.body.id}/return`)).body.code).toBe('ALREADY_RETURNED');
    expect((await req('librarian', 'GET', `/library/books/${b.id}`)).body.availableCopies).toBe(1); // 2 copies, staff still has one
    await s.db.update(libraryIssues).set({ dueOn: addDaysIso(today, -2) }).where(eq(libraryIssues.id, l2.body.id));
    const waived = await req('librarian', 'POST', `/library/issues/${l2.body.id}/return`, { waiveFine: true });
    expect(waived.body).toMatchObject({ status: 'returned', fineMinor: 0 });
    expect((await req('librarian', 'GET', `/library/books/${b.id}`)).body.availableCopies).toBe(2);
    expect((await req('librarian', 'POST', '/library/issues/0192e0f0-0000-7000-8000-000000000000/return')).status).toBe(404);
    expect((await req('librarian', 'GET', '/library/overdue')).body.totals).toEqual({ count: 0, fineMinor: 0 });
    const hist = await req('librarian', 'GET', `/library/issues?status=returned&studentId=${kids[2]!.id}`);
    expect(hist.body.data.map((x: any) => x.id)).toEqual([l1.body.id]);
    expect((await req('librarian', 'GET', '/library/issues?status=all&pageSize=100')).body.meta.total).toBeGreaterThanOrEqual(5);
    const actions = (await s.db.select().from(auditLogs).where(eq(auditLogs.entity, 'library_issue'))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['library.issue', 'library.return']));
    for (const open of (await s.db.select().from(libraryIssues).where(and(eq(libraryIssues.studentId, kids[2]!.id)))).filter((i) => !i.returnedOn)) await req('librarian', 'POST', `/library/issues/${open.id}/return`);
  });

  it('stock stays exact under concurrent issues and returns', async () => {
    const one = (await mkBook({ totalCopies: 1 })).body;
    const rush = await Promise.all([4, 5, 6, 7].map((i) => issue('librarian', { bookId: one.id, studentId: kids[i]!.id })));
    expect(rush.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rush.filter((r) => r.status === 409).every((r) => r.body.code === 'NO_COPIES_AVAILABLE')).toBe(true);
    const [row] = await s.db.select().from(libraryBooks).where(eq(libraryBooks.id, one.id));
    expect(row).toMatchObject({ totalCopies: 1, availableCopies: 0 });
    expect(await s.db.select().from(libraryIssues).where(and(eq(libraryIssues.bookId, one.id)))).toHaveLength(1);

    const two = (await mkBook({ totalCopies: 2 })).body;
    const rush2 = await Promise.all([4, 5, 6, 7].map((i) => issue('librarian', { bookId: two.id, studentId: kids[i]!.id })));
    expect(rush2.filter((r) => r.status === 201)).toHaveLength(2);
    expect((await s.db.select().from(libraryBooks).where(eq(libraryBooks.id, two.id)))[0]!.availableCopies).toBe(0);

    // the same loan returned twice at once: one wins, stock goes up by exactly one
    const loanId = rush.find((r) => r.status === 201)!.body.id;
    const back = await Promise.all([1, 2, 3].map(() => req('librarian', 'POST', `/library/issues/${loanId}/return`)));
    expect(back.filter((r) => r.status === 200)).toHaveLength(1);
    expect(back.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await s.db.select().from(libraryBooks).where(eq(libraryBooks.id, one.id)))[0]).toMatchObject({ availableCopies: 1, totalCopies: 1 });
    // the same student cannot take the same title twice at once either
    const dupRush = await Promise.all([1, 2, 3].map(() => issue('librarian', { bookId: one.id, studentId: kids[8]!.id })));
    expect(dupRush.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await s.db.select().from(libraryBooks).where(eq(libraryBooks.id, one.id)))[0]!.availableCopies).toBe(0);
  });

  it('borrowed lists: own, linked children and staff loans — nobody else’s', async () => {
    const b = (await mkBook()).body;
    const l = await issue('librarian', { bookId: b.id, studentId: kids[9]!.id });
    expect(l.status).toBe(201);
    const mine = await req(kids[9]!.username, 'GET', '/library/my-books');
    expect(mine.body.data.map((x: any) => x.id)).toContain(l.body.id);
    expect(mine.body.data.every((x: any) => x.borrower.id === kids[9]!.id)).toBe(true);
    const g = guardianOf(kids[9]!);
    expect((await req(g.username, 'GET', '/library/my-books')).body.data.map((x: any) => x.id)).toContain(l.body.id);
    expect((await req(g.username, 'GET', `/library/my-books?studentId=${kids[9]!.id}`)).body.data).toHaveLength(mine.body.data.length);
    const stranger = s.ctx.guardians.find((x) => !x.studentIds.includes(kids[9]!.id))!;
    expect((await req(stranger.username, 'GET', '/library/my-books')).body.data.map((x: any) => x.id)).not.toContain(l.body.id);
    expect((await req(stranger.username, 'GET', `/library/my-books?studentId=${kids[9]!.id}`)).status).toBe(404);
    expect((await req(kids[10]!.username, 'GET', '/library/my-books')).body.data.map((x: any) => x.id)).not.toContain(l.body.id);
    expect((await req('9099999999', 'GET', '/library/my-books')).body.data).toEqual([]);
    const staffLoan = await issue('librarian', { bookId: (await mkBook()).body.id, staffId: s.ctx.teachers[0]!.id });
    expect((await req('t001', 'GET', '/library/my-books')).body.data.map((x: any) => x.id)).toEqual([staffLoan.body.id]);
    expect((await req('t002', 'GET', '/library/my-books')).body.data).toEqual([]);
    await req('librarian', 'POST', `/library/issues/${l.body.id}/return`, {});
    expect((await req(kids[9]!.username, 'GET', '/library/my-books')).body.data.map((x: any) => x.id)).not.toContain(l.body.id);
    expect((await req(kids[9]!.username, 'GET', '/library/my-books?includeReturned=true')).body.data.find((x: any) => x.id === l.body.id).status).toBe('returned');
  });

  it('job library.overdue-reminders: guardians and students once per overdue book per week; idempotent', async () => {
    const job = jobs.find((j) => j.name === 'library.overdue-reminders')!;
    expect(job.everyMinutes).toBe(1440);
    const kid = kids[0]!; // also has an UNVERIFIED guardian (9099999999)
    const g = guardianOf(kid);
    const bookA = (await mkBook()).body;
    const bookB = (await mkBook()).body;
    const lateStudent = await issue('librarian', { bookId: bookA.id, studentId: kid.id });
    const lateStaff = await issue('librarian', { bookId: bookB.id, staffId: s.ctx.teachers[1]!.id });
    const fresh = await issue('librarian', { bookId: (await mkBook()).body.id, studentId: kids[3]!.id });
    await s.db.update(libraryIssues).set({ dueOn: addDaysIso(today, -4) }).where(eq(libraryIssues.id, lateStudent.body.id));
    await s.db.update(libraryIssues).set({ dueOn: addDaysIso(today, -1) }).where(eq(libraryIssues.id, lateStaff.body.id));
    const reminders = () => s.db.select().from(notifications).where(eq(notifications.type, 'system.library_overdue'));

    expect(await runJobOnce(s.tenant, job)).toBe(true);
    const first = await reminders();
    const to = (issueId: string) => first.filter((n) => (n.data as any).issueId === issueId).map((n) => n.userId).sort();
    expect(to(lateStudent.body.id)).toEqual([kid.userId, g.userId].sort()); // the child and the verified guardian — not the unverified one
    expect(to(lateStudent.body.id)).not.toContain(await userIdOf('9099999999'));
    expect(to(lateStaff.body.id)).toEqual([(await s.db.select({ u: staff.userId }).from(staff).where(eq(staff.id, s.ctx.teachers[1]!.id)))[0]!.u]);
    expect(to(fresh.body.id)).toEqual([]); // not overdue
    expect(first[0]).toMatchObject({ title: 'Library book overdue', data: expect.objectContaining({ route: '/library' }) });
    expect(first.find((n) => (n.data as any).issueId === lateStudent.body.id)!.body).toContain(bookA.title);

    await runJobOnce(s.tenant, job); // same day: nothing new
    await runJobOnce(s.tenant, job);
    expect(await reminders()).toHaveLength(first.length);
    await s.db.update(libraryIssues).set({ lastRemindedOn: addDaysIso(today, -3) }).where(eq(libraryIssues.id, lateStudent.body.id)); // reminded 3 days ago: wait
    await runJobOnce(s.tenant, job);
    expect(await reminders()).toHaveLength(first.length);
    await s.db.update(libraryIssues).set({ lastRemindedOn: addDaysIso(today, -8) }).where(eq(libraryIssues.id, lateStudent.body.id)); // over a week: remind again
    await runJobOnce(s.tenant, job);
    expect((await reminders()).length).toBe(first.length + 2);
    // a returned book is never nagged about
    await req('librarian', 'POST', `/library/issues/${lateStaff.body.id}/return`);
    await s.db.update(libraryIssues).set({ lastRemindedOn: null }).where(eq(libraryIssues.id, lateStaff.body.id));
    await runJobOnce(s.tenant, job);
    expect((await reminders()).length).toBe(first.length + 2);
  });

  it('feature flag off → 403 FEATURE_DISABLED for every library route', async () => {
    await setFeatures({ library: false });
    for (const [who, method, path] of [['librarian', 'GET', '/library/books'], [kids[0]!.username, 'GET', '/library/my-books'], ['librarian', 'GET', '/library/policy'], ['librarian', 'GET', '/library/overdue'], ['principal', 'GET', '/library/issues']] as const) {
      const r = await req(who, method, path);
      expect(r.status, path).toBe(403);
      expect(r.body.code).toBe('FEATURE_DISABLED');
    }
    expect((await req('librarian', 'POST', '/library/books', { accessionNo: 'OFF-1', title: 'x' })).body.code).toBe('FEATURE_DISABLED');
    expect((await req('transport', 'GET', '/transport/routes')).status).toBe(200);
    await setFeatures({ library: true });
    expect((await req('librarian', 'GET', '/library/books')).status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('read-only school', () => {
  it('refuses transport and library writes with 402 but still serves reads', async () => {
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: '2020-21', startsOn: '2020-04-01', endsOn: '2021-03-31', pricePerStudent: 100, licensedStudents: 50, graceDays: 10 });
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2001-01-01', pricePerStudent: 100, licensedStudents: 50, graceDays: 10 });
    invalidateLicense(s.tenant.id);
    for (const [who, path, body] of [
      ['transport', '/transport/vehicles', { registrationNo: 'RO-0001' }],
      ['librarian', '/library/books', { accessionNo: 'RO-1', title: 'x' }],
      ['librarian', '/library/issues', { bookId: '0192e0f0-0000-7000-8000-000000000000', studentId: kids[0]!.id }],
    ] as const) {
      const r = await req(who, 'POST', path, body);
      expect(r.status, path).toBe(402);
      expect(r.body.code).toBe('SUBSCRIPTION_EXPIRED');
    }
    expect((await req('transport', 'GET', '/transport/routes')).status).toBe(200);
    expect((await req('librarian', 'GET', '/library/books')).status).toBe(200);
  });
});
