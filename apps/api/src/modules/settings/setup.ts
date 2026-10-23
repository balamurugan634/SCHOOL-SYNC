import { eq, sql } from 'drizzle-orm';
import type { SetupStatusOut, SetupStepKey } from '@school-sync/shared';
import { getLicense, seatUsage } from '../../core/billing/license';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { academicYears, announcements, enrollments, events, feeStructures, grades, sections, staff, studentGuardians, subjects, teachingAssignments, terms, timetableSlots } from '../../db/tenant/schema';
import { getGroup } from './school';

/**
 * The onboarding checklist behind the web "Get your school ready" wizard.
 * One round trip of cheap `count(*)` subqueries — safe to poll while the admin works through the steps.
 */
export async function setupStatus(db: Executor, tenant: TenantInfo): Promise<SetupStatusOut> {
  const [cur] = await db.select({ id: academicYears.id, name: academicYears.name }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  const y = sql`${cur?.id ?? null}::uuid`;
  const [school, r] = await Promise.all([
    getGroup(db, 'school'),
    db.execute(sql`
      select
        (select count(*)::int from ${academicYears}) as years,
        (select count(*)::int from ${terms} where ${terms.academicYearId} = ${y}) as terms,
        (select count(*)::int from ${grades} where ${grades.isActive}) as grades,
        (select count(*)::int from ${sections} where ${sections.academicYearId} = ${y}) as sections,
        (select count(*)::int from ${sections} where ${sections.academicYearId} = ${y} and ${sections.classTeacherId} is null) as sections_no_ct,
        (select count(*)::int from ${subjects} where ${subjects.isActive}) as subjects,
        (select count(*)::int from ${teachingAssignments} ta join ${sections} s on s.id = ta.section_id where s.academic_year_id = ${y}) as assignments,
        (select count(*)::int from ${sections} s where s.academic_year_id = ${y} and not exists (select 1 from ${teachingAssignments} ta where ta.section_id = s.id)) as sections_no_teacher,
        (select count(*)::int from ${staff} where ${staff.staffType} = 'teaching' and ${staff.status} = 'active') as teachers,
        (select count(distinct ${enrollments.studentId})::int from ${enrollments} where ${enrollments.academicYearId} = ${y} and ${enrollments.status} = 'enrolled') as students,
        (select count(distinct ${studentGuardians.studentId})::int from ${studentGuardians} where ${studentGuardians.verifiedAt} is not null) as verified_children,
        (select count(*)::int from ${studentGuardians} where ${studentGuardians.verifiedAt} is null) as unverified_links,
        (select count(*)::int from ${timetableSlots} t join ${sections} s on s.id = t.section_id where s.academic_year_id = ${y}) as slots,
        (select count(*)::int from ${feeStructures} where ${feeStructures.academicYearId} = ${y} and ${feeStructures.isActive}) as fee_structures,
        (select count(*)::int from ${announcements} where ${announcements.status} = 'published') as announcements,
        (select count(*)::int from ${events} where ${events.status} = 'published') as events
    `),
  ]);
  const n = r.rows[0] as Record<string, number>;
  const plural = (c: number, one: string, many = `${one}s`) => `${c} ${c === 1 ? one : many}`;

  const profileFields = [school.address, school.phone, school.email, school.website, school.affiliation].filter((v) => typeof v === 'string' && v.trim()).length;
  const profileDone = !!String(school.address ?? '').trim() && !!String(school.phone ?? '').trim();

  const step = (key: SetupStepKey, label: string, done: boolean, count: number, hintTodo: string, hintDone: string) => ({ key, label, done, count, hint: done ? hintDone : hintTodo });
  const feesOff = !tenant.features.fees;

  const steps = [
    step('school_profile', 'School profile', profileDone, profileFields, 'Add the school address and phone number in Settings → School profile.', 'School profile is filled in.'),
    step('academic_year', 'Academic year', !!cur, n.years!, 'Create the academic year and make it the current one.', `Current year is ${cur?.name}.`),
    step('terms', 'Terms', n.terms! > 0, n.terms!, 'Add the terms (e.g. Term 1, Term 2) of the current year.', `${plural(n.terms!, 'term')} set up.`),
    step('grades', 'Grades / classes', n.grades! > 0, n.grades!, 'Add the grades (classes) your school teaches.', `${plural(n.grades!, 'grade')} set up.`),
    step(
      'sections',
      'Sections & class teachers',
      n.sections! > 0 && n.sections_no_ct! === 0,
      n.sections!,
      n.sections! === 0 ? 'Create the sections (A, B, …) of each grade for the current year.' : `${plural(n.sections_no_ct!, 'section')} still ${n.sections_no_ct! === 1 ? 'needs' : 'need'} a class teacher.`,
      `${plural(n.sections!, 'section')}, each with a class teacher.`,
    ),
    step('subjects', 'Subjects', n.subjects! > 0, n.subjects!, 'Add the subjects and the grades that offer them.', `${plural(n.subjects!, 'subject')} set up.`),
    step(
      'teaching_assignments',
      'Subject teachers',
      n.assignments! > 0 && n.sections_no_teacher! === 0,
      n.assignments!,
      n.assignments! === 0 ? 'Assign a teacher to each subject in each section.' : `${plural(n.sections_no_teacher!, 'section')} ${n.sections_no_teacher! === 1 ? 'has' : 'have'} no subject teachers yet.`,
      `${plural(n.assignments!, 'teaching assignment')} in place.`,
    ),
    step('teachers', 'Teachers', n.teachers! > 0, n.teachers!, 'Add your teaching staff (People → Staff).', `${plural(n.teachers!, 'teacher')} added.`),
    step('students', 'Students', n.students! > 0, n.students!, 'Add students one by one, import a spreadsheet, or enrol accepted admissions.', `${plural(n.students!, 'student')} enrolled this year.`),
    step(
      'parents_linked',
      'Parents linked & verified',
      n.verified_children! > 0,
      n.verified_children!,
      n.unverified_links! > 0 ? `${plural(n.unverified_links!, 'parent link')} waiting for verification.` : 'Link parents to their children and verify the links so they can sign in.',
      n.unverified_links! > 0 ? `${plural(n.verified_children!, 'student')} with a verified parent; ${plural(n.unverified_links!, 'link')} still to verify.` : `${plural(n.verified_children!, 'student')} with a verified parent.`,
    ),
    step('timetable', 'Timetable', n.slots! > 0, n.slots!, 'Build the weekly timetable for each section.', `${plural(n.slots!, 'timetable slot')} scheduled.`),
    feesOff
      ? { key: 'fee_structure' as const, label: 'Fee structure', done: true, count: n.fee_structures!, hint: 'Fees are switched off for this school.' }
      : step('fee_structure', 'Fee structure', n.fee_structures! > 0, n.fee_structures!, 'Create a fee structure for the current year.', `${plural(n.fee_structures!, 'fee structure')} set up.`),
    step('communication', 'First announcement or event', n.announcements! + n.events! > 0, n.announcements! + n.events!, 'Publish a welcome announcement or add an event to the calendar.', `${plural(n.announcements!, 'announcement')} and ${plural(n.events!, 'event')} published.`),
  ];

  const done = steps.filter((s) => s.done).length;
  const lic = await getLicense(tenant.id);
  return {
    steps,
    progress: { done, total: steps.length, percent: Math.round((done / steps.length) * 100) },
    ready: done === steps.length,
    license: { state: lic.state, readOnly: lic.readOnly, academicYear: lic.subscription?.academicYear ?? null, daysLeft: lic.daysLeft, seats: await seatUsage(db, lic) },
  };
}
