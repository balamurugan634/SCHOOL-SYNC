import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  attendanceExportQuery,
  idParam,
  staffAttendanceListQuery,
  staffAttendanceListResponse,
  staffAttendanceMarkBody,
  staffAttendanceMarkResponse,
  staffAttendanceMineResponse,
  staffAttendanceRecord,
  staffAttendanceSummaryQuery,
  staffAttendanceSummaryResponse,
  staffAttendanceUpdateBody,
  attendanceRangeQuery,
  leaveDecisionBody,
  staffLeaveBalanceQuery,
  staffLeaveBalanceResponse,
  staffLeaveCreateBody,
  staffLeaveItem,
  staffLeaveListQuery,
  staffLeaveListResponse,
} from '@school-sync/shared';
import { paged } from '../../core/http';
import { requireAnyPerm, requirePerm } from '../../plugins/guards';
import { ctxOf } from './common';
import { csvStream } from './csv';
import * as svc from './staff.service';

const att = ['Staff attendance'];
const lv = ['Staff leave'];

const routes: FastifyPluginAsyncZod = async (app) => {
  // ── staff attendance ──────────────────────────────────────────────────────────────

  app.get(
    '/staff-attendance',
    {
      preHandler: [requirePerm('staff_attendance:view')],
      schema: {
        tags: att,
        summary: 'Staff register for a day (HR roster): every active staff member with their mark, or null',
        description: 'School scope: all staff (HR, principal). Own scope: only the caller. `onApprovedLeave` flags staff with approved leave covering the date so HR can pre-fill them.',
        querystring: staffAttendanceListQuery,
        response: { 200: staffAttendanceListResponse },
      },
    },
    async (req) => {
      const r = await svc.listStaffAttendance(ctxOf(req), req.query);
      return { ...paged(r.rows, r.total, req.query), date: r.date, counts: r.counts };
    },
  );

  app.put(
    '/staff-attendance',
    {
      preHandler: [requirePerm('staff_attendance:create', 'school')],
      schema: {
        tags: att,
        summary: 'Bulk-mark staff attendance for a day (HR) — idempotent upsert',
        description: 'School scope only. Not for future dates, non-working days or holidays. Audited.',
        body: staffAttendanceMarkBody,
        response: { 200: staffAttendanceMarkResponse },
      },
    },
    async (req) => svc.markStaffAttendance(ctxOf(req), req.body),
  );

  app.patch(
    '/staff-attendance/:id',
    { preHandler: [requirePerm('staff_attendance:edit', 'school')], schema: { tags: att, summary: 'Correct one staff attendance record (HR)', params: idParam, body: staffAttendanceUpdateBody, response: { 200: staffAttendanceRecord } } },
    async (req) => svc.updateStaffRecord(ctxOf(req), req.params.id, req.body),
  );

  app.post(
    '/staff-attendance/check-in',
    {
      preHandler: [requirePerm('staff_attendance:create')],
      schema: {
        tags: att,
        summary: 'Check in for today (self-service)',
        description: 'Records the current school time; later than 10 minutes after the first period starts → `late`. 409 `ALREADY_CHECKED_IN` / `ALREADY_MARKED` (HR already recorded the day).',
        response: { 200: staffAttendanceRecord },
      },
    },
    async (req) => svc.checkIn(ctxOf(req)),
  );

  app.post(
    '/staff-attendance/check-out',
    { preHandler: [requirePerm('staff_attendance:create')], schema: { tags: att, summary: 'Check out for today (self-service)', description: '409 `NOT_CHECKED_IN` / `ALREADY_CHECKED_OUT`.', response: { 200: staffAttendanceRecord } } },
    async (req) => svc.checkOut(ctxOf(req)),
  );

  app.get(
    '/staff-attendance/me',
    { preHandler: [requirePerm('staff_attendance:view')], schema: { tags: att, summary: 'My own attendance (today + history, default last 30 days)', querystring: attendanceRangeQuery, response: { 200: staffAttendanceMineResponse } } },
    async (req) => svc.myStaffAttendance(ctxOf(req), req.query),
  );

  app.get(
    '/staff-attendance/summary',
    {
      preHandler: [requirePerm('staff_attendance:view', 'school')],
      schema: { tags: att, summary: 'Staff attendance summary per person over a range (default: this month)', querystring: staffAttendanceSummaryQuery, response: { 200: staffAttendanceSummaryResponse } },
    },
    async (req) => svc.staffSummary(ctxOf(req), req.query),
  );

  app.get(
    '/staff-attendance/export',
    {
      preHandler: [requirePerm('staff_attendance:export', 'school')],
      schema: { tags: att, summary: 'CSV export of staff attendance (max 93 days)', querystring: attendanceExportQuery.pick({ from: true, to: true }), response: { 200: z.string().meta({ description: 'text/csv' }) } },
    },
    async (req, reply) => {
      const stream = await csvStream(['Date', 'Employee id', 'Name', 'Department', 'Status', 'Check in', 'Check out', 'Note'], svc.exportStaffRows(ctxOf(req), req.query));
      return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="staff-attendance-${req.query.from}-to-${req.query.to}.csv"`).send(stream as unknown as string);
    },
  );

  // ── staff leave ───────────────────────────────────────────────────────────────────

  app.post(
    '/staff-leave',
    {
      preHandler: [requirePerm('staff_leave:create')],
      schema: {
        tags: lv,
        summary: 'Apply for my own leave',
        description: 'Max 60 days, may start up to 30 days back, must include a school day, no overlap with a pending/approved request. HR/principal approvers are notified.',
        body: staffLeaveCreateBody,
        response: { 201: staffLeaveItem },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.createStaffLeave(ctxOf(req), req.body)),
  );

  app.get(
    '/staff-leave',
    {
      preHandler: [requirePerm('staff_leave:view')],
      schema: { tags: lv, summary: 'Staff leave requests (own; school scope sees everyone’s), pending first', querystring: staffLeaveListQuery, response: { 200: staffLeaveListResponse } },
    },
    async (req) => {
      const { rows, total } = await svc.listStaffLeave(ctxOf(req), req.query);
      return paged(rows, total, req.query);
    },
  );

  app.get(
    '/staff-leave/balance',
    {
      preHandler: [requirePerm('staff_leave:view')],
      schema: { tags: lv, summary: 'Leave taken and pending this academic year, in school days per type (own; school scope may pass staffId)', querystring: staffLeaveBalanceQuery, response: { 200: staffLeaveBalanceResponse } },
    },
    async (req) => svc.staffLeaveBalance(ctxOf(req), req.query.staffId),
  );

  app.get('/staff-leave/:id', { preHandler: [requirePerm('staff_leave:view')], schema: { tags: lv, summary: 'One staff leave request (others’ → 404)', params: idParam, response: { 200: staffLeaveItem } } }, async (req) => svc.getStaffLeaveOr404(ctxOf(req), req.params.id));

  app.post(
    '/staff-leave/:id/approve',
    {
      preHandler: [requirePerm('staff_leave:approve', 'school')],
      schema: {
        tags: lv,
        summary: 'Approve a staff leave request (HR / principal)',
        description: 'Not your own (403 `SELF_APPROVAL`). Marks `leave` in the staff register for school days up to today that were not already checked in; the applicant is notified (`leave.decided`). Audited.',
        params: idParam,
        body: leaveDecisionBody.default({}),
        response: { 200: staffLeaveItem },
      },
    },
    async (req) => svc.decideStaffLeave(ctxOf(req), req.params.id, 'approved', req.body.note),
  );

  app.post(
    '/staff-leave/:id/reject',
    { preHandler: [requirePerm('staff_leave:approve', 'school')], schema: { tags: lv, summary: 'Reject a staff leave request (a note is required)', params: idParam, body: leaveDecisionBody.default({}), response: { 200: staffLeaveItem } } },
    async (req) => svc.decideStaffLeave(ctxOf(req), req.params.id, 'rejected', req.body.note),
  );

  app.post(
    '/staff-leave/:id/cancel',
    { preHandler: [requireAnyPerm('staff_leave:create', 'staff_leave:edit')], schema: { tags: lv, summary: 'Cancel my pending leave request', params: idParam, response: { 200: staffLeaveItem } } },
    async (req) => svc.cancelStaffLeave(ctxOf(req), req.params.id),
  );
};

export default routes;
