import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import leaveRoutes from './leave.routes';
import rollCallRoutes from './rollcall.routes';
import staffRoutes from './staff.routes';
import viewsRoutes from './views.routes';

/**
 * Attendance & leave: /attendance/* (roll call, corrections, summaries, export, shortage scan), /leave/* (student leave),
 * /staff-attendance/*, /staff-leave/*. Logic lives in the *.service.ts files; see docs/CONVENTIONS.md.
 */
const routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(rollCallRoutes);
  await app.register(viewsRoutes);
  await app.register(leaveRoutes);
  await app.register(staffRoutes);
};

export default routes;
