import { eq, sql } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed as attendanceSeed } from '../src/cli/seed/attendance';
import { addDaysIso, todayIn } from '../src/core/http';
import { attendanceAlerts, attendanceCorrections, attendanceRecords, attendanceSessions, leaveRequests, staff, staffAttendance, staffLeaveRequests } from '../src/db/tenant/schema';
import { createTestSchool, type TestSchool } from './helpers';

/**
 * Attendance on the FULL demo seed (240 students × 35 school days) plus a synthetic history to prove the school-wide
 * summary stays fast on a big `attendance_records` table.
 *
 *   ATTENDANCE_PERF_ROWS=500000 …   extra rows to generate (default 100 000, i.e. a quick check; 500 000 is the real thing)
 *
 * Run it ONCE (it provisions a full-size school): scripts/dev/heavy.sh -- pnpm --filter @school-sync/api exec vitest run test/attendance-perf.test.ts
 */
const EXTRA_ROWS = Number(process.env['ATTENDANCE_PERF_ROWS'] ?? 100_000);

let f: TestSchool;
let today: string;
let seedMs = 0;
let principal: string;
const timings: Record<string, number[]> = {};

async function timed<T>(label: string, fn: () => Promise<T>, runs = 3): Promise<T> {
  let last!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    last = await fn();
    (timings[label] ??= []).push(performance.now() - t0);
  }
  return last;
}
const worst = (label: string) => Math.max(...(timings[label] ?? [0]));

beforeAll(async () => {
  f = await createTestSchool({ size: 'full' });
  today = todayIn(f.tenant.timezone);
  const t0 = performance.now();
  await attendanceSeed(f.ctx);
  seedMs = performance.now() - t0;
  principal = await f.login('principal');
}, 240_000);

describe('full demo seed', () => {
  it('seeds in a few seconds', () => {
    console.log(`attendance seed: ${Math.round(seedMs)} ms for ${f.ctx.students.length} students`);
    expect(f.ctx.students).toHaveLength(240);
    expect(seedMs).toBeLessThan(15_000);
  });

  it('has ~35 school days of roll calls for every section, with realistic numbers', async () => {
    const [sess] = await f.db.select({ n: sql<number>`count(*)::int`, days: sql<number>`count(distinct ${attendanceSessions.date})::int`, sections: sql<number>`count(distinct ${attendanceSessions.sectionId})::int` }).from(attendanceSessions).where(eq(attendanceSessions.status, 'submitted'));
    expect(sess!.sections).toBe(10);
    expect(sess!.days).toBeGreaterThanOrEqual(30);
    expect(sess!.days).toBeLessThanOrEqual(35);
    const [rec] = await f.db.select({ n: sql<number>`count(*)::int`, present: sql<number>`count(*) filter (where status = 'present')::int`, late: sql<number>`count(*) filter (where status = 'late')::int`, half: sql<number>`count(*) filter (where status = 'half_day')::int`, leave: sql<number>`count(*) filter (where status = 'leave')::int`, absent: sql<number>`count(*) filter (where status = 'absent')::int` }).from(attendanceRecords);
    const ratio = rec!.present / rec!.n;
    console.log(`records: ${rec!.n}, present ${(ratio * 100).toFixed(1)}%, absent ${rec!.absent}, late ${rec!.late}, half-day ${rec!.half}, leave ${rec!.leave}`);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(0.96);
    expect(rec!.late).toBeGreaterThan(0);
    expect(rec!.half).toBeGreaterThan(0);
    expect(rec!.leave).toBeGreaterThan(0);
    expect(rec!.n).toBeGreaterThan(240 * 28);
  });

  it('has chronic absentees below the shortage line, leaves, corrections and staff attendance', async () => {
    const perStudent = await f.db.execute<{ pct: number }>(sql`select 100.0 * (count(*) filter (where status in ('present','late')) + 0.5 * count(*) filter (where status = 'half_day')) / nullif(count(*) filter (where status <> 'leave'), 0) as pct from attendance_records group by student_id`);
    const below = perStudent.rows.filter((r) => Number(r.pct) < 75).length;
    expect(below).toBeGreaterThanOrEqual(5);
    expect(below).toBeLessThanOrEqual(15);
    const leaves = await f.db.select({ status: leaveRequests.status, n: sql<number>`count(*)::int` }).from(leaveRequests).groupBy(leaveRequests.status);
    const byStatus = Object.fromEntries(leaves.map((l) => [l.status, l.n]));
    expect(byStatus['approved']).toBeGreaterThanOrEqual(3);
    expect(byStatus['pending']).toBeGreaterThanOrEqual(3);
    expect(byStatus['rejected']).toBeGreaterThanOrEqual(1);
    expect(byStatus['cancelled']).toBeGreaterThanOrEqual(1);
    // the approved future leave pre-marked draft roll calls
    const drafts = await f.db.select({ n: sql<number>`count(*)::int` }).from(attendanceSessions).where(eq(attendanceSessions.status, 'draft'));
    expect(drafts[0]!.n).toBeGreaterThanOrEqual(1);
    const corr = await f.db.select({ status: attendanceCorrections.status, n: sql<number>`count(*)::int` }).from(attendanceCorrections).groupBy(attendanceCorrections.status);
    expect(Object.fromEntries(corr.map((c) => [c.status, c.n]))).toEqual({ pending: 1, approved: 1, rejected: 1 });
    const staffCount = f.ctx.teachers.length + Object.keys(f.ctx.staff).length; // the provisioning super-admin is not part of the register
    expect((await f.db.select({ id: staff.id }).from(staff)).length).toBeGreaterThanOrEqual(staffCount);
    const [sa] = await f.db.select({ n: sql<number>`count(*)::int`, days: sql<number>`count(distinct ${staffAttendance.date})::int` }).from(staffAttendance);
    expect(sa!.n).toBe(staffCount * sa!.days);
    expect((await f.db.select({ id: staffLeaveRequests.id }).from(staffLeaveRequests)).length).toBeGreaterThanOrEqual(3);
  });

  it('shows "not yet marked" sections today and works through the API', async () => {
    const sum = await f.req('GET', `/attendance/summary?date=${today}`, principal);
    expect(sum.status, JSON.stringify(sum.body)).toBe(200);
    expect(sum.body.sectionsTotal).toBe(10);
    if (sum.body.isWorkingDay) {
      expect(sum.body.sectionsMarked).toBe(8); // the last two sections have not marked today yet
      expect(sum.body.totals.percentPresent).toBeGreaterThan(80);
    }
    const stale = await f.req('GET', `/attendance/summary?date=${addDaysIso(today, -2)}&trendDays=14`, principal);
    expect(stale.status).toBe(200);
    // the seeded pending correction is waiting for the principal
    const corr = await f.req('GET', '/attendance/corrections', principal);
    expect(corr.body.meta.total).toBe(1);
    // the chronic absentees are caught by the shortage scan, once
    const scan = await f.req('POST', '/attendance/shortage-scan', principal);
    expect(scan.status, JSON.stringify(scan.body)).toBe(200);
    expect(scan.body.belowThreshold).toBeGreaterThanOrEqual(5);
    expect(scan.body.alertsSent).toBe(scan.body.belowThreshold);
    expect((await f.req('POST', '/attendance/shortage-scan', principal)).body.alertsSent).toBe(0);
    expect((await f.db.select({ id: attendanceAlerts.id }).from(attendanceAlerts)).length).toBe(scan.body.alertsSent);
  });
});

