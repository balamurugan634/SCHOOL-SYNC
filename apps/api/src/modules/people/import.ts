import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { IMPORT_MAX_ROWS, phoneStr, type StudentImportBody, type StudentImportOut, type StudentImportRow } from '@school-sync/shared';
import { z } from 'zod';
import { audit } from '../../core/audit';
import { assertSeatAvailable } from '../../core/billing/license';
import { AppError, unprocessable } from '../../core/errors';
import { todayIn } from '../../core/http';
import type { Executor } from '../../core/tenancy/pools';
import { academicYears, enrollments, grades, guardians, roles, sections, studentGuardians, students, userRoles, users } from '../../db/tenant/schema';
import { normalizeEmail, normalizePhone, prepareCredential, type Credential } from './accounts';
import { nextAdmissionNumbers } from './sequences';
import { chunk, fullName, type PeopleCtx } from './util';

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────
/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF/LF, BOM, blank lines skipped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const ALIASES: Record<string, keyof StudentImportRow> = {
  admissionno: 'admissionNo', admissionnumber: 'admissionNo', admno: 'admissionNo',
  firstname: 'firstName', first: 'firstName', givenname: 'firstName', name: 'firstName',
  lastname: 'lastName', last: 'lastName', surname: 'lastName', familyname: 'lastName',
  dob: 'dob', dateofbirth: 'dob', birthdate: 'dob',
  gender: 'gender', sex: 'gender',
  bloodgroup: 'bloodGroup', blood: 'bloodGroup',
  grade: 'grade', class: 'grade', gradename: 'grade', classname: 'grade',
  section: 'section', sectionname: 'section', division: 'section',
  sectionid: 'sectionId',
  rollno: 'rollNo', roll: 'rollNo', rollnumber: 'rollNo',
  guardianname: 'guardianName', parentname: 'guardianName', guardian: 'guardianName', parent: 'guardianName',
  guardianphone: 'guardianPhone', parentphone: 'guardianPhone', guardianmobile: 'guardianPhone', parentmobile: 'guardianPhone', phone: 'guardianPhone', mobile: 'guardianPhone',
  guardianemail: 'guardianEmail', parentemail: 'guardianEmail', email: 'guardianEmail',
  guardianrelationship: 'guardianRelationship', relationship: 'guardianRelationship', relation: 'guardianRelationship',
  address: 'address', addressline: 'address',
  city: 'city',
};

function csvToRows(csv: string): StudentImportRow[] {
  const table = parseCsv(csv);
  if (table.length < 2) throw unprocessable('The CSV needs a header row and at least one student', 'EMPTY_IMPORT');
  const header = table[0]!.map((h) => ALIASES[h.toLowerCase().replace(/[^a-z0-9]/g, '')]);
  if (!header.includes('firstName')) throw new AppError(422, 'MISSING_COLUMNS', 'The CSV header must include a first name column (e.g. "First Name")', { columns: Object.keys(ALIASES).length });
  return table.slice(1).map((cells) => {
    const o: Record<string, string> = {};
    header.forEach((key, i) => {
      if (key && cells[i] !== undefined && cells[i]!.trim() !== '') o[key] = cells[i]!.trim();
    });
    return o as StudentImportRow;
  });
}

// ── row validation ──────────────────────────────────────────────────────────────────────────────
const GENDER_WORDS: Record<string, 'male' | 'female' | 'other'> = { m: 'male', male: 'male', boy: 'male', f: 'female', female: 'female', girl: 'female', o: 'other', other: 'other' };
const REL_WORDS = new Set(['father', 'mother', 'guardian', 'grandparent', 'sibling', 'other']);
const emailSchema = z.email();

function parseDob(v: string, today: string): string | null {
  let iso: string | null = null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (m) iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso || iso > today || iso < '1980-01-01') return null;
  return iso;
}

