import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  homeworkCreateBody,
  homeworkDetailQuery,
  homeworkItem,
  homeworkListQuery,
  homeworkRosterResponse,
  homeworkSubmitBody,
  homeworkUpdateBody,
  idParam,
  okSchema,
  paged,
  submissionItem,
  submissionListQuery,
  submissionReturnBody,
  submissionReviewBody,
} from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { paged as pagedResult } from '../../core/http';
import { requirePerm } from '../../plugins/guards';
import * as hw from './homework.service';
import * as sub from './submissions.service';

const tag = ['Homework'];
const subTag = ['Submissions'];

const homeworkRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── homework ──────────────────────────────────────────────────────────────

  app.get(
    '/homework',
    {
      preHandler: [requirePerm('homework:view')],
      schema: {
        tags: tag,
        summary: 'Homework visible to me',
        description:
          'Students/parents: published and closed homework of the (child’s) section, each with `learner.status` (pending | submitted | late | reviewed | returned | overdue | not_required); filter with `learnerStatus`. ' +
          'Parents with several children must pass `studentId`. Teachers: homework of their classes/subjects with submission `stats`; management: all.',
        querystring: homeworkListQuery,
        response: { 200: paged(homeworkItem) },
      },
    },
    async (req) => {
      const { rows, total } = await hw.listHomework(req.db, req.tenant, req.auth, req.query);
      return pagedResult(rows, total, req.query);
    },
  );

  app.get(
    '/homework/:id',
    { preHandler: [requirePerm('homework:view')], schema: { tags: tag, summary: 'One homework (drafts are invisible to students and parents)', params: idParam, querystring: homeworkDetailQuery, response: { 200: homeworkItem } } },
    async (req) => hw.getHomework(req.db, req.auth, req.params.id, req.query.studentId),
  );

  app.post(
    '/homework',
    {
      preHandler: [requirePerm('homework:create')],
      schema: {
        tags: tag,
        summary: 'Create homework for a section + subject you teach (draft, or publish immediately)',
        description: 'Teachers: only (section, subject) pairs they teach or sections they lead (403 NOT_TEACHING_SUBJECT; other sections 404). Publishing notifies the section’s students and their verified guardians (`homework.assigned`).',
        body: homeworkCreateBody,
        response: { 201: homeworkItem },
      },
    },
    async (req, reply) => reply.status(201).send(await hw.createHomework(req.db, req.tenant, req.auth, actorOf(req), req.body)),
  );

  app.patch(
    '/homework/:id',
    { preHandler: [requirePerm('homework:edit')], schema: { tags: tag, summary: 'Edit homework (not once closed)', params: idParam, body: homeworkUpdateBody, response: { 200: homeworkItem } } },
    async (req) => hw.updateHomework(req.db, req.auth, actorOf(req), req.params.id, req.body),
  );

  app.post(
    '/homework/:id/publish',
    { preHandler: [requirePerm('homework:publish')], schema: { tags: tag, summary: 'Publish a draft; notifies students and their verified guardians', params: idParam, response: { 200: homeworkItem } } },
    async (req) => hw.publishHomework(req.db, req.tenant, req.auth, actorOf(req), req.params.id),
  );

  app.post(
    '/homework/:id/close',
    { preHandler: [requirePerm('homework:edit')], schema: { tags: tag, summary: 'Close a published homework (no more submissions)', params: idParam, response: { 200: homeworkItem } } },
    async (req) => hw.closeHomework(req.db, req.auth, actorOf(req), req.params.id),
  );

  app.delete(
    '/homework/:id',
    { preHandler: [requirePerm('homework:delete')], schema: { tags: tag, summary: 'Delete homework that has no submissions (otherwise close it)', params: idParam, response: { 200: okSchema } } },
    async (req) => {
      await hw.deleteHomework(req.db, req.auth, actorOf(req), req.params.id);
      return { ok: true as const };
    },
  );

  app.get(
    '/homework/:id/roster',
    {
      preHandler: [requirePerm('submissions:view', 'assigned')],
      schema: { tags: tag, summary: 'Per-homework roster: every student of the section with submitted / late / reviewed / returned / missing', params: idParam, response: { 200: homeworkRosterResponse } },
    },
    async (req) => hw.homeworkRoster(req.db, req.auth, req.params.id),
  );

  // ── submissions ───────────────────────────────────────────────────────────

  app.post(
    '/homework/:id/submit',
    {
      preHandler: [requirePerm('submissions:create')],
      schema: {
        tags: subTag,
        summary: 'Student submits (or resubmits) their work',
        description: 'Late when past the due time. Resubmitting is allowed until the teacher reviews it (409 SUBMISSION_LOCKED); a returned submission can be resubmitted. 409 HOMEWORK_CLOSED once closed.',
        params: idParam,
        body: homeworkSubmitBody,
        response: { 200: submissionItem },
      },
    },
    async (req) => sub.submitHomework(req.db, req.auth, req.params.id, req.body),
  );

  app.get(
    '/homework/:id/submission',
    {
      preHandler: [requirePerm('submissions:view')],
      schema: { tags: subTag, summary: 'My (or my child’s, via ?studentId=) submission for this homework — 404 NOT_SUBMITTED when none', params: idParam, querystring: homeworkDetailQuery, response: { 200: submissionItem } },
    },
    async (req) => sub.mySubmission(req.db, req.auth, req.params.id, req.query.studentId),
  );

  app.get(
    '/submissions',
    {
      preHandler: [requirePerm('submissions:view')],
      schema: { tags: subTag, summary: 'Submissions visible to me (teachers: their classes; students/parents: own / linked children)', querystring: submissionListQuery, response: { 200: paged(submissionItem) } },
    },
    async (req) => {
      const { rows, total } = await sub.listSubmissions(req.db, req.auth, req.query);
      return pagedResult(rows, total, req.query);
    },
  );

  app.get(
    '/submissions/:id',
    { preHandler: [requirePerm('submissions:view')], schema: { tags: subTag, summary: 'One submission', params: idParam, response: { 200: submissionItem } } },
    async (req) => sub.getSubmission(req.db, req.auth, req.params.id),
  );

  app.post(
    '/submissions/:id/review',
    {
      // students hold submissions:edit at `own` (to resubmit) — reviewing needs at least `assigned`
      preHandler: [requirePerm('submissions:edit', 'assigned')],
      schema: { tags: subTag, summary: 'Teacher reviews: marks (≤ max) and/or feedback → reviewed; the student is notified', params: idParam, body: submissionReviewBody, response: { 200: submissionItem } },
    },
    async (req) => sub.reviewSubmission(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.body),
  );

  app.post(
    '/submissions/:id/return',
    {
      preHandler: [requirePerm('submissions:edit', 'assigned')],
      schema: { tags: subTag, summary: 'Teacher returns a submission for rework (feedback required); the student may resubmit', params: idParam, body: submissionReturnBody, response: { 200: submissionItem } },
    },
    async (req) => sub.returnSubmission(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.body),
  );
};

export default homeworkRoutes;
