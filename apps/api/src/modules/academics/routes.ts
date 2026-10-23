import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  academicYearCreateBody,
  academicYearOut,
  academicYearUpdateBody,
  academicsList,
  academicsOverviewOut,
  classTeacherBody,
  copySectionsBody,
  copySectionsOut,
  gradeCreateBody,
  gradeOut,
  gradeSubjectOut,
  gradeSubjectsPutBody,
  gradeUpdateBody,
  idParam,
  okSchema,
  paged,
  periodCreateBody,
  periodOut,
  periodUpdateBody,
  promotionApplyBody,
  promotionApplyOut,
  promotionPreviewBody,
  promotionPreviewOut,
  sectionAssignmentsPutBody,
  sectionCreateBody,
  sectionDetailOut,
  sectionListQuery,
  sectionOut,
  sectionUpdateBody,
  subjectCreateBody,
  subjectOut,
  subjectUpdateBody,
  teachingAssignmentCreateBody,
  teachingAssignmentOut,
  teachingAssignmentQuery,
  teachingAssignmentUpdateBody,
  termCreateBody,
  termOut,
  termUpdateBody,
} from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { invalidatePrincipal } from '../../core/rbac/principal';
import { requirePerm } from '../../plugins/guards';
import { applyPromotion, previewPromotion } from './promotions';
import * as svc from './service';
import * as sec from './sections';

const refreshPrincipals = (tenantId: string, userIds: string[]) => {
  for (const id of new Set(userIds)) invalidatePrincipal(tenantId, id);
};

