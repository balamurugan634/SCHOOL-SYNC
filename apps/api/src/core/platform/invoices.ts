import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type { PlatformAuditEntry, PlatformBillingOverview, PlatformInvoice, PlatformInvoiceIssueBody, PlatformInvoiceListQuery } from '@school-sync/shared';
import { billingInvoices, platformAudit, platformOperators, subscriptions, tenants } from '../../db/control/schema';
import { issueSeatInvoice, issueTrueUp, trueUpPlan } from '../billing/invoicing';
import { AppError, conflict, notFound } from '../errors';
import { decodeCursor, encodeCursor, ilikeAny } from '../http';
import { controlDb } from '../tenancy/control-db';
import { platformAuditLog, type PlatformActor } from './audit';
import { getTenantRow, listTenants } from './tenants';

type InvoiceRow = typeof billingInvoices.$inferSelect;

const todayIso = () => new Date().toISOString().slice(0, 10);

function view(r: InvoiceRow, tenantCode: string, tenantName: string, academicYear: string): PlatformInvoice {
  return {
    id: r.id,
    tenantId: r.tenantId,
    number: r.number,
    tenantCode,
    tenantName,
    subscriptionId: r.subscriptionId,
    academicYear,
    kind: r.kind,
    students: r.students,
    unitPriceMinor: r.unitPriceMinor,
    amountMinor: r.amountMinor,
    currency: r.currency,
    status: r.status,
    overdue: r.status === 'issued' && !!r.dueOn && r.dueOn < todayIso(),
    issuedAt: r.issuedAt.toISOString(),
    dueOn: r.dueOn,
    paidAt: r.paidAt?.toISOString() ?? null,
    paymentReference: r.paymentReference,
    notes: r.notes,
  };
}

const joined = () =>
  controlDb()
    .select({ inv: billingInvoices, code: tenants.code, name: tenants.name, year: subscriptions.academicYear })
    .from(billingInvoices)
    .innerJoin(tenants, eq(tenants.id, billingInvoices.tenantId))
    .innerJoin(subscriptions, eq(subscriptions.id, billingInvoices.subscriptionId));

export async function getInvoice(id: string): Promise<PlatformInvoice> {
  const [r] = await joined().where(eq(billingInvoices.id, id)).limit(1);
  if (!r) throw notFound('Invoice');
  return view(r.inv, r.code, r.name, r.year);
}

