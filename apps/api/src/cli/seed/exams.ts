import { eq } from 'drizzle-orm';
import { addDaysIso } from '../../core/http';
import { examPapers, exams, gradeScales, markSheets, marks, reportRemarks } from '../../db/tenant/schema';
import type { MarkSheetStatus } from '@school-sync/shared';
import type { ModuleSeeder, SeedContext } from './context';

/**
 * Demo data for the exams module (deterministic, bulk inserts):
 *  1. "Term 1 Final Examination" — finished and fully PUBLISHED: every section x subject, a realistic score
 *     distribution with some failures and absentees, class-teacher remarks (published) — powers report cards & trends.
 *  2. "Mid-Term Examination" — marks entry is open; the sheets are in mixed states (draft with partial or no marks,
 *     submitted, approved, returned with a note) so every workflow screen has something to show. Nothing is published,
 *     so students and parents see nothing of it yet.
 *  3. "Final Examination" — scheduled in the future: schedule only, no sheets.
 */

const SHORT_MARKS = new Set(['PE', 'ART']); // 50-mark papers

const chunked = async <T>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) => {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
};

/** roughly normal (mean 0, sd ~1) from the deterministic PRNG */
const gauss = (ctx: SeedContext) => (ctx.rng() + ctx.rng() + ctx.rng() + ctx.rng() - 2) * 1.73;

const REMARKS = {
  high: ['An outstanding term. Keep aiming high.', 'Consistently excellent work and a great role model for the class.', 'Brilliant effort; participates actively and helps classmates.'],
  mid: ['A steady and dependable term. With a little more revision there is room to grow.', 'Good progress. Regular practice in weaker subjects will help.', 'Shows interest in class; should focus on completing homework on time.'],
  low: ['Needs to put in more consistent effort. Extra practice has been suggested.', 'Struggles with a few concepts; please support revision at home.', 'Attendance and focus need improvement. Happy to meet and plan next steps.'],
};
const IMPROVE = ['Revise multiplication tables daily', 'Improve handwriting and presentation', 'Read one English book every week', 'Practise word problems', 'Be more attentive in class', 'Complete assignments on time'];
const CONDUCT = ['Excellent', 'Very good', 'Good', 'Satisfactory'];

