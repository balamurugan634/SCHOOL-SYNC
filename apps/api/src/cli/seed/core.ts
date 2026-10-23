import { eq } from 'drizzle-orm';
import { hashPassword } from '../../core/auth/password';
import type { TenantDb } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { academicYears, enrollments, gradeSubjects, grades, guardians, roles, sections, staff, studentGuardians, students, subjects, teachingAssignments, terms, userRoles, users } from '../../db/tenant/schema';
import type { SeedContext, SeedGuardian, SeedSection, SeedSize, SeedStaff, SeedStudent } from './context';

const FIRST_M = ['Aarav', 'Vihaan', 'Arjun', 'Reyansh', 'Ishaan', 'Kabir', 'Rohan', 'Aditya', 'Dhruv', 'Krish', 'Rahul', 'Karthik', 'Nikhil', 'Siddharth', 'Varun', 'Yash'];
const FIRST_F = ['Ananya', 'Diya', 'Meera', 'Saanvi', 'Aadhya', 'Ira', 'Kavya', 'Navya', 'Priya', 'Riya', 'Sneha', 'Tanvi', 'Zara', 'Lakshmi', 'Pooja', 'Divya'];
const LAST = ['Sharma', 'Reddy', 'Iyer', 'Nair', 'Patel', 'Gupta', 'Menon', 'Singh', 'Khan', 'Das', 'Joshi', 'Kumar', 'Pillai', 'Rao', 'Bose', 'Mehta'];
const TEACHER_NAMES = ['Sunita Verma', 'Rajesh Kulkarni', 'Anjali Desai', 'Mohan Das', 'Fatima Sheikh', 'Vikram Chauhan', 'Lata Subramanian', 'Imran Qureshi', 'Deepa Nambiar', 'Harish Bhat', 'Neha Kapoor', 'Suresh Pandey', 'Rekha Menon', 'Arun Prakash', 'Geeta Rawat', 'Thomas Mathew'];
const SUBJECTS = [
  ['ENG', 'English'],
  ['MAT', 'Mathematics'],
  ['SCI', 'Science'],
  ['SST', 'Social Studies'],
  ['HIN', 'Hindi'],
  ['CS', 'Computer Science'],
  ['PE', 'Physical Education'],
  ['ART', 'Art & Craft'],
] as const;
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+'];
const CITIES = ['Bengaluru', 'Chennai', 'Hyderabad', 'Pune', 'Kochi'];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function insertChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export const DEMO_PASSWORD = 'Demo@12345';

/**
 * Academic structure + people + login accounts. Idempotent guard: refuses to run twice on the same school
 * (returns null) so `site:seed-demo` can be re-run safely.
 *
 * Logins (all use DEMO_PASSWORD):  staff `principal` `office` `accounts` `hr` `librarian` `transport`,
 * teachers `t001`…, students = lowercase admission no. (e.g. `gv20260001`), parents = phone (e.g. `9000000001`).
 * `9099999999` is a parent whose child link is NOT yet verified (must see nothing).
 */
