import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { LibraryBook, LibraryIssue, LibraryPolicy } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { conflict, notFound, unprocessable } from '../../core/errors';
import { addDaysIso, ilikeAny, todayIn } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import { assertStudentAccess } from '../../core/rbac/scope';
import { getSetting, putSetting } from '../../core/settings';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { grades, libraryBooks, libraryIssues, sections, staff, students } from '../../db/tenant/schema';

const fullName = (a: string, b: string | null) => [a, b].filter(Boolean).join(' ');

// ── policy ──────────────────────────────────────────────────────────────────────────────────────

export const getPolicy = (db: Executor): Promise<LibraryPolicy> => getSetting(db, 'library');

export async function updatePolicy(db: Executor, actor: AuditActor, userId: string, body: Partial<LibraryPolicy>): Promise<LibraryPolicy> {
  return db.transaction(async (tx) => {
    const before = await getSetting(tx, 'library');
    const next = await putSetting(tx, 'library', body, userId);
    await audit(tx, actor, { action: 'library.policy_update', entity: 'settings', entityId: 'library', before, after: next });
    return next;
  });
}

// ── catalogue ───────────────────────────────────────────────────────────────────────────────────

type BookRow = typeof libraryBooks.$inferSelect;
const toBook = (b: BookRow): LibraryBook => ({
  id: b.id,
  accessionNo: b.accessionNo,
  isbn: b.isbn,
  title: b.title,
  author: b.author,
  publisher: b.publisher,
  category: b.category,
  shelf: b.shelf,
  totalCopies: b.totalCopies,
  availableCopies: b.availableCopies,
  available: b.availableCopies > 0 && !b.archivedAt,
  archived: !!b.archivedAt,
  createdAt: b.createdAt.toISOString(),
});

export async function listBooks(db: Executor, q: { page: number; pageSize: number; q?: string; category?: string; available?: boolean; includeArchived?: boolean }) {
  const where = and(
    q.includeArchived ? undefined : isNull(libraryBooks.archivedAt),
    q.category ? eq(libraryBooks.category, q.category) : undefined,
    q.available ? sql`${libraryBooks.availableCopies} > 0` : undefined,
    q.q ? ilikeAny(q.q, libraryBooks.title, libraryBooks.author, libraryBooks.isbn, libraryBooks.category, libraryBooks.accessionNo, libraryBooks.publisher) : undefined,
  );
  const [rows, totalRow] = await Promise.all([
    db.select().from(libraryBooks).where(where).orderBy(asc(libraryBooks.title), asc(libraryBooks.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(libraryBooks).where(where),
  ]);
  return { items: rows.map(toBook), total: totalRow[0]?.n ?? 0 };
}

export async function getBook(db: Executor, id: string, includeArchived = false): Promise<LibraryBook> {
  const [b] = await db.select().from(libraryBooks).where(and(eq(libraryBooks.id, id), includeArchived ? undefined : isNull(libraryBooks.archivedAt))).limit(1);
  if (!b) throw notFound('Book');
  return toBook(b);
}

export async function categories(db: Executor): Promise<string[]> {
  const rows = await db.selectDistinct({ c: libraryBooks.category }).from(libraryBooks).where(and(isNull(libraryBooks.archivedAt), sql`${libraryBooks.category} is not null`)).orderBy(asc(libraryBooks.category));
  return rows.map((r) => r.c!).filter(Boolean);
}

export async function createBook(db: Executor, actor: AuditActor, body: { accessionNo: string; isbn?: string | null; title: string; author?: string | null; publisher?: string | null; category?: string | null; shelf?: string | null; totalCopies: number }): Promise<LibraryBook> {
  const [dup] = await db.select({ id: libraryBooks.id }).from(libraryBooks).where(eq(libraryBooks.accessionNo, body.accessionNo)).limit(1);
  if (dup) throw conflict('A book with this accession number already exists', 'ACCESSION_EXISTS');
  return db.transaction(async (tx) => {
    const [b] = await tx
      .insert(libraryBooks)
      .values({ accessionNo: body.accessionNo, isbn: body.isbn ?? null, title: body.title, author: body.author ?? null, publisher: body.publisher ?? null, category: body.category ?? null, shelf: body.shelf ?? null, totalCopies: body.totalCopies, availableCopies: body.totalCopies })
      .returning();
    await audit(tx, actor, { action: 'library.book_create', entity: 'library_book', entityId: b!.id, summary: b!.title, after: { accessionNo: b!.accessionNo, totalCopies: b!.totalCopies } });
    return toBook(b!);
  });
}

export async function updateBook(db: Executor, actor: AuditActor, id: string, body: Partial<{ accessionNo: string; isbn: string | null; title: string; author: string | null; publisher: string | null; category: string | null; shelf: string | null; totalCopies: number }>): Promise<LibraryBook> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(libraryBooks).where(and(eq(libraryBooks.id, id), isNull(libraryBooks.archivedAt))).limit(1).for('update');
    if (!before) throw notFound('Book');
    if (body.accessionNo && body.accessionNo !== before.accessionNo) {
      const [dup] = await tx.select({ id: libraryBooks.id }).from(libraryBooks).where(eq(libraryBooks.accessionNo, body.accessionNo)).limit(1);
      if (dup) throw conflict('A book with this accession number already exists', 'ACCESSION_EXISTS');
    }
    const { totalCopies, ...rest } = body;
    const set: Partial<typeof libraryBooks.$inferInsert> = { ...rest };
    if (totalCopies !== undefined) {
      const onLoan = before.totalCopies - before.availableCopies;
      if (totalCopies < onLoan) throw conflict(`${onLoan} copies are on loan; the total cannot be lower than that`, 'COPIES_ON_LOAN');
      set.totalCopies = totalCopies;
      set.availableCopies = totalCopies - onLoan; // stock moves with the total; the row lock above keeps this exact
    }
    const [b] = await tx.update(libraryBooks).set(set).where(eq(libraryBooks.id, id)).returning();
    await audit(tx, actor, { action: 'library.book_update', entity: 'library_book', entityId: id, summary: before.title, before: { title: before.title, totalCopies: before.totalCopies, availableCopies: before.availableCopies }, after: body });
    return toBook(b!);
  });
}

