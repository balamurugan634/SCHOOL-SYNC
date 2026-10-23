import { and, eq, inArray, ne, or } from 'drizzle-orm';
import type { z } from 'zod';
import type { MyProfileOut, myProfileUpdateBody } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { verifyPassword } from '../../core/auth/password';
import { fileUrl } from '../../core/auth/service';
import { AppError, conflict, notFound, unauthorized, unprocessable } from '../../core/errors';
import type { Executor } from '../../core/tenancy/pools';
import { guardians, staff, students, users } from '../../db/tenant/schema';
import { normalizeEmail, normalizePhone } from './accounts';
import { findGuardianByPhone } from './guardians';
import { definedOnly, diff, fullName, type PeopleCtx } from './util';

/** Own contact details and emergency contacts, shaped by who is asking (student / parent / staff). */
export async function getMyProfile(db: Executor, ctx: PeopleCtx): Promise<MyProfileOut> {
  const p = ctx.principal;
  const [u] = await db.select().from(users).where(eq(users.id, p.userId)).limit(1);
  if (!u) throw notFound('User');
  const out: MyProfileOut = { userType: u.userType, displayName: u.displayName, username: u.username, email: u.email, phone: u.phone, address: null, avatarUrl: fileUrl(u.avatarFileId), emergencyContacts: [], staff: null };

  if (u.userType === 'student' && p.studentId) {
    const [s] = await db.select().from(students).where(eq(students.id, p.studentId)).limit(1);
    if (s) {
      out.address = s.address ?? null;
      out.emergencyContacts = [{ studentId: s.id, studentName: fullName(s.firstName, s.lastName), contacts: s.emergencyContacts }];
    }
  } else if (u.userType === 'parent') {
    if (p.guardianId) {
      const [g] = await db.select({ address: guardians.address }).from(guardians).where(eq(guardians.id, p.guardianId)).limit(1);
      out.address = g?.address ?? null;
    }
    if (p.linkedStudentIds.length) {
      const kids = await db.select().from(students).where(inArray(students.id, p.linkedStudentIds)).orderBy(students.firstName);
      out.emergencyContacts = kids.map((s) => ({ studentId: s.id, studentName: fullName(s.firstName, s.lastName), contacts: s.emergencyContacts }));
    }
  } else if (p.staffId) {
    const [st] = await db.select().from(staff).where(eq(staff.id, p.staffId)).limit(1);
    if (st) {
      out.address = st.address ?? null;
      out.staff = { employeeId: st.employeeId, designation: st.designation, department: st.department, emergencyContact: st.emergencyContact ?? null };
    }
  }
  return out;
}

/**
 * Self-service edit — only the fields a person may change about themselves: phone, email, address, emergency contacts.
 * Names, dates of birth, medical notes etc. are official records: ask the school through a correction request.
 * Changing the email (the account-recovery channel) needs the current password.
 */
export async function updateMyProfile(tx: Executor, ctx: PeopleCtx, input: z.infer<typeof myProfileUpdateBody>): Promise<void> {
  const p = ctx.principal;
  const [u] = await tx.select().from(users).where(eq(users.id, p.userId)).limit(1).for('update');
  if (!u) throw notFound('User');

  const email = input.email === undefined ? undefined : input.email ? normalizeEmail(input.email) : null;
  const phone = input.phone === undefined ? undefined : input.phone ? normalizePhone(input.phone) : null;
  if (email !== undefined && email !== u.email) {
    if (!input.currentPassword) throw new AppError(422, 'PASSWORD_REQUIRED', 'Enter your current password to change your email address');
    if (!u.passwordHash || !(await verifyPassword(u.passwordHash, input.currentPassword))) throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  }
  const clash = await tx
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(and(ne(users.id, u.id), or(email ? eq(users.email, email) : undefined, phone ? eq(users.phone, phone) : undefined)))
    .limit(2);
  if (email && clash.some((c) => c.email === email)) throw conflict('That email address is used by another account', 'EMAIL_TAKEN');
  if (phone && clash.some((c) => c.phone === phone)) throw conflict('That phone number is used by another account', 'PHONE_TAKEN');

  const userPatch = definedOnly({ email, phone });
  const before: Record<string, unknown> = { email: u.email, phone: u.phone };
  const after: Record<string, unknown> = { ...userPatch };
  if (Object.keys(userPatch).length) await tx.update(users).set(userPatch).where(eq(users.id, u.id));

  if (u.userType === 'student' && p.studentId) {
    const [s] = await tx.select().from(students).where(eq(students.id, p.studentId)).limit(1).for('update');
    const patch = definedOnly({ address: input.address, emergencyContacts: input.emergencyContacts });
    if (s && Object.keys(patch).length) {
      await tx.update(students).set(patch).where(eq(students.id, s.id));
      Object.assign(before, { address: s.address, emergencyContacts: s.emergencyContacts.length });
      Object.assign(after, { address: patch.address, emergencyContacts: patch.emergencyContacts?.length });
    }
  } else if (u.userType === 'parent') {
    if (p.guardianId) {
      const [g] = await tx.select().from(guardians).where(eq(guardians.id, p.guardianId)).limit(1).for('update');
      if (phone) {
        const other = await findGuardianByPhone(tx, phone);
        if (other && other.id !== p.guardianId) throw conflict('That phone number belongs to another parent', 'PHONE_TAKEN');
      }
      const patch = definedOnly({ phone, email, address: input.address });
      if (g && Object.keys(patch).length) await tx.update(guardians).set(patch).where(eq(guardians.id, g.id));
    }
    if (input.emergencyContacts !== undefined) {
      const target = input.studentId ?? (p.linkedStudentIds.length === 1 ? p.linkedStudentIds[0] : undefined);
      if (!target) throw unprocessable('Say which child these emergency contacts are for (studentId)', 'STUDENT_REQUIRED');
      // only children reached through a VERIFIED link
      if (!p.linkedStudentIds.includes(target)) throw notFound('Student');
      await tx.update(students).set({ emergencyContacts: input.emergencyContacts }).where(eq(students.id, target));
      Object.assign(after, { emergencyContactsFor: target, emergencyContacts: input.emergencyContacts.length });
    }
  } else if (p.staffId) {
    const patch = definedOnly({ phone, email, address: input.address, emergencyContact: input.emergencyContact });
    if (Object.keys(patch).length) await tx.update(staff).set(patch).where(eq(staff.id, p.staffId));
    if (input.address !== undefined) after.address = input.address;
    if (input.emergencyContact !== undefined) after.emergencyContact = input.emergencyContact ? '[updated]' : null;
  }

  const d = diff(before, after);
  if (Object.keys(d.after).length) await audit(tx, ctx.actor, { action: 'profile.update', entity: 'user', entityId: u.id, summary: 'Updated own contact details', before: d.before, after: d.after });
}
