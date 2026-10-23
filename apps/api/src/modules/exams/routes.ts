import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  classResultsOut,
  classResultsQuery,
  examAnalyticsOut,
  examCreateBody,
  examListQuery,
  examOut,
  examPublishBody,
  examUpdateBody,
  gradeScaleCreateBody,
  gradeScaleOut,
  gradeScaleUpdateBody,
  idParam,
  marksExportQuery,
  markEntriesBody,
  okSchema,
  pageQuery,
  paged,
  paperBulkBody,
  paperCreateBody,
  paperListQuery,
  paperOut,
  paperUpdateBody,
  progressOut,
  progressQuery,
  reportCardOut,
  reportCardsPublishBody,
  reportCardsPublishOut,
  reportRemarkIn,
  reportRemarkOut,
  reportRemarksOut,
  reportRemarksQuery,
  resultsOut,
  resultsQuery,
  sheetApproveBody,
  sheetBulkPublishBody,
  sheetBulkPublishOut,
  sheetCorrectBody,
  sheetDetailOut,
  sheetGenerateBody,
  sheetGenerateOut,
  sheetListQuery,
  sheetOut,
  sheetReturnBody,
  sheetSubmitBody,
  uuid,
} from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { forbidden, notFound, unprocessable } from '../../core/errors';
import type { Principal } from '../../core/rbac/principal';
import { requirePerm } from '../../plugins/guards';
import { toCsv } from './common';
import { reportCardPdf } from './pdf';
import * as results from './results';
import { assertResultAccess } from './scope';
import * as svc from './service';
import * as sheets from './sheets';

const examParam = z.object({ examId: uuid });
const studentParam = z.object({ examId: uuid, studentId: uuid });
const paperParam = z.object({ id: uuid, paperId: uuid });
const listOf = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