export async function archiveBook(db: Executor, actor: AuditActor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(libraryBooks).where(and(eq(libraryBooks.id, id), isNull(libraryBooks.archivedAt))).limit(1).for('update');
    if (!before) throw notFound('Book');
    const [out] = await tx.select({ n: count() }).from(libraryIssues).where(and(eq(libraryIssues.bookId, id), isNull(libraryIssues.returnedOn)));
    if ((out?.n ?? 0) > 0) throw conflict(`${out?.n} copies are still on loan`, 'BOOK_ON_LOAN');
    await tx.update(libraryBooks).set({ archivedAt: new Date() }).where(eq(libraryBooks.id, id));
    await audit(tx, actor, { action: 'library.book_archive', entity: 'library_book', entityId: id, summary: before.title });
  });
}

// ── loans ───────────────────────────────────────────────────────────────────────────────────────

/** Days past due as of `today` (0 when not late). */
const lateDays = (dueOn: string, today: string): number => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000));

const issueSelect = (db: Executor) =>
  db
    .select({
      i: libraryIssues,
      title: libraryBooks.title,
      author: libraryBooks.author,
      accessionNo: libraryBooks.accessionNo,
      sFirst: students.firstName,
      sLast: students.lastName,
      admissionNo: students.admissionNo,
      grade: grades.name,
      section: sections.name,
      tFirst: staff.firstName,
      tLast: staff.lastName,
      employeeId: staff.employeeId,
    })
    .from(libraryIssues)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryIssues.bookId))
    .leftJoin(students, eq(students.id, libraryIssues.studentId))
    .leftJoin(sections, eq(sections.id, students.currentSectionId))
    .leftJoin(grades, eq(grades.id, students.currentGradeId))
    .leftJoin(staff, eq(staff.id, libraryIssues.staffId));

type IssueJoin = Awaited<ReturnType<ReturnType<typeof issueSelect>['execute']>>[number];

function toIssue(r: IssueJoin, today: string, finePerDay: number): LibraryIssue {
  const i = r.i;
  const days = i.returnedOn ? 0 : lateDays(i.dueOn, today);
  const student = !!i.studentId;
  return {
    id: i.id,
    book: { id: i.bookId, title: r.title, author: r.author, accessionNo: r.accessionNo },
    borrower: student
      ? { type: 'student', id: i.studentId!, name: fullName(r.sFirst ?? '', r.sLast), code: r.admissionNo ?? '', grade: r.grade, section: r.section }
      : { type: 'staff', id: i.staffId!, name: fullName(r.tFirst ?? '', r.tLast), code: r.employeeId ?? '', grade: null, section: null },
    issuedOn: i.issuedOn,
    dueOn: i.dueOn,
    returnedOn: i.returnedOn,
    status: i.returnedOn ? 'returned' : days > 0 ? 'overdue' : 'borrowed',
    daysOverdue: days,
    fineMinor: i.returnedOn ? i.fineMinor : days * finePerDay,
  };
}

async function getIssue(db: Executor, tenant: TenantInfo, id: string): Promise<LibraryIssue> {
  const [r] = await issueSelect(db).where(eq(libraryIssues.id, id)).limit(1);
  if (!r) throw notFound('Loan');
  return toIssue(r, todayIn(tenant.timezone), (await getPolicy(db)).finePerDayMinor);
}

