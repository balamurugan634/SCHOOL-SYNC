import { asc } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { addDaysIso, isoWeekday } from '../../core/http';
import { getSetting } from '../../core/settings';
import { gradeSubjects, homework, homeworkSubmissions, materials, periods, studentTasks, syllabusTopics, timetableSlots, timetableSubstitutions, topicProgress } from '../../db/tenant/schema';
import { zonedDayStart } from '../../modules/learning/common';
import type { ModuleSeeder, SeedContext } from './context';

async function insertChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

const HOUR = 3_600_000;

// ── content pools ─────────────────────────────────────────────────────────────────────────────

const HOMEWORK_TITLES: Record<string, string[]> = {
  ENG: ['Reading comprehension: the unseen passage', 'Essay: My favourite season', 'Grammar worksheet: tenses', 'Letter writing practice', 'Vocabulary: word meanings and sentences'],
  MAT: ['Exercise problems 1 to 10', 'Fractions and decimals worksheet', 'Word problems practice', 'Geometry: construct and label', 'Algebra: solving linear equations'],
  SCI: ['Draw and label the diagram', 'Chapter questions and answers', 'Home experiment report', 'Revision worksheet: states of matter', 'Project: life cycle of a plant'],
  SST: ['Map work: major rivers of India', 'Chapter short answer questions', 'Timeline of the freedom struggle', 'Civics: local government notes', 'Project: heritage monuments'],
  HIN: ['Pathan: prashn uttar', 'Anuchhed lekhan', 'Vyakaran abhyas: sangya aur sarvanam', 'Patra lekhan', 'Shabd bhandar: arth aur vakya'],
  CS: ['Flowchart for a daily routine', 'Typing practice and worksheet', 'Spreadsheet formulas exercise', 'Safe internet use: short note', 'Scratch mini project'],
  PE: ['Warm-up routine log for the week', 'Rules of the game: short notes', 'Fitness diary', 'Yoga asanas: draw and describe', 'Healthy food chart'],
  ART: ['Colour wheel in poster colours', 'Sketch: still life', 'Design a greeting card', 'Rangoli pattern on paper', 'Clay or craft model: photo log'],
};
const FEEDBACK_GOOD = ['Well done, neat and complete.', 'Good effort. Keep it up.', 'Excellent presentation.', 'Clear answers. Check spellings next time.', 'Very good understanding of the topic.'];
const FEEDBACK_OK = ['Fair attempt. Revise the last two questions.', 'Needs more detail in the explanations.', 'Please write answers in complete sentences.', 'Some answers are incomplete.'];
const FEEDBACK_REWORK = ['Please redo question 3 and 4 and resubmit.', 'Handwriting is hard to read; rewrite neatly and resubmit.', 'Diagram is missing labels. Add them and resubmit.'];
const SUBMISSION_TEXT = ['Completed. Please check.', 'Done, sir/madam.', 'Submitted as per instructions.', 'All questions attempted.', 'Finished the worksheet at home.'];

const SYLLABUS: Record<string, string[]> = {
  ENG: ['Prose: The Journey Begins', 'Poetry: Nature and Seasons', 'Grammar: Tenses', 'Writing: Paragraphs and Letters', 'Prose: People Who Inspire', 'Grammar: Clauses and Phrases', 'Writing: Notice and Email', 'Literature: Short Story Study'],
  MAT: ['Number Systems', 'Fractions and Decimals', 'Ratio and Proportion', 'Basic Algebra', 'Geometry: Lines and Angles', 'Mensuration', 'Data Handling', 'Integers and Rational Numbers'],
  SCI: ['Food and Nutrition', 'Matter and Its States', 'Motion and Force', 'Light and Shadows', 'Living Organisms', 'Electricity and Circuits', 'Water and Air', 'Our Environment'],
  SST: ['Early Civilisations', 'Landforms and Rivers', 'Kingdoms and Empires', 'Climate and Vegetation', 'Local Government', 'Trade and Cities', 'Resources and Conservation', 'The Constitution'],
  HIN: ['Gadya: Vasant Ke Din', 'Padya: Prakriti Varnan', 'Vyakaran: Sangya aur Sarvanam', 'Lekhan: Anuchhed', 'Gadya: Mahapurush', 'Vyakaran: Kriya aur Visheshan', 'Lekhan: Patra', 'Sahitya Parichay'],
  CS: ['Introduction to Computers', 'Operating System Basics', 'Word Processing', 'Spreadsheets', 'Internet and Safety', 'Algorithms and Flowcharts', 'Introduction to Programming', 'Presentation Skills'],
  PE: ['Fitness and Warm-up', 'Track Events', 'Team Games: Football', 'Yoga and Meditation', 'Team Games: Volleyball', 'First Aid Basics', 'Nutrition and Hygiene', 'Sports Rules and Fair Play'],
  ART: ['Line and Shape', 'Colour Theory', 'Still Life Drawing', 'Poster Making', 'Craft with Paper', 'Folk Art Patterns', 'Clay Modelling', 'Exhibition Preparation'],
};
const GENERIC_TOPICS = ['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4', 'Unit 5', 'Unit 6', 'Unit 7', 'Unit 8'];