export async function seedFoundation(db: TenantDb, tenant: TenantInfo, size: SeedSize): Promise<SeedContext | null> {
  const [already] = await db.select({ id: students.id }).from(students).limit(1);
  if (already) return null;

  const rng = mulberry32(20260421);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)]!;
  const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const [year] = await db.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  if (!year) throw new Error('No current academic year; provision the site first');
  const termIds = (await db.select({ id: terms.id }).from(terms).where(eq(terms.academicYearId, year.id)).orderBy(terms.ordinal)).map((t) => t.id);
  const yearStart = Number(year.startDate.slice(0, 4));
  const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles);
  const roleIds = Object.fromEntries(roleRows.map((r) => [r.key, r.id]));
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.userType, 'staff')).limit(1);

  const cfg =
    size === 'xl'
      ? // a large school (≈1,900 students) for load / UI-performance testing
        { gradeNames: Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`), firstOrdinal: 1, secNames: ['A', 'B', 'C', 'D'], perSection: 40, nSubjects: 8, nTeachers: 64 }
      : size === 'full'
        ? { gradeNames: ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'], firstOrdinal: 6, secNames: ['A', 'B'], perSection: 24, nSubjects: 8, nTeachers: 16 }
        : { gradeNames: ['Grade 6', 'Grade 7'], firstOrdinal: 6, secNames: ['A'], perSection: 6, nSubjects: 4, nTeachers: 4 };

  // ── subjects & grades ──
  const gradeRows = await db.insert(grades).values(cfg.gradeNames.map((name, i) => ({ name, ordinal: cfg.firstOrdinal + i }))).returning();
  const subjectRows = await db.insert(subjects).values(SUBJECTS.slice(0, cfg.nSubjects).map(([code, name]) => ({ code, name, type: 'core' as const }))).returning();
  await db.insert(gradeSubjects).values(gradeRows.flatMap((g) => subjectRows.map((s) => ({ gradeId: g.id, subjectId: s.id, periodsPerWeek: 5 }))));

  // ── staff accounts ──
  const mkStaff = async (username: string, name: string, role: string[], designation: string, type: 'teaching' | 'non_teaching', employeeId: string): Promise<SeedStaff> => {
    const [first, ...rest] = name.split(' ');
    const [u] = await db.insert(users).values({ userType: 'staff', username, email: `${username}@${tenant.code}.school.test`, displayName: name, passwordHash, passwordChangedAt: new Date() }).returning({ id: users.id });
    const [st] = await db.insert(staff).values({ userId: u!.id, employeeId, firstName: first!, lastName: rest.join(' ') || null, designation, staffType: type, email: `${username}@${tenant.code}.school.test`, phone: `98${String(int(10000000, 99999999))}`, joinDate: `${yearStart - int(1, 9)}-06-01`, gender: rng() < 0.5 ? 'female' : 'male' }).returning({ id: staff.id });
    await db.insert(userRoles).values(role.map((r) => ({ userId: u!.id, roleId: roleIds[r]! })));
    return { id: st!.id, userId: u!.id, username, name };
  };
  const mgmt: Record<string, SeedStaff> = {
    principal: await mkStaff('principal', 'Dr. Meenakshi Raman', ['principal'], 'Principal', 'non_teaching', 'EMP100'),
    office: await mkStaff('office', 'Prakash Naidu', ['administrator'], 'Administrative Officer', 'non_teaching', 'EMP101'),
    accounts: await mkStaff('accounts', 'Latha Krishnan', ['accountant'], 'Accountant', 'non_teaching', 'EMP102'),
    hr: await mkStaff('hr', 'Sandeep Malhotra', ['hr'], 'HR Executive', 'non_teaching', 'EMP103'),
    librarian: await mkStaff('librarian', 'Kamala Devi', ['librarian'], 'Librarian', 'non_teaching', 'EMP104'),
    transport: await mkStaff('transport', 'Gopal Reddy', ['transport_manager'], 'Transport Manager', 'non_teaching', 'EMP105'),
  };
  const teachers: SeedStaff[] = [];
  const nSections = cfg.gradeNames.length * cfg.secNames.length;
  for (let i = 0; i < cfg.nTeachers; i++) {
    const roleKeys = i < nSections ? ['teacher', 'class_teacher'] : ['teacher'];
    teachers.push(await mkStaff(`t${String(i + 1).padStart(3, '0')}`, TEACHER_NAMES[i % TEACHER_NAMES.length]!, roleKeys, `${subjectRows[i % subjectRows.length]!.name} Teacher`, 'teaching', `EMP${String(200 + i)}`));
  }

  // ── sections (class teacher = first N teachers) ──
  const sectionList: SeedSection[] = [];
  let ti = 0;
  for (const g of gradeRows) {
    for (const name of cfg.secNames) {
      const ct = teachers[ti++ % teachers.length]!;
      const [s] = await db.insert(sections).values({ gradeId: g.id, academicYearId: year.id, name, classTeacherId: ct.id, room: `${g.ordinal}${name}`, capacity: cfg.perSection + 6 }).returning({ id: sections.id });
      sectionList.push({ id: s!.id, gradeId: g.id, gradeName: g.name, gradeOrdinal: g.ordinal, name, classTeacherId: ct.id });
    }
  }

  // ── who teaches what ──
  const assignments = sectionList.flatMap((sec, si) => subjectRows.map((subj, sj) => ({ sectionId: sec.id, subjectId: subj.id, staffId: teachers[(si * 3 + sj) % teachers.length]!.id })));
  await insertChunks(assignments, 500, (c) => db.insert(teachingAssignments).values(c));

  // ── students, families, accounts ──
  const studentList: SeedStudent[] = [];
  const guardianList: SeedGuardian[] = [];
  const studentRows: (typeof students.$inferInsert)[] = [];
  const userRows: (typeof users.$inferInsert)[] = [];
  const guardianRows: (typeof guardians.$inferInsert)[] = [];
  const linkRows: (typeof studentGuardians.$inferInsert)[] = [];
  const enrollRows: (typeof enrollments.$inferInsert)[] = [];
  const { v7: uuidv7 } = await import('uuid');
  let adm = 0;
  let phone = 9000000000;
  // families that currently have one child and could gain a sibling in another section
  const openFamilies: { guardianIdx: number; sectionId: string }[] = [];
  const verifiedAt = new Date();

  for (const sec of sectionList) {
    for (let roll = 1; roll <= cfg.perSection; roll++) {
      adm++;
      const female = rng() < 0.5;
      const first = pick(female ? FIRST_F : FIRST_M);
      const last = pick(LAST);
      const admissionNo = `GV${yearStart}${String(adm).padStart(4, '0')}`;
      const sUser = uuidv7();
      const sid = uuidv7();
      userRows.push({ id: sUser, userType: 'student', username: admissionNo.toLowerCase(), displayName: `${first} ${last}`, passwordHash, passwordChangedAt: new Date() });
      const city = pick(CITIES);

      // a family: usually new; ~1 in 10 students joins an existing family from a different section (siblings)
      let gIdx: number;
      const sibAt = roll % 8 === 0 ? openFamilies.findIndex((f) => f.sectionId !== sec.id) : -1;
      if (sibAt >= 0) {
        gIdx = openFamilies.splice(sibAt, 1)[0]!.guardianIdx;
      } else {
        phone++;
        const gUser = uuidv7();
        const gid = uuidv7();
        const gFirst = pick(female ? FIRST_M : FIRST_M);
        userRows.push({ id: gUser, userType: 'parent', username: String(phone), phone: String(phone), email: `${gFirst}.${last}.${phone}@parents.school.test`.toLowerCase(), displayName: `${gFirst} ${last}`, passwordHash, passwordChangedAt: new Date() });
        guardianRows.push({ id: gid, userId: gUser, firstName: gFirst, lastName: last, phone: String(phone), email: `${gFirst}.${last}.${phone}@parents.school.test`.toLowerCase(), occupation: pick(['Engineer', 'Doctor', 'Teacher', 'Business', 'Accountant', 'Farmer']), address: { city, state: 'India', country: 'IN' } });
        guardianList.push({ id: gid, userId: gUser, username: String(phone), name: `${gFirst} ${last}`, studentIds: [] });
        gIdx = guardianList.length - 1;
        if (roll % 4 === 0) openFamilies.push({ guardianIdx: gIdx, sectionId: sec.id });
      }
      const g = guardianList[gIdx]!;
      g.studentIds.push(sid);
      studentRows.push({
        id: sid,
        userId: sUser,
        admissionNo,
        firstName: first,
        lastName: last,
        dob: `${yearStart - (sec.gradeOrdinal + 5)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
        gender: female ? 'female' : 'male',
        bloodGroup: pick(BLOOD),
        address: { line1: `${int(1, 99)}, ${pick(['MG Road', 'Park Street', 'Temple Road', 'Lake View'])}`, city, state: 'India', country: 'IN' },
        emergencyContacts: [{ name: g.name, relationship: 'parent', phone: g.username }],
        authorizedPickups: [{ name: g.name, relationship: 'parent', phone: g.username, active: true }],
        admissionDate: `${yearStart - int(0, 3)}-06-10`,
        currentSectionId: sec.id,
        currentGradeId: sec.gradeId,
        rollNo: roll,
      });
      linkRows.push({ studentId: sid, guardianId: g.id, relationship: female ? 'father' : 'mother', isPrimary: g.studentIds.length === 1, isEmergencyContact: true, verifiedAt, verifiedBy: admin?.id ?? null });
      enrollRows.push({ studentId: sid, academicYearId: year.id, gradeId: sec.gradeId, sectionId: sec.id, rollNo: roll, startedAt: year.startDate });
      studentList.push({ id: sid, userId: sUser, admissionNo, username: admissionNo.toLowerCase(), name: `${first} ${last}`, sectionId: sec.id, gradeId: sec.gradeId, guardianId: g.id, rollNo: roll });
    }
  }

  // one parent whose link is awaiting school verification: must have NO access
  const pendingUser = uuidv7();
  const pendingGuardian = uuidv7();
  userRows.push({ id: pendingUser, userType: 'parent', username: '9099999999', phone: '9099999999', displayName: 'Pending Verification (demo)', passwordHash, passwordChangedAt: new Date() });
  guardianRows.push({ id: pendingGuardian, userId: pendingUser, firstName: 'Pending', lastName: 'Verification', phone: '9099999999' });
  linkRows.push({ studentId: studentList[0]!.id, guardianId: pendingGuardian, relationship: 'guardian', verifiedAt: null });

  await insertChunks(userRows, 500, (c) => db.insert(users).values(c));
  const studentRoleId = roleIds['student']!;
  const parentRoleId = roleIds['parent']!;
  await insertChunks(userRows.filter((u) => u.userType !== 'staff').map((u) => ({ userId: u.id!, roleId: u.userType === 'student' ? studentRoleId : parentRoleId })), 500, (c) => db.insert(userRoles).values(c));
  await insertChunks(studentRows, 300, (c) => db.insert(students).values(c));
  await insertChunks(guardianRows, 300, (c) => db.insert(guardians).values(c));
  await insertChunks(linkRows, 500, (c) => db.insert(studentGuardians).values(c));
  await insertChunks(enrollRows, 500, (c) => db.insert(enrollments).values(c));

  return {
    db,
    tenant,
    size,
    rng,
    pick,
    int,
    today: new Date().toISOString().slice(0, 10),
    password: DEMO_PASSWORD,
    passwordHash,
    yearId: year.id,
    yearName: year.name,
    termIds,
    grades: gradeRows.map((g) => ({ id: g.id, name: g.name, ordinal: g.ordinal })),
    subjects: subjectRows.map((s) => ({ id: s.id, code: s.code, name: s.name })),
    sections: sectionList,
    teachers,
    staff: mgmt,
    students: studentList,
    guardians: guardianList,
    assignments,
    roleIds,
    adminUserId: admin?.id ?? '',
  };
}
