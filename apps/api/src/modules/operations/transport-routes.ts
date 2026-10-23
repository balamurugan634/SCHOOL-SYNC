import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idParam,
  okSchema,
  paged,
  transportAllocation,
  transportAllocationBody,
  transportAllocationQuery,
  transportManifest,
  transportMyBusItem,
  transportPickup,
  transportRoute,
  transportRouteCreateBody,
  transportRouteDetail,
  transportRouteListQuery,
  transportRouteUpdateBody,
  transportStopCreateBody,
  transportStopOrderBody,
  transportStopUpdateBody,
  transportVehicle,
  transportVehicleCreateBody,
  transportVehicleListQuery,
  transportVehicleUpdateBody,
  uuid,
} from '@school-sync/shared';
import type { PermissionKey } from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { paged as pagedResult } from '../../core/http';
import { requirePerm } from '../../plugins/guards';
import { requireFeature } from './feature';
import * as svc from './transport';

const tag = ['Transport'];
/** management routes: transport permission at school scope, and the school must have transport enabled */
const staffOnly = (perm: PermissionKey) => [requirePerm(perm, 'school'), requireFeature('transport')];
const studentParam = z.object({ studentId: uuid });

const routes: FastifyPluginAsyncZod = async (app) => {
  // ── vehicles ──
  app.get('/transport/vehicles', { preHandler: staffOnly('transport:view'), schema: { tags: tag, summary: 'Vehicles (with insurance status: valid / expiring within 30 days / expired)', querystring: transportVehicleListQuery, response: { 200: paged(transportVehicle) } } }, async (req) => {
    const { items, total } = await svc.listVehicles(req.db, req.tenant, req.query);
    return pagedResult(items, total, req.query);
  });
  app.post('/transport/vehicles', { preHandler: staffOnly('transport:create'), schema: { tags: tag, summary: 'Add a vehicle', body: transportVehicleCreateBody, response: { 201: transportVehicle } } }, async (req, reply) =>
    reply.status(201).send(await svc.createVehicle(req.db, req.tenant, actorOf(req), req.body)),
  );
  app.patch('/transport/vehicles/:id', { preHandler: staffOnly('transport:edit'), schema: { tags: tag, summary: 'Edit a vehicle (driver, insurance, capacity …)', params: idParam, body: transportVehicleUpdateBody, response: { 200: transportVehicle } } }, async (req) =>
    svc.updateVehicle(req.db, req.tenant, actorOf(req), req.params.id, req.body),
  );
  app.delete('/transport/vehicles/:id', { preHandler: staffOnly('transport:delete'), schema: { tags: tag, summary: 'Take a vehicle out of service (409 while an active route uses it)', params: idParam, response: { 200: transportVehicle } } }, async (req) =>
    svc.retireVehicle(req.db, req.tenant, actorOf(req), req.params.id),
  );

  // ── routes & stops ──
  app.get('/transport/routes', { preHandler: staffOnly('transport:view'), schema: { tags: tag, summary: 'Routes with vehicle, stop count, students on board and seats left', querystring: transportRouteListQuery, response: { 200: paged(transportRoute) } } }, async (req) => {
    const { items, total } = await svc.listRoutes(req.db, req.query);
    return pagedResult(items, total, req.query);
  });
  app.post('/transport/routes', { preHandler: staffOnly('transport:create'), schema: { tags: tag, summary: 'Create a route', body: transportRouteCreateBody, response: { 201: transportRouteDetail } } }, async (req, reply) =>
    reply.status(201).send(await svc.createRoute(req.db, actorOf(req), req.body)),
  );
  app.get('/transport/routes/:id', { preHandler: staffOnly('transport:view'), schema: { tags: tag, summary: 'A route with its ordered stops', params: idParam, response: { 200: transportRouteDetail } } }, async (req) => svc.routeDetail(req.db, req.params.id));
  app.patch('/transport/routes/:id', { preHandler: staffOnly('transport:edit'), schema: { tags: tag, summary: 'Edit a route (name, vehicle, start times); the vehicle must seat the students already on it', params: idParam, body: transportRouteUpdateBody, response: { 200: transportRouteDetail } } }, async (req) =>
    svc.updateRoute(req.db, actorOf(req), req.params.id, req.body),
  );
  app.delete('/transport/routes/:id', { preHandler: staffOnly('transport:delete'), schema: { tags: tag, summary: 'Take a route out of service (409 while students are allocated)', params: idParam, response: { 200: transportRouteDetail } } }, async (req) =>
    svc.updateRoute(req.db, actorOf(req), req.params.id, { isActive: false }),
  );
  app.post('/transport/routes/:id/stops', { preHandler: staffOnly('transport:edit'), schema: { tags: tag, summary: 'Add a stop (appended, or inserted at `ordinal`)', params: idParam, body: transportStopCreateBody, response: { 201: transportRouteDetail } } }, async (req, reply) =>
    reply.status(201).send(await svc.createStop(req.db, actorOf(req), req.params.id, req.body)),
  );
  app.put('/transport/routes/:id/stops/order', { preHandler: staffOnly('transport:edit'), schema: { tags: tag, summary: 'Reorder the stops: send every stop id of the route in driving order', params: idParam, body: transportStopOrderBody, response: { 200: transportRouteDetail } } }, async (req) =>
    svc.reorderStops(req.db, actorOf(req), req.params.id, req.body.stopIds),
  );
  app.patch('/transport/stops/:id', { preHandler: staffOnly('transport:edit'), schema: { tags: tag, summary: 'Edit a stop (name, times, location, fee)', params: idParam, body: transportStopUpdateBody, response: { 200: transportRouteDetail } } }, async (req) =>
    svc.updateStop(req.db, actorOf(req), req.params.id, req.body),
  );
  app.delete('/transport/stops/:id', { preHandler: staffOnly('transport:edit'), schema: { tags: tag, summary: 'Delete a stop nobody boards at', params: idParam, response: { 200: transportRouteDetail } } }, async (req) => svc.deleteStop(req.db, actorOf(req), req.params.id));
  app.get('/transport/routes/:id/manifest', { preHandler: staffOnly('transport:view'), schema: { tags: tag, summary: 'Route manifest: every student per stop in driving order', params: idParam, response: { 200: transportManifest } } }, async (req) => svc.manifest(req.db, req.params.id));

  // ── allocation ──
  app.get('/transport/allocations', { preHandler: staffOnly('transport:view'), schema: { tags: tag, summary: 'Students using the bus (filter by route, stop, student or name)', querystring: transportAllocationQuery, response: { 200: paged(transportAllocation) } } }, async (req) => {
    const { items, total } = await svc.listAllocations(req.db, req.query);
    return pagedResult(items, total, req.query);
  });
  app.put(
    '/transport/students/:studentId',
    {
      preHandler: staffOnly('transport:edit'),
      schema: { tags: tag, summary: 'Put a student on a route / stop (or move them)', description: '409 ROUTE_FULL when the route’s vehicle has no free seat; 422 STOP_NOT_ON_ROUTE, ROUTE_INACTIVE, STUDENT_NOT_ACTIVE.', params: studentParam, body: transportAllocationBody, response: { 200: transportAllocation } },
    },
    async (req) => svc.assignStudent(req.db, req.auth, actorOf(req), req.params.studentId, req.body),
  );
  app.delete('/transport/students/:studentId', { preHandler: staffOnly('transport:edit'), schema: { tags: tag, summary: 'Take a student off the bus', params: studentParam, response: { 200: okSchema } } }, async (req) => {
    await svc.unassignStudent(req.db, req.auth, actorOf(req), req.params.studentId);
    return { ok: true as const };
  });

  // ── learners & parents ──
  app.get(
    '/transport/my-bus',
    {
      preHandler: [requirePerm('transport:view'), requireFeature('transport')],
      schema: {
        tags: tag,
        summary: 'My bus: route, stop, pickup / drop times and driver / attendant contact',
        description: 'Students: themselves. Parents: each verified linked child (`allocated: false` when the child has no bus). Management gets an empty list (use /transport/routes). Driver contact is only returned here, for own / linked children.',
        response: { 200: z.object({ data: z.array(transportMyBusItem) }) },
      },
    },
    async (req) => ({ data: await svc.myBus(req.db, req.auth) }),
  );
  app.get(
    '/transport/students/:studentId/authorized-pickups',
    {
      preHandler: [requirePerm('transport:view'), requireFeature('transport')],
      schema: { tags: tag, summary: 'Authorised pickup persons recorded for a student (read-through; own / linked / school scope)', params: studentParam, response: { 200: z.object({ data: z.array(transportPickup) }) } },
    },
    async (req) => ({ data: await svc.authorizedPickups(req.db, req.auth, req.params.studentId) }),
  );
};

export default routes;