const MATERIAL_LINKS = [
  'https://ncert.nic.in/textbook.php',
  'https://www.khanacademy.org/',
  'https://www.britannica.com/kids',
  'https://www.youtube.com/@NCERTOfficial',
  'https://diksha.gov.in/',
  'https://www.geogebra.org/',
];
const MATERIAL_KINDS = ['Chapter notes', 'Practice worksheet', 'Reference video', 'Revision summary', 'Previous year questions'];

const TASK_POOL: { title: string; notes?: string; priority: 'low' | 'normal' | 'high' }[] = [
  { title: 'Revise Science chapter for the unit test', notes: 'Focus on diagrams', priority: 'high' },
  { title: 'Return library book', priority: 'normal' },
  { title: 'Practice multiplication tables', priority: 'low' },
  { title: 'Prepare for the class debate', notes: 'Collect three points', priority: 'normal' },
  { title: 'Pack sports kit', priority: 'low' },
  { title: 'Finish art project sketch', priority: 'normal' },
  { title: 'Ask teacher about the grammar doubt', priority: 'high' },
  { title: 'Read the English story for tomorrow', priority: 'normal' },
];

// ── seeder ─────────────────────────────────────────────────────────────────────────────────────

export const seed: ModuleSeeder = async (ctx) => {
  await seedTimetable(ctx);
  await seedHomework(ctx);
  await seedMaterials(ctx);
  await seedSyllabus(ctx);
  await seedTasks(ctx);
};

/**
 * Greedy, clash-free timetable: subject-major so every section gets a fair share of the early slots; each placement picks the
 * cheapest free (day, period) where neither the section nor the teacher is busy, spreading a subject over the week (max 2 a day,
 * relaxed only if nothing else is left). If a teacher runs out of free periods the subject simply gets fewer lessons.
 */
async function seedTimetable(ctx: SeedContext) {
  const { db, rng } = ctx;
  const pers = (await db.select().from(periods).orderBy(asc(periods.ordinal))).filter((p) => !p.isBreak);
  const working = (await getSetting(db, 'academic')).workingDays;
  const perWeekRows = await db.select().from(gradeSubjects);
  const perWeek = new Map(perWeekRows.map((r) => [`${r.gradeId}|${r.subjectId}`, r.periodsPerWeek]));
  const codeOf = new Map(ctx.subjects.map((s) => [s.id, s.code]));
  const late = new Set(['PE', 'ART', 'CS']); // practical subjects drift to the afternoon
  const sectionById = new Map(ctx.sections.map((s) => [s.id, s]));

  const teacherBusy = new Set<string>();
  const cellTaken = new Set<string>();
  type Slot = { id: string; sectionId: string; dayOfWeek: number; periodId: string; subjectId: string; staffId: string; room: string };
  const slots: Slot[] = [];

  for (const subj of ctx.subjects) {
    for (const sec of ctx.sections) {
      const a = ctx.assignments.find((x) => x.sectionId === sec.id && x.subjectId === subj.id);
      if (!a) continue;
      const need = perWeek.get(`${sec.gradeId}|${subj.id}`) ?? 5;
      const perDay = new Map<number, number>();
      for (let k = 0; k < need; k++) {
        let best: { day: number; per: (typeof pers)[number]; score: number } | undefined;
        for (const relax of [false, true]) {
          for (const day of working) {
            if (!relax && (perDay.get(day) ?? 0) >= 2) continue;
            for (const [idx, per] of pers.entries()) {
              if (cellTaken.has(`${sec.id}|${day}|${per.id}`) || teacherBusy.has(`${a.staffId}|${day}|${per.id}`)) continue;
              const lean = late.has(codeOf.get(subj.id) ?? '') ? (pers.length - idx) * 0.4 : idx * 0.25;
              const score = (perDay.get(day) ?? 0) * 10 + lean + rng() * 2.5;
              if (!best || score < best.score) best = { day, per, score };
            }
          }
          if (best) break;
        }
        if (!best) break; // no free cell left for this teacher/section: fewer lessons rather than a clash
        const b = best;
        cellTaken.add(`${sec.id}|${b.day}|${b.per.id}`);
        teacherBusy.add(`${a.staffId}|${b.day}|${b.per.id}`);
        perDay.set(b.day, (perDay.get(b.day) ?? 0) + 1);
        slots.push({ id: uuidv7(), sectionId: sec.id, dayOfWeek: b.day, periodId: b.per.id, subjectId: subj.id, staffId: a.staffId, room: `${sectionById.get(sec.id)!.gradeOrdinal}${sectionById.get(sec.id)!.name}` });
      }
    }
  }
  await insertChunks(slots, 500, (c) => db.insert(timetableSlots).values(c));

  // a couple of one-day covers so the dashboards have something to show: tomorrow (or next school day), and today if it is a school day
  const dayCandidates: string[] = [];
  for (let k = 0; k <= 8 && dayCandidates.length < 2; k++) {
    const d = addDaysIso(ctx.today, k);
    if (working.includes(isoWeekday(d))) dayCandidates.push(d);
  }
  const subs: (typeof timetableSubstitutions.$inferInsert)[] = [];
  const usedPeriods = new Set<string>();
  for (const date of dayCandidates) {
    const dow = isoWeekday(date);
    const daySlots = slots.filter((s) => s.dayOfWeek === dow);
    for (const slot of daySlots) {
      if (subs.some((x) => x.date === date)) break;
      const substitute = ctx.teachers.find((t) => t.id !== slot.staffId && !teacherBusy.has(`${t.id}|${dow}|${slot.periodId}`) && !usedPeriods.has(`${t.id}|${date}|${slot.periodId}`));
      if (!substitute) continue;
      usedPeriods.add(`${substitute.id}|${date}|${slot.periodId}`);
      subs.push({ slotId: slot.id, date, substituteStaffId: substitute.id, reason: 'Teacher on official duty', createdBy: ctx.adminUserId || null });
    }
  }
  if (subs.length) await db.insert(timetableSubstitutions).values(subs);
}