interface Good {
  row: number;
  firstName: string;
  lastName: string | null;
  dob: string | null;
  gender: 'male' | 'female' | 'other' | null;
  bloodGroup: string | null;
  sectionId: string;
  gradeId: string;
  rollNo: number | null;
  admissionNo: string | null;
  address: { line1?: string; city?: string } | null;
  guardian: { name: string; phone: string; email: string | null; relationship: 'father' | 'mother' | 'guardian' | 'grandparent' | 'sibling' | 'other' } | null;
  warnings: string[];
}
interface Verdict {
  row: number;
  name: string | null;
  errors: string[];
  warnings: string[];
  good?: Good;
}

/** Validate every row against the school's data (current-year sections, existing admission numbers, existing parents/logins). */
async function validateRows(db: Executor, ctx: PeopleCtx, raw: StudentImportRow[], firstRowNumber: number) {
  const today = todayIn(ctx.tenant.timezone);
  const secRows = await db
    .select({ id: sections.id, name: sections.name, gradeId: sections.gradeId, gradeName: grades.name, capacity: sections.capacity, taken: sql<number>`(select count(*)::int from ${enrollments} e where e.section_id = ${sections.id} and e.status = 'enrolled')` })
    .from(sections)
    .innerJoin(academicYears, and(eq(academicYears.id, sections.academicYearId), eq(academicYears.isCurrent, true)))
    .innerJoin(grades, eq(grades.id, sections.gradeId));
  const byId = new Map(secRows.map((s) => [s.id, s]));
  const byKey = new Map(secRows.map((s) => [`${s.gradeName.toLowerCase()}|${s.name.toLowerCase()}`, s]));
  const byGrade = Map.groupBy(secRows, (s) => s.gradeName.toLowerCase());

  const explicitNos = raw.map((r) => r.admissionNo?.trim()).filter((x): x is string => !!x);
  const phones = [...new Set(raw.map((r) => (r.guardianPhone ? normalizePhone(r.guardianPhone) : '')).filter(Boolean))];
  const emails = [...new Set(raw.map((r) => r.guardianEmail?.trim().toLowerCase()).filter((x): x is string => !!x))];
  const [takenNos, knownGuardians, takenUsers] = await Promise.all([
    explicitNos.length ? db.select({ no: students.admissionNo }).from(students).where(inArray(sql`lower(${students.admissionNo})`, explicitNos.map((n) => n.toLowerCase()))) : Promise.resolve([]),
    phones.length ? db.select({ id: guardians.id, phone: guardians.phone, userId: guardians.userId }).from(guardians).where(inArray(guardians.phone, phones)) : Promise.resolve([]),
    phones.length || emails.length || explicitNos.length
      ? db
          .select({ id: users.id, username: users.username, phone: users.phone, email: users.email })
          .from(users)
          .where(or(phones.length ? inArray(users.phone, phones) : undefined, phones.length ? inArray(users.username, phones) : undefined, emails.length ? inArray(users.email, emails) : undefined, explicitNos.length ? inArray(users.username, explicitNos.map((n) => n.toLowerCase())) : undefined))
      : Promise.resolve([]),
  ]);
  const takenNoSet = new Set(takenNos.map((t) => t.no.toLowerCase()));
  const guardianByPhone = new Map(knownGuardians.map((g) => [g.phone!, g]));

  const incoming = new Map<string, number>();
  const seenNos = new Set<string>();
  const seenKeys = new Set<string>();
  const verdicts: Verdict[] = [];

  raw.forEach((r, i) => {
    const row = firstRowNumber + i;
    const errors: string[] = [];
    const warnings: string[] = [];
    const first = r.firstName?.trim();
    if (!first) errors.push('First name is required');
    const name = first ? fullName(first, r.lastName?.trim() || null) : null;

    let dob: string | null = null;
    if (r.dob) {
      dob = parseDob(r.dob.trim(), today);
      if (!dob) errors.push(`Date of birth "${r.dob}" is not a valid past date (use YYYY-MM-DD or DD/MM/YYYY)`);
    }
    let gender: Good['gender'] = null;
    if (r.gender) {
      gender = GENDER_WORDS[r.gender.trim().toLowerCase()] ?? null;
      if (!gender) errors.push(`Gender "${r.gender}" is not recognised (male, female or other)`);
    }
    let bloodGroup: string | null = null;
    if (r.bloodGroup) {
      bloodGroup = r.bloodGroup.trim().toUpperCase();
      if (!/^(A|B|AB|O)[+-]$/.test(bloodGroup)) {
        errors.push(`Blood group "${r.bloodGroup}" is not valid (e.g. O+, AB-)`);
        bloodGroup = null;
      }
    }

    // section: by id, or grade + section names (a grade with a single section needs no section name)
    let section: (typeof secRows)[number] | undefined;
    if (r.sectionId) {
      section = byId.get(r.sectionId.trim());
      if (!section) errors.push('sectionId is not a section of the current academic year');
    } else if (r.grade) {
      const g = r.grade.trim().toLowerCase();
      if (r.section) section = byKey.get(`${g}|${r.section.trim().toLowerCase()}`);
      else if ((byGrade.get(g) ?? []).length === 1) section = byGrade.get(g)![0];
      if (!section) errors.push(r.section ? `There is no section "${r.grade} ${r.section}" in the current academic year` : `Grade "${r.grade}" ${byGrade.has(g) ? 'has several sections: add a section column' : 'does not exist for the current academic year'}`);
    } else errors.push('Grade and section (or sectionId) are required');

    let rollNo: number | null = null;
    if (r.rollNo) {
      rollNo = Number(r.rollNo);
      if (!Number.isInteger(rollNo) || rollNo < 1 || rollNo > 9999) {
        errors.push(`Roll number "${r.rollNo}" is not valid`);
        rollNo = null;
      }
    }

    let admissionNo: string | null = null;
    if (r.admissionNo) {
      admissionNo = r.admissionNo.trim();
      const lower = admissionNo.toLowerCase();
      if (!/^[A-Za-z0-9._-]{3,30}$/.test(admissionNo)) errors.push(`Admission number "${admissionNo}" has invalid characters or length`);
      else if (takenNoSet.has(lower) || takenUsers.some((u) => u.username === lower)) errors.push(`Admission number ${admissionNo} is already in use`);
      else if (seenNos.has(lower)) errors.push(`Admission number ${admissionNo} appears twice in this file`);
      seenNos.add(lower);
    }

    let guardian: Good['guardian'] = null;
    if (r.guardianName || r.guardianPhone || r.guardianEmail) {
      const gName = r.guardianName?.trim();
      const phoneOk = r.guardianPhone ? phoneStr.safeParse(r.guardianPhone).success : false;
      const gPhone = r.guardianPhone && phoneOk ? normalizePhone(r.guardianPhone) : '';
      const gEmail = r.guardianEmail?.trim().toLowerCase() || null;
      if (!gName) errors.push('Guardian name is required when guardian details are given');
      if (!r.guardianPhone) errors.push('Guardian phone is required when guardian details are given');
      else if (!phoneOk) errors.push(`Guardian phone "${r.guardianPhone}" is not valid`);
      if (gEmail && !emailSchema.safeParse(gEmail).success) errors.push(`Guardian email "${r.guardianEmail}" is not valid`);
      const rel = (r.guardianRelationship?.trim().toLowerCase() ?? 'guardian') || 'guardian';
      if (!REL_WORDS.has(rel)) errors.push(`Guardian relationship "${r.guardianRelationship}" is not recognised`);
      if (gName && gPhone) {
        const known = guardianByPhone.get(gPhone);
        if (known) warnings.push('This phone number already belongs to a registered parent: the child is linked to them, and the link needs verification');
        else {
          // no registered parent has this number, so any account that does is someone else's (e.g. a staff member)
          if (takenUsers.some((u) => u.username === gPhone || u.phone === gPhone)) errors.push(`The phone number ${gPhone} is already used by another account`);
          if (gEmail && takenUsers.some((u) => u.email === gEmail)) errors.push(`The email ${gEmail} is already used by another account`);
        }
        guardian = { name: gName, phone: gPhone, email: gEmail, relationship: (REL_WORDS.has(rel) ? rel : 'guardian') as NonNullable<Good['guardian']>['relationship'] };
      }
    }

    if (section) {
      const n = (incoming.get(section.id) ?? 0) + 1;
      incoming.set(section.id, n);
      if (section.capacity != null && section.taken + n > section.capacity) errors.push(`Section ${section.gradeName} ${section.name} is full (capacity ${section.capacity})`);
    }
    if (name) {
      const key = `${name.toLowerCase()}|${dob ?? ''}|${guardian?.phone ?? ''}`;
      if (seenKeys.has(key)) warnings.push('Looks like a duplicate of an earlier row in this file');
      seenKeys.add(key);
    }

    const verdict: Verdict = { row, name, errors, warnings };
    if (!errors.length && first && section) {
      verdict.good = {
        row,
        firstName: first,
        lastName: r.lastName?.trim() || null,
        dob,
        gender,
        bloodGroup,
        sectionId: section.id,
        gradeId: section.gradeId,
        rollNo,
        admissionNo,
        address: r.address || r.city ? { line1: r.address?.trim() || undefined, city: r.city?.trim() || undefined } : null,
        guardian,
        warnings,
      };
    }
    verdicts.push(verdict);
  });
  return { verdicts, knownGuardians: guardianByPhone };
}

