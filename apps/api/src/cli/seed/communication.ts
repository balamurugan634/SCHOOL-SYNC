import { v7 as uuidv7 } from 'uuid';
import { addDaysIso, todayIn } from '../../core/http';
import { announcementReceipts, announcements, audienceTargets, eventRegistrations, events, meetings, notificationPreferences, notifications } from '../../db/tenant/schema';
import { resolveAudienceUserIds } from '../../modules/communication/audience';
import type { ModuleSeeder, SeedContext } from './context';

/**
 * Demo data for communication: announcements (urgent / important / scheduled / class-specific / needing acknowledgement,
 * with read + ack receipts), the school calendar (holidays, sports day, PTM day with registration, a field trip with
 * consent, exams), meetings in every status, and a lived-in notification inbox for the first student / parent / teacher.
 */
export const seed: ModuleSeeder = async (ctx) => {
  const { db, tenant } = ctx;
  const tz = tenant.timezone;
  const today = todayIn(tz);
  const now = Date.now();
  const ago = (days: number, hours = 0) => new Date(now - days * 86_400_000 - hours * 3_600_000);
  const ahead = (days: number, hours = 0) => new Date(now + days * 86_400_000 + hours * 3_600_000);
  const chunks = async <T>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
  };

  const principal = ctx.staff.principal!;
  const office = ctx.staff.office!;
  const t0 = ctx.teachers[0]!; // class teacher of the first section
  const sec0 = ctx.sections[0]!;
  const student0 = ctx.students[0]!;
  const guardian0 = ctx.guardians.find((g) => g.id === student0.guardianId)!;
  const yearStart = Number(ctx.yearName.slice(0, 4));

  // ── announcements ─────────────────────────────────────────────────────────────────────────────
  type Ann = { key: string; title: string; body: string; priority: 'normal' | 'important' | 'urgent'; status: 'draft' | 'published' | 'archived'; by: string; publishAt: Date | null; expiresAt?: Date | null; ack?: boolean; audience: { type: 'all' | 'user_type' | 'section' | 'grade' | 'role'; id: string }[]; read: number; acked: number };
  const A: Ann[] = [
    { key: 'rain', title: 'School closed tomorrow due to heavy rain', body: 'Following the weather advisory, the school will remain closed tomorrow. Online worksheets will be shared by class teachers. Classes resume the day after.', priority: 'urgent', status: 'published', by: principal.userId, publishAt: ago(0, 3), audience: [{ type: 'all', id: '*' }], read: 0.8, acked: 0 },
    { key: 'annual', title: 'Annual Day rehearsal schedule', body: 'Rehearsals for the Annual Day programme begin next week after school (3:30–5:00 pm). Participating students will receive their group lists from class teachers. Please ensure safe transport home.', priority: 'important', status: 'published', by: office.userId, publishAt: ago(1, 6), audience: [{ type: 'user_type', id: 'parent' }, { type: 'user_type', id: 'student' }], read: 0.62, acked: 0 },
    { key: 'ptm-soon', title: 'Parent–teacher meeting: registration opens Monday', body: 'Registration for the next Parent–Teacher Meeting opens on Monday at 9:00 am in the Events section of the app. Slots are limited — please register early.', priority: 'normal', status: 'draft', by: principal.userId, publishAt: ahead(1, 4), audience: [{ type: 'user_type', id: 'parent' }], read: 0, acked: 0 },
    { key: 'science', title: `${sec0.gradeName} ${sec0.name}: science project submission`, body: 'Please submit your science project charts and models by Friday. Projects will be displayed in the corridor exhibition. Label every item with name and roll number.', priority: 'normal', status: 'published', by: t0.userId, publishAt: ago(2, 2), audience: [{ type: 'section', id: sec0.id }], read: 0.7, acked: 0 },
    { key: 'conduct', title: 'Updated code of conduct and bus safety policy', body: 'The school has updated its code of conduct and school-bus safety policy for this year. Please read the attached summary with your child and acknowledge in the app. Acknowledgement is required for transport and extracurricular participation.', priority: 'important', status: 'published', by: principal.userId, publishAt: ago(5), audience: [{ type: 'user_type', id: 'parent' }, { type: 'user_type', id: 'student' }], ack: true, read: 0.72, acked: 0.42 },
    { key: 'library', title: 'Library week: book fair and reading challenge', body: 'The library is celebrating Reading Week with a book fair, author talk and a reading challenge for all classes. Visit the library during breaks to register.', priority: 'normal', status: 'published', by: office.userId, publishAt: ago(12), expiresAt: ahead(6), audience: [{ type: 'all', id: '*' }], read: 0.45, acked: 0 },
    { key: 'staff', title: 'Staff meeting on Friday', body: 'All teaching staff are requested to attend the staff meeting on Friday at 3:45 pm in the conference room. Agenda: term-end assessments and the Annual Day.', priority: 'normal', status: 'published', by: principal.userId, publishAt: ago(3), audience: [{ type: 'user_type', id: 'staff' }], read: 0.8, acked: 0 },
    { key: 'uniform', title: 'Winter uniform reminder', body: 'Winter uniform is mandatory from the first week of December. Plain navy sweaters only.', priority: 'normal', status: 'archived', by: office.userId, publishAt: ago(40), expiresAt: ago(10), audience: [{ type: 'user_type', id: 'parent' }], read: 0.9, acked: 0 },
    { key: 'sports-draft', title: 'Sports Day circular (draft)', body: 'Draft circular for Sports Day: reporting time, uniform, and house colours.', priority: 'normal', status: 'draft', by: principal.userId, publishAt: null, audience: [{ type: 'all', id: '*' }], read: 0, acked: 0 },
  ];
  const annRows = A.map((a) => ({ ...a, id: uuidv7() }));
  await db.insert(announcements).values(
    annRows.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      priority: a.priority,
      status: a.status,
      requiresAck: !!a.ack,
      publishAt: a.publishAt,
      expiresAt: a.expiresAt ?? null,
      createdBy: a.by,
      publishedBy: a.status === 'draft' ? null : a.by,
    })),
  );
  await db.insert(audienceTargets).values(annRows.flatMap((a) => a.audience.map((t) => ({ ownerType: 'announcement' as const, ownerId: a.id, targetType: t.type, targetId: t.id }))));

  // receipts + the inbox notification each recipient got when it was published
  const firstStudentUsers = new Set([student0.userId, guardian0.userId]);
  const receipts: (typeof announcementReceipts.$inferInsert)[] = [];
  const inbox: (typeof notifications.$inferInsert)[] = [];
  for (const a of annRows.filter((x) => x.status !== 'draft')) {
    const audience = (await resolveAudienceUserIds(db, 'announcement', a.id)).filter((u) => u !== a.by);
    for (const uid of audience) {
      // the demo student and parent: read the urgent notice and the class announcement, but not the acknowledgement one
      const demo = firstStudentUsers.has(uid);
      const read = demo ? a.key === 'rain' || a.key === 'science' || a.key === 'library' : ctx.rng() < a.read;
      const acked = !demo && !!a.ack && read && ctx.rng() < a.acked / Math.max(a.read, 0.01);
      const at = new Date((a.publishAt as Date).getTime() + 60_000);
      if (read) receipts.push({ announcementId: a.id, userId: uid, readAt: new Date(at.getTime() + Math.floor(ctx.rng() * 36) * 3_600_000), ackedAt: acked ? new Date(at.getTime() + Math.floor(ctx.rng() * 48 + 1) * 3_600_000) : null });
      inbox.push({
        userId: uid,
        type: 'announcement.new',
        title: a.title,
        body: a.body.length > 140 ? `${a.body.slice(0, 139)}…` : a.body,
        data: { route: `/announcements/${a.id}`, announcementId: a.id },
        priority: a.priority === 'urgent' ? 'high' : 'normal',
        readAt: read ? new Date(at.getTime() + 3_600_000) : null,
        pushStatus: 'sent',
        pushedAt: at,
        createdAt: at,
      });
    }
  }
  await chunks(receipts, 500, (c) => db.insert(announcementReceipts).values(c));

  // ── events & calendar ─────────────────────────────────────────────────────────────────────────
  const hol = (name: string, from: string, to = from) => ({ title: name, kind: 'holiday' as const, startDate: from, endDate: to });
  const holidays = [
    hol('Dr. Ambedkar Jayanti', `${yearStart}-04-14`),
    hol('May Day', `${yearStart}-05-01`),
    hol('Independence Day', `${yearStart}-08-15`),
    hol('Gandhi Jayanti', `${yearStart}-10-02`),
    hol('Dussehra', `${yearStart}-10-20`),
    hol('Diwali break', `${yearStart}-11-07`, `${yearStart}-11-11`),
    hol('Christmas', `${yearStart}-12-25`),
    hol('Winter break', `${yearStart}-12-26`, `${yearStart}-12-31`),
    hol('Republic Day', `${yearStart + 1}-01-26`),
    hol('Holi', `${yearStart + 1}-03-04`),
  ];
  const E: { key: string; title: string; description?: string; kind: 'holiday' | 'event' | 'exam' | 'ptm' | 'sports' | 'other'; startDate: string; endDate: string; startTime?: string; endTime?: string; location?: string; status: 'draft' | 'published' | 'cancelled'; reg?: boolean; consent?: boolean; consentText?: string; deadline?: Date; capacity?: number; by: string; audience: { type: 'all' | 'user_type' | 'grade' | 'section'; id: string }[] }[] = [
    ...holidays.map((h, i) => ({ key: `hol${i}`, ...h, status: 'published' as const, by: office.userId, audience: [{ type: 'all' as const, id: '*' }] })),
    { key: 'sports', title: 'Annual Sports Day', description: 'Track and field events, house relays and the march past. Students report in house colours by 8:15 am. Parents are welcome from 10:00 am.', kind: 'sports', startDate: addDaysIso(today, 21), endDate: addDaysIso(today, 21), startTime: '08:30', endTime: '15:00', location: 'School Ground', status: 'published', reg: true, deadline: ahead(14), by: principal.userId, audience: [{ type: 'user_type', id: 'student' }, { type: 'user_type', id: 'parent' }] },
    { key: 'ptm', title: 'Parent–Teacher Meeting', description: 'Meet class teachers to discuss progress. Register one slot per child; each slot is 10 minutes.', kind: 'ptm', startDate: addDaysIso(today, 12), endDate: addDaysIso(today, 12), startTime: '09:00', endTime: '13:00', location: 'Classrooms', status: 'published', reg: true, deadline: ahead(9), capacity: 120, by: principal.userId, audience: [{ type: 'user_type', id: 'parent' }] },
    { key: 'trip', title: `${sec0.gradeName} field trip: City Zoo & Science Park`, description: 'A full-day educational visit with teachers and attendants. Bus leaves at 8:00 am and returns by 4:30 pm. Packed lunch required.', kind: 'event', startDate: addDaysIso(today, 18), endDate: addDaysIso(today, 18), startTime: '08:00', endTime: '16:30', location: 'City Zoo', status: 'published', consent: true, consentText: 'I give permission for my child to take part in the school trip to City Zoo & Science Park, and I accept the school’s safety guidelines. I understand my child will travel by the school bus.', deadline: ahead(10), by: t0.userId, audience: [{ type: 'grade', id: sec0.gradeId }] },
    { key: 'exams', title: 'Mid-term examinations', description: 'Mid-term examinations begin. Detailed paper schedule is under Exams.', kind: 'exam', startDate: addDaysIso(today, 30), endDate: addDaysIso(today, 36), status: 'published', by: principal.userId, audience: [{ type: 'all', id: '*' }] },
    { key: 'sciexpo', title: 'Science Exhibition', description: 'Student projects on display; judged by invited faculty.', kind: 'event', startDate: addDaysIso(today, -20), endDate: addDaysIso(today, -20), startTime: '10:00', endTime: '14:00', location: 'Assembly Hall', status: 'published', by: office.userId, audience: [{ type: 'all', id: '*' }] },
    { key: 'quiz', title: 'Inter-school quiz', description: 'Postponed by the organising school.', kind: 'other', startDate: addDaysIso(today, 8), endDate: addDaysIso(today, 8), status: 'cancelled', by: principal.userId, audience: [{ type: 'user_type', id: 'student' }] },
    { key: 'annualday', title: 'Annual Day', description: 'Draft: programme being finalised.', kind: 'event', startDate: addDaysIso(today, 60), endDate: addDaysIso(today, 60), startTime: '17:00', endTime: '20:00', location: 'Auditorium', status: 'draft', by: principal.userId, audience: [{ type: 'all', id: '*' }] },
  ];
  const evRows = E.map((e) => ({ ...e, id: uuidv7() }));
  await db.insert(events).values(
    evRows.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description ?? null,
      kind: e.kind,
      startDate: e.startDate,
      endDate: e.endDate,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
      allDay: !e.startTime,
      location: e.location ?? null,
      audienceAll: e.audience.some((t) => t.type === 'all'),
      registrationRequired: !!e.reg,
      consentRequired: !!e.consent,
      consentText: e.consentText ?? null,
      registrationDeadline: e.deadline ?? null,
      capacity: e.capacity ?? null,
      status: e.status,
      createdBy: e.by,
    })),
  );
  await db.insert(audienceTargets).values(evRows.flatMap((e) => e.audience.map((t) => ({ ownerType: 'event' as const, ownerId: e.id, targetType: t.type, targetId: t.id }))));

  // responses: sports day (students answer), PTM (one parent answer per child), trip (parents consent)
  const registrations: (typeof eventRegistrations.$inferInsert)[] = [];
  const guardianUser = new Map(ctx.guardians.map((g) => [g.id, g.userId]));
  const evId = (key: string) => evRows.find((e) => e.key === key)!.id;
  for (const st of ctx.students) {
    if (st.id !== student0.id && ctx.rng() < 0.55) registrations.push({ eventId: evId('sports'), studentId: st.id, respondedBy: st.userId, response: ctx.rng() < 0.85 ? 'going' : 'not_going', respondedAt: ago(ctx.int(0, 5), ctx.int(0, 20)) });
    if (st.id !== student0.id && ctx.rng() < 0.5) registrations.push({ eventId: evId('ptm'), studentId: st.id, respondedBy: guardianUser.get(st.guardianId)!, response: ctx.rng() < 0.9 ? 'going' : 'not_going', respondedAt: ago(ctx.int(0, 4), ctx.int(0, 20)) });
    if (st.gradeId === sec0.gradeId && st.id !== student0.id && ctx.rng() < 0.62) registrations.push({ eventId: evId('trip'), studentId: st.id, respondedBy: guardianUser.get(st.guardianId)!, response: ctx.rng() < 0.86 ? 'consent_given' : 'consent_denied', note: null, respondedAt: ago(ctx.int(0, 6), ctx.int(0, 20)) });
  }
  await chunks(registrations, 500, (c) => db.insert(eventRegistrations).values(c));

  // events people were told about
  const announced = ['sports', 'ptm', 'trip', 'exams'];
  for (const key of announced) {
    const e = evRows.find((x) => x.key === key)!;
    const audience = (await resolveAudienceUserIds(db, 'event', e.id)).filter((u) => u !== e.by);
    const at = ago(ctx.int(1, 4), ctx.int(0, 8));
    await chunks(
      audience.map((userId) => ({ userId, type: 'event.new', title: `New: ${e.title}`, body: `${e.startDate}${e.reg || e.consent ? '. Your response is needed.' : ''}`, data: { route: `/events/${e.id}`, eventId: e.id }, priority: 'normal' as const, readAt: ctx.rng() < 0.5 ? at : null, pushStatus: 'sent' as const, createdAt: at })),
      500,
      (c) => db.insert(notifications).values(c),
    );
  }
  await chunks(inbox, 500, (c) => db.insert(notifications).values(c));

  // ── parent–teacher meetings: every status ────────────────────────────────────────────────────
  const staffById = new Map([...ctx.teachers, ...Object.values(ctx.staff)].map((t) => [t.id, t]));
  const subjectTeacher = ctx.assignments.find((a) => a.sectionId === sec0.id && a.staffId !== t0.id)?.staffId ?? t0.id;
  // school-local wall-clock time (demo schools run on IST)
  const slot = (days: number, hour: number, min = 0) => new Date(`${addDaysIso(today, days)}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+05:30`);
  const familyOf = (i: number) => {
    const st = ctx.students.filter((s) => s.sectionId === sec0.id)[i] ?? ctx.students[i]!;
    return { st, g: ctx.guardians.find((g) => g.id === st.guardianId)! };
  };
  const M: { st: (typeof ctx.students)[number]; g: (typeof ctx.guardians)[number]; staffId: string; topic: string; status: 'requested' | 'confirmed' | 'declined' | 'completed' | 'cancelled'; proposedAt?: Date; scheduledAt?: Date; mode?: 'in_person' | 'online' | 'phone'; where?: string; notes?: string; created: Date }[] = [
    { st: student0, g: guardian0, staffId: subjectTeacher, topic: 'Discuss progress in Mathematics and the upcoming mid-term', status: 'requested', proposedAt: slot(5, 15), created: ago(1, 3) },
    { st: student0, g: guardian0, staffId: t0.id, topic: 'Settling in and attendance this term', status: 'confirmed', scheduledAt: slot(3, 10, 30), mode: 'in_person', where: `Room ${sec0.gradeName.replace('Grade ', '')}${sec0.name}`, created: ago(4) },
    { st: student0, g: guardian0, staffId: t0.id, topic: 'Review of first unit test results', status: 'completed', scheduledAt: slot(-10, 11), mode: 'in_person', where: 'Staff room', notes: 'Strong in languages. Agreed a weekly practice plan for Mathematics and a check-in after the mid-term.', created: ago(14) },
    { st: student0, g: guardian0, staffId: subjectTeacher, topic: 'Extra classes for Science', status: 'declined', notes: 'Extra classes are not offered this term; please see the class teacher about the revision sessions.', created: ago(8) },
    { ...familyOf(1), staffId: t0.id, topic: 'Concerned about recent absences', status: 'requested', proposedAt: slot(6, 9), created: ago(0, 6) },
    { ...familyOf(2), staffId: t0.id, topic: 'Homework load at home', status: 'requested', proposedAt: slot(7, 16), created: ago(2) },
    { ...familyOf(3), staffId: t0.id, topic: 'Career guidance and subject choices', status: 'confirmed', scheduledAt: slot(2, 14), mode: 'online', where: 'https://meet.example.org/greenvalley-ptm-3', created: ago(5) },
    { ...familyOf(4), staffId: t0.id, topic: 'Change of bus route', status: 'cancelled', notes: 'Resolved over the phone.', created: ago(6) },
  ];
  await db.insert(meetings).values(
    M.map((m) => ({
      studentId: m.st.id,
      guardianId: m.g.id,
      staffId: m.staffId,
      requestedBy: m.g.userId,
      topic: m.topic,
      proposedAt: m.proposedAt ?? null,
      scheduledAt: m.scheduledAt ?? null,
      durationMin: 15,
      mode: m.mode ?? ('in_person' as const),
      locationOrLink: m.where ?? null,
      status: m.status,
      outcomeNotes: m.notes ?? null,
      decidedBy: m.status === 'requested' ? null : (staffById.get(m.staffId)?.userId ?? null),
      createdAt: m.created,
    })),
  );
  const mtgNotes: (typeof notifications.$inferInsert)[] = [];
  for (const m of M) {
    const tUser = staffById.get(m.staffId)?.userId;
    if (tUser) mtgNotes.push({ userId: tUser, type: 'meeting.requested', title: 'New meeting request', data: { route: '/meetings' }, readAt: m.status === 'requested' ? null : m.created, pushStatus: 'sent', createdAt: m.created });
    if (m.status === 'confirmed' || m.status === 'declined') mtgNotes.push({ userId: m.g.userId, type: m.status === 'confirmed' ? 'meeting.confirmed' : 'meeting.declined', title: m.status === 'confirmed' ? 'Meeting confirmed' : 'Meeting request declined', data: { route: '/meetings' }, readAt: m.g.id === guardian0.id && m.status === 'confirmed' ? null : m.created, pushStatus: 'sent', createdAt: new Date(m.created.getTime() + 3_600_000) });
  }
  await db.insert(notifications).values(mtgNotes);

  // ── a lived-in inbox for the demo student, parent and teacher ──────────────────────────────────
  type T = [type: string, title: string, body: string, route: string, priority?: 'high'];
  const studentT: T[] = [
    ['homework.assigned', 'New homework: Mathematics', 'Chapter 5 exercises 5.1–5.3 · due Friday', '/homework'],
    ['homework.assigned', 'New homework: English', 'Write a page on “My favourite season” · due Monday', '/homework'],
    ['homework.reminder', 'Homework due tomorrow', 'Science worksheet — Light and Shadows', '/homework'],
    ['marks.published', 'Unit test results published', 'Open the app to view your marks.', '/results'],
    ['attendance.late', 'Marked late today', 'You were marked late for Period 1.', '/attendance'],
    ['tasks.reminder', 'Reminder: Science project', 'Finish the chart paper before Friday.', '/tasks'],
    ['leave.decided', 'Leave request approved', 'Your leave request was approved by your class teacher.', '/leave'],
    ['event.new', 'New: Annual Sports Day', 'Register to take part', '/events'],
    ['system.notice', 'Welcome to SchoolSync', 'Find homework, results and announcements here.', '/'],
  ];
  const parentT: T[] = [
    ['attendance.absent', `${student0.name.split(' ')[0]} was marked absent today`, 'Please send a leave note if this was planned.', '/attendance', 'high'],
    ['fees.due', 'Fee invoice due soon', 'Open the app to view your invoice.', '/fees/invoices'],
    ['fees.receipt', 'Payment received', 'Thank you — your receipt is available.', '/fees/invoices'],
    ['marks.published', 'Unit test results published', 'Open the app to view the results.', '/results'],
    ['leave.decided', 'Leave request approved', 'The class teacher approved your leave request.', '/leave'],
    ['homework.assigned', 'New homework assigned', 'Mathematics · due Friday', '/homework'],
    ['event.new', 'New: Parent–Teacher Meeting', 'Your response is needed.', '/events'],
    ['attendance.shortage', 'Attendance below 75%', 'Attendance has dropped below the school minimum.', '/attendance'],
    ['system.notice', 'School app update', 'Parents can now request meetings with teachers in the app.', '/'],
  ];
  const teacherT: T[] = [
    ['leave.requested', 'New leave request', 'A parent has applied for leave for a student in your class.', '/leave'],
    ['meeting.requested', 'New meeting request', 'A parent has asked to meet you.', '/meetings'],
    ['homework.submitted', 'New homework submissions', '5 students have submitted Mathematics homework.', '/homework'],
    ['attendance.reminder', 'Attendance not marked yet', `Attendance for ${sec0.gradeName} ${sec0.name} is pending.`, '/attendance'],
    ['marks.reminder', 'Marks entry due', 'Enter unit-test marks before Thursday.', '/exams'],
    ['tasks.reminder', 'Reminder: lesson plan', 'Update topic progress for this week.', '/syllabus'],
    ['event.new', 'New: Staff meeting', 'Friday 3:45 pm, conference room.', '/events'],
    ['system.notice', 'Timetable updated', 'Period 4 on Wednesday has changed.', '/timetable'],
  ];
  const personal: (typeof notifications.$inferInsert)[] = [];
  for (const [userId, templates] of [[student0.userId, studentT], [guardian0.userId, parentT], [t0.userId, teacherT]] as const) {
    for (let i = 0; i < 30; i++) {
      const [type, title, body, route, priority] = templates[(i * 7 + Math.floor(ctx.rng() * 3)) % templates.length]!;
      const at = ago(Math.floor((i / 30) * 10), ctx.int(0, 20));
      personal.push({ userId, type, title, body, data: { route }, priority: priority ?? 'normal', readAt: i < 6 ? (ctx.rng() < 0.75 ? null : at) : ctx.rng() < 0.3 ? null : new Date(at.getTime() + 1_800_000), pushStatus: 'sent', pushedAt: at, createdAt: at });
    }
  }
  await chunks(personal, 500, (c) => db.insert(notifications).values(c));

  // ── preferences: a parent who wants announcement emails and quiet evenings, a teacher who mutes task reminders ──
  await db.insert(notificationPreferences).values([
    { userId: guardian0.userId, category: 'announcement', push: true, email: true },
    { userId: guardian0.userId, category: 'event', push: true, email: false, quietFrom: '22:00', quietTo: '06:30' },
    { userId: t0.userId, category: 'tasks', push: false, email: false },
  ]);
};
