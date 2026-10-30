import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParam, meetingCancelBody, meetingCompleteBody, meetingConfirmBody, meetingDeclineBody, meetingItem, meetingListQuery, meetingRequestBody, meetingRescheduleBody, meetingTeacherOption, meetingTeachersQuery, paged } from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { paged as pagedResult } from '../../core/http';
import { requireAnyPerm, requirePerm } from '../../plugins/guards';
import { emptyBodyOk } from './common';
import * as svc from './meetings';

const tag = ['Meetings'];
const decideGuard = requireAnyPerm('meetings:edit', 'meetings:approve');

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/meetings',
    {
      preHandler: [requirePerm('meetings:view')],
      schema: {
        tags: tag,
        summary: 'Parent–teacher meetings I can see',
        description: 'Parents: their linked children’s meetings. Teachers: meetings addressed to them or for a section they lead. School-scope staff: all. Each item lists the `availableActions` for the caller.',
        querystring: meetingListQuery,
        response: { 200: paged(meetingItem) },
      },
    },
    async (req) => {
      const { items, total } = await svc.listMeetings(req.db, req.auth, req.query, req.tenant.id);
      return pagedResult(items, total, req.query);
    },
  );

  app.get(
    '/meetings/upcoming',
    { preHandler: [requirePerm('meetings:view')], schema: { tags: tag, summary: 'Upcoming confirmed meetings (soonest first) and requests still waiting for an answer', response: { 200: z.object({ data: z.array(meetingItem) }) } } },
    async (req) => ({ data: await svc.upcoming(req.db, req.auth, undefined, req.tenant.id) }),
  );

  app.get(
    '/meetings/teachers',
    {
      preHandler: [requirePerm('meetings:view')],
      schema: { tags: tag, summary: 'Teachers a parent can ask for a meeting about a child (class teacher + subject teachers)', querystring: meetingTeachersQuery, response: { 200: z.object({ data: z.array(meetingTeacherOption) }) } },
    },
    async (req) => ({ data: await svc.teacherOptions(req.db, req.auth, req.query.studentId) }),
  );

  app.post(
    '/meetings',
    {
      preHandler: [requirePerm('meetings:create')],
      schema: {
        tags: tag,
        summary: 'Request a meeting with a teacher of my child (parents)',
        description: 'The teacher must teach or lead the child’s section (see GET /meetings/teachers). Only one pending request per child and teacher. The teacher is notified (`meeting.requested`).',
        body: meetingRequestBody,
        response: { 201: meetingItem },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.requestMeeting(req.db, req.tenant, req.auth, actorOf(req), req.body)),
  );

  app.get('/meetings/:id', { preHandler: [requirePerm('meetings:view')], schema: { tags: tag, summary: 'One meeting', params: idParam, response: { 200: meetingItem } } }, async (req) => svc.getMeeting(req.db, req.auth, req.params.id, req.tenant.id));

  app.post(
    '/meetings/:id/confirm',
    {
      preHandler: [decideGuard],
      schema: {
        tags: tag,
        summary: 'Confirm a request with a time, mode and place (teacher / class teacher / office); the parent is notified (`meeting.confirmed`)',
        description: 'Mode `online` with a connected provider (`provider`, default: the school’s default provider) creates the Zoom / Google Meet meeting and puts its join link in `locationOrLink`; without a provider the teacher types the link. A provider failure never blocks the confirmation: `onlineMeeting.status` becomes `failed` and the room can be retried.',
        params: idParam,
        body: meetingConfirmBody,
        response: { 200: meetingItem },
      },
    },
    async (req) => svc.confirm(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.body, req.log),
  );

  app.post(
    '/meetings/:id/decline',
    { preHandler: [decideGuard], schema: { tags: tag, summary: 'Decline a request with a reason; the parent is notified (`meeting.declined`)', params: idParam, body: meetingDeclineBody, response: { 200: meetingItem } } },
    async (req) => svc.decline(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.body.reason),
  );

  app.post(
    '/meetings/:id/reschedule',
    { preHandler: [decideGuard], schema: { tags: tag, summary: 'Move a confirmed meeting to a new time (the teacher must be free); the parent is notified (`meeting.rescheduled`)', params: idParam, body: meetingRescheduleBody, response: { 200: meetingItem } } },
    async (req) => svc.reschedule(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.body, req.log),
  );

  app.post(
    '/meetings/:id/complete',
    { preHandler: [decideGuard], schema: { tags: tag, summary: 'Close a confirmed meeting with outcome notes', params: idParam, body: meetingCompleteBody, response: { 200: meetingItem } } },
    async (req) => svc.complete(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.body.outcomeNotes, req.log),
  );

  app.post(
    '/meetings/:id/cancel',
    {
      preValidation: [emptyBodyOk],
      preHandler: [requirePerm('meetings:view')],
      schema: { tags: tag, summary: 'Cancel a pending or confirmed meeting (the parent who asked, or the teacher / class teacher / office); the other side is notified (`meeting.cancelled`)', params: idParam, body: meetingCancelBody, response: { 200: meetingItem } },
    },
    async (req) => svc.cancel(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.body.reason, req.log),
  );

  app.post(
    '/meetings/:id/online-meeting/retry',
    {
      preHandler: [decideGuard],
      schema: {
        tags: tag,
        summary: 'Retry the meeting’s Zoom / Google Meet room after a failure (create, update or cancel at the provider)',
        description: 'Only while `onlineMeeting.status` is `failed`; 409 ONLINE_MEETING_NOT_FAILED otherwise. Failed rooms are also retried automatically every few minutes for a day.',
        params: idParam,
        response: { 200: meetingItem },
      },
    },
    async (req) => svc.retryOnline(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.log),
  );
};

export default routes;