const dueTime = (ctx: SeedContext, date: string, hour = 17) => new Date(zonedDayStart(date, ctx.tenant.timezone).getTime() + hour * HOUR);

async function seedHomework(ctx: SeedContext) {
  const { db, rng, int } = ctx;
  const teacherUser = new Map(ctx.teachers.map((t) => [t.id, t.userId]));
  const assignment = new Map(ctx.assignments.map((a) => [`${a.sectionId}|${a.subjectId}`, a.staffId]));
  const studentsBySection = Map.groupBy(ctx.students, (s) => s.sectionId);
  const diligence = new Map(ctx.students.map((s) => [s.id, rng() < 0.08 ? 0.3 : 0.6 + rng() * 0.4]));
  const dueOffsets = [-12, -9, -7, -5, -3, -2, -1, 0, 1, 3];
  const now = Date.now();
  const hwRows: (typeof homework.$inferInsert)[] = [];
  const subRows: (typeof homeworkSubmissions.$inferInsert)[] = [];

  ctx.sections.forEach((sec, si) => {
    for (let i = 0; i < dueOffsets.length; i++) {
      const subject = ctx.subjects[i % ctx.subjects.length]!;
      const staffId = assignment.get(`${sec.id}|${subject.id}`);
      if (!staffId) continue;
      const pool = HOMEWORK_TITLES[subject.code] ?? ['Practice exercise'];
      const title = pool[(si + Math.floor(i / ctx.subjects.length) + i) % pool.length]!;
      const offset = dueOffsets[i]!;
      const dueDate = addDaysIso(ctx.today, offset);
      const dueAt = dueTime(ctx, dueDate, 17);
      const assignedAt = new Date(dueAt.getTime() - int(2, 5) * 24 * HOUR);
      const status = i === 0 ? 'closed' : i === dueOffsets.length - 1 && si % 3 === 0 ? 'draft' : 'published';
      const allowSubmission = i % 4 !== 3;
      const maxMarks = allowSubmission && i % 2 === 0 ? 10 : allowSubmission && i % 3 === 0 ? 20 : null;
      const id = uuidv7();
      hwRows.push({
        id,
        sectionId: sec.id,
        subjectId: subject.id,
        staffId,
        createdByUserId: teacherUser.get(staffId) ?? null,
        title,
        description: `${title}. Write neatly in your notebook${allowSubmission ? ' and submit a photo or a short note here' : ''}. Ask your subject teacher if you have doubts.`,
        attachments: [],
        assignedAt: status === 'draft' ? new Date(now) : assignedAt,
        dueAt,
        allowSubmission,
        maxMarks,
        status,
        // reminders for work due tomorrow are the job's business; older homework is marked as already reminded
        dueReminderSentAt: offset <= 0 ? assignedAt : null,
      });
      if (!allowSubmission || status === 'draft') continue;

      const reviewer = teacherUser.get(staffId) ?? null;
      const dueMs = dueAt.getTime();
      const pastDue = dueMs <= now;
      for (const [idx, st] of (studentsBySection.get(sec.id) ?? []).entries()) {
        const d = diligence.get(st.id)!;
        let r = rng();
        // guarantee a few visible late / missing cases per section even in the small seed
        if (pastDue && status !== 'closed' && i === 4) {
          if (idx === 1 || idx === 2) r = d * 0.88 + 0.05;
          else if (idx === 3) continue;
        }
        let submittedAt: Date | null = null;
        let kind: 'submitted' | 'late' | 'returned' | null = null;
        if (pastDue) {
          if (r < d * 0.88) {
            submittedAt = new Date(dueMs - int(1, 70) * HOUR);
            kind = r < 0.03 ? 'returned' : 'submitted';
          } else if (r < d * 0.88 + 0.1) {
            submittedAt = new Date(Math.min(now - HOUR, dueMs + int(1, 36) * HOUR));
            kind = 'late';
          }
        } else if (r < 0.4 * d) {
          const earliest = assignedAt.getTime();
          submittedAt = new Date(Math.min(now - HOUR, earliest + int(1, 40) * HOUR));
          if (submittedAt.getTime() < earliest) submittedAt = new Date(earliest);
          kind = 'submitted';
        }
        if (!submittedAt || !kind) continue;

        const reviewProb = status === 'closed' ? 0.97 : offset <= -5 ? 0.85 : offset <= -1 ? 0.5 : 0;
        const row: typeof homeworkSubmissions.$inferInsert = {
          homeworkId: id,
          studentId: st.id,
          text: SUBMISSION_TEXT[int(0, SUBMISSION_TEXT.length - 1)]!,
          attachments: [],
          submittedAt,
          status: kind === 'late' ? 'late' : 'submitted',
          updatedAt: submittedAt,
        };
        if (kind === 'returned') {
          Object.assign(row, { status: 'returned', feedback: FEEDBACK_REWORK[int(0, FEEDBACK_REWORK.length - 1)]!, reviewedBy: reviewer, reviewedAt: new Date(Math.min(now - HOUR, submittedAt.getTime() + int(2, 20) * HOUR)) });
        } else if (rng() < (kind === 'late' ? reviewProb * 0.4 : reviewProb)) {
          const good = rng() < 0.7;
          const reviewedAt = new Date(Math.min(now - HOUR / 2, submittedAt.getTime() + int(2, 30) * HOUR));
          Object.assign(row, {
            status: 'reviewed',
            marks: maxMarks ? Math.round(maxMarks * (good ? 0.7 + rng() * 0.3 : 0.4 + rng() * 0.3) * 2) / 2 : null,
            feedback: (good ? FEEDBACK_GOOD : FEEDBACK_OK)[int(0, 3)] ?? null,
            reviewedBy: reviewer,
            reviewedAt,
            updatedAt: reviewedAt,
          });
        }
        subRows.push(row);
      }
    }
  });

  await insertChunks(hwRows, 300, (c) => db.insert(homework).values(c));
  await insertChunks(subRows, 500, (c) => db.insert(homeworkSubmissions).values(c));
}

