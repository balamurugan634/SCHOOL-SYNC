import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import homeworkRoutes from './homework.routes';
import materialRoutes from './materials.routes';
import taskRoutes from './tasks.routes';
import timetableRoutes from './timetable.routes';

/** Teaching & learning: /timetable, /homework, /submissions, /materials, /syllabus, /tasks. */
const routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(timetableRoutes);
  await app.register(homeworkRoutes);
  await app.register(materialRoutes);
  await app.register(taskRoutes);
};

export default routes;