export const seed: ModuleSeeder = async (ctx) => {
  const { db } = ctx;
  const principal = ctx.staff.principal!;
  const scale = await db.select({ id: gradeScales.id }).from(gradeScales).where(eq(gradeScales.isDefault, true)).limit(1);
  const gradeScaleId = scale[0]?.id ?? null;
  const [term1, term2] = [ctx.termIds[0] ?? null, ctx.termIds[ctx.termIds.length - 1] ?? null];
  const teacherUser = new Map(ctx.teachers.map((t) => [t.id, t.userId]));
  const asDate = (iso: string, hour: number) => new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00Z`);

  // ── abilities: each student has a stable base level, each subject its own offset ──
  const ability = new Map(ctx.students.map((s) => [s.id, 66 + gauss(ctx) * 14]));
  const subjectBias = new Map(ctx.subjects.map((s) => [s.id, gauss(ctx) * 4]));
  const studentsBySection = Map.groupBy(ctx.students, (s) => s.sectionId);
  const gradeOfSection = new Map(ctx.sections.map((s) => [s.id, s.gradeId]));

  const maxFor = (code: string) => (SHORT_MARKS.has(code) ? 50 : 100);
  const codeOf = new Map(ctx.subjects.map((s) => [s.id, s.code]));

  async function createExam(def: { name: string; type: 'final' | 'midterm'; termId: string | null; start: string; end: string; status: 'published' | 'marks_entry' | 'scheduled'; publishedAt?: Date }) {
    const [e] = await db
      .insert(exams)
      .values({ name: def.name, examType: def.type, academicYearId: ctx.yearId, termId: def.termId, gradeScaleId, startDate: def.start, endDate: def.end, passPercent: 35, status: def.status, publishedAt: def.publishedAt ?? null, createdBy: principal.userId })
      .returning({ id: exams.id });
    // one paper per grade x subject, one subject per day (Sundays skipped), 09:00-12:00
    const papers: (typeof examPapers.$inferInsert)[] = [];
    for (const g of ctx.grades) {
      let day = def.start;
      for (const s of ctx.subjects) {
        while (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) day = addDaysIso(day, 1);
        const max = maxFor(s.code);
        papers.push({ examId: e!.id, gradeId: g.id, subjectId: s.id, examDate: day, startTime: '09:00', endTime: SHORT_MARKS.has(s.code) ? '10:30' : '12:00', room: `Exam Hall ${String.fromCharCode(65 + (g.ordinal % 3))}`, maxMarks: max, passMarks: Math.round(max * 0.35) });
        day = addDaysIso(day, 1);
      }
    }
    const inserted = await db.insert(examPapers).values(papers).returning({ id: examPapers.id, gradeId: examPapers.gradeId, subjectId: examPapers.subjectId, maxMarks: examPapers.maxMarks });
    return { id: e!.id, papers: inserted };
  }

  /** marks for one student on one paper: [obtained | null, absent] */
  const score = (studentId: string, subjectId: string, max: number, absentRate: number): [number | null, boolean] => {
    if (ctx.rng() < absentRate) return [null, true];
    const pct = Math.max(12, Math.min(99, (ability.get(studentId) ?? 65) + (subjectBias.get(subjectId) ?? 0) + gauss(ctx) * 7));
    return [Math.min(max, Math.round((pct / 100) * max)), false];
  };

  const sheetRowsFor = (examId: string, papers: { id: string; gradeId: string; subjectId: string }[]) => {
    const byGradeSubject = new Map(papers.map((p) => [`${p.gradeId}:${p.subjectId}`, p]));
    const rows: (typeof markSheets.$inferInsert & { _staff: string })[] = [];
    for (const a of ctx.assignments) {
      const paper = byGradeSubject.get(`${gradeOfSection.get(a.sectionId)}:${a.subjectId}`);
      if (paper) rows.push({ examId, paperId: paper.id, sectionId: a.sectionId, subjectId: a.subjectId, _staff: a.staffId });
    }
    return rows;
  };

  // ───────────── 1. completed, fully published previous-term exam ─────────────
  const endPrev = addDaysIso(ctx.today, -28);
  const prev = await createExam({ name: 'Term 1 Final Examination', type: 'final', termId: term1, start: addDaysIso(endPrev, -(ctx.subjects.length + 1)), end: endPrev, status: 'published', publishedAt: asDate(addDaysIso(endPrev, 12), 11) });
  const prevRows = sheetRowsFor(prev.id, prev.papers);
  const prevSheets = await db
    .insert(markSheets)
    .values(
      prevRows.map(({ _staff, ...r }) => ({
        ...r,
        status: 'published' as MarkSheetStatus,
        submittedBy: teacherUser.get(_staff) ?? null,
        submittedAt: asDate(addDaysIso(endPrev, 4), 10),
        reviewedBy: principal.userId,
        reviewedAt: asDate(addDaysIso(endPrev, 9), 15),
        publishedBy: principal.userId,
        publishedAt: asDate(addDaysIso(endPrev, 12), 11),
      })),
    )
    .returning({ id: markSheets.id, sectionId: markSheets.sectionId, subjectId: markSheets.subjectId });
  const prevMarks: (typeof marks.$inferInsert)[] = [];
  const staffOfSheet = new Map(prevRows.map((r) => [`${r.sectionId}:${r.subjectId}`, r._staff]));
  for (const sh of prevSheets) {
    const max = maxFor(codeOf.get(sh.subjectId) ?? '');
    for (const st of studentsBySection.get(sh.sectionId) ?? []) {
      const [obtained, absent] = score(st.id, sh.subjectId, max, 0.015);
      const pct = obtained == null ? 0 : (obtained / max) * 100;
      prevMarks.push({ sheetId: sh.id, studentId: st.id, marksObtained: obtained, isAbsent: absent, remarks: pct >= 92 ? 'Excellent' : pct < 35 && !absent ? 'Needs extra support' : null, enteredBy: teacherUser.get(staffOfSheet.get(`${sh.sectionId}:${sh.subjectId}`) ?? '') ?? null });
    }
  }
  await chunked(prevMarks, 500, (c) => db.insert(marks).values(c));

  // class-teacher remarks, published with the report cards
  const totals = new Map<string, { sum: number; max: number }>();
  for (const m of prevMarks) {
    const sh = prevSheets.find((x) => x.id === m.sheetId)!;
    const t = totals.get(m.studentId) ?? { sum: 0, max: 0 };
    t.sum += m.marksObtained ?? 0;
    t.max += maxFor(codeOf.get(sh.subjectId) ?? '');
    totals.set(m.studentId, t);
  }
  const ctOfSection = new Map(ctx.sections.map((s) => [s.id, teacherUser.get(s.classTeacherId) ?? null]));
  const remarkRows: (typeof reportRemarks.$inferInsert)[] = ctx.students.map((st) => {
    const t = totals.get(st.id);
    const pct = t && t.max ? (t.sum / t.max) * 100 : 60;
    const tier = pct >= 80 ? REMARKS.high : pct >= 55 ? REMARKS.mid : REMARKS.low;
    return { examId: prev.id, studentId: st.id, remark: ctx.pick(tier), areasToImprove: pct >= 80 ? null : ctx.pick(IMPROVE), conduct: pct >= 70 ? ctx.pick(CONDUCT.slice(0, 2)) : ctx.pick(CONDUCT.slice(1)), enteredBy: ctOfSection.get(st.sectionId) ?? null, publishedAt: asDate(addDaysIso(endPrev, 12), 12) };
  });
  await chunked(remarkRows, 500, (c) => db.insert(reportRemarks).values(c));

  // ───────────── 2. current mid-term: marks entry open, sheets in mixed states ─────────────
  const midEnd = addDaysIso(ctx.today, -3);
  const mid = await createExam({ name: 'Mid-Term Examination', type: 'midterm', termId: term2, start: addDaysIso(midEnd, -(ctx.subjects.length + 1)), end: midEnd, status: 'marks_entry' });
  const midRows = sheetRowsFor(mid.id, mid.papers);
  // deterministic spread over the workflow states; the first few sheets are pinned so every state is always present
  const plan: ('draft_empty' | 'draft_partial' | 'submitted' | 'approved' | 'returned')[] = [];
  const pattern = ['submitted', 'approved', 'draft_partial', 'draft_empty', 'submitted', 'returned', 'approved', 'draft_partial', 'submitted', 'approved'] as const;
  midRows.forEach((_, i) => plan.push(pattern[i % pattern.length]!));
  const midSheets = await db
    .insert(markSheets)
    .values(
      midRows.map(({ _staff, ...r }, i) => {
        const st = plan[i]!;
        const reviewed = st === 'approved' || st === 'returned';
        const status: MarkSheetStatus = st === 'submitted' ? 'submitted' : st === 'approved' ? 'approved' : st === 'returned' ? 'returned' : 'draft';
        return {
          ...r,
          status,
          submittedBy: st === 'draft_empty' || st === 'draft_partial' ? null : (teacherUser.get(_staff) ?? null),
          submittedAt: st === 'draft_empty' || st === 'draft_partial' ? null : asDate(addDaysIso(ctx.today, -2), 10 + (i % 6)),
          reviewedBy: reviewed ? principal.userId : null,
          reviewedAt: reviewed ? asDate(addDaysIso(ctx.today, -1), 14) : null,
          returnNote: st === 'returned' ? ctx.pick(['Please re-check the marks of the last three students; totals do not match the answer sheets.', 'Question 5 was marked out of 10 instead of 5 for a few students. Kindly correct and resubmit.', 'Two students are marked absent but attended the paper. Please verify.']) : null,
        };
      }),
    )
    .returning({ id: markSheets.id, sectionId: markSheets.sectionId, subjectId: markSheets.subjectId });
  const midMarks: (typeof marks.$inferInsert)[] = [];
  midSheets.forEach((sh, i) => {
    const st = plan[i]!;
    if (st === 'draft_empty') return;
    const max = maxFor(codeOf.get(sh.subjectId) ?? '');
    const roster = studentsBySection.get(sh.sectionId) ?? [];
    const enteredBy = teacherUser.get(staffOfSheet.get(`${sh.sectionId}:${sh.subjectId}`) ?? midRows[i]!._staff) ?? null;
    roster.forEach((stu, k) => {
      if (st === 'draft_partial' && k >= Math.ceil(roster.length / 2)) return; // a teacher part-way through the list
      const [obtained, absent] = score(stu.id, sh.subjectId, max, 0.02);
      midMarks.push({ sheetId: sh.id, studentId: stu.id, marksObtained: obtained, isAbsent: absent, remarks: null, enteredBy });
    });
  });
  await chunked(midMarks, 500, (c) => db.insert(marks).values(c));

  // ───────────── 3. upcoming final: schedule only ─────────────
  await createExam({ name: 'Annual Final Examination', type: 'final', termId: term2, start: addDaysIso(ctx.today, 35), end: addDaysIso(ctx.today, 35 + ctx.subjects.length + 1), status: 'scheduled' });

};