async function seedMaterials(ctx: SeedContext) {
  const { db, int } = ctx;
  const gradeOf = new Map(ctx.grades.map((g) => [g.id, g]));
  const rows: (typeof materials.$inferInsert)[] = [];
  let n = 0;
  const link = () => MATERIAL_LINKS[n++ % MATERIAL_LINKS.length]!;
  const teacherFor = (sectionId: string, subjectId: string) => ctx.assignments.find((a) => a.sectionId === sectionId && a.subjectId === subjectId)?.staffId;
  const userOf = new Map(ctx.teachers.map((t) => [t.id, t.userId]));

  for (const g of ctx.grades) {
    const secs = ctx.sections.filter((s) => s.gradeId === g.id);
    for (const subj of ctx.subjects) {
      const staffId = secs.map((s) => teacherFor(s.id, subj.id)).find(Boolean);
      rows.push({
        title: `${subj.name}: ${MATERIAL_KINDS[n % MATERIAL_KINDS.length]} (${gradeOf.get(g.id)!.name})`,
        description: `Shared with every ${gradeOf.get(g.id)!.name} section.`,
        gradeId: g.id,
        sectionId: null,
        subjectId: subj.id,
        url: link(),
        createdBy: staffId ? (userOf.get(staffId) ?? null) : null,
        createdAt: new Date(Date.now() - int(3, 40) * 86_400_000),
      });
    }
  }
  ctx.sections.forEach((sec, si) => {
    for (let k = 0; k < Math.min(3, ctx.subjects.length); k++) {
      const subj = ctx.subjects[(si + k) % ctx.subjects.length]!;
      const staffId = teacherFor(sec.id, subj.id);
      rows.push({
        title: `${subj.name}: ${MATERIAL_KINDS[(si + k + 2) % MATERIAL_KINDS.length]} for ${sec.gradeName} ${sec.name}`,
        gradeId: sec.gradeId,
        sectionId: sec.id,
        subjectId: subj.id,
        url: link(),
        createdBy: staffId ? (userOf.get(staffId) ?? null) : null,
        createdAt: new Date(Date.now() - int(1, 20) * 86_400_000),
      });
    }
  });
  await insertChunks(rows, 500, (c) => db.insert(materials).values(c));
}

