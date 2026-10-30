import { and, asc, eq, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import type { CalendarItem } from '@school-sync/shared';
import { addDaysIso } from '../../core/http';
import { joinUrlOf } from '../../core/online-meetings';
import type { Principal } from '../../core/rbac/principal';
import { assertStudentAccess, sectionScope } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { badRequestRange } from './calendar-range';
import { events, examPapers, exams, grades, homework, sections, students, subjects } from '../../db/tenant/schema';
import { visibleCond } from './events';

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const CAP = 400;

/**
 * One merged, read-only feed for the caller: school events & holidays (their audience), exam papers (their grade / their
 * children’s grades, once the exam is no longer a draft) and homework due dates (their sections). Every source applies
 * the same scope its own endpoints use; nothing here is copied into a table.
 */
export async function calendarFeed(db: Executor, tenant: TenantInfo, p: Principal, q: { from: string; to: string; studentId?: string }): Promise<CalendarItem[]> {
  badRequestRange(q.from, q.to);
  const out: CalendarItem[] = [];

  // a child filter narrows exam papers and homework (parents); it must be someone the caller may see
  let child: { id: string; gradeId: string | null; sectionId: string | null } | null = null;
  if (q.studentId) {
    await assertStudentAccess(db, p, p.scope('exams:view') ? 'exams:view' : 'homework:view', q.studentId);
    const [s] = await db.select({ id: students.id, gradeId: students.currentGradeId, sectionId: students.currentSectionId }).from(students).where(eq(students.id, q.studentId)).limit(1);
    child = s ?? null;
  }
  const own = p.userType === 'student' ? p.studentId : null;

  // 1 ── events & holidays
  const evs = await db
    .select()
    .from(events)
    .where(and(visibleCond(p), ne(events.status, 'draft'), lte(events.startDate, q.to), gte(events.endDate, q.from)))
    .orderBy(asc(events.startDate), asc(events.id))
    .limit(CAP);
  for (const e of evs) {
    out.push({
      id: `event:${e.id}`,
      kind: e.kind,
      title: e.title,
      subtitle: e.status === 'cancelled' ? 'Cancelled' : e.location,
      date: e.startDate,
      endDate: e.endDate,
      startTime: hhmm(e.startTime),
      endTime: hhmm(e.endTime),
      allDay: e.allDay,
      location: e.location,
      status: e.status,
      studentId: null,
      entityId: e.id,
      route: `/events/${e.id}`,
      joinUrl: e.status === 'published' ? joinUrlOf(e) : null,
    });
  }

  // 2 ── exam papers (grade-level schedule)
  const examScope = p.scope('exams:view');
  if (examScope) {
    const gradeFilter = await gradeIdsFor(db, p, examScope, child);
    if (gradeFilter === null || gradeFilter.length) {
      const papers = await db
        .select({ paper: examPapers, examName: exams.name, subject: subjects.name, grade: grades.name })
        .from(examPapers)
        .innerJoin(exams, eq(exams.id, examPapers.examId))
        .innerJoin(subjects, eq(subjects.id, examPapers.subjectId))
        .innerJoin(grades, eq(grades.id, examPapers.gradeId))
        .where(and(ne(exams.status, 'draft'), gte(examPapers.examDate, q.from), lte(examPapers.examDate, q.to), gradeFilter ? inArray(examPapers.gradeId, gradeFilter) : undefined))
        .orderBy(asc(examPapers.examDate), asc(examPapers.startTime))
        .limit(CAP);
      for (const r of papers) {
        const sameDay = r.paper.examDate!;
        out.push({
          id: `exam_paper:${r.paper.id}`,
          kind: 'exam_paper',
          title: `${r.subject} exam`,
          subtitle: [r.examName, gradeFilter === null || gradeFilter.length > 1 || p.userType === 'staff' ? r.grade : null].filter(Boolean).join(' · '),
          date: sameDay,
          endDate: sameDay,
          startTime: hhmm(r.paper.startTime),
          endTime: hhmm(r.paper.endTime),
          allDay: !r.paper.startTime,
          location: r.paper.room,
          status: null,
          studentId: child?.id ?? own ?? null,
          entityId: r.paper.id,
          route: `/results/${r.paper.examId}`,
          joinUrl: null,
        });
      }
    }
  }

  // 3 ── homework due dates
  if (p.scope('homework:view')) {
    const secWhere = child ? (child.sectionId ? eq(homework.sectionId, child.sectionId) : sql`false`) : sectionScope(p, 'homework:view', homework.sectionId);
    const tz = tenant.timezone;
    const dueDate = sql<string>`(${homework.dueAt} at time zone ${tz})::date::text`;
    const dueTime = sql<string>`to_char(${homework.dueAt} at time zone ${tz}, 'HH24:MI')`;
    const hw = await db
      .select({ id: homework.id, title: homework.title, subject: subjects.name, section: sections.name, grade: grades.name, date: dueDate, time: dueTime, sectionId: homework.sectionId })
      .from(homework)
      .innerJoin(subjects, eq(subjects.id, homework.subjectId))
      .innerJoin(sections, eq(sections.id, homework.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(
        and(
          eq(homework.status, 'published'),
          secWhere,
          gte(homework.dueAt, sql`(${q.from}::date)::timestamp at time zone ${tz}`),
          lt(homework.dueAt, sql`(${addDaysIso(q.to, 1)}::date)::timestamp at time zone ${tz}`),
        ),
      )
      .orderBy(asc(homework.dueAt), asc(homework.id))
      .limit(CAP);
    for (const r of hw) {
      out.push({
        id: `homework:${r.id}`,
        kind: 'homework_due',
        title: `Due: ${r.title}`,
        subtitle: p.userType === 'staff' ? `${r.subject} · ${r.grade} ${r.section}` : r.subject,
        date: r.date,
        endDate: r.date,
        startTime: r.time,
        endTime: null,
        allDay: false,
        location: null,
        status: null,
        studentId: child?.id ?? own ?? null,
        entityId: r.id,
        route: `/homework/${r.id}`,
        joinUrl: null,
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.id.localeCompare(b.id));
}

/** Grades whose exam papers the caller may see: `null` = every grade; `[]` = none. */
async function gradeIdsFor(db: Executor, p: Principal, scope: NonNullable<ReturnType<Principal['scope']>>, child: { gradeId: string | null } | null): Promise<string[] | null> {
  if (child) return child.gradeId ? [child.gradeId] : [];
  switch (scope) {
    case 'school':
      return null;
    case 'assigned': {
      if (!p.assignedSectionIds.length) return [];
      const rows = await db.selectDistinct({ id: sections.gradeId }).from(sections).where(inArray(sections.id, p.assignedSectionIds));
      return rows.map((r) => r.id);
    }
    case 'linked':
    case 'own': {
      const ids = scope === 'own' ? (p.studentId ? [p.studentId] : []) : p.linkedStudentIds;
      if (!ids.length) return [];
      const rows = await db.selectDistinct({ id: students.currentGradeId }).from(students).where(inArray(students.id, ids));
      return rows.map((r) => r.id).filter((x): x is string => !!x);
    }
  }
}
