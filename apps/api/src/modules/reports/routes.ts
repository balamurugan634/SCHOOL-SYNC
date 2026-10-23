import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { experienceFor, managementDashboard, parentDashboard, parentDashboardQuery, studentDashboard, teacherDashboard } from '@school-sync/shared';
import { forbidden } from '../../core/errors';
import { requireAuth } from '../../plugins/guards';
import { ctxOf } from '../attendance/common';
import * as svc from './dashboard';

const tags = ['Dashboard'];

/**
 * One call per home screen. Each endpoint is for one experience (a student's token gets 403 on /dashboard/management) and
 * composes the owning modules' services, so every figure matches the screen it links to.
 */
const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  const only = (exp: 'student' | 'parent' | 'teacher' | 'management') => async (req: Parameters<typeof requireAuth>[0], reply: Parameters<typeof requireAuth>[1]) => {
    await requireAuth(req, reply);
    if (experienceFor(req.auth.roles) !== exp && !(exp === 'teacher' && req.auth.staffId && req.auth.assignedSectionIds.length)) throw forbidden('This home screen is for a different role', 'WRONG_EXPERIENCE');
  };

  app.get('/dashboard/student', { preHandler: [only('student')], schema: { tags, summary: 'Student home: today’s classes, attendance, homework, tasks, exams, announcements', response: { 200: studentDashboard } } }, async (req) => svc.studentDashboard(ctxOf(req)));

  app.get('/dashboard/parent', { preHandler: [only('parent')], schema: { tags, summary: 'Parent home: every linked child at a glance + the selected child’s day, fees, meetings', querystring: parentDashboardQuery, response: { 200: parentDashboard } } }, async (req) => svc.parentDashboard(ctxOf(req), req.query.studentId));

  app.get('/dashboard/teacher', { preHandler: [only('teacher')], schema: { tags, summary: 'Teacher home: today’s timetable, unmarked attendance, homework to review, marks to enter', response: { 200: teacherDashboard } } }, async (req) => svc.teacherDashboard(ctxOf(req)));

  app.get('/dashboard/management', { preHandler: [only('management')], schema: { tags, summary: 'Management home: KPIs, attendance, approvals queue, finance, alerts (each block only if permitted)', response: { 200: managementDashboard } } }, async (req) => svc.managementDashboard(ctxOf(req)));
};

export default dashboardRoutes;
