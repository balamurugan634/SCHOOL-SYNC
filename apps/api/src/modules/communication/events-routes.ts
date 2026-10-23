import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { calendarQuery, calendarResponse, eventChildResponse, eventCreateBody, eventItem, eventListQuery, eventRespondBody, eventResponseRow, eventResponsesQuery, eventUpdateBody, idParam, okSchema, paged } from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { paged as pagedResult } from '../../core/http';
import { requireAnyPerm, requirePerm } from '../../plugins/guards';
import { events } from '../../db/tenant/schema';
import { eq } from 'drizzle-orm';
import { calendarFeed } from './calendar';
import * as svc from './events';

const tag = ['Events'];

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/events',
    {
      preHandler: [requirePerm('events:view')],
      schema: {
        tags: tag,
        summary: 'Events & holidays I can see',
        description: 'Events whose audience includes me (published or cancelled), plus drafts I created; school-scope editors also see every draft. Without `from`/`to` only upcoming and ongoing events are listed. For events that ask for registration or consent, `children` lists the caller’s children with their answer so far.',
        querystring: eventListQuery,
        response: { 200: paged(eventItem) },
      },
    },
    async (req) => {
      const { items, total } = await svc.listEvents(req.db, req.tenant, req.auth, req.query);
      return pagedResult(items, total, req.query);
    },
  );

  app.post(
    '/events',
    {
      preHandler: [requirePerm('events:create')],
      schema: {
        tags: tag,
        summary: 'Create an event / holiday / PTM / sports day (draft, or published at once with `publish: true`)',
        description: 'Teachers (assigned scope) may only address sections they lead or teach. `registrationRequired` asks parents for going / not going per child; `consentRequired` (with `consentText`) asks for permission per child. `capacity` limits positive answers; `registrationDeadline` closes answers.',
        body: eventCreateBody,
        response: { 201: eventItem },
      },
    },
    async (req, reply) => {
      const created = await svc.createEvent(req.db, req.tenant, req.auth, actorOf(req), req.body);
      if (created.notify) {
        const [ev] = await req.db.select().from(events).where(eq(events.id, created.id)).limit(1);
        if (ev) await svc.announceEvent(req.db, req.tenant, ev, req.auth.userId, 'new').catch((e) => req.log.error({ err: e }, 'event fan-out failed'));
      }
      return reply.status(201).send(await svc.getEvent(req.db, req.tenant, req.auth, created.id));
    },
  );

  app.get('/events/:id', { preHandler: [requirePerm('events:view')], schema: { tags: tag, summary: 'One event (with response counts for its organisers)', params: idParam, response: { 200: eventItem } } }, async (req) => svc.getEvent(req.db, req.tenant, req.auth, req.params.id));

  app.patch(
    '/events/:id',
    { preHandler: [requirePerm('events:edit')], schema: { tags: tag, summary: 'Edit an event (creator, or school-scope editor); changed date / time / place of a published event notifies the audience', params: idParam, body: eventUpdateBody, response: { 200: eventItem } } },
    async (req) => {
      const r = await svc.updateEvent(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.body);
      if (r.notifyChange) {
        const [ev] = await req.db.select().from(events).where(eq(events.id, req.params.id)).limit(1);
        if (ev) await svc.announceEvent(req.db, req.tenant, ev, req.auth.userId, 'updated').catch((e) => req.log.error({ err: e }, 'event fan-out failed'));
      }
      return svc.getEvent(req.db, req.tenant, req.auth, req.params.id);
    },
  );

  app.post(
    '/events/:id/publish',
    { preHandler: [requirePerm('events:publish')], schema: { tags: tag, summary: 'Publish a draft event and notify its audience (`event.new`)', params: idParam, response: { 200: eventItem } } },
    async (req) => {
      const ev = await svc.publishEvent(req.db, req.auth, actorOf(req), req.params.id);
      await svc.announceEvent(req.db, req.tenant, ev, req.auth.userId, 'new').catch((e) => req.log.error({ err: e }, 'event fan-out failed'));
      return svc.getEvent(req.db, req.tenant, req.auth, ev.id);
    },
  );

  app.post(
    '/events/:id/cancel',
    { preHandler: [requirePerm('events:edit')], schema: { tags: tag, summary: 'Cancel an event (kept on the calendar as cancelled; the audience is notified)', params: idParam, response: { 200: eventItem } } },
    async (req) => {
      const ev = await svc.cancelEvent(req.db, req.auth, actorOf(req), req.params.id);
      await svc.announceEvent(req.db, req.tenant, ev, req.auth.userId, 'cancelled').catch((e) => req.log.error({ err: e }, 'event fan-out failed'));
      return svc.getEvent(req.db, req.tenant, req.auth, ev.id);
    },
  );

  app.delete(
    '/events/:id',
    { preHandler: [requireAnyPerm('events:delete', 'events:edit')], schema: { tags: tag, summary: 'Delete a draft event (or, with events:delete, a published one that has no responses)', params: idParam, response: { 200: okSchema } } },
    async (req) => {
      await svc.deleteEvent(req.db, req.auth, actorOf(req), req.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/events/:id/respond',
    {
      preHandler: [requirePerm('event_responses:create')],
      schema: {
        tags: tag,
        summary: 'Register for an event / give or deny consent, for one child (own child for students, linked child for parents)',
        description: 'Registration events accept `going` / `not_going`; consent events accept `consent_given` / `consent_denied` (parents only). Answers can be changed until the deadline. Errors: 409 EVENT_FULL, REGISTRATION_CLOSED, EVENT_ENDED, EVENT_CANCELLED; 422 NO_RESPONSE_REQUIRED, RESPONSE_NOT_ALLOWED.',
        params: idParam,
        body: eventRespondBody,
        response: { 200: eventChildResponse },
      },
    },
    async (req) => svc.respond(req.db, req.tenant, req.auth, req.params.id, req.body),
  );

  app.get(
    '/events/:id/responses',
    {
      preHandler: [requireAnyPerm('events:edit', 'events:create')],
      schema: { tags: tag, summary: 'Organisers: answers per child (`response=pending` lists children who have not answered)', params: idParam, querystring: eventResponsesQuery, response: { 200: paged(eventResponseRow) } },
    },
    async (req) => {
      const { items, total } = await svc.listResponses(req.db, req.auth, req.params.id, req.query);
      return pagedResult(items, total, req.query);
    },
  );

  app.get(
    '/calendar',
    {
      preHandler: [requireAnyPerm('events:view', 'exams:view', 'homework:view')],
      schema: {
        tags: tag,
        summary: 'Calendar feed: events, holidays, exam papers and homework due dates for me (max 100 days)',
        description: 'Each item has a `kind`: holiday | event | ptm | sports | exam | other (school events), exam_paper (grade of the student / children; exams that are no longer drafts), homework_due (published homework of my sections). Parents can pass `studentId` to narrow exam papers and homework to one child.',
        querystring: calendarQuery,
        response: { 200: calendarResponse },
      },
    },
    async (req) => ({ from: req.query.from, to: req.query.to, data: await calendarFeed(req.db, req.tenant, req.auth, req.query) }),
  );
};

export default routes;
