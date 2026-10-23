import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import library from './library-routes';
import transport from './transport-routes';

/** Operations: transport (`/transport/*`) and library (`/library/*`); each is gated by the school's feature flag. */
const routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(transport);
  await app.register(library);
};

export default routes;
