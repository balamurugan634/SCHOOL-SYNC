import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  attendanceExportQuery,
  attendanceRangeQuery,
  attendanceRecordsQuery,
  attendanceRecordsResponse,
  attendanceSchoolSummaryQuery,
  attendanceSchoolSummaryResponse,
  attendanceSectionSummaryResponse,
  attendanceShortageScanResponse,
  attendanceStudentSummaryResponse,
  attendanceTodayResponse,
  uuid,
} from '@school-sync/shared';
import { forbidden } from '../../core/errors';
import { requireAuth, requirePerm } from '../../plugins/guards';
import { ctxOf } from './common';
import { csvStream } from './csv';
import * as views from './views.service';

const tag = ['Attendance'];
const studentParam = z.object({ studentId: uuid });
const sectionParam = z.object({ sectionId: uuid });

/** management: school scope on attendance approval or edit (principal, administrator, super admin) */
async function requireSchoolAttendanceAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply);
  if (!(req.auth.can('attendance:approve', 'school') || req.auth.can('attendance:edit', 'school'))) throw forbidden();
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/attendance/students/:studentId/summary',
    {
      preHandler: [requirePerm('attendance:view')],
      schema: {
        tags: tag,
        summary: 'A student’s attendance summary: counts, percentage, month-by-month, shortage flag',
        description:
          'Students: themselves; parents: verified-linked children; teachers: students of their classes; school scope: anyone. Anyone else is 404. ' +
          'Percentage = (present + late + ½·half_day) / (present + absent + late + half_day); approved `leave` days are excluded. `from`/`to` default to the academic year start / today. ' +
          '`shortage.isShort` compares with the school’s `attendance.shortagePercent`.',
        params: studentParam,
        querystring: attendanceRangeQuery,
        response: { 200: attendanceStudentSummaryResponse },
      },
    },
    async (req) => views.studentSummary(ctxOf(req), req.params.studentId, req.query),
  );

  app.get(
    '/attendance/students/:studentId/records',
    {
      preHandler: [requirePerm('attendance:view')],
      schema: {
        tags: tag,
        summary: 'A student’s attendance history (newest first, keyset pagination)',
        params: studentParam,
        querystring: attendanceRecordsQuery,
        response: { 200: attendanceRecordsResponse },
      },
    },
    async (req) => views.studentRecords(ctxOf(req), req.params.studentId, req.query),
  );

  app.get(
    '/attendance/sections/:sectionId/summary',
    {
      preHandler: [requirePerm('attendance:view')],
      schema: {
        tags: tag,
        summary: 'Section attendance over a date range: per-day counts and per-student percentages (staff)',
        description: 'Defaults to the last 30 days. Only submitted roll calls count. Teachers: their own sections; school scope: any.',
        params: sectionParam,
        querystring: attendanceRangeQuery,
        response: { 200: attendanceSectionSummaryResponse },
      },
    },
    async (req) => views.sectionSummary(ctxOf(req), req.params.sectionId, req.query),
  );

  app.get(
    '/attendance/summary',
    {
      preHandler: [requirePerm('attendance:view', 'school')],
      schema: {
        tags: tag,
        summary: 'School-wide attendance for a day (management dashboard)',
        description: 'Totals, % present, per-section table (marked or not), absentee list and a short trend. SQL aggregation over indexed columns — stays fast with hundreds of thousands of records.',
        querystring: attendanceSchoolSummaryQuery,
        response: { 200: attendanceSchoolSummaryResponse },
      },
    },
    async (req) => views.schoolSummary(ctxOf(req), req.query),
  );

  app.get(
    '/attendance/today',
    {
      preHandler: [requirePerm('attendance:view')],
      schema: {
        tags: tag,
        summary: 'Today’s attendance shaped for the role dashboards',
        description:
          'Teachers: the sections (daily mode) or period slots (period mode) I take attendance for today, with `marked` and `pendingCount` for the “not yet marked” list. ' +
          'Students/parents: today’s status per (linked) child. Management: school snapshot. Empty `items` on non-working days and holidays.',
        response: { 200: attendanceTodayResponse },
      },
    },
    async (req) => views.todayView(ctxOf(req)),
  );

  app.get(
    '/attendance/export',
    {
      preHandler: [requirePerm('attendance:export')],
      schema: {
        tags: tag,
        summary: 'CSV export of attendance records (max 93 days per file)',
        querystring: attendanceExportQuery,
        response: { 200: z.string().meta({ description: 'text/csv' }) },
      },
    },
    async (req, reply) => {
      const stream = await csvStream(['Date', 'Class', 'Section', 'Period', 'Roll no', 'Admission no', 'Student', 'Status', 'Remarks'], views.exportRows(ctxOf(req), req.query));
      return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="attendance-${req.query.from}-to-${req.query.to}.csv"`).send(stream as unknown as string);
    },
  );

  app.post(
    '/attendance/shortage-scan',
    {
      preHandler: [requireSchoolAttendanceAdmin],
      schema: {
        tags: tag,
        summary: 'Run the attendance shortage scan now (management)',
        description: 'Same scan as the daily job: students below `attendance.shortagePercent` since the academic year started get one alert per month (guardians notified, `attendance.shortage`). Safe to call repeatedly.',
        response: { 200: attendanceShortageScanResponse },
      },
    },
    async (req) => views.scanAttendanceShortage(req.tenant, req.db),
  );
};

export default routes;