const routes: FastifyPluginAsyncZod = async (app) => {
  /** Notifications run after commit; a failure there must not turn a committed change into a 500. */
  const afterCommit = (req: { log: { error: (o: unknown, m?: string) => void } }, fn: () => Promise<void>) => fn().catch((err) => req.log.error({ err }, 'post-commit notification failed'));

  // ── grade scales ──────────────────────────────────────────────────────────────────────────
  const GS = ['Exams'];
  app.get('/grade-scales', { preHandler: [requirePerm('exams:view')], schema: { tags: GS, summary: 'Grade scales with their bands', querystring: pageQuery, response: { 200: paged(gradeScaleOut) } } }, async (req) => svc.listGradeScales(req.db, req.query));
  app.get('/grade-scales/:id', { preHandler: [requirePerm('exams:view')], schema: { tags: GS, summary: 'One grade scale', params: idParam, response: { 200: gradeScaleOut } } }, async (req) => svc.getGradeScale(req.db, req.params.id));
  app.post('/grade-scales', { preHandler: [requirePerm('exams:create')], schema: { tags: GS, summary: 'Create a grade scale (bands must cover 0-100 without overlap)', body: gradeScaleCreateBody, response: { 201: gradeScaleOut } } }, async (req, reply) => {
    const out = await req.db.transaction((tx) => svc.createGradeScale(tx, actorOf(req), req.body));
    return reply.status(201).send(out);
  });
  app.patch('/grade-scales/:id', { preHandler: [requirePerm('exams:edit')], schema: { tags: GS, summary: 'Rename, make default, or replace the bands of a grade scale', params: idParam, body: gradeScaleUpdateBody, response: { 200: gradeScaleOut } } }, async (req) =>
    req.db.transaction((tx) => svc.updateGradeScale(tx, actorOf(req), req.params.id, req.body)),
  );
  app.delete('/grade-scales/:id', { preHandler: [requirePerm('exams:delete')], schema: { tags: GS, summary: 'Delete an unused, non-default grade scale', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => svc.deleteGradeScale(tx, actorOf(req), req.params.id));
    return { ok: true as const };
  });

  // ── exams ─────────────────────────────────────────────────────────────────────────────────
  const EX = ['Exams'];
  app.get('/exams', { preHandler: [requirePerm('exams:view')], schema: { tags: EX, summary: 'Exams visible to me (students/parents/teachers: scheduled or later, for their grades)', querystring: examListQuery, response: { 200: paged(examOut) } } }, async (req) =>
    svc.listExams(req.db, req.auth, req.tenant, req.query),
  );
  app.post('/exams', { preHandler: [requirePerm('exams:create')], schema: { tags: EX, summary: 'Create an exam (draft)', body: examCreateBody, response: { 201: examOut } } }, async (req, reply) => {
    const out = await req.db.transaction((tx) => svc.createExam(tx, req.auth, actorOf(req), req.body));
    return reply.status(201).send(out);
  });
  app.get('/exams/:id', { preHandler: [requirePerm('exams:view')], schema: { tags: EX, summary: 'One exam', params: idParam, response: { 200: examOut } } }, async (req) => svc.getExamFor(req.db, req.auth, req.params.id));
  app.patch('/exams/:id', { preHandler: [requirePerm('exams:edit')], schema: { tags: EX, summary: 'Edit an exam that is not yet published', params: idParam, body: examUpdateBody, response: { 200: examOut } } }, async (req) =>
    req.db.transaction((tx) => svc.updateExam(tx, req.auth, actorOf(req), req.params.id, req.body)),
  );
  app.delete('/exams/:id', { preHandler: [requirePerm('exams:delete')], schema: { tags: EX, summary: 'Delete an exam that has no mark sheets yet', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => svc.deleteExam(tx, actorOf(req), req.params.id));
    return { ok: true as const };
  });

  for (const [verb, summary] of [
    ['schedule', 'draft -> scheduled: makes the schedule visible to students, parents and teachers (needs at least one paper)'],
    ['open-marks', 'scheduled -> marks_entry: subject teachers may enter marks'],
    ['start-review', 'marks_entry -> under_review'],
  ] as const) {
    app.post(`/exams/:id/${verb}`, { preHandler: [requirePerm('exams:edit')], schema: { tags: EX, summary, params: idParam, response: { 200: examOut } } }, async (req) => {
      const r = await req.db.transaction((tx) => svc.transitionExam(tx, req.tenant, req.auth, actorOf(req), req.params.id, verb));
      await afterCommit(req, () => r.notifyAfter(req.db));
      return r.exam;
    });
  }
  app.post('/exams/:id/publish', { preHandler: [requirePerm('exams:publish')], schema: { tags: EX, summary: 'Publish the exam: publishes all approved mark sheets and notifies students and verified guardians', params: idParam, body: examPublishBody.optional(), response: { 200: examOut } } }, async (req) => {
    if (!req.auth.can('marks:publish', 'school')) throw forbidden();
    const r = await req.db.transaction((tx) => svc.publishExam(tx, req.auth, actorOf(req), req.params.id, req.body?.force ?? false));
    await afterCommit(req, () => r.after(req.db, req.tenant));
    return r.exam;
  });

  // schedule
  app.get('/exams/:id/papers', { preHandler: [requirePerm('exams:view')], schema: { tags: EX, summary: 'The exam schedule (papers) — students/parents/teachers see only their grades', params: idParam, querystring: paperListQuery, response: { 200: listOf(paperOut) } } }, async (req) => ({
    data: await svc.listPapers(req.db, req.auth, req.params.id, req.query.gradeId),
  }));
  app.post('/exams/:id/papers', { preHandler: [requirePerm('exams:edit')], schema: { tags: EX, summary: 'Add a paper (grade x subject) to the schedule; rejects clashes for the same grade', params: idParam, body: paperCreateBody, response: { 201: paperOut } } }, async (req, reply) => {
    const out = await req.db.transaction((tx) => svc.createPaper(tx, actorOf(req), req.params.id, req.body));
    return reply.status(201).send(out);
  });
  app.post('/exams/:id/papers/bulk', { preHandler: [requirePerm('exams:edit')], schema: { tags: EX, summary: 'Create or update many papers at once (matched by grade + subject)', params: idParam, body: paperBulkBody, response: { 200: listOf(paperOut) } } }, async (req) => ({
    data: await req.db.transaction((tx) => svc.upsertPapers(tx, actorOf(req), req.params.id, req.body.papers)),
  }));
  app.patch('/exams/:id/papers/:paperId', { preHandler: [requirePerm('exams:edit')], schema: { tags: EX, summary: 'Edit a paper', params: paperParam, body: paperUpdateBody, response: { 200: paperOut } } }, async (req) =>
    req.db.transaction((tx) => svc.updatePaper(tx, actorOf(req), req.params.id, req.params.paperId, req.body)),
  );
  app.delete('/exams/:id/papers/:paperId', { preHandler: [requirePerm('exams:edit')], schema: { tags: EX, summary: 'Remove a paper that has no mark sheets', params: paperParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => svc.deletePaper(tx, actorOf(req), req.params.id, req.params.paperId));
    return { ok: true as const };
  });

  // mark-sheet generation, bulk publish, analytics
  app.post('/exams/:id/sheets/generate', { preHandler: [requirePerm('exams:edit')], schema: { tags: EX, summary: 'Create mark sheets (exam x section x subject) from the teaching assignments; idempotent', params: idParam, body: sheetGenerateBody, response: { 200: sheetGenerateOut } } }, async (req) =>
    req.db.transaction((tx) => svc.generateSheets(tx, actorOf(req), req.params.id, req.body.sectionId)),
  );
  app.post('/exams/:id/sheets/publish', { preHandler: [requirePerm('marks:publish')], schema: { tags: EX, summary: 'Publish all approved sheets of the exam (optionally one section / subject)', params: idParam, body: sheetBulkPublishBody, response: { 200: sheetBulkPublishOut } } }, async (req) => {
    const r = await req.db.transaction((tx) => sheets.publishExamSheets(tx, req.auth, actorOf(req), req.params.id, req.body));
    await afterCommit(req, () => sheets.notifyPublished(req.db, req.tenant, req.params.id, r.newSections));
    return { published: r.published, skipped: r.skipped };
  });
  app.get('/exams/:id/analytics', { preHandler: [requirePerm('marks:view', 'assigned')], schema: { tags: EX, summary: 'Per section/subject averages, pass %, top performers and distribution (within my scope)', params: idParam, response: { 200: examAnalyticsOut } } }, async (req) =>
    results.examAnalytics(req.db, req.auth, req.params.id),
  );

  // ── mark sheets ───────────────────────────────────────────────────────────────────────────
  const MK = ['Marks'];
  app.get('/marks/sheets', { preHandler: [requirePerm('marks:view', 'assigned')], schema: { tags: MK, summary: 'Mark sheets in my scope (teachers: sheets of my subjects and my class)', querystring: sheetListQuery, response: { 200: paged(sheetOut) } } }, async (req) => sheets.listSheets(req.db, req.auth, req.query));
  app.get('/marks/sheets/:id', { preHandler: [requirePerm('marks:view')], schema: { tags: MK, summary: 'A mark sheet with entries. Students/parents: only published sheets, only their own entries; otherwise 404', params: idParam, response: { 200: sheetDetailOut } } }, async (req) =>
    sheets.getSheetDetail(req.db, req.auth, req.params.id),
  );
  app.put('/marks/sheets/:id/entries', { preHandler: [requirePerm('marks:edit')], schema: { tags: MK, summary: 'Bulk upsert marks (subject teacher only; sheet must be draft or returned)', params: idParam, body: markEntriesBody, response: { 200: sheetDetailOut } } }, async (req) =>
    req.db.transaction((tx) => sheets.saveEntries(tx, req.auth, actorOf(req), req.params.id, req.body.entries)),
  );
  app.post('/marks/sheets/:id/submit', { preHandler: [requirePerm('marks:edit')], schema: { tags: MK, summary: 'Submit for review (all students need marks or an absent flag). With exams.requireApproval=false it becomes approved/published directly', params: idParam, body: sheetSubmitBody, response: { 200: sheetDetailOut } } }, async (req) => {
    const r = await req.db.transaction((tx) => sheets.submitSheet(tx, req.auth, actorOf(req), req.params.id));
    await afterCommit(req, () => r.after(req.db, req.tenant));
    return r.sheet;
  });
  app.post('/marks/sheets/:id/approve', { preHandler: [requirePerm('marks:approve')], schema: { tags: MK, summary: 'Approve a submitted sheet', params: idParam, body: sheetApproveBody, response: { 200: sheetDetailOut } } }, async (req) =>
    req.db.transaction((tx) => sheets.approveSheet(tx, req.auth, actorOf(req), req.params.id, req.body.note)),
  );
  app.post('/marks/sheets/:id/return', { preHandler: [requirePerm('marks:approve')], schema: { tags: MK, summary: 'Send a submitted/approved sheet back to the teacher with a note (teacher is notified)', params: idParam, body: sheetReturnBody, response: { 200: sheetDetailOut } } }, async (req) => {
    const r = await req.db.transaction((tx) => sheets.returnSheet(tx, req.auth, actorOf(req), req.params.id, req.body.note));
    await afterCommit(req, () => r.after(req.db, req.tenant));
    return r.sheet;
  });
  app.post('/marks/sheets/:id/publish', { preHandler: [requirePerm('marks:publish')], schema: { tags: MK, summary: 'Publish an approved sheet: students and verified guardians can now see it and are notified', params: idParam, response: { 200: sheetDetailOut } } }, async (req) => {
    const r = await req.db.transaction((tx) => sheets.publishSheet(tx, req.auth, actorOf(req), req.params.id));
    await afterCommit(req, () => r.after(req.db, req.tenant));
    return r.sheet;
  });
  app.post('/marks/sheets/:id/correct', { preHandler: [requirePerm('marks:approve')], schema: { tags: MK, summary: 'Correct marks AFTER publication (mandatory reason; before/after audited; families re-notified)', params: idParam, body: sheetCorrectBody, response: { 200: sheetDetailOut } } }, async (req) => {
    const r = await req.db.transaction((tx) => sheets.correctSheet(tx, req.auth, actorOf(req), req.params.id, req.body.reason, req.body.entries));
    await afterCommit(req, () => r.after(req.db, req.tenant));
    return r.sheet;
  });
  app.get('/marks/export', { preHandler: [requirePerm('marks:export')], schema: { tags: MK, summary: 'CSV export of submitted/approved/published marks in my scope', querystring: marksExportQuery, response: { 200: z.string().meta({ description: 'text/csv' }) } } }, async (req, reply) => {
    const rows = await sheets.exportRows(req.db, req.auth, req.query);
    const csv = toCsv(
      ['Exam', 'Class', 'Section', 'Subject', 'Sheet status', 'Admission no', 'Roll no', 'Student', 'Max marks', 'Marks', 'Absent', 'Remarks'],
      rows.map((r) => [r.exam, r.grade, r.section, r.subject, r.sheetStatus, r.admissionNo, r.rollNo, [r.first, r.last].filter(Boolean).join(' '), r.maxMarks, r.absent ? '' : r.obtained, r.absent ? 'yes' : 'no', r.remarks]),
    );
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="marks.csv"').send(csv);
  });

  // ── results ───────────────────────────────────────────────────────────────────────────────
  const RS = ['Results'];
  /** a student asks for themselves, a parent with one child for that child; everyone else names the student */
  const pickStudent = (req: { auth: Principal }, given?: string): string => {
    if (given) return given;
    if (req.auth.studentId) return req.auth.studentId;
    if (req.auth.linkedStudentIds.length === 1) return req.auth.linkedStudentIds[0]!;
    throw unprocessable('studentId is required', 'STUDENT_REQUIRED');
  };
  app.get('/results', { preHandler: [requirePerm('marks:view')], schema: { tags: RS, summary: 'Published results of one student (all exams, or one with ?examId): subject marks, percent, grade, pass/fail, class rank', querystring: resultsQuery, response: { 200: resultsOut } } }, async (req) => {
    const studentId = pickStudent(req, req.query.studentId);
    await assertResultAccess(req.db, req.auth, 'marks:view', studentId);
    return { data: await results.studentResults(req.db, studentId, req.query.examId) };
  });
  app.get('/results/class', { preHandler: [requirePerm('marks:view', 'assigned')], schema: { tags: RS, summary: 'Published results of a whole section for one exam (class teacher / school scope)', querystring: classResultsQuery, response: { 200: classResultsOut } } }, async (req) => {
    results.assertCanRemark(req.auth, 'report_cards:view', req.query.sectionId);
    return results.classResults(req.db, req.query.examId, req.query.sectionId);
  });
  app.get('/results/progress', { preHandler: [requirePerm('marks:view')], schema: { tags: RS, summary: 'Progress trend: published marks per subject across exams', querystring: progressQuery, response: { 200: progressOut } } }, async (req) => {
    const studentId = pickStudent(req, req.query.studentId);
    await assertResultAccess(req.db, req.auth, 'marks:view', studentId);
    return results.progress(req.db, studentId);
  });

  // ── report cards ──────────────────────────────────────────────────────────────────────────
  const RC = ['Report cards'];
  app.get('/report-cards/:examId/students/:studentId', { preHandler: [requirePerm('report_cards:view')], schema: { tags: RC, summary: 'Report card: published subjects, total/percent/grade/rank, attendance %, class-teacher remarks (once published)', params: studentParam, response: { 200: reportCardOut } } }, async (req) => {
    await assertResultAccess(req.db, req.auth, 'report_cards:view', req.params.studentId);
    return results.reportCard(req.db, req.tenant, req.auth, req.params.examId, req.params.studentId);
  });
  app.get('/report-cards/:examId/students/:studentId/pdf', { preHandler: [requirePerm('report_cards:view')], schema: { tags: RC, summary: 'Report card as a PDF', params: studentParam, response: { 200: z.string().meta({ format: 'binary', description: 'application/pdf' }) } } }, async (req, reply) => {
    await assertResultAccess(req.db, req.auth, 'report_cards:view', req.params.studentId);
    const card = await results.reportCard(req.db, req.tenant, req.auth, req.params.examId, req.params.studentId);
    const pdf = await reportCardPdf(card);
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="report-card-${card.admissionNo}.pdf"`).send(pdf as unknown as string);
  });
  app.put('/report-cards/:examId/students/:studentId/remarks', { preHandler: [requirePerm('report_cards:edit')], schema: { tags: RC, summary: 'Class teacher writes remarks (saving takes them back to draft until published)', params: studentParam, body: reportRemarkIn, response: { 200: reportRemarkOut } } }, async (req) => {
    const out = await req.db.transaction((tx) => results.saveRemark(tx, req.auth, actorOf(req), req.params.examId, req.params.studentId, req.body));
    if (!out) throw notFound('Remark');
    return out;
  });
  app.get('/report-cards/:examId/remarks', { preHandler: [requirePerm('report_cards:view', 'assigned')], schema: { tags: RC, summary: 'Remarks of every student of a section (class teacher / school scope)', params: examParam, querystring: reportRemarksQuery, response: { 200: reportRemarksOut } } }, async (req) =>
    results.listRemarks(req.db, req.auth, req.params.examId, req.query.sectionId),
  );
  app.post('/report-cards/:examId/publish', { preHandler: [requirePerm('report_cards:publish')], schema: { tags: RC, summary: 'Publish class-teacher remarks (a section, or named students) so families see them on the report card', params: examParam, body: reportCardsPublishBody, response: { 200: reportCardsPublishOut } } }, async (req) => {
    const ids = await req.db.transaction((tx) => results.publishRemarks(tx, actorOf(req), req.params.examId, req.body));
    await afterCommit(req, () => results.notifyReportCards(req.db, req.tenant, req.params.examId, ids));
    return { published: ids.length };
  });
};

export default routes;
