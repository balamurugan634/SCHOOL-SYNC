import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParam, okSchema, paged, timetableDayQuery, timetableDayResponse, timetableGridQuery, timetableGridResponse, timetableReplaceBody, timetableSetSlotBody, timetableSlotItem, timetableSlotsResponse, timetableSubstitutionCreateBody, timetableSubstitutionItem, timetableSubstitutionListQuery } from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { paged as pagedResult } from '../../core/http';
import { requirePerm } from '../../plugins/guards';
import * as svc from './timetable.service';

const tag = ['Timetable'];

/**
 * Timetable rules (enforced by the service, summarised here for API readers):
 *  - a slot's subject must be offered to the section's grade (422 SUBJECT_NOT_OFFERED)
 *  - the teacher must be the one assigned to that subject in that section (422 TEACHER_NOT_ASSIGNED); `allowUnassigned: true` saves anyway with a warning
 *  - a teacher cannot teach two sections in the same day+period (409 TEACHER_CLASH, with the clashing section in the problem body)
 *  - breaks (422 PERIOD_IS_BREAK) and non-working weekdays (422 NOT_A_WORKING_DAY) take no lessons
 */
const timetableRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/timetable/sections/:id',
    {
      preHandler: [requirePerm('timetable:view')],
      schema: { tags: tag, summary: 'Weekly timetable grid of a section (days × periods) with the week’s substitutions', params: idParam, querystring: timetableGridQuery, response: { 200: timetableGridResponse } },
    },
    async (req) => svc.sectionGrid(req.db, req.tenant, req.auth, req.params.id, req.query.date),
  );

  app.put(
    '/timetable/sections/:id',
    {
      preHandler: [requirePerm('timetable:edit')],
      schema: {
        tags: tag,
        summary: 'Replace a section’s whole timetable (validated as a set; atomic, audited)',
        description: 'Slots not in the body are removed. A teacher clash with another section answers 409 TEACHER_CLASH.',
        params: idParam,
        body: timetableReplaceBody,
        response: { 200: timetableSlotsResponse },
      },
    },
    async (req) => ({ data: await svc.replaceSection(req.db, req.auth, actorOf(req), req.params.id, req.body) }),
  );

  app.put(
    '/timetable/slots',
    {
      preHandler: [requirePerm('timetable:edit')],
      schema: {
        tags: tag,
        summary: 'Set one timetable slot (creates or replaces the lesson at section + day + period)',
        description: 'Omit `staffId` to use the teacher assigned to the subject in that section. Returns `warnings: ["TEACHER_NOT_ASSIGNED"]` when saved with allowUnassigned.',
        body: timetableSetSlotBody,
        response: { 200: timetableSlotItem },
      },
    },
    async (req) => svc.setSlot(req.db, req.auth, actorOf(req), req.body),
  );

  app.delete(
    '/timetable/slots/:id',
    { preHandler: [requirePerm('timetable:edit')], schema: { tags: tag, summary: 'Clear a timetable slot', params: idParam, response: { 200: okSchema } } },
    async (req) => {
      await svc.clearSlot(req.db, req.auth, actorOf(req), req.params.id);
      return { ok: true as const };
    },
  );

  app.get(
    '/timetable/me',
    {
      preHandler: [requirePerm('timetable:view')],
      schema: {
        tags: tag,
        summary: 'My school day: a student’s section, a parent’s child (?studentId=), or a teacher’s own lessons including covers',
        querystring: timetableDayQuery,
        response: { 200: timetableDayResponse },
      },
    },
    async (req) => svc.dayView(req.db, req.tenant, req.auth, { date: req.query.date, studentId: req.query.studentId }),
  );

  app.get(
    '/timetable/today',
    {
      preHandler: [requirePerm('timetable:view')],
      schema: {
        tags: tag,
        summary: 'Today’s timetable for the dashboards: entries tagged past/current/upcoming by school time, plus `current` and `next`',
        querystring: timetableDayQuery.pick({ studentId: true }),
        response: { 200: timetableDayResponse },
      },
    },
    async (req) => svc.dayView(req.db, req.tenant, req.auth, { studentId: req.query.studentId, onlyToday: true }),
  );

  app.get(
    '/timetable/substitutions',
    {
      preHandler: [requirePerm('timetable:view')],
      schema: { tags: tag, summary: 'One-day covers in a date range (defaults to the next two weeks) visible to me', querystring: timetableSubstitutionListQuery, response: { 200: paged(timetableSubstitutionItem) } },
    },
    async (req) => {
      const { rows, total } = await svc.listSubstitutions(req.db, req.tenant, req.auth, req.query);
      return pagedResult(rows, total, req.query);
    },
  );

  app.post(
    '/timetable/substitutions',
    {
      preHandler: [requirePerm('timetable:edit')],
      schema: {
        tags: tag,
        summary: 'Arrange a one-day cover for a lesson; the substitute (and the covered teacher) are notified',
        description: '409 TEACHER_CLASH if the substitute already teaches or covers in that period; 409 SUBSTITUTION_EXISTS if the lesson is already covered that date.',
        body: timetableSubstitutionCreateBody,
        response: { 201: timetableSubstitutionItem },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.createSubstitution(req.db, req.tenant, req.auth, actorOf(req), req.body)),
  );

  app.delete(
    '/timetable/substitutions/:id',
    { preHandler: [requirePerm('timetable:edit')], schema: { tags: tag, summary: 'Cancel a one-day cover', params: idParam, response: { 200: okSchema } } },
    async (req) => {
      await svc.removeSubstitution(req.db, req.auth, actorOf(req), req.params.id);
      return { ok: true as const };
    },
  );
};

export default timetableRoutes;
