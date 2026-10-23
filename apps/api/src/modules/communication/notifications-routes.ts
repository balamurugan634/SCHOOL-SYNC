import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParam, notificationItem, notificationList, notificationListQuery, notificationPreferences, notificationPreferencesUpdateBody, notificationReadAllBody, notificationReadAllResponse, notificationTestResponse, notificationUnreadCount, okSchema } from '@school-sync/shared';
import { notFound } from '../../core/errors';
import { requirePerm } from '../../plugins/guards';
import { emptyBodyOk } from './common';
import * as inbox from './inbox';

const tag = ['Notifications'];

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/notifications',
    {
      preHandler: [requirePerm('notifications:view')],
      schema: { tags: tag, summary: 'My notification inbox (newest first, keyset pagination via `nextCursor`)', querystring: notificationListQuery, response: { 200: notificationList } },
    },
    async (req) => inbox.listInbox(req.db, req.auth.userId, req.query),
  );

  app.get(
    '/notifications/unread-count',
    { preHandler: [requirePerm('notifications:view')], schema: { tags: tag, summary: 'Number of unread notifications (for the app badge)', response: { 200: notificationUnreadCount } } },
    async (req) => ({ unread: await inbox.unreadCount(req.db, req.auth.userId) }),
  );

  app.post(
    '/notifications/read-all',
    {
      preValidation: [emptyBodyOk],
      preHandler: [requirePerm('notifications:edit')],
      schema: { tags: tag, summary: 'Mark all my notifications (optionally one category) as read', body: notificationReadAllBody, response: { 200: notificationReadAllResponse } },
    },
    async (req) => ({ updated: await inbox.markAllRead(req.db, req.auth.userId, req.body.category) }),
  );

  app.get(
    '/notifications/preferences',
    { preHandler: [requirePerm('notifications:view')], schema: { tags: tag, summary: 'My notification settings per category (push / email / quiet hours)', response: { 200: notificationPreferences } } },
    async (req) => inbox.getPreferences(req.db, req.tenant, req.auth.userId),
  );

  app.put(
    '/notifications/preferences',
    {
      preHandler: [requirePerm('notifications:edit')],
      schema: {
        tags: tag,
        summary: 'Change my notification settings (only the categories / fields sent are changed)',
        description: 'Quiet hours are school-local `HH:MM`: send both `quietFrom` and `quietTo`, or both `null` to use the school default; `quietFrom` = `quietTo` switches quiet hours off. Push for a category in quiet hours is held back and delivered when the window ends; high-priority (urgent) notifications ignore quiet hours but not an explicit `push: false`.',
        body: notificationPreferencesUpdateBody,
        response: { 200: notificationPreferences },
      },
    },
    async (req) => inbox.updatePreferences(req.db, req.tenant, req.auth.userId, req.body.preferences),
  );

  app.post(
    '/notifications/test',
    {
      preHandler: [requirePerm('notifications:edit')],
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { tags: tag, summary: 'Send a test push to my registered devices (5 per minute)', response: { 200: notificationTestResponse } },
    },
    async (req) => inbox.sendTest(req.db, req.tenant, req.auth.userId),
  );

  app.post(
    '/notifications/:id/read',
    { preHandler: [requirePerm('notifications:edit')], schema: { tags: tag, summary: 'Mark one notification as read', params: idParam, response: { 200: notificationItem } } },
    async (req) => {
      const n = await inbox.markRead(req.db, req.auth.userId, req.params.id);
      if (!n) throw notFound('Notification');
      return n;
    },
  );

  app.delete(
    '/notifications/:id',
    { preHandler: [requirePerm('notifications:edit')], schema: { tags: tag, summary: 'Delete one notification from my inbox', params: idParam, response: { 200: okSchema } } },
    async (req) => {
      if (!(await inbox.deleteOne(req.db, req.auth.userId, req.params.id))) throw notFound('Notification');
      return { ok: true as const };
    },
  );
};

export default routes;
