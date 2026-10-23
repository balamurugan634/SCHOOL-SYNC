import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  announcementCreateBody,
  announcementItem,
  announcementListQuery,
  announcementManageQuery,
  announcementRecipient,
  announcementRecipientsQuery,
  announcementScheduleBody,
  announcementStats,
  announcementUnreadCount,
  announcementUpdateBody,
  idParam,
  isoDateTime,
  okSchema,
  paged,
  uuid,
} from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { paged as pagedResult } from '../../core/http';
import { requireAnyPerm, requirePerm } from '../../plugins/guards';
import * as svc from './announcements';

const tag = ['Announcements'];
const item = announcementItem;
const receipt = z.object({ announcementId: uuid, readAt: isoDateTime, ackedAt: isoDateTime.nullable() });
const ackReceipt = z.object({ announcementId: uuid, readAt: isoDateTime, ackedAt: isoDateTime });
const manageGuard = requireAnyPerm('announcements:create', 'announcements:edit');

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/announcements',
    {
      preHandler: [requirePerm('announcements:view')],
      schema: {
        tags: tag,
        summary: 'My announcements',
        description: 'Published, not-expired announcements whose audience includes me (students: their user type / role / grade / section; parents: their verified children’s grades / sections and the parent audience; staff: by role / user type). Each item carries my read / acknowledged flags.',
        querystring: announcementListQuery,
        response: { 200: paged(item) },
      },
    },
    async (req) => {
      const { items, total } = await svc.listFeed(req.db, req.auth, req.query);
      return pagedResult(items, total, req.query);
    },
  );

  app.get(
    '/announcements/unread-count',
    { preHandler: [requirePerm('announcements:view')], schema: { tags: tag, summary: 'Unread announcements and ones still waiting for my acknowledgement', response: { 200: announcementUnreadCount } } },
    async (req) => svc.unreadCounts(req.db, req.auth),
  );

  app.get(
    '/announcements/manage',
    {
      preHandler: [manageGuard],
      schema: {
        tags: tag,
        summary: 'Announcements I manage (authored by me; all of them with school-scope editing)',
        description: 'Includes drafts and scheduled ones, the audience, and read / acknowledged counts. Archived ones only with `state=archived`.',
        querystring: announcementManageQuery,
        response: { 200: paged(item) },
      },
    },
    async (req) => {
      const { items, total } = await svc.listManaged(req.db, req.auth, req.query);
      return pagedResult(items, total, req.query);
    },
  );

  app.post(
    '/announcements',
    {
      preHandler: [requirePerm('announcements:create')],
      schema: {
        tags: tag,
        summary: 'Create an announcement (saved as a draft; give `publishAt` to schedule it)',
        description: 'Teachers (announcements at "assigned" scope) may only address `section` targets for sections they lead or teach; anything else needs school scope. Upload attachments first with `POST /files` (purpose `announcement`) and pass their ids.',
        body: announcementCreateBody,
        response: { 201: item },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.createAnnouncement(req.db, req.auth, actorOf(req), req.body)),
  );

  app.get(
    '/announcements/:id',
    { preHandler: [requirePerm('announcements:view')], schema: { tags: tag, summary: 'One announcement (recipient, or its manager)', params: idParam, response: { 200: item } } },
    async (req) => svc.getVisible(req.db, req.auth, req.params.id),
  );

  app.patch(
    '/announcements/:id',
    {
      preHandler: [requirePerm('announcements:edit')],
      schema: { tags: tag, summary: 'Edit a draft (a published announcement can only change `expiresAt`)', params: idParam, body: announcementUpdateBody, response: { 200: item } },
    },
    async (req) => svc.updateAnnouncement(req.db, req.auth, actorOf(req), req.params.id, req.body),
  );

  app.post(
    '/announcements/:id/schedule',
    { preHandler: [requirePerm('announcements:publish')], schema: { tags: tag, summary: 'Schedule a draft: it is published automatically at `publishAt`', params: idParam, body: announcementScheduleBody, response: { 200: item } } },
    async (req) => svc.schedule(req.db, req.auth, actorOf(req), req.params.id, req.body.publishAt),
  );

  app.post(
    '/announcements/:id/unschedule',
    { preHandler: [requirePerm('announcements:publish')], schema: { tags: tag, summary: 'Take a scheduled announcement back to a plain draft', params: idParam, response: { 200: item } } },
    async (req) => svc.unschedule(req.db, req.auth, actorOf(req), req.params.id),
  );

  app.post(
    '/announcements/:id/publish',
    {
      preHandler: [requirePerm('announcements:publish')],
      schema: { tags: tag, summary: 'Publish a draft now and notify its audience (`announcement.new`)', params: idParam, response: { 200: item } },
    },
    async (req) => {
      const row = await req.db.transaction((tx) => svc.publishNow(tx, req.auth, actorOf(req), req.params.id));
      await svc.fanOut(req.db, req.tenant, row).catch((e) => req.log.error({ err: e, announcementId: row.id }, 'announcement fan-out failed'));
      return svc.getVisible(req.db, req.auth, row.id);
    },
  );

  app.post(
    '/announcements/:id/expire',
    { preHandler: [requirePerm('announcements:publish')], schema: { tags: tag, summary: 'End a published announcement now (it disappears from feeds and is archived shortly after)', params: idParam, response: { 200: item } } },
    async (req) => svc.expire(req.db, req.auth, actorOf(req), req.params.id),
  );

  app.post(
    '/announcements/:id/archive',
    { preHandler: [requireAnyPerm('announcements:edit', 'announcements:publish')], schema: { tags: tag, summary: 'Archive an announcement (history is kept)', params: idParam, response: { 200: item } } },
    async (req) => svc.archive(req.db, req.auth, actorOf(req), req.params.id),
  );

  app.delete(
    '/announcements/:id',
    {
      preHandler: [requireAnyPerm('announcements:delete', 'announcements:edit')],
      schema: { tags: tag, summary: 'Delete a draft (author), or archive a published announcement (announcements:delete)', params: idParam, response: { 200: okSchema } },
    },
    async (req) => {
      await svc.remove(req.db, req.auth, actorOf(req), req.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/announcements/:id/read',
    { preHandler: [requirePerm('announcements:view')], schema: { tags: tag, summary: 'Mark an announcement as read (idempotent)', params: idParam, response: { 200: receipt } } },
    async (req) => svc.markRead(req.db, req.auth, req.params.id),
  );

  app.post(
    '/announcements/:id/ack',
    { preHandler: [requirePerm('announcements:view')], schema: { tags: tag, summary: 'Acknowledge an announcement that asks for it (idempotent; also marks it read)', params: idParam, response: { 200: ackReceipt } } },
    async (req) => svc.acknowledge(req.db, req.auth, actorOf(req), req.params.id),
  );

  app.get(
    '/announcements/:id/stats',
    {
      preHandler: [manageGuard],
      schema: { tags: tag, summary: 'Delivery statistics: audience size, read, acknowledged — overall, by user type and by section', params: idParam, response: { 200: announcementStats } },
    },
    async (req) => svc.stats(req.db, req.auth, req.params.id),
  );

  app.get(
    '/announcements/:id/recipients',
    {
      preHandler: [manageGuard],
      schema: { tags: tag, summary: 'Who is in the audience, with read / acknowledged times (filter `unread` / `unacknowledged` to chase people)', params: idParam, querystring: announcementRecipientsQuery, response: { 200: paged(announcementRecipient) } },
    },
    async (req) => {
      const { items, total } = await svc.recipients(req.db, req.auth, req.params.id, req.query);
      return pagedResult(items, total, req.query);
    },
  );
};

export default routes;
