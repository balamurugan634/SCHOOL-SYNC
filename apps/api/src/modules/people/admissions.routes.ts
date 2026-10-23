import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { admissionCreateBody, admissionEnrollBody, admissionEnrollOut, admissionListOut, admissionListQuery, admissionOut, admissionStatusBody, admissionUpdateBody, idParam, myProfileOut, myProfileUpdateBody } from '@school-sync/shared';
import { forbidden } from '../../core/errors';
import { requireAnyPerm, requireAuth, requirePerm } from '../../plugins/guards';
import { prepareCredential } from './accounts';
import { changeAdmissionStatus, createAdmission, enrollAdmission, getAdmission, listAdmissions, updateAdmission } from './admissions';
import { ctxOf, metaOf } from './http';
import { getMyProfile, updateMyProfile } from './profile';
import { refreshPrincipals } from './util';

const routes: FastifyPluginAsyncZod = async (app) => {
  const tag = ['Admissions'];

  app.get('/admissions', { preHandler: [requirePerm('admissions:view', 'school')], schema: { tags: tag, summary: 'Applications, newest first (filter by status, grade, year; search by name / application no / guardian)', querystring: admissionListQuery, response: { 200: admissionListOut } } }, async (req) => {
    const { rows, total } = await listAdmissions(req.db, req.query);
    return { data: rows, meta: metaOf(req.query, total) };
  });

  app.get('/admissions/:id', { preHandler: [requirePerm('admissions:view', 'school')], schema: { tags: tag, summary: 'One application', params: idParam, response: { 200: admissionOut } } }, async (req) => getAdmission(req.db, req.params.id));

  app.post('/admissions', { preHandler: [requirePerm('admissions:create', 'school')], schema: { tags: tag, summary: 'Staff enters an application (status: submitted)', body: admissionCreateBody, response: { 201: admissionOut } } }, async (req, reply) => {
    const id = await req.db.transaction((tx) => createAdmission(tx, ctxOf(req), req.body));
    return reply.status(201).send(await getAdmission(req.db, id));
  });

  app.patch('/admissions/:id', { preHandler: [requirePerm('admissions:edit', 'school')], schema: { tags: tag, summary: 'Edit an application that is not yet enrolled or rejected (documents are uploaded file ids)', params: idParam, body: admissionUpdateBody, response: { 200: admissionOut } } }, async (req) => {
    await req.db.transaction((tx) => updateAdmission(tx, ctxOf(req), req.params.id, req.body));
    return getAdmission(req.db, req.params.id);
  });

  app.post(
    '/admissions/:id/status',
    {
      preHandler: [requireAnyPerm('admissions:edit', 'admissions:approve')],
      schema: { tags: tag, summary: 'Move an application along: submitted → under_review → waitlisted | accepted | rejected. Review needs admissions:edit, decisions need admissions:approve', params: idParam, body: admissionStatusBody, response: { 200: admissionOut } },
    },
    async (req) => {
      await req.db.transaction((tx) => changeAdmissionStatus(tx, ctxOf(req), req.params.id, req.body));
      return getAdmission(req.db, req.params.id);
    },
  );

  app.post(
    '/admissions/:id/enroll',
    {
      preHandler: [requirePerm('admissions:approve', 'school')],
      schema: { tags: tag, summary: 'Enrol an accepted application: student + login, parent (new or the registered one with that phone) + link, enrollment in the current year — one transaction, seat-checked. Passwords are returned once', params: idParam, body: admissionEnrollBody, response: { 200: admissionEnrollOut } },
    },
    async (req) => {
      const ctx = ctxOf(req);
      if (!ctx.principal.can('students:create', 'school')) throw forbidden();
      const prepared = { student: req.body.createStudentLogin ? await prepareCredential() : undefined, guardian: req.body.createParentLogin ? await prepareCredential() : undefined };
      const r = await req.db.transaction((tx) => enrollAdmission(tx, ctx, req.params.id, req.body, prepared));
      refreshPrincipals(req.tenant.id, r.userIds);
      return { admission: await getAdmission(req.db, req.params.id), studentId: r.studentId, admissionNo: r.admissionNo, guardianId: r.guardianId, guardianLinkVerified: r.guardianLinkVerified, credentials: r.credentials };
    },
  );

  // ── self-service ──
  const me = ['Profile'];
  app.get('/me/profile', { preHandler: [requireAuth], schema: { tags: me, summary: 'My contact details and emergency contacts (student: own, parent: each linked child, staff: own)', response: { 200: myProfileOut } } }, async (req) => getMyProfile(req.db, ctxOf(req)));

  app.patch(
    '/me/profile',
    { preHandler: [requireAuth], schema: { tags: me, summary: 'Update my phone, email (needs current password), address and emergency contacts. Names, birth date and medical details go through correction requests', body: myProfileUpdateBody, response: { 200: myProfileOut } } },
    async (req) => {
      const ctx = ctxOf(req);
      await req.db.transaction((tx) => updateMyProfile(tx, ctx, req.body));
      return getMyProfile(req.db, ctx);
    },
  );
};

export default routes;
