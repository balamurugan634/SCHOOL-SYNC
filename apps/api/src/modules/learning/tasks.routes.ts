import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParam, okSchema, paged, taskCreateBody, taskItem, taskListQuery, tasksFeedQuery, tasksFeedResponse, taskUpdateBody } from '@school-sync/shared';
import { paged as pagedResult } from '../../core/http';
import { requirePerm } from '../../plugins/guards';
import * as svc from './tasks.service';

const tag = ['Tasks'];

/** Personal to-dos: strictly the caller’s own (someone else’s task id answers 404). Students only. */
const taskRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/tasks/feed',
    {
      preHandler: [requirePerm('tasks:view')],
      schema: {
        tags: tag,
        summary: '“My Tasks” feed: personal tasks + pending/overdue homework as virtual items, sorted by due date (undated last)',
        description: 'Each item has a `kind` (`task` | `homework`), `status`, `overdue` flag and a deep-link `route`.',
        querystring: tasksFeedQuery,
        response: { 200: tasksFeedResponse },
      },
    },
    async (req) => ({ data: await svc.tasksFeed(req.db, req.auth, req.query) }),
  );

  app.get(
    '/tasks',
    { preHandler: [requirePerm('tasks:view')], schema: { tags: tag, summary: 'My personal tasks', querystring: taskListQuery, response: { 200: paged(taskItem) } } },
    async (req) => {
      const { rows, total } = await svc.listTasks(req.db, req.tenant, req.auth, req.query);
      return pagedResult(rows, total, req.query);
    },
  );

  app.post(
    '/tasks',
    {
      preHandler: [requirePerm('tasks:create')],
      schema: { tags: tag, summary: 'Add a personal task (priority, due date, optional reminder → `tasks.reminder` notification)', body: taskCreateBody, response: { 201: taskItem } },
    },
    async (req, reply) => reply.status(201).send(await svc.createTask(req.db, req.auth, req.body)),
  );

  app.get('/tasks/:id', { preHandler: [requirePerm('tasks:view')], schema: { tags: tag, summary: 'One of my tasks', params: idParam, response: { 200: taskItem } } }, async (req) => svc.getTask(req.db, req.auth, req.params.id));

  app.patch(
    '/tasks/:id',
    { preHandler: [requirePerm('tasks:edit')], schema: { tags: tag, summary: 'Edit a task or change its status (todo | doing | done)', params: idParam, body: taskUpdateBody, response: { 200: taskItem } } },
    async (req) => svc.updateTask(req.db, req.auth, req.params.id, req.body),
  );

  app.delete(
    '/tasks/:id',
    { preHandler: [requirePerm('tasks:delete')], schema: { tags: tag, summary: 'Delete one of my tasks', params: idParam, response: { 200: okSchema } } },
    async (req) => {
      await svc.deleteTask(req.db, req.auth, req.params.id);
      return { ok: true as const };
    },
  );
};

export default taskRoutes;
