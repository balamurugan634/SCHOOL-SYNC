import { sql } from 'drizzle-orm';
import { addDaysIso } from '../../core/http';
import { putSetting } from '../../core/settings';
import { concessions, expenses, feeCategories, feeStructureItems, feeStructures, invoices, payments, refunds, studentFeePlans } from '../../db/tenant/schema';
import { reserveNumbers, formatNumber, yearToken } from '../../modules/fees/billing';
import { generateDues } from '../../modules/fees/service';
import type { ModuleSeeder } from './context';

/**
 * Demo data for fees & finance (deterministic, bulk inserts):
 *  - categories: tuition, transport, lab, activity
 *  - per-grade structures (with and without transport), 3 instalments each: one long overdue, one recently overdue, one upcoming
 *  - a plan and invoices for every student (generated through the real service, so approved concessions are applied)
 *  - ~60% of families paid in full by varied methods with numbered receipts, some partial, some overdue/defaulting
 *  - concessions (approved + pending + rejected), one refund request, 25 expenses (two awaiting approval)
 */

const METHODS = ['cash', 'upi', 'upi', 'bank_transfer', 'cheque', 'card', 'online'] as const;
const EXPENSES: [string, string, string, number][] = [
  ['Salaries', 'Support staff wages', 'Payroll', 18_500_000],
  ['Utilities', 'Electricity bill', 'State Electricity Board', 2_840_000],
  ['Utilities', 'Water and sewage charges', 'Municipal Corporation', 640_000],
  ['Utilities', 'Internet and phone lines', 'Airtel Business', 480_000],
  ['Maintenance', 'Classroom furniture repair', 'Sri Lakshmi Carpentry', 1_250_000],
  ['Maintenance', 'Playground resurfacing', 'GreenTurf Services', 6_800_000],
  ['Maintenance', 'Air-conditioner servicing, computer lab', 'CoolCare', 420_000],
  ['Stationery', 'Chalk, markers and registers', 'Ravi Stationers', 185_000],
  ['Stationery', 'Exam answer booklets', 'Classic Printers', 360_000],
  ['Supplies', 'Cleaning supplies', 'Hygiene Mart', 142_000],
  ['Supplies', 'First-aid kit refill', 'Apollo Pharmacy', 68_000],
  ['Events', 'Annual day stage and sound', 'Spotlight Events', 3_250_000],
  ['Events', 'Sports day refreshments', 'Fresh Bites Catering', 540_000],
  ['Events', 'Science exhibition materials', 'Edu Supplies', 295_000],
  ['Transport', 'Bus diesel (monthly)', 'Indian Oil', 1_920_000],
  ['Transport', 'Bus insurance renewal', 'New India Assurance', 860_000],
  ['Software', 'ERP and attendance SMS credits', 'SchoolSync', 300_000],
  ['Software', 'Antivirus licences', 'SecureSoft', 120_000],
  ['Sports', 'Cricket and football kits', 'Sports Hub', 780_000],
  ['Sports', 'Athletics track marking', 'Sports Hub', 210_000],
  ['Miscellaneous', 'Courier and postage', 'DTDC', 24_000],
  ['Miscellaneous', 'Staff tea and snacks', 'Canteen', 56_000],
  ['Maintenance', 'Library roof waterproofing', 'WaterSeal Contractors', 4_900_000],
  ['Salaries', 'Visiting music teacher honorarium', 'Payroll', 1_200_000],
  ['Supplies', 'Lab chemicals and glassware', 'Scientific Traders', 1_460_000],
];

