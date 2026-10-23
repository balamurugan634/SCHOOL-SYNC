import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { addDaysIso, isoWeekday, todayIn } from '../../core/http';
import { getSetting } from '../../core/settings';
import { academicYears, attendanceCorrections, attendanceRecords, attendanceSessions, leaveRequests, staffAttendance, staffLeaveRequests } from '../../db/tenant/schema';
import { zonedDayStart } from '../../modules/learning/common';
import { applyLeaveToAttendance } from '../../modules/attendance/leave.service';
import type { ModuleSeeder } from './context';

type Status = 'present' | 'absent' | 'late' | 'leave' | 'half_day';

async function insertChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

const LEAVE_REASONS: [('sick' | 'casual' | 'family' | 'event'), string][] = [
  ['sick', 'Fever and cold, doctor advised rest'],
  ['family', 'Attending a family function out of town'],
  ['sick', 'Dental treatment'],
  ['casual', 'Visiting grandparents'],
  ['event', 'Representing the district in a sports meet'],
];

/**
 * Demo data for attendance & leave:
 *  - the last 35 school days of roll calls for every section (≈93% present, a few chronic absentees below the 75% shortage line,
 *    late / half-day marks, approved leaves), today's roll call for all sections except the last couple ("not yet marked"),
 *  - student leave (approved / pending / rejected / cancelled) and a pending + decided attendance corrections,
 *  - 35 days of staff attendance and a few staff leave requests.
 */
