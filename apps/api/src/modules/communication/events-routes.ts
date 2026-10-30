import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { calendarQuery, calendarResponse, eventChildResponse, eventCreateBody, eventItem, eventListQuery, eventRespondBody, eventResponseRow, eventResponsesQuery, eventUpdateBody, idParam, okSchema, ONLINE_PROVIDERS, onlineProvidersOut, paged } from '@school-sync/shared';
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/audit';
import { paged as pagedResult } from '../../core/http';
import { defaultProvider, runCleanup, syncOnline, usableProviders } from '../../core/online-meetings';
import { requireAnyPerm, requirePerm } from '../../plugins/guards';
import { events } from '../../db/tenant/schema';
import { eq } from 'drizzle-orm';
import { calendarFeed } from './calendar';
import * as svc from './events';

const tag = ['Events'];

/** Create / update / cancel the event's Zoom or Google Meet meeting after the change has been saved. Never throws: a provider failure is recorded on the event. */
const syncEvent = (req: FastifyRequest, id: string) => syncOnline(req.tenant, req.db, 'event', id, { actor: actorOf(req), log: req.log });

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

  app.get(
    '/events/online-providers',
    {
      preHandler: [requireAnyPerm('events:create', 'events:edit', 'meetings:edit', 'meetings:approve')],
      schema: {
        tags: tag,
        summary: 'Zoom / Google Meet providers the school has connected and switched on (what an event or meeting form may offer), and its default',
        response: { 200: onlineProvidersOut },
      },
    },
    async (req) => {
      const usable = await usableProviders(req.db);
      return { providers: ONLINE_PROVIDERS.filter((p) => usable.includes(p)), defaultProvider: await defaultProvider(req.db) };
    },
  );

  app.post(
    '/events',
    {
      preHandler: [requirePerm('events:create')],
      schema: {
        tags: tag,
        summary: 'Create an event / holiday / PTM / sports day (draft, or published at once with `publish: true`)',
        description: 'Teachers (assigned scope) may only address sections they lead or teach. `registrationRequired` asks parents for going / not going per child; `consentRequired` (with `consentText`) asks for permission per child. `capacity` limits positive answers; `registrationDeadline` closes answers. `onlineMeeting: { provider: "zoom" | "google" }` adds a Zoom / Google Meet meeting (needs a start and end time on ONE day and a connected provider; created when the event is published, updated when the day, time or title change, cancelled with the event). A provider failure never blocks saving: the event answers with `onlineMeeting.status = "failed"` and can be retried.',
        body: eventCreateBody,
        response: { 201: eventItem },
      },
    },
    async (req, reply) => {
      const created = await svc.createEvent(req.db, req.tenant, req.auth, actorOf(req), req.body);
      if (created.notify) {
        await syncEvent(req, created.id);
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
      await syncEvent(req, req.params.id);
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
      await syncEvent(req, ev.id);
      await svc.announceEvent(req.db, req.tenant, ev, req.auth.userId, 'new').catch((e) => req.log.error({ err: e }, 'event fan-out failed'));
      return svc.getEvent(req.db, req.tenant, req.auth, ev.id);
    },
  );

  app.post(
    '/events/:id/cancel',
    { preHandler: [requirePerm('events:edit')], schema: { tags: tag, summary: 'Cancel an event (kept on the calendar as cancelled; the audience is notified)', params: idParam, response: { 200: eventItem } } },
    async (req) => {
      const ev = await svc.cancelEvent(req.db, req.auth, actorOf(req), req.params.id);
      await syncEvent(req, ev.id);
      await svc.announceEvent(req.db, req.tenant, ev, req.auth.userId, 'cancelled').catch((e) => req.log.error({ err: e }, 'event fan-out failed'));
      return svc.getEvent(req.db, req.tenant, req.auth, ev.id);
    },
  );

  app.delete(
    '/events/:id',
    { preHandler: [requireAnyPerm('events:delete', 'events:edit')], schema: { tags: tag, summary: 'Delete a draft event (or, with events:delete, a published one that has no responses)', params: idParam, response: { 200: okSchema } } },
    async (req) => {
      const cleanup = await svc.deleteEvent(req.db, req.auth, actorOf(req), req.params.id);
      if (cleanup) await runCleanup(req.tenant, req.db); // cancels the event's online meeting; the background job repeats it if the provider is down
      return { ok: true as const };
    },
  );

  app.post(
    '/events/:id/online-meeting/retry',
    {
      preHandler: [requirePerm('events:edit')],
      schema: {
        tags: tag,
        summary: 'Retry the event’s online meeting after a failure (create, update or cancel at Zoom / Google Meet)',
        description: 'Only while `onlineMeeting.status` is `failed`; 409 ONLINE_MEETING_NOT_FAILED otherwise. The result (success or a new safe error) is in the returned event. Failed meetings are also retried automatically every few minutes for a day.',
        params: idParam,
        response: { 200: eventItem },
      },
    },
    async (req) => {
      await svc.retryOnline(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.log);
      return svc.getEvent(req.db, req.tenant, req.auth, req.params.id);
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