export const seed: ModuleSeeder = async (ctx) => {
  const { db } = ctx;
  const accounts = ctx.staff.accounts!;
  const actor = { userId: accounts.userId, name: accounts.name };
  const chunked = async <T>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
  };

  await putSetting(db, 'fees', { lateFeePerDayMinor: 5000, parentsCanPayOnline: true }, accounts.userId);

  // ── categories ──
  const cats = await db
    .insert(feeCategories)
    .values([
      { code: 'TUI', name: 'Tuition' },
      { code: 'TRN', name: 'Transport' },
      { code: 'LAB', name: 'Lab' },
      { code: 'ACT', name: 'Activity' },
    ])
    .returning();
  const cat = Object.fromEntries(cats.map((c) => [c.code, c.id])) as Record<'TUI' | 'TRN' | 'LAB' | 'ACT', string>;

  // ── structures: 3 instalments per grade, plain and "+ transport" ──
  const due = [addDaysIso(ctx.today, -130), addDaysIso(ctx.today, -40), addDaysIso(ctx.today, 50)];
  const structureOf = new Map<string, { plain: string; transport: string }>();
  for (const g of ctx.grades) {
    const tuition = (12_000 + 1_000 * (g.ordinal - 6)) * 100;
    const make = async (name: string, withTransport: boolean) => {
      const [s] = await db.insert(feeStructures).values({ name, academicYearId: ctx.yearId, gradeId: g.id }).returning({ id: feeStructures.id });
      const items: (typeof feeStructureItems.$inferInsert)[] = [];
      due.forEach((d, i) => {
        items.push({ structureId: s!.id, categoryId: cat.TUI, label: `Tuition - Instalment ${i + 1}`, amountMinor: tuition, dueDate: d, ordinal: i * 10 });
        if (i === 0) items.push({ structureId: s!.id, categoryId: cat.ACT, label: 'Activity fee', amountMinor: 150_000, dueDate: d, ordinal: 1 });
        if (i === 0 && g.ordinal >= 8) items.push({ structureId: s!.id, categoryId: cat.LAB, label: 'Lab fee', amountMinor: 250_000, dueDate: d, ordinal: 2 });
        if (withTransport) items.push({ structureId: s!.id, categoryId: cat.TRN, label: `Transport - Instalment ${i + 1}`, amountMinor: 360_000, dueDate: d, ordinal: i * 10 + 5 });
      });
      await db.insert(feeStructureItems).values(items);
      return s!.id;
    };
    structureOf.set(g.id, { plain: await make(`${g.name} fees ${ctx.yearName}`, false), transport: await make(`${g.name} fees + transport ${ctx.yearName}`, true) });
  }

  // ── plans for every student (about 35% use the school bus) ──
  const planRows = ctx.students.map((s, i) => {
    const st = structureOf.get(s.gradeId)!;
    return { studentId: s.id, structureId: i % 20 < 7 ? st.transport : st.plain, academicYearId: ctx.yearId, createdBy: accounts.userId };
  });
  await chunked(planRows, 500, (c) => db.insert(studentFeePlans).values(c));

  // ── concessions: approved ones exist BEFORE dues are generated, so they reduce the invoices ──
  const pickStudents = (from: number, n: number) => ctx.students.slice(from, from + n);
  const conRows: (typeof concessions.$inferInsert)[] = [];
  const add = (stu: { id: string }, name: string, type: 'percent' | 'fixed', value: number, status: 'approved' | 'pending' | 'rejected', reason: string, categoryId: string | null = null) =>
    conRows.push({ studentId: stu.id, academicYearId: ctx.yearId, name, type, value, categoryId, reason, status, requestedBy: accounts.userId, decidedBy: status === 'pending' ? null : ctx.adminUserId, decidedAt: status === 'pending' ? null : new Date() });
  pickStudents(3, 3).forEach((s) => add(s, 'Sibling discount', 'percent', 1000, 'approved', 'Second child in the school'));
  pickStudents(9, 2).forEach((s) => add(s, 'Merit scholarship', 'fixed', 1_000_000, 'approved', 'Topper of the previous year'));
  pickStudents(15, 1).forEach((s) => add(s, 'Staff ward concession', 'percent', 5000, 'approved', 'Child of a staff member', cat.TUI));
  pickStudents(20, 2).forEach((s) => add(s, 'Financial hardship waiver', 'percent', 2500, 'pending', 'Parent lost employment; documents submitted'));
  pickStudents(24, 1).forEach((s) => add(s, 'Sports quota', 'fixed', 500_000, 'pending', 'State-level athlete'));
  pickStudents(28, 1).forEach((s) => add(s, 'Late-joining waiver', 'percent', 2000, 'rejected', 'Not eligible under policy'));
  await db.insert(concessions).values(conRows);

  // ── dues, through the real service (idempotent; applies the approved concessions) ──
  await db.transaction((tx) => generateDues(tx, actor, {}));

  // ── payments: ~60% of families clear everything that is due, some pay part, some default ──
  const allInvoices = await db.select().from(invoices);
  const byStudent = Map.groupBy(allInvoices, (i) => i.studentId);
  const guardianUser = new Map(ctx.guardians.flatMap((g) => g.studentIds.map((sid) => [sid, g.userId] as const)));
  const firstSeq = await reserveNumbers(db, 'receipt', allInvoices.length * 2); // generous upper bound; numbering is gap-tolerant
  let seq = firstSeq;
  const token = await yearToken(db, ctx.yearId);
  const payRows: (typeof payments.$inferInsert)[] = [];
  const paidState: { id: string; paid: number; status: 'paid' | 'partial' | 'unpaid' }[] = [];
  const iso = (d: string, hour: number) => new Date(`${d}T${String(hour).padStart(2, '0')}:${String(ctx.int(0, 59)).padStart(2, '0')}:00Z`);

  const pay = (inv: typeof invoices.$inferSelect, studentId: string, amount: number, when: string) => {
    const method = ctx.pick(METHODS);
    const ref = method === 'cheque' ? `CHQ-${ctx.int(100000, 999999)}` : method === 'upi' || method === 'bank_transfer' ? `${method === 'upi' ? 'UPI' : 'UTR'}${ctx.int(10 ** 9, 9 * 10 ** 9)}` : method === 'online' ? null : null;
    const clamp = when > ctx.today ? ctx.today : when;
    payRows.push({
      invoiceId: inv.id,
      studentId,
      amountMinor: amount,
      method,
      status: 'succeeded',
      reference: ref,
      gateway: method === 'online' ? 'mock' : null,
      gatewayOrderId: method === 'online' ? `order_mock_${ctx.int(10 ** 8, 9 * 10 ** 8)}${payRows.length}` : null,
      gatewayPaymentId: method === 'online' ? `pay_mock_${ctx.int(10 ** 8, 9 * 10 ** 8)}${payRows.length}` : null,
      payerUserId: method === 'online' ? (guardianUser.get(studentId) ?? null) : null,
      receiptNo: formatNumber('RCT', token, seq++),
      paidAt: iso(clamp, ctx.int(9, 16)),
      receivedBy: method === 'online' ? null : accounts.userId,
    });
  };

  let familyIdx = 0;
  for (const st of ctx.students) {
    const list = (byStudent.get(st.id) ?? []).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const r = (familyIdx++ * 37 + ctx.int(0, 99)) % 100; // deterministic profile
    const profile = r < 60 ? 'good' : r < 78 ? 'partial' : 'defaulter';
    for (const inv of list) {
      const payable = inv.totalMinor - inv.discountMinor;
      const overdue = inv.dueDate < ctx.today;
      let paid = 0;
      if (payable <= 0) {
        paidState.push({ id: inv.id, paid: 0, status: 'paid' });
        continue;
      }
      if (profile === 'good' && (overdue || ctx.rng() < 0.2)) {
        // a good family pays on time, sometimes in two parts
        if (ctx.rng() < 0.15) {
          const first = Math.round(payable * 0.5);
          pay(inv, st.id, first, addDaysIso(inv.dueDate, -ctx.int(0, 8)));
          pay(inv, st.id, payable - first, addDaysIso(inv.dueDate, ctx.int(0, 12)));
        } else pay(inv, st.id, payable, addDaysIso(inv.dueDate, -ctx.int(0, 10)));
        paid = payable;
      } else if (profile === 'partial' && overdue) {
        if (inv === list[0]) {
          pay(inv, st.id, payable, addDaysIso(inv.dueDate, ctx.int(2, 20)));
          paid = payable;
        } else {
          paid = Math.round((payable * ctx.int(30, 60)) / 100 / 100) * 100;
          pay(inv, st.id, paid, addDaysIso(inv.dueDate, ctx.int(3, 15)));
        }
      } else if (profile === 'defaulter' && overdue && inv === list[0] && ctx.rng() < 0.5) {
        paid = Math.round((payable * 0.4) / 100) * 100;
        pay(inv, st.id, paid, addDaysIso(inv.dueDate, ctx.int(5, 25)));
      }
      paidState.push({ id: inv.id, paid, status: paid >= payable ? 'paid' : paid > 0 ? 'partial' : 'unpaid' });
    }
  }
  // ~12 payments are cheque/online rows; online ones need unique gateway ids, which the counter suffix above guarantees
  await chunked(payRows, 400, (c) => db.insert(payments).values(c));
  await chunked(paidState, 300, async (c) => {
    await db.execute(sql`update invoices i set paid_minor = v.paid, status = v.status from (values ${sql.join(c.map((x) => sql`(${x.id}::uuid, ${x.paid}::bigint, ${x.status}::text)`), sql`, `)}) as v(id, paid, status) where i.id = v.id`);
  });

  // ── one refund request waiting for approval (a duplicate cash payment) ──
  const refundable = payRows.map((p, i) => ({ p, i })).find(({ p }) => p.method === 'cash' && (p.amountMinor ?? 0) > 100_000);
  if (refundable) {
    const [row] = await db.select({ id: payments.id }).from(payments).where(sql`${payments.receiptNo} = ${refundable.p.receiptNo}`).limit(1);
    if (row) await db.insert(refunds).values({ paymentId: row.id, amountMinor: 150_000, reason: 'Activity fee paid twice (cash and UPI)', requestedBy: accounts.userId });
  }

  // ── 25 expenses over the last four months; the two largest wait for approval ──
  const pendingLimit = 5_000_000;
  await db.insert(expenses).values(
    EXPENSES.map(([category, description, paidTo, amountMinor], i) => {
      const needs = amountMinor >= pendingLimit && i % 2 === 0;
      return {
        category,
        description,
        amountMinor,
        spentOn: addDaysIso(ctx.today, -ctx.int(1, 120)),
        paidTo,
        reference: i % 3 === 0 ? `BILL-${ctx.int(1000, 9999)}` : null,
        status: needs ? ('pending' as const) : i === 21 ? ('rejected' as const) : ('approved' as const),
        createdBy: accounts.userId,
        approvedBy: needs ? null : ctx.adminUserId,
        decidedAt: needs ? null : new Date(),
        decisionNote: i === 21 ? 'Duplicate of an earlier bill' : null,
      };
    }),
  );
};