async function hashMany(n: number): Promise<Credential[]> {
  const out: Credential[] = [];
  for (let i = 0; i < n; i += 8) out.push(...(await Promise.all(Array.from({ length: Math.min(8, n - i) }, () => prepareCredential()))));
  return out;
}

async function seatReport(ctx: PeopleCtx, db: Executor, adding: number): Promise<StudentImportOut['seats']> {
  try {
    await assertSeatAvailable(ctx.tenant, db, adding);
    return { adding, ok: true };
  } catch (e) {
    if (e instanceof AppError) return { adding, ok: false, code: e.code, message: e.message };
    throw e;
  }
}

/**
 * Bulk import. `dryRun` validates and reports (including whether the licence has seats for the whole batch);
 * a real run writes everything in one transaction, in chunks of ≤500 rows, after the seat check for the whole batch.
 * Password hashing happens before the transaction opens (Argon2 is slow and must not hold a transaction).
 */
export async function importStudents(db: Executor, ctx: PeopleCtx, body: StudentImportBody): Promise<StudentImportOut> {
  const raw = body.csv ? csvToRows(body.csv) : body.rows!;
  if (!raw.length) throw unprocessable('There are no rows to import', 'EMPTY_IMPORT');
  if (raw.length > IMPORT_MAX_ROWS) throw new AppError(422, 'TOO_MANY_ROWS', `Import at most ${IMPORT_MAX_ROWS} students at a time`, { max: IMPORT_MAX_ROWS });
  const { verdicts, knownGuardians } = await validateRows(db, ctx, raw, body.csv ? 2 : 1);
  const good = verdicts.flatMap((v) => (v.good ? [v.good] : []));
  const report = (created: Map<number, { studentId: string; admissionNo: string }>): Omit<StudentImportOut, 'seats' | 'credentials' | 'dryRun' | 'created'> => ({
    total: verdicts.length,
    valid: good.length,
    invalid: verdicts.length - good.length,
    rows: verdicts.map((v) => ({ row: v.row, ok: !!v.good, name: v.name, errors: v.errors, warnings: v.warnings, admissionNo: created.get(v.row)?.admissionNo ?? v.good?.admissionNo ?? null, studentId: created.get(v.row)?.studentId ?? null })),
  });

  if (body.dryRun) return { dryRun: true, created: 0, seats: await seatReport(ctx, db, good.length), credentials: [], ...report(new Map()) };

  if (verdicts.length - good.length > 0 && !body.skipInvalid) {
    throw new AppError(422, 'IMPORT_HAS_ERRORS', `${verdicts.length - good.length} row(s) have errors. Fix them, or import the valid rows only with skipInvalid.`, { report: { dryRun: false, created: 0, seats: await seatReport(ctx, db, good.length), credentials: [], ...report(new Map()) } });
  }
  if (!good.length) throw unprocessable('There are no valid rows to import', 'NOTHING_TO_IMPORT');

  // credentials first (slow), then one transaction for everything
  const newGuardianPhones = [...new Set(good.flatMap((g) => (g.guardian && !knownGuardians.has(g.guardian.phone) ? [g.guardian.phone] : [])))];
  const studentCreds = body.createLogins ? await hashMany(good.length) : [];
  const guardianCreds = body.createLogins ? await hashMany(newGuardianPhones.length) : [];

  return db.transaction(async (tx) => {
    await assertSeatAvailable(ctx.tenant, tx, good.length);
    // capacity could have changed while we were hashing: re-check inside the transaction
    const counts = await tx
      .select({ id: sections.id, name: sections.name, capacity: sections.capacity, taken: sql<number>`(select count(*)::int from ${enrollments} e where e.section_id = ${sections.id} and e.status = 'enrolled')`, maxRoll: sql<number>`(select coalesce(max(roll_no), 0)::int from ${enrollments} e where e.section_id = ${sections.id})` })
      .from(sections)
      .where(inArray(sections.id, [...new Set(good.map((g) => g.sectionId))]));
    const secInfo = new Map(counts.map((c) => [c.id, { ...c, added: 0, roll: c.maxRoll }]));
    for (const g of good) {
      const s = secInfo.get(g.sectionId)!;
      s.added++;
      if (s.capacity != null && s.taken + s.added > s.capacity) throw new AppError(409, 'SECTION_FULL', `Section ${s.name} filled up while importing`);
    }

    const needNumbers = good.filter((g) => !g.admissionNo).length;
    const generated = needNumbers ? await nextAdmissionNumbers(tx, ctx.tenant, needNumbers) : [];
    let gi = 0;
    const [studentRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, 'student')).limit(1);
    const [parentRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, 'parent')).limit(1);
    const [year] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
    const today = todayIn(ctx.tenant.timezone);
    const now = new Date();

    const userRows: (typeof users.$inferInsert)[] = [];
    const roleRows: (typeof userRoles.$inferInsert)[] = [];
    const guardianRows: (typeof guardians.$inferInsert)[] = [];
    const studentRows: (typeof students.$inferInsert)[] = [];
    const enrollRows: (typeof enrollments.$inferInsert)[] = [];
    const linkRows: (typeof studentGuardians.$inferInsert)[] = [];
    const created = new Map<number, { studentId: string; admissionNo: string }>();
    const credentials: StudentImportOut['credentials'] = [];
    const newGuardians = new Map<string, { id: string; cred: { username: string; temporaryPassword: string } | null }>();

    good.forEach((g, idx) => {
      const admissionNo = g.admissionNo ?? generated[gi++]!;
      const studentId = uuidv7();
      const displayName = fullName(g.firstName, g.lastName);
      const sc = studentCreds[idx];
      let userId: string | null = null;
      if (sc) {
        userId = uuidv7();
        userRows.push({ id: userId, userType: 'student', username: admissionNo.toLowerCase(), displayName, passwordHash: sc.hash, mustChangePassword: true, passwordChangedAt: now });
        if (studentRole) roleRows.push({ userId, roleId: studentRole.id, grantedBy: ctx.actor.userId ?? null });
      }
      const sec = secInfo.get(g.sectionId)!;
      const rollNo = g.rollNo ?? ++sec.roll;
      studentRows.push({
        id: studentId,
        userId,
        admissionNo,
        firstName: g.firstName,
        lastName: g.lastName,
        dob: g.dob,
        gender: g.gender,
        bloodGroup: g.bloodGroup,
        address: g.address,
        emergencyContacts: g.guardian ? [{ name: g.guardian.name, relationship: g.guardian.relationship, phone: g.guardian.phone }] : [],
        admissionDate: today,
        currentSectionId: g.sectionId,
        currentGradeId: g.gradeId,
        rollNo,
      });
      enrollRows.push({ studentId, academicYearId: year!.id, gradeId: g.gradeId, sectionId: g.sectionId, rollNo, status: 'enrolled', startedAt: today });

      let guardianCred: { username: string; temporaryPassword: string } | null = null;
      if (g.guardian) {
        const known = knownGuardians.get(g.guardian.phone);
        let guardianId: string;
        let verified = false;
        if (known) guardianId = known.id;
        else {
          let ng = newGuardians.get(g.guardian.phone);
          if (!ng) {
            const gid = uuidv7();
            const [first, ...rest] = g.guardian.name.split(/\s+/);
            const gc = guardianCreds[newGuardianPhones.indexOf(g.guardian.phone)];
            let gUser: string | null = null;
            if (gc) {
              gUser = uuidv7();
              userRows.push({ id: gUser, userType: 'parent', username: g.guardian.phone, phone: g.guardian.phone, email: g.guardian.email ? normalizeEmail(g.guardian.email) : null, displayName: g.guardian.name, passwordHash: gc.hash, mustChangePassword: true, passwordChangedAt: now });
              if (parentRole) roleRows.push({ userId: gUser, roleId: parentRole.id, grantedBy: ctx.actor.userId ?? null });
            }
            guardianRows.push({ id: gid, userId: gUser, firstName: first ?? g.guardian.name, lastName: rest.join(' ') || null, phone: g.guardian.phone, email: g.guardian.email });
            ng = { id: gid, cred: gc ? { username: g.guardian.phone, temporaryPassword: gc.password } : null };
            newGuardians.set(g.guardian.phone, ng);
            guardianCred = ng.cred; // reported once, on the first child of that family
          }
          guardianId = ng.id;
          verified = true; // the school typed in a brand-new parent: nobody else's child is exposed
        }
        linkRows.push({ studentId, guardianId, relationship: g.guardian.relationship, isPrimary: true, canPickup: true, isEmergencyContact: true, verifiedAt: verified ? now : null, verifiedBy: verified ? (ctx.actor.userId ?? null) : null });
      }
      created.set(g.row, { studentId, admissionNo });
      credentials.push({ row: g.row, admissionNo, student: sc ? { username: admissionNo.toLowerCase(), temporaryPassword: sc.password } : null, guardian: guardianCred });
    });

    for (const c of chunk(userRows, 500)) await tx.insert(users).values(c);
    for (const c of chunk(roleRows, 500)) await tx.insert(userRoles).values(c);
    for (const c of chunk(guardianRows, 500)) await tx.insert(guardians).values(c);
    for (const c of chunk(studentRows, 500)) await tx.insert(students).values(c);
    for (const c of chunk(enrollRows, 500)) await tx.insert(enrollments).values(c);
    for (const c of chunk(linkRows, 500)) await tx.insert(studentGuardians).values(c);

    const numbers = studentRows.map((s) => s.admissionNo).sort();
    await audit(tx, ctx.actor, {
      action: 'student.import',
      entity: 'student',
      summary: `Imported ${studentRows.length} students${verdicts.length > good.length ? ` (${verdicts.length - good.length} rows skipped)` : ''}`,
      after: { created: studentRows.length, skipped: verdicts.length - good.length, newParents: guardianRows.length, firstAdmissionNo: numbers[0], lastAdmissionNo: numbers.at(-1) },
    });
    return { dryRun: false, created: studentRows.length, seats: { adding: good.length, ok: true }, credentials, ...report(created) };
  });
}