export async function issueBook(
  db: Executor,
  tenant: TenantInfo,
  p: Principal,
  actor: AuditActor,
  body: { bookId: string; studentId?: string; staffId?: string; dueOn?: string },
): Promise<LibraryIssue> {
  if (!!body.studentId === !!body.staffId) throw unprocessable('Give exactly one borrower: studentId or staffId', 'BORROWER_REQUIRED');
  const today = todayIn(tenant.timezone);
  if (body.dueOn && (body.dueOn < today || body.dueOn > addDaysIso(today, 365))) throw unprocessable('The due date must be between today and one year from now', 'DUE_DATE_INVALID');
  const id = await db.transaction(async (tx) => {
    const borrowerId = (body.studentId ?? body.staffId)!;
    if (body.studentId) {
      await assertStudentAccess(tx, p, 'students:view', body.studentId);
      const [s] = await tx.select({ status: students.status, archivedAt: students.archivedAt }).from(students).where(eq(students.id, body.studentId)).limit(1);
      if (!s || s.archivedAt || s.status !== 'active') throw unprocessable('Only active students can borrow books', 'BORROWER_NOT_ACTIVE');
    } else {
      const [t] = await tx.select({ status: staff.status }).from(staff).where(eq(staff.id, body.staffId!)).limit(1);
      if (!t) throw notFound('Staff member');
      if (t.status !== 'active') throw unprocessable('Only active staff can borrow books', 'BORROWER_NOT_ACTIVE');
    }
    // one borrower's loans are counted and extended serially
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`library-borrower:${borrowerId}`}))`);
    const policy = await getSetting(tx, 'library');
    const [active] = await tx.select({ n: count() }).from(libraryIssues).where(and(isNull(libraryIssues.returnedOn), body.studentId ? eq(libraryIssues.studentId, borrowerId) : eq(libraryIssues.staffId, borrowerId)));
    const max = body.studentId ? policy.maxLoansPerStudent : policy.maxLoansPerStaff;
    if ((active?.n ?? 0) >= max) throw conflict(`This borrower already has ${max} books out`, 'LOAN_LIMIT_REACHED');
    const [again] = await tx
      .select({ id: libraryIssues.id })
      .from(libraryIssues)
      .where(and(eq(libraryIssues.bookId, body.bookId), isNull(libraryIssues.returnedOn), body.studentId ? eq(libraryIssues.studentId, borrowerId) : eq(libraryIssues.staffId, borrowerId)))
      .limit(1);
    if (again) throw conflict('This borrower already has a copy of this book', 'ALREADY_BORROWED');

    // the stock decrement IS the claim: it only matches while a copy is on the shelf, and row locking serialises concurrent issues
    const [taken] = await tx
      .update(libraryBooks)
      .set({ availableCopies: sql`${libraryBooks.availableCopies} - 1` })
      .where(and(eq(libraryBooks.id, body.bookId), isNull(libraryBooks.archivedAt), sql`${libraryBooks.availableCopies} > 0`))
      .returning({ title: libraryBooks.title });
    if (!taken) {
      const [exists] = await tx.select({ id: libraryBooks.id }).from(libraryBooks).where(and(eq(libraryBooks.id, body.bookId), isNull(libraryBooks.archivedAt))).limit(1);
      if (!exists) throw notFound('Book');
      throw conflict('No copy of this book is available right now', 'NO_COPIES_AVAILABLE');
    }
    const dueOn = body.dueOn ?? addDaysIso(today, body.studentId ? policy.loanDays : policy.staffLoanDays);
    const [issue] = await tx.insert(libraryIssues).values({ bookId: body.bookId, studentId: body.studentId ?? null, staffId: body.staffId ?? null, issuedOn: today, dueOn, issuedBy: p.userId }).returning();
    await audit(tx, actor, { action: 'library.issue', entity: 'library_issue', entityId: issue!.id, summary: taken.title, after: { bookId: body.bookId, studentId: body.studentId, staffId: body.staffId, dueOn } });
    return issue!.id;
  });
  return getIssue(db, tenant, id);
}

export async function returnBook(db: Executor, tenant: TenantInfo, actor: AuditActor, id: string, waiveFine: boolean): Promise<LibraryIssue> {
  const today = todayIn(tenant.timezone);
  await db.transaction(async (tx) => {
    const policy = await getSetting(tx, 'library');
    const [cur] = await tx.select().from(libraryIssues).where(eq(libraryIssues.id, id)).limit(1);
    if (!cur) throw notFound('Loan');
    const fine = waiveFine ? 0 : lateDays(cur.dueOn, today) * policy.finePerDayMinor;
    // claim the return: only one concurrent caller can flip returned_on from NULL
    const [done] = await tx.update(libraryIssues).set({ returnedOn: today, fineMinor: fine }).where(and(eq(libraryIssues.id, id), isNull(libraryIssues.returnedOn))).returning({ id: libraryIssues.id });
    if (!done) throw conflict('This book has already been returned', 'ALREADY_RETURNED');
    await tx.update(libraryBooks).set({ availableCopies: sql`${libraryBooks.availableCopies} + 1` }).where(eq(libraryBooks.id, cur.bookId));
    await audit(tx, actor, { action: 'library.return', entity: 'library_issue', entityId: id, after: { returnedOn: today, fineMinor: fine, waived: waiveFine } });
  });
  return getIssue(db, tenant, id);
}

function statusCond(status: 'active' | 'overdue' | 'returned' | 'all', today: string): SQL | undefined {
  switch (status) {
    case 'active':
      return isNull(libraryIssues.returnedOn);
    case 'overdue':
      return and(isNull(libraryIssues.returnedOn), lt(libraryIssues.dueOn, today));
    case 'returned':
      return sql`${libraryIssues.returnedOn} is not null`;
    default:
      return undefined;
  }
}

export async function listIssues(db: Executor, tenant: TenantInfo, q: { page: number; pageSize: number; q?: string; status: 'active' | 'overdue' | 'returned' | 'all'; bookId?: string; studentId?: string; staffId?: string }) {
  const today = todayIn(tenant.timezone);
  const where = and(
    statusCond(q.status, today),
    q.bookId ? eq(libraryIssues.bookId, q.bookId) : undefined,
    q.studentId ? eq(libraryIssues.studentId, q.studentId) : undefined,
    q.staffId ? eq(libraryIssues.staffId, q.staffId) : undefined,
    q.q ? or(ilikeAny(q.q, libraryBooks.title, libraryBooks.accessionNo, students.firstName, students.lastName, students.admissionNo, staff.firstName, staff.lastName, staff.employeeId)) : undefined,
  );
  const policy = await getPolicy(db);
  const base = q.status === 'overdue' || q.status === 'active' ? asc(libraryIssues.dueOn) : desc(libraryIssues.issuedOn);
  const [rows, totalRow] = await Promise.all([
    issueSelect(db).where(where).orderBy(base, asc(libraryIssues.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db
      .select({ n: count() })
      .from(libraryIssues)
      .innerJoin(libraryBooks, eq(libraryBooks.id, libraryIssues.bookId))
      .leftJoin(students, eq(students.id, libraryIssues.studentId))
      .leftJoin(staff, eq(staff.id, libraryIssues.staffId))
      .where(where),
  ]);
  return { items: rows.map((r) => toIssue(r, today, policy.finePerDayMinor)), total: totalRow[0]?.n ?? 0, policy };
}

/** Overdue loans plus totals (count and accrued fines) over ALL overdue loans, not just the page. */
export async function overdue(db: Executor, tenant: TenantInfo, q: { page: number; pageSize: number; q?: string }) {
  const r = await listIssues(db, tenant, { ...q, status: 'overdue' });
  const today = todayIn(tenant.timezone);
  const [t] = await db
    .select({ n: count(), days: sql<number>`coalesce(sum(${today}::date - ${libraryIssues.dueOn}), 0)::int` })
    .from(libraryIssues)
    .where(statusCond('overdue', today));
  return { ...r, totals: { count: t?.n ?? 0, fineMinor: (t?.days ?? 0) * r.policy.finePerDayMinor } };
}

/** The caller's own loans (students), their children's (parents) or their own staff loans (staff). */
export async function myBooks(db: Executor, tenant: TenantInfo, p: Principal, q: { studentId?: string; includeReturned?: boolean }): Promise<LibraryIssue[]> {
  const scope = p.scope('library:view');
  const today = todayIn(tenant.timezone);
  const conds: SQL[] = [];
  if (q.studentId) {
    await assertStudentAccess(db, p, 'library:view', q.studentId);
    conds.push(eq(libraryIssues.studentId, q.studentId));
  } else {
    const kids = scope === 'own' ? (p.studentId ? [p.studentId] : []) : scope === 'linked' ? p.linkedStudentIds : [];
    if (kids.length) conds.push(inArray(libraryIssues.studentId, kids));
    if (p.staffId) conds.push(eq(libraryIssues.staffId, p.staffId));
  }
  if (!conds.length) return [];
  const rows = await issueSelect(db)
    .where(and(or(...conds), q.includeReturned ? undefined : isNull(libraryIssues.returnedOn)))
    .orderBy(asc(sql`${libraryIssues.returnedOn} is not null`), asc(libraryIssues.dueOn), asc(libraryIssues.id))
    .limit(200);
  const policy = await getPolicy(db);
  return rows.map((r) => toIssue(r, today, policy.finePerDayMinor));
}
