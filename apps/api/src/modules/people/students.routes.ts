import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  correctionApproveBody,
  correctionCreateBody,
  correctionListOut,
  correctionListQuery,
  correctionOut,
  correctionRejectBody,
  guardianLinkOut,
  idParam,
  okSchema,
  studentCreateBody,
  studentCreateOut,
  studentDetailOut,
  studentDocumentCreateBody,
  studentDocumentOut,
  studentDocumentParam,
  studentGuardianLinkBody,
  studentGuardianParam,
  studentGuardianUpdateBody,
  studentImportBody,
  studentImportOut,
  studentListOut,
  studentListQuery,
  studentMoveSectionBody,
  studentStatusBody,
  studentUpdateBody,
} from '@school-sync/shared';
import { z } from 'zod';
import { notify } from '../../core/notify';
import { assertStudentAccess } from '../../core/rbac/scope';
import { requirePerm } from '../../plugins/guards';
import { prepareCredential } from './accounts';
import { cancelCorrection, correctionReviewerIds, createCorrection, decideCorrection, getCorrection, listCorrections } from './corrections';
import { linkGuardian, setLinkVerified, unlinkGuardian, updateLink, type LinkEffect } from './guardians';
import { ctxOf, metaOf } from './http';
import { importStudents } from './import';
import { addDocument, changeStudentStatus, createStudent, deleteDocument, getStudentDetail, listDocuments, listStudents, moveStudentSection, updateStudent, verifyDocument } from './students';
import { refreshPrincipals } from './util';

