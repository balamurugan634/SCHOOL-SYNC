import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import announcements from './announcements-routes';
import events from './events-routes';
import meetings from './meetings-routes';
import notifications from './notifications-routes';

/** Communication: announcements, events & calendar, parent–teacher meetings, notification inbox & preferences. */
const routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(announcements);
  await app.register(events);
  await app.register(meetings);
  await app.register(notifications);
};

export default routes;