async function seedSyllabus(ctx: SeedContext) {
  const { db, rng, int } = ctx;
  const topicRows: (typeof syllabusTopics.$inferInsert)[] = [];
  const byGradeSubject = new Map<string, { id: string }[]>();
  for (const g of ctx.grades) {
    for (const subj of ctx.subjects) {
      const titles = SYLLABUS[subj.code] ?? GENERIC_TOPICS;
      const list: { id: string }[] = [];
      titles.forEach((title, idx) => {
        const id = uuidv7();
        list.push({ id });
        topicRows.push({ id, gradeId: g.id, subjectId: subj.id, termId: ctx.termIds[idx < titles.length / 2 ? 0 : 1] ?? ctx.termIds[0] ?? null, title, ordinal: idx + 1, plannedHours: int(3, 8) });
      });
      byGradeSubject.set(`${g.id}|${subj.id}`, list);
    }
  }
  await insertChunks(topicRows, 500, (c) => db.insert(syllabusTopics).values(c));

  const teacherUser = new Map(ctx.teachers.map((t) => [t.id, t.userId]));
  const progress: (typeof topicProgress.$inferInsert)[] = [];
  for (const sec of ctx.sections) {
    for (const subj of ctx.subjects) {
      const topics = byGradeSubject.get(`${sec.gradeId}|${subj.id}`) ?? [];
      const staffId = ctx.assignments.find((a) => a.sectionId === sec.id && a.subjectId === subj.id)?.staffId;
      const completed = Math.min(topics.length, int(3, 5) + (rng() < 0.15 ? 1 : 0)); // term 1 is mostly done by October
      topics.forEach((t, idx) => {
        if (idx >= completed + 1) return;
        const done = idx < completed;
        progress.push({ topicId: t.id, sectionId: sec.id, status: done ? 'completed' : 'in_progress', completedAt: done ? new Date(Date.now() - int(5, 90) * 86_400_000) : null, updatedBy: staffId ? (teacherUser.get(staffId) ?? null) : null });
      });
    }
  }
  await insertChunks(progress, 500, (c) => db.insert(topicProgress).values(c));
}

async function seedTasks(ctx: SeedContext) {
  const { db, int, rng } = ctx;
  const now = Date.now();
  const rows: (typeof studentTasks.$inferInsert)[] = [];
  ctx.students.slice(0, 8).forEach((st, si) => {
    const count = 2 + (si % 3);
    for (let k = 0; k < count; k++) {
      const t = TASK_POOL[(si * 3 + k) % TASK_POOL.length]!;
      const done = k === 0 && si % 2 === 1;
      const dueAt = rng() < 0.85 ? new Date(now + int(-2, 6) * 86_400_000 + int(0, 10) * HOUR) : null;
      const remindCandidate = dueAt ? new Date(dueAt.getTime() - 3 * HOUR) : null;
      const remindAt = !done && remindCandidate && remindCandidate.getTime() > now + HOUR && rng() < 0.6 ? remindCandidate : null; // only future reminders (past ones would be sent by the job)
      rows.push({
        studentId: st.id,
        title: t.title,
        notes: t.notes ?? null,
        priority: t.priority,
        dueAt,
        remindAt,
        status: done ? 'done' : k === 1 && si % 3 === 0 ? 'doing' : 'todo',
        completedAt: done ? new Date(now - int(1, 20) * HOUR) : null,
      });
    }
  });
  await db.insert(studentTasks).values(rows);
}