const routes: FastifyPluginAsyncZod = async (app) => {
  const tag = ['Students'];

  app.get('/students', { preHandler: [requirePerm('students:view')], schema: { tags: tag, summary: 'Students visible to me (teacher = assigned sections, parent = verified children, student = self); search by name / admission no', querystring: studentListQuery, response: { 200: studentListOut } } }, async (req) => {
    const { rows, total } = await listStudents(req.db, ctxOf(req), req.query);
    return { data: rows, meta: metaOf(req.query, total) };
  });

  app.post(
    '/students/import',
    {
      preHandler: [requirePerm('students:create', 'school')],
      schema: {
        tags: tag,
        summary: 'Bulk import from CSV text or JSON rows (max 500). dryRun=true (default) reports per-row problems and whether the licence has seats for the whole batch; dryRun=false writes everything or nothing',
        body: studentImportBody,
        response: { 200: studentImportOut },
      },
    },
    async (req) => importStudents(req.db, ctxOf(req), req.body),
  );

  app.post(
    '/students',
    {
      preHandler: [requirePerm('students:create', 'school')],
      schema: { tags: tag, summary: 'Add a student: admission number, enrollment in the current year (seat-checked), student login with a temporary password (shown once), optional guardians', body: studentCreateBody, response: { 201: studentCreateOut } },
    },
    async (req, reply) => {
      const input = req.body;
      // Argon2 is slow: hash before the transaction
      const prepared = { student: input.createLogin ? await prepareCredential() : undefined, guardians: await Promise.all((input.guardians ?? []).map((g) => (!g.guardianId && g.createLogin && (g.phone || g.email) ? prepareCredential() : undefined))) };
      const ctx = ctxOf(req);
      const created = await req.db.transaction((tx) => createStudent(tx, ctx, input, prepared));
      refreshPrincipals(req.tenant.id, created.userIds);
      return reply.status(201).send({ ...(await getStudentDetail(req.db, ctx, created.id)), credentials: created.credentials });
    },
  );

  app.get('/students/:id', { preHandler: [requirePerm('students:view')], schema: { tags: tag, summary: 'One student (404 outside my scope). Medical notes, documents and contact details appear only if I am permitted', params: idParam, response: { 200: studentDetailOut } } }, async (req) => getStudentDetail(req.db, ctxOf(req), req.params.id));

  app.patch('/students/:id', { preHandler: [requirePerm('students:edit')], schema: { tags: tag, summary: 'Edit a student’s record (including photo file id, emergency contacts and authorised pickups)', params: idParam, body: studentUpdateBody, response: { 200: studentDetailOut } } }, async (req) => {
    const ctx = ctxOf(req);
    await req.db.transaction((tx) => updateStudent(tx, ctx, req.params.id, req.body));
    return getStudentDetail(req.db, ctx, req.params.id);
  });

  app.post(
    '/students/:id/status',
    {
      preHandler: [requirePerm('students:edit')],
      schema: { tags: tag, summary: 'Suspend / reinstate, or archive a student as transferred, withdrawn or alumni (never deleted; login switched off; history kept). Archiving needs students:delete', params: idParam, body: studentStatusBody, response: { 200: studentDetailOut } },
    },
    async (req) => {
      const ctx = ctxOf(req);
      const r = await req.db.transaction((tx) => changeStudentStatus(tx, ctx, req.params.id, req.body));
      refreshPrincipals(req.tenant.id, r.userIds);
      return getStudentDetail(req.db, ctx, req.params.id);
    },
  );

  app.post(
    '/students/:id/move-section',
    { preHandler: [requirePerm('students:edit')], schema: { tags: tag, summary: 'Move a student to another section of the current year (updates the enrollment; no new seat)', params: idParam, body: studentMoveSectionBody, response: { 200: studentDetailOut } } },
    async (req) => {
      const ctx = ctxOf(req);
      const r = await req.db.transaction((tx) => moveStudentSection(tx, ctx, req.params.id, req.body));
      refreshPrincipals(req.tenant.id, r.userIds);
      return getStudentDetail(req.db, ctx, req.params.id);
    },
  );

  // ── guardian links (the "school-approved process": only verified links give a parent access) ──
  const ltag = ['Students', 'Guardians'];
  const linkOf = async (req: Parameters<typeof ctxOf>[0], studentId: string, guardianId: string) => {
    const d = await getStudentDetail(req.db, ctxOf(req), studentId);
    return d.guardians.find((g) => g.guardianId === guardianId)!;
  };
  const afterLink = async (req: Parameters<typeof ctxOf>[0], e: LinkEffect, verifiedNow = false) => {
    refreshPrincipals(req.tenant.id, [e.userId]);
    if (verifiedNow && e.userId) await notify(req.db, req.tenant, { userIds: [e.userId], type: 'system.child_linked', title: 'A child was added to your account', body: 'The school has verified your link. Open the app to see your child.', data: { route: '/profile' } });
  };

  app.post(
    '/students/:id/guardians',
    { preHandler: [requirePerm('guardians:edit', 'school')], schema: { tags: ltag, summary: 'Link a registered parent to a student. The link grants NO access until it is verified (or created with verified=true)', params: idParam, body: studentGuardianLinkBody, response: { 201: guardianLinkOut } } },
    async (req, reply) => {
      const e = await req.db.transaction((tx) => linkGuardian(tx, ctxOf(req), req.params.id, req.body));
      await afterLink(req, e, req.body.verified);
      return reply.status(201).send(await linkOf(req, req.params.id, req.body.guardianId));
    },
  );

  app.patch(
    '/students/:id/guardians/:guardianId',
    { preHandler: [requirePerm('guardians:edit', 'school')], schema: { tags: ltag, summary: 'Change relationship / primary / pickup / emergency flags of a link', params: studentGuardianParam, body: studentGuardianUpdateBody, response: { 200: guardianLinkOut } } },
    async (req) => {
      const e = await req.db.transaction((tx) => updateLink(tx, ctxOf(req), req.params.id, req.params.guardianId, req.body));
      await afterLink(req, e);
      return linkOf(req, req.params.id, req.params.guardianId);
    },
  );

  app.post(
    '/students/:id/guardians/:guardianId/verify',
    { preHandler: [requirePerm('guardians:edit', 'school')], schema: { tags: ltag, summary: 'Verify the parent↔child relationship: from now on the parent can see this child (audited; the parent is notified)', params: studentGuardianParam, response: { 200: guardianLinkOut } } },
    async (req) => {
      const e = await req.db.transaction((tx) => setLinkVerified(tx, ctxOf(req), req.params.id, req.params.guardianId, true));
      await afterLink(req, e, e.changed);
      return linkOf(req, req.params.id, req.params.guardianId);
    },
  );

  app.post(
    '/students/:id/guardians/:guardianId/unverify',
    { preHandler: [requirePerm('guardians:edit', 'school')], schema: { tags: ltag, summary: 'Withdraw verification: the parent immediately loses access to this child (the link stays)', params: studentGuardianParam, response: { 200: guardianLinkOut } } },
    async (req) => {
      const e = await req.db.transaction((tx) => setLinkVerified(tx, ctxOf(req), req.params.id, req.params.guardianId, false));
      await afterLink(req, e);
      return linkOf(req, req.params.id, req.params.guardianId);
    },
  );

  app.delete(
    '/students/:id/guardians/:guardianId',
    { preHandler: [requirePerm('guardians:edit', 'school')], schema: { tags: ltag, summary: 'Remove the link between a parent and a student', params: studentGuardianParam, response: { 200: okSchema } } },
    async (req) => {
      const e = await req.db.transaction((tx) => unlinkGuardian(tx, ctxOf(req), req.params.id, req.params.guardianId));
      await afterLink(req, e);
      return { ok: true as const };
    },
  );

  // ── documents (sensitive) ──
  const dtag = ['Students', 'Documents'];
  app.get('/students/:id/documents', { preHandler: [requirePerm('student_documents:view')], schema: { tags: dtag, summary: 'Student documents (certificates, ID proofs, medical)', params: idParam, response: { 200: z.object({ data: z.array(studentDocumentOut) }) } } }, async (req) => {
    await assertStudentAccess(req.db, req.auth, 'student_documents:view', req.params.id);
    return { data: await listDocuments(req.db, req.params.id) };
  });

  app.post('/students/:id/documents', { preHandler: [requirePerm('student_documents:create')], schema: { tags: dtag, summary: 'Attach an uploaded file as a student document', params: idParam, body: studentDocumentCreateBody, response: { 201: studentDocumentOut } } }, async (req, reply) =>
    reply.status(201).send(await req.db.transaction((tx) => addDocument(tx, ctxOf(req), req.params.id, req.body))),
  );

  app.post('/students/:id/documents/:docId/verify', { preHandler: [requirePerm('student_documents:create')], schema: { tags: dtag, summary: 'Mark a document as checked by the school', params: studentDocumentParam, response: { 200: studentDocumentOut } } }, async (req) =>
    req.db.transaction((tx) => verifyDocument(tx, ctxOf(req), req.params.id, req.params.docId)),
  );

  app.delete('/students/:id/documents/:docId', { preHandler: [requirePerm('student_documents:delete')], schema: { tags: dtag, summary: 'Remove a student document record', params: studentDocumentParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => deleteDocument(tx, ctxOf(req), req.params.id, req.params.docId));
    return { ok: true as const };
  });

  // ── record-correction requests ──
  const ctag = ['Students', 'Corrections'];
  app.post(
    '/students/:id/correction-requests',
    { preHandler: [requirePerm('students:view')], schema: { tags: ctag, summary: 'A verified-linked parent (or the student) asks the school to correct an official field. Nothing changes until it is approved', params: idParam, body: correctionCreateBody, response: { 201: correctionOut } } },
    async (req, reply) => {
      const ctx = ctxOf(req);
      const id = await req.db.transaction((tx) => createCorrection(tx, ctx, req.params.id, req.body));
      const out = await getCorrection(req.db, ctx, id);
      await notify(req.db, req.tenant, { userIds: await correctionReviewerIds(req.db), type: 'system.correction_requested', title: 'A record correction needs review', data: { route: `/students/${req.params.id}` } });
      return reply.status(201).send(out);
    },
  );

  app.get('/correction-requests', { preHandler: [requirePerm('students:view')], schema: { tags: ctag, summary: 'Correction requests: reviewers see all, parents and students see the ones they filed', querystring: correctionListQuery, response: { 200: correctionListOut } } }, async (req) => {
    const { rows, total } = await listCorrections(req.db, ctxOf(req), req.query);
    return { data: rows, meta: metaOf(req.query, total) };
  });

  app.get('/correction-requests/:id', { preHandler: [requirePerm('students:view')], schema: { tags: ctag, summary: 'One correction request', params: idParam, response: { 200: correctionOut } } }, async (req) => getCorrection(req.db, ctxOf(req), req.params.id));

  app.post(
    '/correction-requests/:id/approve',
    { preHandler: [requirePerm('students:edit', 'school')], schema: { tags: ctag, summary: 'Approve: the change is applied to the student record in the same audited transaction', params: idParam, body: correctionApproveBody, response: { 200: correctionOut } } },
    async (req) => {
      const ctx = ctxOf(req);
      const r = await req.db.transaction((tx) => decideCorrection(tx, ctx, req.params.id, 'approved', req.body.note));
      await notify(req.db, req.tenant, { userIds: [r.requesterId], type: 'system.correction_decided', title: 'Your correction request was approved', data: { route: '/profile' } });
      return getCorrection(req.db, ctx, req.params.id);
    },
  );

  app.post(
    '/correction-requests/:id/reject',
    { preHandler: [requirePerm('students:edit', 'school')], schema: { tags: ctag, summary: 'Reject (a reason is required)', params: idParam, body: correctionRejectBody, response: { 200: correctionOut } } },
    async (req) => {
      const ctx = ctxOf(req);
      const r = await req.db.transaction((tx) => decideCorrection(tx, ctx, req.params.id, 'rejected', req.body.note));
      await notify(req.db, req.tenant, { userIds: [r.requesterId], type: 'system.correction_decided', title: 'Your correction request was reviewed', data: { route: '/profile' } });
      return getCorrection(req.db, ctx, req.params.id);
    },
  );

  app.post('/correction-requests/:id/cancel', { preHandler: [requirePerm('students:view')], schema: { tags: ctag, summary: 'Withdraw my own pending request', params: idParam, response: { 200: correctionOut } } }, async (req) => {
    const ctx = ctxOf(req);
    await req.db.transaction((tx) => cancelCorrection(tx, ctx, req.params.id));
    return getCorrection(req.db, ctx, req.params.id);
  });
};

export default routes;