export const seed: ModuleSeeder = async (ctx) => {
  const { db, rng, int, pick, tenant } = ctx;
  const tz = tenant.timezone;
  const today = todayIn(tz);
  const acad = await getSetting(db, 'academic');
  const att = await getSetting(db, 'attendance');

  // ── the last 35 school days (ascending), never before the academic year began ──
  const [year] = await db.select({ startDate: academicYears.startDate }).from(academicYears).where(eq(academicYears.id, ctx.yearId)).limit(1);
  const yearStart = year?.startDate;
  const days: string[] = [];
  for (let d = today; days.length < 35 && (!yearStart || d >= yearStart); d = addDaysIso(d, -1)) if (acad.workingDays.includes(isoWeekday(d))) days.push(d);
  days.reverse();
  if (!days.length) return;
  const nextSchoolDay = (from: string) => {
    let d = addDaysIso(from, 1);
    for (let i = 0; i < 10 && !acad.workingDays.includes(isoWeekday(d)); i++) d = addDaysIso(d, 1);
    return d;
  };

  const bySection = new Map<string, typeof ctx.students>();
  for (const s of ctx.students) (bySection.get(s.sectionId) ?? bySection.set(s.sectionId, []).get(s.sectionId)!).push(s);
  for (const list of bySection.values()) list.sort((a, b) => a.rollNo - b.rollNo);
  const teacherOf = new Map(ctx.teachers.map((t) => [t.id, t]));
  const guardianUserOf = new Map(ctx.guardians.flatMap((g) => g.studentIds.map((sid) => [sid, g.userId] as const)));
  const principal = ctx.staff['principal'];

  // ── who is away on approved leave (past) and who is chronically absent ──
  const sectionsList = ctx.sections;
  // each leave scenario gets its own student (the next unused one from `nth`, wrapping around in small sections)
  const usedForLeave = new Set<string>();
  const pickStudent = (secIdx: number, nth: number) => {
    const list = bySection.get(sectionsList[secIdx % sectionsList.length]!.id) ?? [];
    for (let k = 0; k < list.length; k++) {
      const cand = list[(nth + k) % list.length]!;
      if (!usedForLeave.has(cand.id)) {
        usedForLeave.add(cand.id);
        return cand;
      }
    }
    return undefined;
  };
  const pastLeaves: { studentId: string; sectionId: string; from: string; to: string; type: 'sick' | 'casual' | 'family' | 'event'; reason: string }[] = [];
  if (days.length >= 14) {
    const mk = (secIdx: number, nth: number, startIdx: number, len: number, r: (typeof LEAVE_REASONS)[number]) => {
      const s = pickStudent(secIdx, nth);
      if (s) pastLeaves.push({ studentId: s.id, sectionId: s.sectionId, from: days[startIdx]!, to: days[Math.min(startIdx + len - 1, days.length - 2)]!, type: r[0], reason: r[1] });
    };
    mk(0, 4, days.length - 12, 3, LEAVE_REASONS[0]!);
    mk(1, 7, days.length - 20, 2, LEAVE_REASONS[1]!);
    mk(2, 2, days.length - 9, 1, LEAVE_REASONS[2]!);
  }
  const leaveDay = new Map<string, string>(); // `${studentId}:${date}` → leave request marker
  for (const l of pastLeaves) for (const d of days) if (d >= l.from && d <= l.to) leaveDay.set(`${l.studentId}:${d}`, 'leave');

  const chronic = new Map<string, number>(); // student → daily absence probability (28–45%: well below the 75% shortage line)
  const pool = ctx.students.slice(3);
  const nChronic = Math.max(2, Math.round(ctx.students.length * 0.03));
  while (chronic.size < Math.min(nChronic, pool.length)) chronic.set(pool[int(0, pool.length - 1)]!.id, 0.28 + rng() * 0.17);

  // ── roll calls ──
  const unmarkedToday = new Set(sectionsList.slice(-(ctx.size === 'small' ? 1 : 2)).map((s) => s.id));
  const sessions: (typeof attendanceSessions.$inferInsert)[] = [];
  const records: (typeof attendanceRecords.$inferInsert)[] = [];
  const prevAbsent = new Set<string>();
  const sessionIdOf = new Map<string, string>(); // `${sectionId}:${date}`
  for (const date of days) {
    const submittedAt = new Date(Math.min(Date.now() - 20 * 60_000, zonedDayStart(date, tz).getTime() + (9 * 60 + 20) * 60_000));
    for (const sec of sectionsList) {
      if (date === today && unmarkedToday.has(sec.id)) continue;
      const teacher = teacherOf.get(sec.classTeacherId);
      const sid = uuidv7();
      sessionIdOf.set(`${sec.id}:${date}`, sid);
      sessions.push({ id: sid, sectionId: sec.id, date, periodId: null, takenBy: sec.classTeacherId, takenByUserId: teacher?.userId ?? null, status: 'submitted', submittedAt });
      for (const stu of bySection.get(sec.id) ?? []) {
        let status: Status = 'present';
        let remarks: string | null = null;
        if (leaveDay.has(`${stu.id}:${date}`)) status = 'leave';
        else {
          const absentP = chronic.get(stu.id) ?? (prevAbsent.has(stu.id) ? 0.3 : 0.028);
          const roll = rng();
          if (roll < absentP) {
            status = 'absent';
            if (rng() < 0.3) remarks = pick(['Fever', 'Informed by parent', 'Family function', 'No intimation']);
          } else if (roll < absentP + 0.02) {
            status = 'late';
            remarks = rng() < 0.5 ? pick(['Bus delay', 'Arrived 15 minutes late']) : null;
          } else if (roll < absentP + 0.028) {
            status = 'half_day';
            remarks = 'Left early';
          }
        }
        if (status === 'absent') prevAbsent.add(stu.id);
        else prevAbsent.delete(stu.id);
        records.push({ id: uuidv7(), sessionId: sid, studentId: stu.id, sectionId: sec.id, date, status, remarks, markedAt: submittedAt, updatedBy: teacher?.userId ?? null });
      }
    }
  }
  await insertChunks(sessions, 500, (c) => db.insert(attendanceSessions).values(c));
  await insertChunks(records, 500, (c) => db.insert(attendanceRecords).values(c));

  // ── student leave requests ──
  const leaveRows: (typeof leaveRequests.$inferInsert)[] = [];
  const decidedBy = (sectionId: string) => teacherOf.get(sectionsList.find((s) => s.id === sectionId)?.classTeacherId ?? '')?.userId ?? ctx.adminUserId;
  for (const l of pastLeaves) {
    leaveRows.push({ studentId: l.studentId, sectionId: l.sectionId, requestedBy: guardianUserOf.get(l.studentId) ?? ctx.adminUserId, leaveType: l.type, fromDate: l.from, toDate: l.to, reason: l.reason, status: 'approved', decidedBy: decidedBy(l.sectionId), decidedAt: new Date(zonedDayStart(l.from, tz).getTime() - 20 * 3_600_000), decisionNote: 'Approved. Get well soon.' });
  }
  const tomorrow = nextSchoolDay(today);
  const dayAfter = nextSchoolDay(tomorrow);
  // pending requests waiting for class teachers / the office
  const pendings: [number, number, 'sick' | 'casual' | 'family' | 'event', string, string, string][] = [
    [0, 9, 'sick', 'Viral fever, will rejoin after recovery', tomorrow, dayAfter],
    [1, 3, 'family', 'Cousin’s wedding in Mysuru', dayAfter, nextSchoolDay(dayAfter)],
    [3, 6, 'event', 'State-level chess tournament', tomorrow, tomorrow],
  ];
  for (const [si, nth, type, reason, from, to] of pendings) {
    const s = pickStudent(si, nth);
    if (s) leaveRows.push({ studentId: s.id, sectionId: s.sectionId, requestedBy: guardianUserOf.get(s.id) ?? ctx.adminUserId, leaveType: type, fromDate: from, toDate: to, reason, status: 'pending' });
  }
  const rej = pickStudent(2, 11);
  if (rej && days.length > 8) leaveRows.push({ studentId: rej.id, sectionId: rej.sectionId, requestedBy: guardianUserOf.get(rej.id) ?? ctx.adminUserId, leaveType: 'casual', fromDate: days[days.length - 8]!, toDate: days[days.length - 8]!, reason: 'Shopping trip', status: 'rejected', decidedBy: decidedBy(rej.sectionId), decidedAt: new Date(Date.now() - 9 * 86_400_000), decisionNote: 'Not a valid reason during term; please avoid taking leave on exam-prep days.' });
  const cxl = pickStudent(1, 12);
  if (cxl) leaveRows.push({ studentId: cxl.id, sectionId: cxl.sectionId, requestedBy: guardianUserOf.get(cxl.id) ?? ctx.adminUserId, leaveType: 'sick', fromDate: tomorrow, toDate: tomorrow, reason: 'Fever (cancelled — child is better)', status: 'cancelled' });
  // one approved leave for the coming school days: attendance is pre-marked `leave` (draft roll calls)
  const future = pickStudent(4, 5);
  if (future) leaveRows.push({ studentId: future.id, sectionId: future.sectionId, requestedBy: guardianUserOf.get(future.id) ?? ctx.adminUserId, leaveType: 'family', fromDate: tomorrow, toDate: dayAfter, reason: 'Travelling to native place', status: 'approved', decidedBy: decidedBy(future.sectionId), decidedAt: new Date(), decisionNote: 'Approved' });
  await insertChunks(leaveRows, 500, (c) => db.insert(leaveRequests).values(c));
  if (future && att.leaveMarksAttendance) await applyLeaveToAttendance(db, { studentId: future.id, sectionId: future.sectionId, fromDate: tomorrow, toDate: dayAfter, userId: ctx.adminUserId, createDrafts: att.mode === 'daily' });

  // ── attendance corrections: one waiting (principal), one approved, one rejected ──
  const earlier = days.slice(-6, -2);
  const pickRecord = (status: Status, skip = 0) => records.filter((r) => r.status === status && earlier.includes(r.date) && !leaveDay.has(`${r.studentId}:${r.date}`))[skip];
  const toCorr = (rec: NonNullable<ReturnType<typeof pickRecord>>, to: Status, reason: string, state: 'pending' | 'approved' | 'rejected') => {
    const sec = sectionsList.find((s) => s.id === rec.sectionId)!;
    const teacher = teacherOf.get(sec.classTeacherId);
    return {
      recordId: '',
      studentId: rec.studentId,
      sectionId: rec.sectionId,
      date: rec.date,
      fromStatus: rec.status as Status,
      toStatus: to,
      reason,
      requestedBy: teacher?.userId ?? ctx.adminUserId,
      status: state,
      ...(state === 'pending' ? {} : { decidedBy: principal?.userId ?? ctx.adminUserId, decidedAt: new Date(Date.now() - 86_400_000), decisionNote: state === 'approved' ? 'Verified with the parent' : 'Medical certificate not provided' }),
    };
  };
  const corrSource: [NonNullable<ReturnType<typeof pickRecord>> | undefined, Status, string, 'pending' | 'approved' | 'rejected'][] = [
    [pickRecord('absent', 0), 'present', 'Student was present; marked absent by mistake', 'pending'],
    [pickRecord('absent', 1), 'leave', 'Parent had informed about a medical appointment', 'approved'],
    [pickRecord('late', 0), 'present', 'Arrived on time, bus delay was on another day', 'rejected'],
  ];
  const corrRows: (typeof attendanceCorrections.$inferInsert)[] = [];
  for (const [rec, to, reason, state] of corrSource) {
    if (!rec) continue;
    corrRows.push({ ...toCorr(rec, to, reason, state), recordId: rec.id! });
    // approved corrections have already been applied to the record
    if (state === 'approved') await db.update(attendanceRecords).set({ status: to }).where(eq(attendanceRecords.id, rec.id!));
  }
  if (corrRows.length) await db.insert(attendanceCorrections).values(corrRows);

  // ── staff attendance (every staff member, same days) ──
  const everyone = [...ctx.teachers, ...Object.values(ctx.staff)];
  const staffLeaveRows: (typeof staffLeaveRequests.$inferInsert)[] = [];
  const hr = ctx.staff['hr'];
  const leaveStaff = ctx.teachers[4] ?? ctx.teachers[0];
  const leaveDays = new Set(days.slice(-9, -7));
  if (leaveStaff && days.length > 10) staffLeaveRows.push({ staffId: leaveStaff.id, leaveType: 'sick', fromDate: days[days.length - 9]!, toDate: days[days.length - 8]!, reason: 'Viral fever', status: 'approved', decidedBy: hr?.userId ?? principal?.userId ?? ctx.adminUserId, decidedAt: new Date(Date.now() - 10 * 86_400_000), decisionNote: 'Approved' });
  const pendingStaff = ctx.teachers[6] ?? ctx.teachers[0];
  if (pendingStaff) staffLeaveRows.push({ staffId: pendingStaff.id, leaveType: 'casual', fromDate: tomorrow, toDate: dayAfter, reason: 'Personal work at the bank and registrar office', status: 'pending' });
  const rejectedStaff = ctx.teachers[8] ?? ctx.teachers[1];
  if (rejectedStaff && days.length > 15) staffLeaveRows.push({ staffId: rejectedStaff.id, leaveType: 'casual', fromDate: days[days.length - 14]!, toDate: days[days.length - 14]!, reason: 'Need a day off', status: 'rejected', decidedBy: principal?.userId ?? ctx.adminUserId, decidedAt: new Date(Date.now() - 15 * 86_400_000), decisionNote: 'Exam duty that day; please choose another date.' });
  if (staffLeaveRows.length) await db.insert(staffLeaveRequests).values(staffLeaveRows);

  const staffRows: (typeof staffAttendance.$inferInsert)[] = [];
  const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  for (const date of days) {
    for (const st of everyone) {
      const onLeave = st.id === leaveStaff?.id && leaveDays.has(date);
      const roll = rng();
      const status: Status = onLeave ? 'leave' : roll < 0.018 ? 'absent' : roll < 0.05 ? 'late' : roll < 0.058 ? 'half_day' : 'present';
      if (status === 'leave' || status === 'absent') {
        staffRows.push({ staffId: st.id, date, status, markedBy: hr?.userId ?? ctx.adminUserId, note: status === 'leave' ? 'Approved leave' : null });
        continue;
      }
      const checkIn = status === 'late' ? hhmm(8, int(41, 59)) : hhmm(int(7, 8), int(0, 25));
      const checkOut = date === today ? null : status === 'half_day' ? hhmm(12, int(0, 40)) : hhmm(int(15, 16), int(0, 40));
      staffRows.push({ staffId: st.id, date, status, checkIn, checkOut, markedBy: hr?.userId ?? ctx.adminUserId });
    }
  }
  await insertChunks(staffRows, 500, (c) => db.insert(staffAttendance).values(c));
};