const routes: FastifyPluginAsyncZod = async (app) => {
  const tag = ['Academics'];

  // ── overview ───────────────────────────────────────────────────────────────────────────────────
  app.get('/academics/overview', { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'Counts for the academic structure (years, grades, sections, subjects, …) and the current year', response: { 200: academicsOverviewOut } } }, async (req) => svc.overview(req.db, req.auth));

  // ── academic years ─────────────────────────────────────────────────────────────────────────────
  app.get('/academics/years', { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'Academic years, newest first', response: { 200: academicsList(academicYearOut) } } }, async (req) => ({ data: (await svc.listYears(req.db)).map(svc.toYearOut) }));

  app.post(
    '/academics/years',
    { preHandler: [requirePerm('academics:create')], schema: { tags: tag, summary: 'Create an academic year (dates may not overlap another year)', body: academicYearCreateBody, response: { 201: academicYearOut } } },
    async (req, reply) => {
      const r = await req.db.transaction((tx) => svc.createYear(tx, actorOf(req), req.body));
      if (r.switchedCurrent) invalidatePrincipal(req.tenant.id);
      return reply.status(201).send(svc.toYearOut(await svc.getYear(req.db, r.id)));
    },
  );

  app.get('/academics/years/:id', { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'One academic year', params: idParam, response: { 200: academicYearOut } } }, async (req) => svc.toYearOut(await svc.getYear(req.db, req.params.id)));

  app.patch(
    '/academics/years/:id',
    { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Rename / re-date an academic year', params: idParam, body: academicYearUpdateBody, response: { 200: academicYearOut } } },
    async (req) => {
      await req.db.transaction((tx) => svc.updateYear(tx, actorOf(req), req.params.id, req.body));
      return svc.toYearOut(await svc.getYear(req.db, req.params.id));
    },
  );

  app.post(
    '/academics/years/:id/set-current',
    { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Make this the (one) current academic year; assigned-section scopes of every teacher refresh', params: idParam, response: { 200: academicYearOut } } },
    async (req) => {
      await req.db.transaction((tx) => svc.setCurrentYear(tx, actorOf(req), req.params.id));
      // "current year" feeds every teacher's / class teacher's assigned sections
      invalidatePrincipal(req.tenant.id);
      return svc.toYearOut(await svc.getYear(req.db, req.params.id));
    },
  );

  app.delete('/academics/years/:id', { preHandler: [requirePerm('academics:delete')], schema: { tags: tag, summary: 'Delete an unused academic year', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => svc.deleteYear(tx, actorOf(req), req.params.id));
    return { ok: true as const };
  });

  app.post(
    '/academics/years/:id/copy-sections',
    { preHandler: [requirePerm('academics:create')], schema: { tags: tag, summary: 'Create this year’s sections from an earlier year (optionally with class teachers and teaching assignments)', params: idParam, body: copySectionsBody, response: { 200: copySectionsOut } } },
    async (req) => {
      const { result, targetIsCurrent } = await req.db.transaction((tx) => svc.copySections(tx, actorOf(req), req.params.id, req.body));
      if (targetIsCurrent) invalidatePrincipal(req.tenant.id);
      return result;
    },
  );

  // ── terms ──────────────────────────────────────────────────────────────────────────────────────
  app.get('/academics/years/:id/terms', { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'Terms of a year', params: idParam, response: { 200: academicsList(termOut) } } }, async (req) => ({ data: (await svc.listTerms(req.db, req.params.id)).map(svc.toTermOut) }));

  app.post(
    '/academics/years/:id/terms',
    { preHandler: [requirePerm('academics:create')], schema: { tags: tag, summary: 'Add a term (inside the year, not overlapping another term)', params: idParam, body: termCreateBody, response: { 201: termOut } } },
    async (req, reply) => reply.status(201).send(svc.toTermOut(await req.db.transaction((tx) => svc.createTerm(tx, actorOf(req), req.params.id, req.body)))),
  );

  app.patch(
    '/academics/terms/:id',
    { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Update a term', params: idParam, body: termUpdateBody, response: { 200: termOut } } },
    async (req) => svc.toTermOut(await req.db.transaction((tx) => svc.updateTerm(tx, actorOf(req), req.params.id, req.body))),
  );

  app.delete('/academics/terms/:id', { preHandler: [requirePerm('academics:delete')], schema: { tags: tag, summary: 'Delete a term', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => svc.deleteTerm(tx, actorOf(req), req.params.id));
    return { ok: true as const };
  });

  // ── grades ─────────────────────────────────────────────────────────────────────────────────────
  app.get('/academics/grades', { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'Grades / classes in order', response: { 200: academicsList(gradeOut) } } }, async (req) => ({ data: (await svc.listGrades(req.db)).map(svc.toGradeOut) }));

  app.post('/academics/grades', { preHandler: [requirePerm('academics:create')], schema: { tags: tag, summary: 'Create a grade', body: gradeCreateBody, response: { 201: gradeOut } } }, async (req, reply) =>
    reply.status(201).send(svc.toGradeOut(await req.db.transaction((tx) => svc.createGrade(tx, actorOf(req), req.body)))),
  );

  app.patch('/academics/grades/:id', { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Update a grade', params: idParam, body: gradeUpdateBody, response: { 200: gradeOut } } }, async (req) =>
    svc.toGradeOut(await req.db.transaction((tx) => svc.updateGrade(tx, actorOf(req), req.params.id, req.body))),
  );

  app.delete('/academics/grades/:id', { preHandler: [requirePerm('academics:delete')], schema: { tags: tag, summary: 'Delete an unused grade', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => svc.deleteGrade(tx, actorOf(req), req.params.id));
    return { ok: true as const };
  });

  app.get(
    '/academics/grades/:id/subjects',
    { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'Subjects a grade offers, with periods per week', params: idParam, response: { 200: academicsList(gradeSubjectOut) } } },
    async (req) => ({ data: await svc.listGradeSubjects(req.db, req.params.id) }),
  );

  app.put(
    '/academics/grades/:id/subjects',
    { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Set the full list of subjects a grade offers (replaces the previous list)', params: idParam, body: gradeSubjectsPutBody, response: { 200: academicsList(gradeSubjectOut) } } },
    async (req) => ({ data: await req.db.transaction((tx) => svc.putGradeSubjects(tx, actorOf(req), req.params.id, req.body.subjects)) }),
  );

  // ── subjects ───────────────────────────────────────────────────────────────────────────────────
  app.get('/academics/subjects', { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'Subjects', response: { 200: academicsList(subjectOut) } } }, async (req) => ({ data: (await svc.listSubjects(req.db)).map(svc.toSubjectOut) }));

  app.post('/academics/subjects', { preHandler: [requirePerm('academics:create')], schema: { tags: tag, summary: 'Create a subject', body: subjectCreateBody, response: { 201: subjectOut } } }, async (req, reply) =>
    reply.status(201).send(svc.toSubjectOut(await req.db.transaction((tx) => svc.createSubject(tx, actorOf(req), req.body)))),
  );

  app.patch('/academics/subjects/:id', { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Update a subject', params: idParam, body: subjectUpdateBody, response: { 200: subjectOut } } }, async (req) =>
    svc.toSubjectOut(await req.db.transaction((tx) => svc.updateSubject(tx, actorOf(req), req.params.id, req.body))),
  );

  app.delete('/academics/subjects/:id', { preHandler: [requirePerm('academics:delete')], schema: { tags: tag, summary: 'Delete an unused subject', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => svc.deleteSubject(tx, actorOf(req), req.params.id));
    return { ok: true as const };
  });

  // ── periods (day structure) ────────────────────────────────────────────────────────────────────
  app.get('/academics/periods', { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'School-day periods in order (including breaks)', response: { 200: academicsList(periodOut) } } }, async (req) => ({ data: (await svc.listPeriods(req.db)).map(svc.toPeriodOut) }));

  app.post('/academics/periods', { preHandler: [requirePerm('academics:create')], schema: { tags: tag, summary: 'Add a period', body: periodCreateBody, response: { 201: periodOut } } }, async (req, reply) =>
    reply.status(201).send(svc.toPeriodOut(await req.db.transaction((tx) => svc.createPeriod(tx, actorOf(req), req.body)))),
  );

  app.patch('/academics/periods/:id', { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Update a period', params: idParam, body: periodUpdateBody, response: { 200: periodOut } } }, async (req) =>
    svc.toPeriodOut(await req.db.transaction((tx) => svc.updatePeriod(tx, actorOf(req), req.params.id, req.body))),
  );

  app.delete('/academics/periods/:id', { preHandler: [requirePerm('academics:delete')], schema: { tags: tag, summary: 'Delete an unused period', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => svc.deletePeriod(tx, actorOf(req), req.params.id));
    return { ok: true as const };
  });

  // ── sections ───────────────────────────────────────────────────────────────────────────────────
  app.get(
    '/academics/sections',
    {
      preHandler: [requirePerm('academics:view')],
      schema: { tags: tag, summary: 'Sections visible to me by scope (teacher = assigned, student = own, parent = children’s, management = all); `mine=true` = current year', querystring: sectionListQuery, response: { 200: paged(sectionOut) } },
    },
    async (req) => {
      const { rows, total } = await sec.listSections(req.db, req.auth, req.query);
      return { data: rows, meta: { page: req.query.page, pageSize: req.query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / req.query.pageSize)) } };
    },
  );

  app.post('/academics/sections', { preHandler: [requirePerm('academics:create')], schema: { tags: tag, summary: 'Create a section for a grade and year (optionally with its class teacher)', body: sectionCreateBody, response: { 201: sectionOut } } }, async (req, reply) => {
    const r = await req.db.transaction((tx) => sec.createSection(tx, actorOf(req), req.body));
    refreshPrincipals(req.tenant.id, r.effect.userIds);
    return reply.status(201).send(sec.toSectionOut(await sec.getSectionRow(req.db, r.id)));
  });

  app.get('/academics/sections/:id', { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'A section with its teaching assignments (404 if outside my scope)', params: idParam, response: { 200: sectionDetailOut } } }, async (req) => sec.getSectionDetail(req.db, req.auth, req.params.id));

  app.patch('/academics/sections/:id', { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Update section name / room / capacity', params: idParam, body: sectionUpdateBody, response: { 200: sectionOut } } }, async (req) => {
    await req.db.transaction((tx) => sec.updateSection(tx, actorOf(req), req.params.id, req.body));
    return sec.toSectionOut(await sec.getSectionRow(req.db, req.params.id));
  });

  app.delete('/academics/sections/:id', { preHandler: [requirePerm('academics:delete')], schema: { tags: tag, summary: 'Delete a section that has no enrolments', params: idParam, response: { 200: okSchema } } }, async (req) => {
    const r = await req.db.transaction((tx) => sec.deleteSection(tx, actorOf(req), req.params.id));
    refreshPrincipals(req.tenant.id, r.userIds);
    return { ok: true as const };
  });

  app.put(
    '/academics/sections/:id/class-teacher',
    { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Assign (or, with staffId null, remove) the class teacher; keeps the class_teacher role in step', params: idParam, body: classTeacherBody, response: { 200: sectionOut } } },
    async (req) => {
      const effect = await req.db.transaction((tx) => sec.setClassTeacher(tx, actorOf(req), req.params.id, req.body.staffId));
      refreshPrincipals(req.tenant.id, effect.userIds);
      return sec.toSectionOut(await sec.getSectionRow(req.db, req.params.id));
    },
  );

  app.put(
    '/academics/sections/:id/teaching-assignments',
    { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Replace a section’s whole subject → teacher grid', params: idParam, body: sectionAssignmentsPutBody, response: { 200: academicsList(teachingAssignmentOut) } } },
    async (req) => {
      const r = await req.db.transaction((tx) => sec.replaceSectionAssignments(tx, actorOf(req), req.params.id, req.body.assignments));
      refreshPrincipals(req.tenant.id, r.userIds);
      return { data: r.rows.map(sec.toAssignmentOut) };
    },
  );

  // ── teaching assignments ───────────────────────────────────────────────────────────────────────
  app.get(
    '/academics/teaching-assignments',
    { preHandler: [requirePerm('academics:view')], schema: { tags: tag, summary: 'Who teaches what (section + subject → teacher), limited to sections in my scope', querystring: teachingAssignmentQuery, response: { 200: paged(teachingAssignmentOut) } } },
    async (req) => {
      const { rows, total } = await sec.listAssignments(req.db, req.auth, req.query);
      return { data: rows, meta: { page: req.query.page, pageSize: req.query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / req.query.pageSize)) } };
    },
  );

  app.post(
    '/academics/teaching-assignments',
    { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Assign a teacher to a subject in a section (one teacher per section + subject)', body: teachingAssignmentCreateBody, response: { 201: teachingAssignmentOut } } },
    async (req, reply) => {
      const r = await req.db.transaction((tx) => sec.createAssignment(tx, actorOf(req), req.body));
      refreshPrincipals(req.tenant.id, r.userIds);
      return reply.status(201).send(sec.toAssignmentOut(r.row));
    },
  );

  app.patch(
    '/academics/teaching-assignments/:id',
    { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Change the teacher of an assignment', params: idParam, body: teachingAssignmentUpdateBody, response: { 200: teachingAssignmentOut } } },
    async (req) => {
      const r = await req.db.transaction((tx) => sec.updateAssignment(tx, actorOf(req), req.params.id, req.body.staffId));
      refreshPrincipals(req.tenant.id, r.userIds);
      return sec.toAssignmentOut(r.row);
    },
  );

  app.delete('/academics/teaching-assignments/:id', { preHandler: [requirePerm('academics:edit')], schema: { tags: tag, summary: 'Remove a teaching assignment', params: idParam, response: { 200: okSchema } } }, async (req) => {
    const r = await req.db.transaction((tx) => sec.deleteAssignment(tx, actorOf(req), req.params.id));
    refreshPrincipals(req.tenant.id, r.userIds);
    return { ok: true as const };
  });

  // ── year-end promotion ─────────────────────────────────────────────────────────────────────────
  const ptag = ['Promotions'];
  app.post(
    '/promotions/preview',
    { preHandler: [requirePerm('promotions:view')], schema: { tags: ptag, summary: 'Dry run of the year-end promotion: who goes where, seats needed, problems to fix first', body: promotionPreviewBody, response: { 200: promotionPreviewOut } } },
    async (req) => previewPromotion(req.db, req.tenant, req.body),
  );

  app.post(
    '/promotions/apply',
    { preHandler: [requirePerm('promotions:approve')], schema: { tags: ptag, summary: 'Apply the promotion: new-year enrollments (seat-checked), old ones closed, last grade → alumni. Needs promotions:approve', body: promotionApplyBody, response: { 200: promotionApplyOut } } },
    async (req) => {
      const out = await req.db.transaction((tx) => applyPromotion(tx, req.tenant, actorOf(req), req.body));
      // sections, linked children and statuses changed for many users
      invalidatePrincipal(req.tenant.id);
      return out;
    },
  );
};

export default routes;
