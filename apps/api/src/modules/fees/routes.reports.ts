import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  collectionOut,
  collectionQuery,
  defaulterOut,
  defaultersQuery,
  expenseCreateBody,
  expenseDecisionBody,
  expenseListQuery,
  expenseOut,
  expenseSummaryOut,
  expenseSummaryQuery,
  expenseUpdateBody,
  financeSummaryOut,
  financeSummaryQuery,
  idParam,
  okSchema,
  outstandingOut,
  outstandingQuery,
  paged,
} from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { requirePerm } from '../../plugins/guards';
import { toCsv } from '../exams/common';
import * as reports from './reports';

const R = ['Fee reports'];
const E = ['Expenses'];
const csvOut = z.string().meta({ description: 'text/csv' });
const sendCsv = (reply: FastifyReply, name: string, csv: string) => reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${name}"`).send(csv);

const routes: FastifyPluginAsyncZod = async (app) => {
  // ── fee reports (fees:view = on screen, fees:export = CSV) ───────────────────────────────
  app.get('/fees/reports/outstanding', { preHandler: [requirePerm('fees:view', 'school')], schema: { tags: R, summary: 'Outstanding fees with aging buckets (not due, 1-30, 31-60, 61-90, 90+ days), optionally grouped by grade or section', querystring: outstandingQuery, response: { 200: outstandingOut } } }, async (req) => reports.outstandingReport(req.db, req.tenant, req.query));
  app.get('/fees/reports/outstanding/export', { preHandler: [requirePerm('fees:export', 'school')], schema: { tags: R, summary: 'CSV of the outstanding / aging report', querystring: outstandingQuery, response: { 200: csvOut } } }, async (req, reply) => {
    const r = await reports.outstandingReport(req.db, req.tenant, { ...req.query, groupBy: req.query.groupBy === 'none' ? 'grade' : req.query.groupBy });
    return sendCsv(reply, 'outstanding.csv', toCsv(['Group', 'Invoices', 'Outstanding (minor)', 'Overdue (minor)', 'Not due', '1-30 days', '31-60 days', '61-90 days', '90+ days'], r.rows.map((x) => [x.name, x.invoices, x.outstandingMinor, x.overdueMinor, x.buckets.notDue, x.buckets.d1to30, x.buckets.d31to60, x.buckets.d61to90, x.buckets.d90plus])));
  });
  app.get('/fees/reports/defaulters', { preHandler: [requirePerm('fees:view', 'school')], schema: { tags: R, summary: 'Defaulters: students with overdue balances, worst first, with the primary guardian’s phone', querystring: defaultersQuery, response: { 200: paged(defaulterOut) } } }, async (req) => reports.defaultersReport(req.db, req.tenant, req.query) as Promise<never>);
  app.get('/fees/reports/defaulters/export', { preHandler: [requirePerm('fees:export', 'school')], schema: { tags: R, summary: 'CSV of defaulters (up to 5000 rows)', querystring: defaultersQuery.omit({ page: true, pageSize: true }), response: { 200: csvOut } } }, async (req, reply) => {
    const r = (await reports.defaultersReport(req.db, req.tenant, { ...req.query, page: 1, pageSize: 100 }, { all: true })) as { data: z.infer<typeof defaulterOut>[] };
    return sendCsv(reply, 'defaulters.csv', toCsv(['Student', 'Admission no', 'Class', 'Section', 'Overdue invoices', 'Overdue (minor)', 'Oldest due date', 'Max days overdue', 'Guardian', 'Guardian phone'], r.data.map((d) => [d.studentName, d.admissionNo, d.gradeName, d.sectionName, d.overdueInvoices, d.overdueMinor, d.oldestDueDate, d.maxDaysOverdue, d.guardianName, d.guardianPhone])));
  });
  app.get('/fees/reports/collection', { preHandler: [requirePerm('fees:view', 'school')], schema: { tags: R, summary: 'Collection summary for a period: daily/monthly series, by payment method, by fee category', querystring: collectionQuery, response: { 200: collectionOut } } }, async (req) => reports.collectionReport(req.db, req.tenant, req.query));
  app.get('/fees/reports/collection/export', { preHandler: [requirePerm('fees:export', 'school')], schema: { tags: R, summary: 'CSV of the collection series', querystring: collectionQuery, response: { 200: csvOut } } }, async (req, reply) => {
    const r = await reports.collectionReport(req.db, req.tenant, req.query);
    return sendCsv(reply, 'collection.csv', toCsv(['Period', 'Collected (minor)', 'Refunded (minor)', 'Payments'], r.series.map((s) => [s.period, s.collectedMinor, s.refundedMinor, s.count])));
  });

  app.get('/finance/summary', { preHandler: [requirePerm('fees:view', 'school'), requirePerm('payments:view', 'school')], schema: { tags: R, summary: 'Management dashboard: collected vs expenses vs outstanding (expenses are null without expenses:view)', querystring: financeSummaryQuery, response: { 200: financeSummaryOut } } }, async (req) => reports.financeSummary(req.db, req.tenant, req.auth, req.query));

  // ── expenses ──────────────────────────────────────────────────────────────────────────────
  app.get('/expenses', { preHandler: [requirePerm('expenses:view', 'school')], schema: { tags: E, summary: 'Expenses', querystring: expenseListQuery, response: { 200: paged(expenseOut) } } }, async (req) => reports.listExpenses(req.db, req.query) as Promise<never>);
  app.post('/expenses', { preHandler: [requirePerm('expenses:create', 'school')], schema: { tags: E, summary: 'Record an expense. Amounts above fees.expenseApprovalThresholdMinor are created `pending` and need expenses:approve', body: expenseCreateBody, response: { 201: expenseOut } } }, async (req, reply) => reply.status(201).send(await req.db.transaction((tx) => reports.createExpense(tx, actorOf(req), req.body))));
  app.get('/expenses/summary', { preHandler: [requirePerm('expenses:view', 'school')], schema: { tags: E, summary: 'Monthly and per-category totals of approved expenses', querystring: expenseSummaryQuery, response: { 200: expenseSummaryOut } } }, async (req) => reports.expenseSummary(req.db, req.tenant, req.query));
  app.get('/expenses/export', { preHandler: [requirePerm('expenses:export', 'school')], schema: { tags: E, summary: 'CSV of expenses (same filters as the list)', querystring: expenseListQuery.omit({ page: true, pageSize: true }), response: { 200: csvOut } } }, async (req, reply) => {
    const rows = (await reports.listExpenses(req.db, { ...req.query, page: 1, pageSize: 100 }, { all: true })) as z.infer<typeof expenseOut>[];
    return sendCsv(reply, 'expenses.csv', toCsv(['Date', 'Category', 'Description', 'Paid to', 'Reference', 'Amount (minor)', 'Status', 'Recorded by', 'Approved by'], rows.map((e) => [e.spentOn, e.category, e.description, e.paidTo, e.reference, e.amountMinor, e.status, e.createdByName, e.approvedByName])));
  });
  app.get('/expenses/:id', { preHandler: [requirePerm('expenses:view', 'school')], schema: { tags: E, summary: 'One expense', params: idParam, response: { 200: expenseOut } } }, async (req) => reports.getExpense(req.db, req.params.id));
  app.patch('/expenses/:id', { preHandler: [requirePerm('expenses:edit', 'school')], schema: { tags: E, summary: 'Edit an expense (editing a rejected one resubmits it; raising an approved one above the threshold sends it back for approval)', params: idParam, body: expenseUpdateBody, response: { 200: expenseOut } } }, async (req) => req.db.transaction((tx) => reports.updateExpense(tx, actorOf(req), req.params.id, req.body)));
  app.post('/expenses/:id/approve', { preHandler: [requirePerm('expenses:approve', 'school')], schema: { tags: E, summary: 'Approve a pending expense', params: idParam, body: expenseDecisionBody, response: { 200: expenseOut } } }, async (req) => req.db.transaction((tx) => reports.decideExpense(tx, actorOf(req), req.params.id, 'approved', req.body.note)));
  app.post('/expenses/:id/reject', { preHandler: [requirePerm('expenses:approve', 'school')], schema: { tags: E, summary: 'Reject a pending expense', params: idParam, body: expenseDecisionBody, response: { 200: expenseOut } } }, async (req) => req.db.transaction((tx) => reports.decideExpense(tx, actorOf(req), req.params.id, 'rejected', req.body.note)));
  app.delete('/expenses/:id', { preHandler: [requirePerm('expenses:delete', 'school')], schema: { tags: E, summary: 'Delete an expense (audited with a snapshot)', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => reports.deleteExpense(tx, actorOf(req), req.params.id));
    return { ok: true as const };
  });
};

export default routes;
