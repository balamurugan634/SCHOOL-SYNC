import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import admissionRoutes from './admissions.routes';
import guardianRoutes from './guardians.routes';
import staffRoutes from './staff.routes';
import studentRoutes from './students.routes';

/** People: students (+ guardian links, documents, import, corrections), guardians, staff, admissions, self-service profile. */
const routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(studentRoutes);
  await app.register(guardianRoutes);
  await app.register(staffRoutes);
  await app.register(admissionRoutes);
};

export default routes;
