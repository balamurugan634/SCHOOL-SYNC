import { and, count, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLogs, concessions, examPapers, exams, expenses, invoices, markSheets, payments, refunds, reportRemarks, studentFeePlans } from '../src/db/tenant/schema';
import { seed as seedExams } from '../src/cli/seed/exams';
import { seed as seedFees } from '../src/cli/seed/fees';
import { createTestSchool } from './helpers';

/** The demo seeders: realistic, complete, and consistent with what the API serves. */
describe('exams + fees demo seed', () => {
  it('seeds the three exams, mixed sheet states, invoices, payments, concessions, refund and expenses', async () => {
    const s = await createTestSchool({ size: 'full' });
    const t0 = Date.now();
    await seedExams(s.ctx);
    await seedFees(s.ctx);
    expect(Date.now() - t0).toBeLessThan(30_000);

    // ── exams ──
    const ex = await s.db.select().from(exams);
    expect(Object.fromEntries(ex.map((e) => [e.name, e.status]))).toEqual({ 'Term 1 Final Examination': 'published', 'Mid-Term Examination': 'marks_entry', 'Annual Final Examination': 'scheduled' });
    const sheets = await s.db.select({ examId: markSheets.examId, status: markSheets.status, n: count() }).from(markSheets).groupBy(markSheets.examId, markSheets.status);
    const by = (name: string) => ex.find((e) => e.name === name)!.id;
    const states = (id: string) => Object.fromEntries(sheets.filter((x) => x.examId === id).map((x) => [x.status, x.n]));
    expect(Object.keys(states(by('Term 1 Final Examination')))).toEqual(['published']);
    expect(states(by('Term 1 Final Examination')).published).toBe(s.ctx.assignments.length);
    expect(Object.keys(states(by('Mid-Term Examination'))).sort()).toEqual(['approved', 'draft', 'returned', 'submitted']);
    expect(sheets.filter((x) => x.examId === by('Annual Final Examination'))).toHaveLength(0);
    expect((await s.db.select({ n: count() }).from(examPapers).where(eq(examPapers.examId, by('Annual Final Examination'))))[0]!.n).toBe(s.ctx.grades.length * s.ctx.subjects.length);
    expect((await s.db.select({ n: count() }).from(reportRemarks))[0]!.n).toBe(s.ctx.students.length);

    // students and parents see the published exam only, with real numbers and some failures
    const principal = await s.login('principal');
    const stu = s.ctx.students[0]!;
    const student = await s.login(stu.username);
    const parent = await s.login(s.ctx.guardians.find((g) => g.studentIds.includes(stu.id))!.username);
    const list = await s.req('GET', '/exams', student);
    expect(list.body.data.map((e: any) => e.name).sort()).toEqual(['Annual Final Examination', 'Mid-Term Examination', 'Term 1 Final Examination']);
    const res = await s.req('GET', `/results?studentId=${stu.id}`, parent);
    expect(res.body.data).toHaveLength(1); // the mid-term is unpublished: invisible
    expect(res.body.data[0]).toMatchObject({ examName: 'Term 1 Final Examination', complete: true, subjectsPublished: s.ctx.subjects.length });
    expect(res.body.data[0].rank).toBeGreaterThanOrEqual(1);
    const rc = await s.req('GET', `/report-cards/${by('Term 1 Final Examination')}/students/${stu.id}`, student);
    expect(rc.status).toBe(200);
    expect(rc.body.remarks.remark).toBeTruthy();
    const an = await s.req('GET', `/exams/${by('Term 1 Final Examination')}/analytics`, principal);
    expect(an.body.distribution.reduce((t: number, b: any) => t + b.count, 0)).toBe(s.ctx.students.length);
    const failing = an.body.rows.reduce((t: number, r: any) => t + (r.appeared - r.passCount), 0);
    expect(failing).toBeGreaterThan(0);
    expect(failing).toBeLessThan(an.body.rows.reduce((t: number, r: any) => t + r.appeared, 0) * 0.3);

    // ── fees ──
    expect((await s.db.select({ n: count() }).from(studentFeePlans))[0]!.n).toBe(s.ctx.students.length);
    const inv = await s.db.select().from(invoices);
    expect(inv).toHaveLength(s.ctx.students.length * 3);
    const paid = inv.filter((i) => i.status === 'paid').length;
    const partial = inv.filter((i) => i.status === 'partial').length;
    const unpaid = inv.filter((i) => i.status === 'unpaid').length;
    expect(paid).toBeGreaterThan(inv.length * 0.4);
    expect(partial).toBeGreaterThan(5);
    expect(unpaid).toBeGreaterThan(5);
    // the ledger is consistent: invoice.paid equals its payments minus refunds
    const mismatch = await s.db.execute<{ n: number }>(sql`select count(*)::int as n from invoices i where i.paid_minor <> coalesce((select sum(amount_minor - refunded_minor) from payments p where p.invoice_id = i.id and p.status in ('succeeded','partially_refunded','refunded')), 0)`);
    expect(mismatch.rows[0]!.n).toBe(0);
    const methods = (await s.db.select({ m: payments.method }).from(payments).groupBy(payments.method)).map((x) => x.m);
    expect(methods).toEqual(expect.arrayContaining(['cash', 'upi', 'cheque', 'online']));
    expect((await s.db.select({ n: count() }).from(payments).where(sql`${payments.receiptNo} is null`))[0]!.n).toBe(0);
    const con = await s.db.select({ status: concessions.status, n: count() }).from(concessions).groupBy(concessions.status);
    expect(Object.fromEntries(con.map((c) => [c.status, c.n]))).toMatchObject({ approved: 6, pending: 3, rejected: 1 });
    expect(inv.some((i) => i.discountMinor > 0)).toBe(true);
    expect(await s.db.select().from(refunds)).toHaveLength(1);
    const exp = await s.db.select().from(expenses);
    expect(exp).toHaveLength(25);
    expect(exp.filter((e) => e.status === 'pending').length).toBeGreaterThanOrEqual(1);

    // the finance dashboard, overdue report and an accountant's view agree with the data
    const accounts = await s.login('accounts');
    const fin = await s.req('GET', '/finance/summary', accounts);
    expect(fin.status).toBe(200);
    expect(fin.body.overdueMinor).toBeGreaterThan(0);
    expect(fin.body.collectedMinor).toBeGreaterThan(0);
    expect(fin.body.expensesMinor).toBeGreaterThan(0);
    expect(fin.body.pending.refunds).toBe(1);
    const def = await s.req('GET', '/fees/reports/defaulters', accounts);
    expect(def.body.meta.total).toBeGreaterThan(10);
    const parentInv = await s.req('GET', '/fees/invoices', parent);
    expect(parentInv.body.meta.total).toBeGreaterThanOrEqual(3);
    expect((await s.req('GET', '/fees/invoices', await s.login('t001'))).status).toBe(403);
    expect((await s.db.select({ n: count() }).from(auditLogs).where(and(eq(auditLogs.action, 'fees.generate_dues'))))[0]!.n).toBe(1);
  }, 120_000);
});
