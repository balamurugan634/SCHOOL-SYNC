import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  attendanceCorrectionCreateBody,
  attendanceCorrectionDecisionBody,
  attendanceCorrectionItem,
  attendanceCorrectionListQuery,
  attendanceCorrectionListResponse,
  attendanceRosterQuery,
  attendanceRosterResponse,
  attendanceSubmitBody,
  attendanceSubmitResponse,
  idParam,
  uuid,
} from '@school-sync/shared';
import { paged } from '../../core/http';
import { requireAnyPerm, requirePerm } from '../../plugins/guards';
import { ctxOf } from './common';
import * as rc from './rollcall.service';

const tag = ['Attendance'];
const sectionParam = z.object({ sectionId: uuid });

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/attendance/sections/:sectionId',
    {
      preHandler: [requirePerm('attendance:view')],
      schema: {
        tags: tag,
        summary: 'Roll-call roster of a section for a date (and period)',
        description:
          'Staff only. Returns the section’s active students (roll order) with any saved marks; students on approved leave are pre-filled as `leave` (`source: "leave"`). ' +
          '`canSubmit`/`blockedReason` say whether the caller may submit right now (future date, non-working day, holiday, edit window, not the class teacher / period teacher). ' +
          'In `period` mode `periodId` is required. A section outside the caller’s classes is 404.',
        params: sectionParam,
        querystring: attendanceRosterQuery,
        response: { 200: attendanceRosterResponse },
      },
    },
    async (req) => rc.getRoster(ctxOf(req), req.params.sectionId, req.query),
  );

  app.put(
    '/attendance/sections/:sectionId',
    {
      preHandler: [requireAnyPerm('attendance:create', 'attendance:edit')],
      schema: {
        tags: tag,
        summary: 'Submit (or re-submit) the whole roll call of a section — idempotent upsert',
        description:
          'Daily mode: the class teacher (or school scope) marks the section; period mode: the period’s teacher / class teacher / school scope, with `periodId`. ' +
          'List every student, or pass `defaultStatus` for the unlisted ones (students on approved leave become `leave`). Never for a future date, non-working day or holiday. ' +
          'Teachers may re-submit within `attendance.editWindowHours` of the first submission (and take a missed roll call until the end of that date + the window); afterwards 403 `EDIT_WINDOW_CLOSED` — use a correction request. ' +
          'Administrators with `attendance:edit` at school scope may override. When `attendance.notifyParentsOnAbsent` is on, verified guardians of newly absent students get an `attendance.absent` notification after the commit. Audited.',
        params: sectionParam,
        body: attendanceSubmitBody,
        response: { 200: attendanceSubmitResponse },
      },
    },
    async (req) => rc.submitRollCall(ctxOf(req), req.params.sectionId, req.body),
  );

  app.post(
    '/attendance/records/:id/corrections',
    {
      preHandler: [requirePerm('attendance:create')],
      schema: {
        tags: tag,
        summary: 'Ask for a correction of a submitted attendance record (after the edit window)',
        description: 'Only teachers who may mark that section. One pending request per record (409 `CORRECTION_PENDING`). The class teacher — or school-level approvers when the class teacher asks — is notified.',
        params: idParam,
        body: attendanceCorrectionCreateBody,
        response: { 201: attendanceCorrectionItem },
      },
    },
    async (req, reply) => reply.status(201).send(await rc.requestCorrection(ctxOf(req), req.params.id, req.body)),
  );

  app.get(
    '/attendance/corrections',
    {
      preHandler: [requireAnyPerm('attendance:approve', 'attendance:create')],
      schema: {
        tags: tag,
        summary: 'Correction requests (default: pending)',
        description: 'Approvers see requests for sections they lead (class teachers) or all sections (school scope); teachers without approval rights see only their own (`mine`).',
        querystring: attendanceCorrectionListQuery,
        response: { 200: attendanceCorrectionListResponse },
      },
    },
    async (req) => {
      const { rows, total } = await rc.listCorrections(ctxOf(req), req.query);
      return paged(rows, total, req.query);
    },
  );

  app.post(
    '/attendance/corrections/:id/approve',
    {
      preHandler: [requirePerm('attendance:approve')],
      schema: {
        tags: tag,
        summary: 'Approve a correction: applies the change, audits before/after and notifies the student and verified guardians',
        description: 'Class teacher of that section or school scope (404 otherwise). The requester cannot approve their own request unless they hold school scope (403 `SELF_APPROVAL`).',
        params: idParam,
        body: attendanceCorrectionDecisionBody.default({}),
        response: { 200: attendanceCorrectionItem },
      },
    },
    async (req) => rc.decideCorrection(ctxOf(req), req.params.id, 'approved', req.body.note),
  );

  app.post(
    '/attendance/corrections/:id/reject',
    {
      preHandler: [requirePerm('attendance:approve')],
      schema: {
        tags: tag,
        summary: 'Reject a correction (a note is required); the requester is notified',
        params: idParam,
        body: attendanceCorrectionDecisionBody.default({}),
        response: { 200: attendanceCorrectionItem },
      },
    },
    async (req) => rc.decideCorrection(ctxOf(req), req.params.id, 'rejected', req.body.note),
  );
};

export default routes;
