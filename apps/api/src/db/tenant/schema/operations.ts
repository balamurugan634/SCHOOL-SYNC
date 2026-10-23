import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, doublePrecision, index, integer, pgTable, text, time, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './_helpers';
import { staff, students } from './people';

// ── Transport ────────────────────────────────────────────────────────────────
export const transportVehicles = pgTable(
  'transport_vehicles',
  {
    id: pk(),
    registrationNo: text('registration_no').notNull(),
    model: text('model'),
    capacity: integer('capacity').notNull().default(40),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),
    attendantName: text('attendant_name'),
    insuranceExpiry: date('insurance_expiry', { mode: 'string' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('transport_vehicles_reg_uq').on(t.registrationNo)],
);

export const transportRoutes = pgTable('transport_routes', {
  id: pk(),
  name: text('name').notNull(),
  vehicleId: uuid('vehicle_id').references(() => transportVehicles.id, { onDelete: 'set null' }),
  pickupStartTime: time('pickup_start_time'),
  dropStartTime: time('drop_start_time'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const transportStops = pgTable(
  'transport_stops',
  {
    id: pk(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => transportRoutes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ordinal: integer('ordinal').notNull(),
    pickupTime: time('pickup_time'),
    dropTime: time('drop_time'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    feeMinor: bigint('fee_minor', { mode: 'number' }),
  },
  (t) => [index('transport_stops_route_idx').on(t.routeId, t.ordinal)],
);

export const studentTransport = pgTable(
  'student_transport',
  {
    studentId: uuid('student_id')
      .primaryKey()
      .references(() => students.id, { onDelete: 'cascade' }),
    routeId: uuid('route_id')
      .notNull()
      .references(() => transportRoutes.id),
    stopId: uuid('stop_id').references(() => transportStops.id, { onDelete: 'set null' }),
    startDate: date('start_date', { mode: 'string' }),
    createdAt: createdAt(),
  },
  (t) => [index('student_transport_route_idx').on(t.routeId)],
);

// ── Library ──────────────────────────────────────────────────────────────────
export const libraryBooks = pgTable(
  'library_books',
  {
    id: pk(),
    accessionNo: text('accession_no').notNull(),
    isbn: text('isbn'),
    title: text('title').notNull(),
    author: text('author'),
    publisher: text('publisher'),
    category: text('category'),
    shelf: text('shelf'),
    totalCopies: integer('total_copies').notNull().default(1),
    availableCopies: integer('available_copies').notNull().default(1),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('library_books_acc_uq').on(t.accessionNo),
    index('library_books_title_idx').on(t.title),
    // stock can never go negative or exceed the copies the library owns, whatever the application does
    check('library_books_stock_chk', sql`${t.availableCopies} >= 0 and ${t.availableCopies} <= ${t.totalCopies}`),
  ],
);

export const libraryIssues = pgTable(
  'library_issues',
  {
    id: pk(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => libraryBooks.id),
    studentId: uuid('student_id').references(() => students.id),
    staffId: uuid('staff_id').references(() => staff.id),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    returnedOn: date('returned_on', { mode: 'string' }),
    fineMinor: bigint('fine_minor', { mode: 'number' }).notNull().default(0),
    issuedBy: uuid('issued_by'),
    /** last overdue reminder sent (school-local date) — keeps the daily reminder job idempotent */
    lastRemindedOn: date('last_reminded_on', { mode: 'string' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('library_issues_student_idx').on(t.studentId, t.returnedOn),
    index('library_issues_staff_idx').on(t.staffId, t.returnedOn),
    index('library_issues_book_idx').on(t.bookId, t.returnedOn),
    index('library_issues_due_idx').on(t.dueOn).where(sql`${t.returnedOn} is null`),
    // one open loan of a title per borrower
    uniqueIndex('library_issues_open_student_uq').on(t.bookId, t.studentId).where(sql`${t.returnedOn} is null and ${t.studentId} is not null`),
    uniqueIndex('library_issues_open_staff_uq').on(t.bookId, t.staffId).where(sql`${t.returnedOn} is null and ${t.staffId} is not null`),
    check('library_issues_borrower_chk', sql`(${t.studentId} is not null) <> (${t.staffId} is not null)`),
  ],
);
