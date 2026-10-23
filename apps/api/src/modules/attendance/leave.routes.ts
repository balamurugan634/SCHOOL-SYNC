import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParam, leaveCreateBody, leaveDecisionBody, leaveItem, leaveListQuery, leaveListResponse } from '@school-sync/shared';
import { paged } from '../../core/http';
import { requireAnyPerm, requirePerm } from '../../plugins/guards';
import { ctxOf } from './common';
import * as svc from './leave.service';

const tag = ['Leave'];

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/leave',
    {
      preHandler: [requirePerm('leave:view')],
      schema: {
        tags: tag,
        summary: 'Student leave requests visible to me (pending first)',
        description: 'Students: their own; parents: their verified-linked children only (never other families); teachers: students of their classes; school scope: all. `from`/`to` select requests overlapping the range.',
        querystring: leaveListQuery,
        response: { 200: leaveListResponse },
      },
    },
    async (req) => {
      const { rows, total } = await svc.listLeave(ctxOf(req), req.query);
      return paged(rows, total, req.query);
    },
  );

  app.post(
    '/leave',
    {
      preHandler: [requirePerm('leave:create')],
      schema: {
        tags: tag,
        summary: 'Apply for leave for a student (parent for a linked child, or the student)',
        description:
          'Parents with several children must pass `studentId` (422 `STUDENT_REQUIRED`); a child that is not verified-linked is 404. Max 60 days, may start up to 30 days in the past, must include a school day (422 `NO_WORKING_DAYS`), ' +
          'must not overlap a pending/approved request (409 `LEAVE_OVERLAP`). The class teacher is notified.',
        body: leaveCreateBody,
        response: { 201: leaveItem },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.createLeave(ctxOf(req), req.body)),
  );

  app.get('/leave/:id', { preHandler: [requirePerm('leave:view')], schema: { tags: tag, summary: 'One leave request (out-of-scope → 404)', params: idParam, response: { 200: leaveItem } } }, async (req) => svc.getLeaveOr404(ctxOf(req), req.params.id));

  app.post(
    '/leave/:id/approve',
    {
      preHandler: [requirePerm('leave:approve')],
      schema: {
        tags: tag,
        summary: 'Approve a leave request',
        description:
          'The class teacher of the student’s section or a school-scope approver (other teachers: 403 `NOT_CLASS_TEACHER`). With `attendance.leaveMarksAttendance`, attendance is marked `leave` for the school days (existing roll calls updated; in daily mode drafts are created for days without one). ' +
          'Notifies the student and verified guardians (`leave.decided`). Audited.',
        params: idParam,
        body: leaveDecisionBody.default({}),
        response: { 200: leaveItem },
      },
    },
    async (req) => svc.decideLeave(ctxOf(req), req.params.id, 'approved', req.body.note),
  );

  app.post(
    '/leave/:id/reject',
    { preHandler: [requirePerm('leave:approve')], schema: { tags: tag, summary: 'Reject a leave request (a note is required)', params: idParam, body: leaveDecisionBody.default({}), response: { 200: leaveItem } } },
    async (req) => svc.decideLeave(ctxOf(req), req.params.id, 'rejected', req.body.note),
  );

  app.post(
    '/leave/:id/cancel',
    { preHandler: [requireAnyPerm('leave:create', 'leave:edit')], schema: { tags: tag, summary: 'Cancel my pending leave request', description: 'Only the person who applied, while it is pending.', params: idParam, response: { 200: leaveItem } } },
    async (req) => svc.cancelLeave(ctxOf(req), req.params.id),
  );
};

export default routes;
