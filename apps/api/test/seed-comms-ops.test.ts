import { count, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { announcementReceipts, announcements, eventRegistrations, events, libraryIssues, meetings, studentTransport, transportRoutes, transportStops, transportVehicles } from '../src/db/tenant/schema';
import { seed as seedCommunication } from '../src/cli/seed/communication';
import { seed as seedOperations } from '../src/cli/seed/operations';
import { createTestSchool, type TestSchool } from './helpers';

/** The demo seeders of communication and operations (run alone on top of the foundation, so other modules' seeders cannot interfere). */
let s: TestSchool;
const num = async (q: ReturnType<typeof sql>) => Number((await s.db.execute<{ n: number }>(q)).rows[0]!.n);

beforeAll(async () => {
  s = await createTestSchool({ size: 'full' });
  const t0 = Date.now();
  await seedCommunication(s.ctx);
  await seedOperations(s.ctx);
  console.info(`communication + operations seeded in ${Date.now() - t0} ms`);
});

describe('communication seed', () => {
  it('has announcements of every kind, with read / acknowledgement receipts', async () => {
    const rows = await s.db.select().from(announcements);
    expect(rows.find((a) => a.priority === 'urgent' && a.status === 'published')).toBeTruthy();
    expect(rows.find((a) => a.priority === 'important' && a.status === 'published' && !a.requiresAck)).toBeTruthy();
    expect(rows.find((a) => a.status === 'draft' && a.publishAt && a.publishAt > new Date())).toBeTruthy(); // scheduled
    expect(rows.find((a) => a.status === 'draft' && !a.publishAt)).toBeTruthy();
    expect(rows.find((a) => a.status === 'archived')).toBeTruthy();
    const ack = rows.find((a) => a.requiresAck)!;
    const [r] = await s.db.select({ read: count(announcementReceipts.readAt), acked: count(announcementReceipts.ackedAt) }).from(announcementReceipts).where(eq(announcementReceipts.announcementId, ack.id));
    expect(r!.read).toBeGreaterThan(50);
    expect(r!.acked).toBeGreaterThan(20);
    expect(r!.acked).toBeLessThan(r!.read);
    // the section-specific one is addressed to a single section
    const stats = await s.req('GET', `/announcements/${rows.find((a) => a.title.includes('science project'))!.id}/stats`, await s.login(s.ctx.teachers[0]!.username));
    expect(stats.status).toBe(200);
    expect(stats.body.bySection).toHaveLength(1);
    expect(stats.body.audienceSize).toBeGreaterThan(20);
  });

  it('feeds look right for the demo student, parent and teacher', async () => {
    const stu = await s.login(s.ctx.students[0]!.username);
    const par = await s.login(s.ctx.guardians[0]!.username);
    const tea = await s.login('t001');
    const feed = await s.req('GET', '/announcements', stu);
    expect(feed.body.data.length).toBeGreaterThanOrEqual(4);
    expect(feed.body.data.some((a: any) => a.requiresAck && !a.acknowledged)).toBe(true);
    expect((await s.req('GET', '/announcements/unread-count', par)).body.pendingAck).toBe(1);
    for (const [name, t] of [['student', stu], ['parent', par], ['teacher', tea]] as const) {
      const inbox = await s.req('GET', '/notifications?limit=100', t);
      expect(inbox.body.data.length, name).toBeGreaterThanOrEqual(30);
      const unread = (await s.req('GET', '/notifications/unread-count', t)).body.unread;
      expect(unread, name).toBeGreaterThan(3);
      expect(unread, name).toBeLessThan(inbox.body.data.length);
      expect(new Set(inbox.body.data.map((n: any) => n.category)).size, name).toBeGreaterThanOrEqual(4);
    }
    expect((await s.req('GET', '/announcements', await s.login('9099999999'))).body.data).toHaveLength(0);
    expect((await s.req('GET', '/notifications/preferences', par)).body.categories.find((c: any) => c.category === 'event')).toMatchObject({ quietFrom: '22:00', quietTo: '06:30' });
  });

  it('calendar has the year’s holidays, sports day, PTM (registration) and a consent trip', async () => {
    const all = await s.db.select().from(events);
    expect(all.filter((e) => e.kind === 'holiday').length).toBeGreaterThanOrEqual(8);
    for (const e of all) {
      if (e.kind === 'holiday') {
        expect(e.startDate >= `${s.ctx.yearName.slice(0, 4)}-04-01`).toBe(true);
        expect(e.endDate <= `${Number(s.ctx.yearName.slice(0, 4)) + 1}-03-31`).toBe(true);
      }
    }
    expect(all.find((e) => e.kind === 'sports' && e.registrationRequired)).toBeTruthy();
    expect(all.find((e) => e.kind === 'ptm' && e.registrationRequired && e.capacity)).toBeTruthy();
    const trip = all.find((e) => e.consentRequired)!;
    expect(trip.consentText).toBeTruthy();
    const regs = await s.db.select().from(eventRegistrations).where(eq(eventRegistrations.eventId, trip.id));
    expect(regs.length).toBeGreaterThan(5);
    expect(regs.some((r) => r.response === 'consent_denied')).toBe(true);
    expect(regs.some((r) => r.studentId === s.ctx.students[0]!.id)).toBe(false); // the demo parent still has a form to fill in
    const par = await s.login(s.ctx.guardians[0]!.username);
    const detail = await s.req('GET', `/events/${trip.id}`, par);
    expect(detail.body.children[0]).toMatchObject({ response: null });
    expect(detail.body.responseOpen).toBe(true);
    const from = new Date().toISOString().slice(0, 10);
    const cal = await s.req('GET', `/calendar?from=${from}&to=${new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)}`, par);
    expect(cal.status).toBe(200);
    expect(cal.body.data.length).toBeGreaterThanOrEqual(5);
    const counts = (await s.req('GET', `/events/${all.find((e) => e.kind === 'ptm')!.id}`, await s.login('principal'))).body.counts;
    expect(counts.going).toBeGreaterThan(20);
  });

  it('meetings exist in every status', async () => {
    const rows = await s.db.select({ status: meetings.status, n: count() }).from(meetings).groupBy(meetings.status);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['requested', 'confirmed', 'declined', 'completed', 'cancelled']));
    const tea = await s.login('t001');
    const mine = await s.req('GET', '/meetings', tea);
    expect(mine.body.data.length).toBeGreaterThanOrEqual(5);
    expect((await s.req('GET', '/meetings/upcoming', tea)).body.data.length).toBeGreaterThan(0);
    expect((await s.req('GET', '/meetings', await s.login(s.ctx.guardians[0]!.username))).body.data).toHaveLength(4);
  });
});

