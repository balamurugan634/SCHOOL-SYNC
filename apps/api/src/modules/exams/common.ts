import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { PermissionKey } from '@school-sync/shared';
import PDFDocument from 'pdfkit';
import { guardians, rolePermissions, studentGuardians, students, userRoles, users } from '../../db/tenant/schema';
import type { Executor } from '../../core/tenancy/pools';

/** Helpers shared by the exams and fees modules (recipients, CSV, PDF, small formatters). */

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/**
 * User ids that may be told about a student's results / fees: the student's own account and the accounts of
 * *verified* guardians only (the unverified link of the demo data never receives anything).
 */
export async function recipientsForStudents(db: Executor, studentIds: string[], opts: { includeStudents?: boolean } = {}): Promise<string[]> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return [];
  const out = new Set<string>();
  for (const part of chunk(ids, 1000)) {
    const [own, guard] = await Promise.all([
      opts.includeStudents === false ? Promise.resolve([] as { u: string | null }[]) : db.select({ u: students.userId }).from(students).where(inArray(students.id, part)),
      db
        .select({ u: guardians.userId })
        .from(studentGuardians)
        .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .where(and(inArray(studentGuardians.studentId, part), isNotNull(studentGuardians.verifiedAt))),
    ]);
    for (const r of [...own, ...guard]) if (r.u) out.add(r.u);
  }
  return [...out];
}

/** Active users holding `perm` through any role (e.g. who should hear about a refund request). */
export async function usersWithPermission(db: Executor, perm: PermissionKey): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(rolePermissions)
    .innerJoin(userRoles, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(rolePermissions.permission, perm), eq(users.status, 'active')));
  return rows.map((r) => r.id);
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────

/** RFC 4180 quoting, plus a guard against spreadsheet formula injection (cells starting with = + - @). */
function cell(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  // BOM so Excel opens UTF-8 names correctly
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

// ── PDF ─────────────────────────────────────────────────────────────────────────────────────

/** Render a small PDF fully in memory (documents here are one or two pages). */
export function renderPdf(build: (doc: PDFKit.PDFDocument) => void, info: { title: string; author?: string } = { title: 'Document' }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: info.title, Author: info.author ?? 'SchoolSync' } });
    const parts: Buffer[] = [];
    doc.on('data', (c: Buffer) => parts.push(c));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/** Helvetica (the built-in PDF font) cannot draw ₹ or non-Latin scripts, so amounts are printed as `INR 1,234.50`. */
export function formatMoney(minor: number, currency: string): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString('en-IN');
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${currency} ${whole}.${frac}`;
}

/** Strip characters the built-in PDF font cannot encode so a name never breaks rendering. */
export const pdfSafe = (s: string | null | undefined): string => (s ?? '').normalize('NFKD').replace(/[^\x20-\x7E -ÿ]/g, '');

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const hhmm = (t: string | null | undefined): string | null => (t ? t.slice(0, 5) : null);
