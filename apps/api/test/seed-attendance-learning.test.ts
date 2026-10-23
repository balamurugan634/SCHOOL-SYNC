import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { todayIn } from '../src/core/http';
import { attendanceCorrections, attendanceRecords, attendanceSessions, homework, leaveRequests, staffAttendance, timetableSlots } from '../src/db/tenant/schema';
import { createTestSchool } from './helpers';

/** attendance + learning demo seeders running together with every other module's seeder (the real `site:seed-demo` order). */
describe('attendance + learning demo seed in the full pipeline', () => {
  it('produces data the API serves to each role', async () => {
    const s = await createTestSchool({ size: 'small', modules: true });
    const today = todayIn(s.tenant.timezone);
    const principal = await s.login('principal');
    const stu = s.ctx.students[0]!;
    const parentUser = s.ctx.guardians.find((g) => g.studentIds.includes(stu.id))!;

    expect((await s.db.select({ n: sql<number>`count(*)::int` }).from(attendanceSessions))[0]!.n).toBeGreaterThan(20);
    expect((await s.db.select({ n: sql<number>`count(*)::int` }).from(attendanceRecords))[0]!.n).toBeGreaterThan(200);
    expect((await s.db.select({ n: sql<number>`count(*)::int` }).from(staffAttendance))[0]!.n).toBeGreaterThan(100);
    expect((await s.db.select({ n: sql<number>`count(*)::int` }).from(leaveRequests).where(eq(leaveRequests.status, 'pending')))[0]!.n).toBeGreaterThanOrEqual(2);
    expect((await s.db.select({ n: sql<number>`count(*)::int` }).from(attendanceCorrections).where(eq(attendanceCorrections.status, 'pending')))[0]!.n).toBe(1);
    expect((await s.db.select({ n: sql<number>`count(*)::int` }).from(homework))[0]!.n).toBeGreaterThan(5);
    expect((await s.db.select({ n: sql<number>`count(*)::int` }).from(timetableSlots))[0]!.n).toBeGreaterThan(20);

    const sum = await s.req('GET', `/attendance/summary?date=${today}`, principal);
    expect(sum.status).toBe(200);
    expect(sum.body.sectionsTotal).toBe(2);
    expect((await s.req('GET', '/attendance/summary?trendDays=14', principal)).body.trend.length).toBeGreaterThan(5);

    // student, parent and a teacher get sensible views of the same data
    const student = await s.login(stu.username);
    const mine = await s.req('GET', `/attendance/students/${stu.id}/summary`, student);
    expect(mine.status).toBe(200);
    expect(mine.body.totals.total).toBeGreaterThan(20);
    const par = await s.login(parentUser.username);
    expect((await s.req('GET', `/attendance/students/${stu.id}/summary`, par)).body.totals.total).toBe(mine.body.totals.total);
    const t = await s.login('t001');
    expect((await s.req('GET', '/attendance/today', t)).status).toBe(200);
    expect((await s.req('GET', '/leave?status=pending', t)).status).toBe(200);
    expect((await s.req('GET', '/homework', student)).body.data.length).toBeGreaterThan(0);
    expect((await s.req('GET', '/timetable/me', student)).status).toBe(200);
    expect((await s.req('GET', '/staff-attendance/summary', await s.login('hr'))).body.staff.length).toBeGreaterThan(5);
    expect((await s.req('GET', '/staff-leave?status=pending', await s.login('hr'))).body.meta.total).toBeGreaterThanOrEqual(1);
  });
});
