import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  idParam,
  materialCreateBody,
  materialItem,
  materialListQuery,
  materialUpdateBody,
  okSchema,
  paged,
  syllabusBulkProgressBody,
  syllabusCoverageQuery,
  syllabusCoverageResponse,
  syllabusListQuery,
  syllabusProgressBody,
  syllabusProgressResponse,
  syllabusTopicCreateBody,
  syllabusTopicItem,
  syllabusTopicUpdateBody,
  syllabusTopicsResponse,
  homeworkDetailQuery,
} from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { paged as pagedResult } from '../../core/http';
import { requirePerm } from '../../plugins/guards';
import * as mat from './materials.service';
import * as syl from './syllabus.service';

const matTag = ['Materials'];
const sylTag = ['Syllabus'];

const materialRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── study materials ───────────────────────────────────────────────────────

  app.get(
    '/materials',
    {
      preHandler: [requirePerm('materials:view')],
      schema: {
        tags: matTag,
        summary: 'Study materials for my section / grade (students, parents via ?studentId=) or the classes I teach (teachers)',
        querystring: materialListQuery,
        response: { 200: paged(materialItem) },
      },
    },
    async (req) => {
      const { rows, total } = await mat.listMaterials(req.db, req.auth, req.query);
      return pagedResult(rows, total, req.query);
    },
  );

  app.get(
    '/materials/:id',
    { preHandler: [requirePerm('materials:view')], schema: { tags: matTag, summary: 'One study material', params: idParam, querystring: homeworkDetailQuery, response: { 200: materialItem } } },
    async (req) => mat.getMaterial(req.db, req.auth, req.params.id, req.query.studentId),
  );

  app.post(
    '/materials',
    {
      preHandler: [requirePerm('materials:create')],
      schema: {
        tags: matTag,
        summary: 'Publish a study material (uploaded file or link) for a section, or for a whole grade + subject',
        description: 'Teachers: only subjects they teach (403 NOT_TEACHING_SUBJECT). Attach an uploaded file with `fileId` (validated) or a link with `url`.',
        body: materialCreateBody,
        response: { 201: materialItem },
      },
    },
    async (req, reply) => reply.status(201).send(await mat.createMaterial(req.db, req.auth, actorOf(req), req.body)),
  );

  app.patch(
    '/materials/:id',
    { preHandler: [requirePerm('materials:edit')], schema: { tags: matTag, summary: 'Edit a material you manage', params: idParam, body: materialUpdateBody, response: { 200: materialItem } } },
    async (req) => mat.updateMaterial(req.db, req.auth, actorOf(req), req.params.id, req.body),
  );

  app.delete(
    '/materials/:id',
    { preHandler: [requirePerm('materials:delete')], schema: { tags: matTag, summary: 'Archive a material (hidden from students and parents; kept for history)', params: idParam, response: { 200: okSchema } } },
    async (req) => {
      await mat.archiveMaterial(req.db, req.auth, actorOf(req), req.params.id);
      return { ok: true as const };
    },
  );

  // ── syllabus & lesson progress ────────────────────────────────────────────

  app.get(
    '/syllabus/topics',
    {
      preHandler: [requirePerm('syllabus:view')],
      schema: {
        tags: sylTag,
        summary: 'Syllabus topics of a grade (+subject/term) with the section’s lesson progress',
        description: 'Students/parents get their (child’s) grade and section automatically. Pass `sectionId` to include progress. Capped at 2000 topics.',
        querystring: syllabusListQuery,
        response: { 200: syllabusTopicsResponse },
      },
    },
    async (req) => ({ data: await syl.listTopics(req.db, req.auth, req.query) }),
  );

  app.post(
    '/syllabus/topics',
    {
      preHandler: [requirePerm('syllabus:create')],
      schema: { tags: sylTag, summary: 'Add a syllabus topic for a grade + subject (teachers: only subjects they teach in that grade)', body: syllabusTopicCreateBody, response: { 201: syllabusTopicItem } },
    },
    async (req, reply) => reply.status(201).send(await syl.createTopic(req.db, req.auth, actorOf(req), req.body)),
  );

  app.patch(
    '/syllabus/topics/:id',
    { preHandler: [requirePerm('syllabus:edit')], schema: { tags: sylTag, summary: 'Edit a syllabus topic', params: idParam, body: syllabusTopicUpdateBody, response: { 200: syllabusTopicItem } } },
    async (req) => syl.updateTopic(req.db, req.auth, actorOf(req), req.params.id, req.body),
  );

  app.delete(
    '/syllabus/topics/:id',
    { preHandler: [requirePerm('syllabus:edit')], schema: { tags: sylTag, summary: 'Remove a syllabus topic (and its progress rows)', params: idParam, response: { 200: okSchema } } },
    async (req) => {
      await syl.deleteTopic(req.db, req.auth, actorOf(req), req.params.id);
      return { ok: true as const };
    },
  );

  app.put(
    '/syllabus/topics/:id/progress',
    {
      preHandler: [requirePerm('syllabus:edit')],
      schema: { tags: sylTag, summary: 'Set a section’s progress on one topic (not_started | in_progress | completed)', params: idParam, body: syllabusProgressBody, response: { 200: syllabusProgressResponse } },
    },
    async (req) => ({ data: await syl.setProgress(req.db, req.auth, actorOf(req), req.body.sectionId, [{ topicId: req.params.id, status: req.body.status }]) }),
  );

  app.put(
    '/syllabus/progress',
    {
      preHandler: [requirePerm('syllabus:edit')],
      schema: { tags: sylTag, summary: 'Set a section’s progress on several topics at once (atomic, audited)', body: syllabusBulkProgressBody, response: { 200: syllabusProgressResponse } },
    },
    async (req) => ({ data: await syl.setProgress(req.db, req.auth, actorOf(req), req.body.sectionId, req.body.items) }),
  );

  app.get(
    '/syllabus/coverage',
    {
      preHandler: [requirePerm('syllabus:view')],
      schema: {
        tags: sylTag,
        summary: 'Syllabus coverage % per section and subject (completed topics / all topics of the grade)',
        querystring: syllabusCoverageQuery,
        response: { 200: syllabusCoverageResponse },
      },
    },
    async (req) => ({ data: await syl.coverage(req.db, req.auth, req.query) }),
  );
};

export default materialRoutes;
