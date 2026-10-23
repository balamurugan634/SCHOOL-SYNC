import { eq, inArray } from 'drizzle-orm';
import { addDaysIso } from '../../core/http';
import { admissions, counters, recordCorrectionRequests, students } from '../../db/tenant/schema';
import type { ModuleSeeder } from './context';

const APPLICANTS: [string, string, 'male' | 'female', string, string][] = [
  ['Aarush', 'Mehra', 'male', 'Rakesh Mehra', 'father'],
  ['Ishita', 'Banerjee', 'female', 'Sunita Banerjee', 'mother'],
  ['Neel', 'Varghese', 'male', 'Thomas Varghese', 'father'],
  ['Tara', 'Kapoor', 'female', 'Anil Kapoor', 'father'],
  ['Samar', 'Qureshi', 'male', 'Zainab Qureshi', 'mother'],
  ['Myra', 'Pillai', 'female', 'Gopinath Pillai', 'father'],
  ['Rudra', 'Chatterjee', 'male', 'Debjani Chatterjee', 'mother'],
  ['Anvi', 'Deshpande', 'female', 'Prashant Deshpande', 'father'],
  ['Vivaan', 'Saxena', 'male', 'Neha Saxena', 'mother'],
  ['Kiara', 'Fernandes', 'female', 'Joseph Fernandes', 'father'],
];
const STATUSES = ['submitted', 'submitted', 'submitted', 'under_review', 'under_review', 'waitlisted', 'accepted', 'accepted', 'rejected', 'enrolled'] as const;
const SCHOOLS = ['Little Flower Nursery', 'St. Mary’s Primary School', 'Sunrise Public School', 'Delhi Public School', 'Kendriya Vidyalaya', 'Homeschooled'];

/**
 * People demo data: a realistic admissions pipeline (every state) and parents' record-correction requests
 * (pending, one rejected, one approved). Students, parents, staff and sections already exist (seedFoundation).
 */