// vitest hides console output of passing tests, so the measurements also go to a file next to the OS temp dir
afterAll(() => {
  try {
    const report = { when: new Date().toISOString(), seedMs: Math.round(seedMs), extraRows: EXTRA_ROWS, timingsMs: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, v.map((x) => Math.round(x))])) };
    writeFileSync(join(tmpdir(), 'schoolsync-attendance-perf.json'), JSON.stringify(report, null, 2));
  } catch {
    /* best effort */
  }
});

describe(`performance with ${EXTRA_ROWS.toLocaleString()} extra attendance records`, () => {
  let studentId: string;
  let sectionId: string;
  let oldDate: string;
  let total = 0;

  beforeAll(async () => {
    studentId = f.ctx.students[10]!.id;
    sectionId = f.ctx.sections[0]!.id;
    const perDay = f.ctx.students.length;
    const days = Math.ceil(EXTRA_ROWS / perDay);
    const start = '2019-01-01';
    oldDate = addDaysIso(start, Math.floor(days / 2));
    const t0 = performance.now();
    // in slices, so no single statement runs into the 30 s statement timeout
    for (let from = 0; from < days; from += 300) {
      const to = Math.min(days, from + 300) - 1;
      await f.db.execute(sql`
        insert into attendance_sessions (id, section_id, date, status, submitted_at, created_at, updated_at)
        select gen_random_uuid(), sec.id, (${start}::date + g)::date, 'submitted', now(), now(), now()
        from sections sec cross join generate_series(${from}::int, ${to}::int) g`);
      await f.db.execute(sql`
        insert into attendance_records (id, session_id, student_id, section_id, date, status, marked_at, updated_at)
        select gen_random_uuid(), s.id, st.id, s.section_id, s.date,
               case when random() < 0.93 then 'present' when random() < 0.5 then 'absent' else 'late' end, now(), now()
        from attendance_sessions s join students st on st.current_section_id = s.section_id and st.status = 'active'
        where s.date >= (${start}::date + ${from}::int) and s.date <= (${start}::date + ${to}::int)`);
    }
    await f.db.execute(sql`analyze attendance_records`);
    await f.db.execute(sql`analyze attendance_sessions`);
    const [c] = await f.db.select({ n: sql<number>`count(*)::int` }).from(attendanceRecords);
    total = c!.n;
    console.log(`generated history: ${total.toLocaleString()} records in ${Math.round(performance.now() - t0)} ms`);
  }, 600_000);

  it('the table is as big as asked', () => {
    expect(total).toBeGreaterThanOrEqual(EXTRA_ROWS);
  });

  it('school-wide summary (today, a historical day, with trend) stays fast', async () => {
    const a = await timed('school summary (today)', () => f.req('GET', `/attendance/summary?date=${today}`, principal));
    expect(a.status).toBe(200);
    const b = await timed('school summary (historical day, 31-day trend)', () => f.req('GET', `/attendance/summary?date=${oldDate}&trendDays=31&absenteeLimit=500`, principal));
    expect(b.status).toBe(200);
    expect(b.body.sectionsMarked).toBe(10);
    expect(b.body.totals.markedStudents).toBe(240);
    expect(b.body.totals.present + b.body.totals.absent + b.body.totals.late).toBe(240);
    expect(b.body.trend.length).toBe(Math.min(31, Math.floor(Math.ceil(EXTRA_ROWS / 240) / 2) + 1));
    console.log(`school summary: today ${timings['school summary (today)']!.map((x) => Math.round(x)).join('/')} ms, historical ${timings['school summary (historical day, 31-day trend)']!.map((x) => Math.round(x)).join('/')} ms`);
    expect(worst('school summary (today)')).toBeLessThan(750);
    expect(worst('school summary (historical day, 31-day trend)')).toBeLessThan(1000);
  });

  it('the other views stay fast too', async () => {
    const stu = await timed('student summary (whole history)', () => f.req('GET', `/attendance/students/${studentId}/summary?from=2019-01-01&to=${today}`, principal));
    // 3 000+ days is beyond the 400-day range cap: the API refuses instead of scanning everything
    expect(stu.status).toBe(422);
    const yr = await timed('student summary (academic year)', () => f.req('GET', `/attendance/students/${studentId}/summary`, principal));
    expect(yr.status).toBe(200);
    const recs = await timed('student records (page of 30)', () => f.req('GET', `/attendance/students/${studentId}/records?limit=30`, principal));
    expect(recs.body.data).toHaveLength(30);
    const deep = await timed('student records (deep page)', () => f.req('GET', `/attendance/students/${studentId}/records?limit=30&from=2019-01-01&to=2019-06-30`, principal));
    expect(deep.status).toBe(200);
    const sec = await timed('section summary (30 days)', () => f.req('GET', `/attendance/sections/${sectionId}/summary`, principal));
    expect(sec.status).toBe(200);
    const td = await timed('today (management)', () => f.req('GET', '/attendance/today', principal));
    expect(td.status).toBe(200);
    const exp = await timed('csv export (one day)', () => f.req('GET', `/attendance/export?from=${oldDate}&to=${oldDate}`, principal), 1);
    expect(exp.status).toBe(200);
    for (const [label, ts] of Object.entries(timings)) console.log(`  ${label}: ${ts.map((x) => Math.round(x)).join('/')} ms`);
    for (const label of ['student summary (academic year)', 'student records (page of 30)', 'student records (deep page)', 'section summary (30 days)', 'today (management)', 'csv export (one day)']) expect(worst(label), label).toBeLessThan(1000);
  });

  it('the shortage scan over the whole table only reads the current academic year', async () => {
    const t0 = performance.now();
    const r = await f.req('POST', '/attendance/shortage-scan', principal);
    const ms = performance.now() - t0;
    console.log(`shortage scan: ${Math.round(ms)} ms`);
    expect(r.status).toBe(200);
    expect(ms).toBeLessThan(2000);
  });

  it('keeps a student’s current-year records on the index (no sequential scan of the big table)', async () => {
    const plan = await f.db.execute<{ 'QUERY PLAN': string }>(sql`explain select status from attendance_records where student_id = ${studentId} and date >= date '2026-04-01' order by date desc limit 30`);
    const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).not.toMatch(/Seq Scan on attendance_records/);
    const day = await f.db.execute<{ 'QUERY PLAN': string }>(sql`explain select section_id, count(*) from attendance_records where date = ${today} group by section_id`);
    expect(day.rows.map((r) => r['QUERY PLAN']).join('\n')).not.toMatch(/Seq Scan on attendance_records/);
  });
});