describe('operations seed', () => {
  it('transport: 5 vehicles, 3 routes, about 60 riders within the seats, expiry alerts', async () => {
    expect(await s.db.select().from(transportVehicles)).toHaveLength(5);
    expect(await s.db.select().from(transportRoutes)).toHaveLength(3);
    expect((await s.db.select().from(transportStops)).length).toBeGreaterThanOrEqual(18);
    expect((await s.db.select().from(studentTransport)).length).toBe(60);
    const t = await s.login('transport');
    const routes = await s.req('GET', '/transport/routes', t);
    expect(routes.body.data.every((r: any) => r.seatsLeft >= 0 && r.studentCount > 10)).toBe(true);
    const alerts = await s.req('GET', '/transport/vehicles?insuranceAlert=true', t);
    expect(alerts.body.data.map((v: any) => v.insuranceStatus).sort()).toEqual(['expired', 'expiring']);
    const my = await s.req('GET', '/transport/my-bus', await s.login(s.ctx.students[0]!.username));
    expect(my.body.data[0]).toMatchObject({ allocated: true, driver: { phone: expect.any(String) } });
    const m = await s.req('GET', `/transport/routes/${routes.body.data[0].id}/manifest`, t);
    expect(m.body.stops.reduce((n: number, x: any) => n + x.students.length, 0)).toBe(routes.body.data[0].studentCount);
  });

  it('library: 150 books, ~40 loans with consistent stock, overdue loans and fines', async () => {
    expect(await num(sql`select count(*)::int as n from library_books`)).toBe(150);
    const issues = await s.db.select().from(libraryIssues);
    expect(issues.length).toBeGreaterThanOrEqual(36);
    expect(issues.length).toBeLessThanOrEqual(40);
    // stock = copies − loans still out, for every title (and the CHECK constraint held on insert)
    const bad = await num(sql`select count(*)::int as n from library_books b where b.available_copies <> b.total_copies - (select count(*) from library_issues i where i.book_id = b.id and i.returned_on is null)`);
    expect(bad).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    const overdue = issues.filter((i) => !i.returnedOn && i.dueOn < today);
    expect(overdue.length).toBeGreaterThanOrEqual(6);
    expect(issues.filter((i) => i.returnedOn).length).toBeGreaterThanOrEqual(8);
    expect(issues.some((i) => i.returnedOn && i.fineMinor > 0)).toBe(true);
    const lib = await s.login('librarian');
    const od = await s.req('GET', '/library/overdue', lib);
    expect(od.status).toBe(200);
    expect(od.body.totals.count).toBe(overdue.length);
    expect(od.body.totals.fineMinor).toBeGreaterThan(0);
    const mine = await s.req('GET', '/library/my-books', await s.login(s.ctx.students[0]!.username));
    expect(mine.body.data.map((x: any) => x.status).sort()).toEqual(['borrowed', 'overdue']);
    expect((await s.req('GET', '/library/books?q=wings%20of%20fire', lib)).body.data[0]).toMatchObject({ author: 'A. P. J. Abdul Kalam' });
    expect((await s.req('GET', '/library/categories', lib)).body.data.length).toBeGreaterThanOrEqual(8);
  });
});