export const seed: ModuleSeeder = async (ctx) => {
  const { db } = ctx;
  const yearStart = ctx.yearName.slice(0, 4);
  const principalUser = ctx.staff.principal!.userId;
  const officeUser = ctx.staff.office!.userId;
  const lowGrade = ctx.grades[0]!;
  const day = 86_400_000;

  // ── admissions ──
  const enrolledStudent = ctx.students.at(-1)!;
  const enrolledGuardian = ctx.guardians.find((g) => g.id === enrolledStudent.guardianId);
  const rows: (typeof admissions.$inferInsert)[] = APPLICANTS.map(([first, last, gender, guardianName, rel], i) => {
    const status = STATUSES[i]!;
    const decided = status === 'accepted' || status === 'rejected' || status === 'waitlisted' || status === 'enrolled';
    const isEnrolled = status === 'enrolled';
    const when = new Date(Date.now() - (30 - i * 3) * day);
    return {
      applicationNo: `APP-${yearStart}-${String(i + 1).padStart(4, '0')}`,
      firstName: isEnrolled ? enrolledStudent.name.split(' ')[0]! : first,
      lastName: isEnrolled ? enrolledStudent.name.split(' ').slice(1).join(' ') || null : last,
      dob: `${Number(yearStart) - ctx.int(7, 12)}-${String(ctx.int(1, 12)).padStart(2, '0')}-${String(ctx.int(1, 28)).padStart(2, '0')}`,
      gender,
      gradeAppliedId: isEnrolled ? enrolledStudent.gradeId : (ctx.grades[i % ctx.grades.length] ?? lowGrade).id,
      academicYearId: ctx.yearId,
      guardianName: isEnrolled && enrolledGuardian ? enrolledGuardian.name : guardianName,
      guardianRelationship: rel as 'father' | 'mother',
      guardianPhone: isEnrolled && enrolledGuardian ? enrolledGuardian.username : `98${String(76000000 + i * 1317)}`,
      guardianEmail: i % 2 === 0 ? `${last.toLowerCase()}.${first.toLowerCase()}@mail.test` : null,
      previousSchool: ctx.pick(SCHOOLS),
      address: { city: ctx.pick(['Bengaluru', 'Chennai', 'Hyderabad', 'Pune']), state: 'India', country: 'IN' },
      notes: status === 'rejected' ? 'Seat criteria not met for this grade.' : i % 3 === 0 ? 'Sibling already studying in the school.' : null,
      documents: [],
      status,
      decidedBy: decided ? (status === 'rejected' || status === 'accepted' ? principalUser : officeUser) : null,
      decidedAt: decided ? new Date(when.getTime() + 2 * day) : null,
      decisionNote: status === 'rejected' ? 'Seat criteria not met for this grade.' : status === 'waitlisted' ? 'Waitlisted: sections are at capacity.' : null,
      studentId: isEnrolled ? enrolledStudent.id : null,
      createdAt: when,
      updatedAt: when,
    };
  });
  await db.insert(admissions).values(rows);
  // the application-number sequence continues after the seeded ones
  await db.insert(counters).values({ key: `application_no:${yearStart}`, value: rows.length }).onConflictDoUpdate({ target: counters.key, set: { value: rows.length } });

  // ── correction requests ──
  const picks = ctx.guardians.filter((g) => g.studentIds.length).slice(0, 5);
  const targets = picks.map((g) => ctx.students.find((s) => s.id === g.studentIds[0])!);
  if (picks.length < 5) return;
  const current = new Map((await db.select().from(students).where(inArray(students.id, targets.map((t) => t.id)))).map((s) => [s.id, s]));
  const at = (n: number) => new Date(Date.now() - n * day);
  const [t0, t1, t2, t3, t4] = targets as [(typeof targets)[number], (typeof targets)[number], (typeof targets)[number], (typeof targets)[number], (typeof targets)[number]];
  const s0 = current.get(t0.id)!;
  const s1 = current.get(t1.id)!;
  const s2 = current.get(t2.id)!;
  const s3 = current.get(t3.id)!;
  const s4 = current.get(t4.id)!;
  const reqs: (typeof recordCorrectionRequests.$inferInsert)[] = [
    { studentId: s0.id, requestedBy: picks[0]!.userId, requesterRole: 'parent', changes: { dob: addDaysIso(s0.dob ?? '2015-01-01', 1) }, original: { dob: s0.dob }, reason: 'The date of birth on the birth certificate is one day later.', status: 'pending', createdAt: at(2), updatedAt: at(2) },
    { studentId: s1.id, requestedBy: picks[1]!.userId, requesterRole: 'parent', changes: { bloodGroup: s1.bloodGroup === 'O+' ? 'B+' : 'O+' }, original: { bloodGroup: s1.bloodGroup }, reason: 'Blood group was recorded wrongly at admission (lab report attached at the office).', status: 'pending', createdAt: at(1), updatedAt: at(1) },
    { studentId: s2.id, requestedBy: t2.userId, requesterRole: 'student', changes: { address: { line1: '14, Lake View Road', city: 'Bengaluru', state: 'India', country: 'IN' } }, original: { address: s2.address }, reason: 'We have moved to a new house.', status: 'pending', createdAt: at(0), updatedAt: at(0) },
    { studentId: s3.id, requestedBy: picks[3]!.userId, requesterRole: 'parent', changes: { lastName: `${s3.lastName ?? ''}-Nair`.trim() }, original: { lastName: s3.lastName }, reason: 'Please add the mother’s surname.', status: 'rejected', decidedBy: officeUser, decidedAt: at(5), decisionNote: 'The name must match the birth certificate on file.', createdAt: at(8), updatedAt: at(5) },
    { studentId: s4.id, requestedBy: picks[4]!.userId, requesterRole: 'parent', changes: { nationality: 'Indian' }, original: { nationality: s4.nationality }, reason: 'Nationality is missing on the record.', status: 'approved', decidedBy: officeUser, decidedAt: at(10), decisionNote: 'Updated.', createdAt: at(12), updatedAt: at(10) },
  ];
  await db.insert(recordCorrectionRequests).values(reqs);
  // the approved request was applied when it was decided
  await db.update(students).set({ nationality: 'Indian' }).where(eq(students.id, s4.id));
};