export async function listInvoices(q: PlatformInvoiceListQuery) {
  const today = todayIso();
  const overdue = sql`(${billingInvoices.status} = 'issued' and ${billingInvoices.dueOn} is not null and ${billingInvoices.dueOn} < ${today})`;
  const where = and(
    q.q ? sql`(${ilikeAny(q.q, billingInvoices.number, tenants.code, tenants.name)})` : undefined,
    q.tenant ? eq(tenants.code, q.tenant.toLowerCase()) : undefined,
    q.status ? eq(billingInvoices.status, q.status) : undefined,
    q.kind ? eq(billingInvoices.kind, q.kind) : undefined,
    q.overdue === 'true' ? overdue : q.overdue === 'false' ? sql`not ${overdue}` : undefined,
  );
  const [rows, [count]] = await Promise.all([
    joined()
      .where(where)
      .orderBy(desc(billingInvoices.issuedAt), desc(billingInvoices.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    controlDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(billingInvoices)
      .innerJoin(tenants, eq(tenants.id, billingInvoices.tenantId))
      .where(where),
  ]);
  const total = count?.n ?? 0;
  return { data: rows.map((r) => view(r.inv, r.code, r.name, r.year)), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
}

export async function tenantInvoices(code: string): Promise<PlatformInvoice[]> {
  const t = await getTenantRow(code);
  const rows = await joined().where(eq(billingInvoices.tenantId, t.id)).orderBy(desc(billingInvoices.issuedAt), desc(billingInvoices.id));
  return rows.map((r) => view(r.inv, r.code, r.name, r.year));
}

/** Issue the committed-seats invoice or a true-up for one of a school's subscriptions (reuses the billing core). */
export async function issueInvoice(code: string, body: PlatformInvoiceIssueBody, actor: PlatformActor): Promise<{ invoice: PlatformInvoice | null; message: string | null }> {
  const t = await getTenantRow(code);
  const [sub] = await controlDb().select().from(subscriptions).where(and(eq(subscriptions.tenantId, t.id), eq(subscriptions.academicYear, body.academicYear))).limit(1);
  if (!sub) throw new AppError(400, 'NO_SUBSCRIPTION', 'No subscription for that academic year');
  const inv = await (body.kind === 'seats' ? issueSeatInvoice(sub.id, body.dueOn) : issueTrueUp(sub.id, body.dueOn)).catch((e: Error) => {
    throw new AppError(409, 'INVOICE_FAILED', e.message);
  });
  if (!inv) return { invoice: null, message: body.kind === 'seats' ? 'Nothing to invoice: the subscription has no committed seats or no price.' : 'Nothing to bill: no students above what has already been invoiced.' };
  await platformAuditLog(actor, 'invoice.issue', t.code, { invoiceId: inv.id, number: inv.number, kind: inv.kind, students: inv.students, amountMinor: inv.amountMinor, currency: inv.currency, academicYear: sub.academicYear });
  return { invoice: view(inv, t.code, t.name, sub.academicYear), message: null };
}

export async function markInvoicePaid(id: string, body: { paidOn: string; reference?: string }, actor: PlatformActor): Promise<PlatformInvoice> {
  const current = await getInvoice(id);
  if (current.status === 'paid') throw conflict('This invoice is already marked as paid', 'INVOICE_ALREADY_PAID');
  if (current.status !== 'issued') throw conflict(`A ${current.status} invoice cannot be marked as paid`, 'INVOICE_NOT_PAYABLE');
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (body.paidOn > tomorrow) throw new AppError(422, 'VALIDATION_ERROR', 'The paid date cannot be in the future', { errors: [{ path: 'paidOn', message: 'The paid date cannot be in the future' }] });
  // noon UTC keeps the calendar day the same in every time zone
  const [row] = await controlDb()
    .update(billingInvoices)
    .set({ status: 'paid', paidAt: new Date(`${body.paidOn}T12:00:00Z`), paymentReference: body.reference || null })
    .where(and(eq(billingInvoices.id, id), eq(billingInvoices.status, 'issued')))
    .returning();
  if (!row) throw conflict('This invoice changed in the meantime. Reload and try again.', 'INVOICE_CHANGED');
  await platformAuditLog(actor, 'invoice.paid', current.tenantCode, { invoiceId: id, number: current.number, amountMinor: current.amountMinor, currency: current.currency, paidOn: body.paidOn, reference: body.reference || null });
  return getInvoice(id);
}

export async function voidInvoice(id: string, reason: string, actor: PlatformActor): Promise<PlatformInvoice> {
  const current = await getInvoice(id);
  if (current.status === 'paid') throw conflict('A paid invoice cannot be voided', 'INVOICE_PAID');
  if (current.status === 'void') throw conflict('This invoice is already void', 'INVOICE_ALREADY_VOID');
  const [row] = await controlDb()
    .update(billingInvoices)
    .set({ status: 'void', notes: [current.notes, `Voided: ${reason}`].filter(Boolean).join(' | ') })
    .where(and(eq(billingInvoices.id, id), ne(billingInvoices.status, 'paid'), ne(billingInvoices.status, 'void')))
    .returning();
  if (!row) throw conflict('This invoice changed in the meantime. Reload and try again.', 'INVOICE_CHANGED');
  await platformAuditLog(actor, 'invoice.void', current.tenantCode, { invoiceId: id, number: current.number, amountMinor: current.amountMinor, currency: current.currency, reason });
  return getInvoice(id);
}

// ── billing overview across schools ─────────────────────────────────────────────────────────────
export async function billingOverview(): Promise<PlatformBillingOverview> {
  const db = controlDb();
  const today = todayIso();
  const list = await listTenants({});
  const schools = list.data.filter((s) => s.status === 'active' || s.status === 'suspended');
  const subIds = schools.map((s) => s.license.subscriptionId).filter((x): x is string => !!x);
  const [plans, seatsInvoiced, sums] = await Promise.all([
    trueUpPlan(subIds),
    subIds.length ? db.selectDistinct({ id: billingInvoices.subscriptionId }).from(billingInvoices).where(and(inArray(billingInvoices.subscriptionId, subIds), eq(billingInvoices.kind, 'seats'), ne(billingInvoices.status, 'void'))) : Promise.resolve([]),
    db
      .select({
        currency: billingInvoices.currency,
        invoiced: sql<number>`coalesce(sum(${billingInvoices.amountMinor}) filter (where ${billingInvoices.status} in ('issued','paid')), 0)::float8`,
        paid: sql<number>`coalesce(sum(${billingInvoices.amountMinor}) filter (where ${billingInvoices.status} = 'paid'), 0)::float8`,
        outstanding: sql<number>`coalesce(sum(${billingInvoices.amountMinor}) filter (where ${billingInvoices.status} = 'issued'), 0)::float8`,
        overdue: sql<number>`coalesce(sum(${billingInvoices.amountMinor}) filter (where ${billingInvoices.status} = 'issued' and ${billingInvoices.dueOn} is not null and ${billingInvoices.dueOn} < ${today}), 0)::float8`,
      })
      .from(billingInvoices)
      .groupBy(billingInvoices.currency),
  ]);
  const invoicedSeats = new Set(seatsInvoiced.map((r) => r.id));

  const totals = new Map<string, PlatformBillingOverview['totals'][number]>();
  const bucket = (currency: string) => {
    let b = totals.get(currency);
    if (!b) totals.set(currency, (b = { currency, committedMinor: 0, invoicedMinor: 0, paidMinor: 0, outstandingMinor: 0, overdueMinor: 0, trueUpDueMinor: 0 }));
    return b;
  };
  for (const s of sums) Object.assign(bucket(s.currency), { invoicedMinor: s.invoiced, paidMinor: s.paid, outstandingMinor: s.outstanding, overdueMinor: s.overdue });

  const rows = schools.map((s) => {
    const l = s.license;
    const plan = l.subscriptionId ? plans.get(l.subscriptionId) : undefined;
    const price = l.pricePerStudentMinor ?? 0;
    const trueUpStudents = plan && price > 0 ? plan.extra : 0;
    const currency = l.currency ?? s.currency;
    if (l.subscriptionId && (l.state === 'trial' || l.state === 'active' || l.state === 'grace')) bucket(currency).committedMinor += (l.licensedStudents ?? 0) * price;
    if (trueUpStudents > 0) bucket(currency).trueUpDueMinor += trueUpStudents * price;
    return {
      code: s.code,
      name: s.name,
      status: s.status,
      currency,
      state: l.state,
      academicYear: l.academicYear,
      subscriptionId: l.subscriptionId,
      pricePerStudentMinor: l.pricePerStudentMinor,
      licensedStudents: l.licensedStudents,
      usedNow: s.seats.used,
      peakBillable: plan?.peak ?? 0,
      invoicedStudents: plan?.invoiced ?? 0,
      seatsInvoiced: !!l.subscriptionId && invoicedSeats.has(l.subscriptionId),
      trueUpStudents,
      trueUpMinor: trueUpStudents * price,
      outstandingMinor: s.billing.outstandingMinor,
      outstandingCount: s.billing.outstandingCount,
      overdueCount: s.billing.overdueCount,
    };
  });
  return { asOf: today, totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), schools: rows };
}

// ── audit log ───────────────────────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function listAudit(q: { cursor?: string; limit: number; tenant?: string; action?: string; actor?: string }): Promise<{ data: PlatformAuditEntry[]; nextCursor: string | null }> {
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const rows = await controlDb()
    .select({ a: platformAudit, opName: platformOperators.displayName, opId: platformOperators.id })
    .from(platformAudit)
    .leftJoin(platformOperators, sql`${platformOperators.id}::text = ${platformAudit.actor}`)
    .where(
      and(
        cur?.id && UUID_RE.test(cur.id) ? lt(platformAudit.id, cur.id) : undefined,
        q.tenant ? eq(platformAudit.tenantCode, q.tenant.toLowerCase()) : undefined,
        q.action ? sql`${platformAudit.action} ilike ${`${q.action.replace(/[\\%_]/g, '\\$&')}%`}` : undefined,
        q.actor ? eq(platformAudit.actor, q.actor) : undefined,
      ),
    )
    .orderBy(desc(platformAudit.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const data: PlatformAuditEntry[] = page.map(({ a, opName, opId }) => ({
    id: a.id,
    at: a.at.toISOString(),
    actor: a.actor,
    actorKind: opId ? 'operator' : a.actor === 'platform-api' ? 'key' : a.actor === 'cli' ? 'cli' : 'system',
    actorName: opName ?? null,
    action: a.action,
    tenantCode: a.tenantCode,
    detail: a.detail ?? null,
  }));
  return { data, nextCursor: rows.length > q.limit ? encodeCursor({ id: page.at(-1)!.a.id }) : null };
}

