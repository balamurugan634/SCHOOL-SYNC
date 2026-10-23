// Shared zod schemas for the operations module: transport (/transport/*) and library (/library/*).
// Money is integer minor units (paise); dates YYYY-MM-DD; times HH:MM.
import { z } from 'zod';
import { dateStr, isoDateTime, pageQuery, paged, timeStr, uuid } from './common';

const opsBool = z.enum(['true', 'false']).transform((v) => v === 'true');

// ═══ Transport ═══════════════════════════════════════════════════════════════════════════════════
export const INSURANCE_STATUSES = ['valid', 'expiring', 'expired', 'unknown'] as const;
export type InsuranceStatus = (typeof INSURANCE_STATUSES)[number];

const phone = z.string().trim().min(5).max(20);
const vehicleFields = {
  registrationNo: z.string().trim().min(3).max(20),
  model: z.string().trim().max(80).nullable(),
  capacity: z.number().int().min(1).max(150),
  driverName: z.string().trim().max(100).nullable(),
  driverPhone: phone.nullable(),
  attendantName: z.string().trim().max(100).nullable(),
  insuranceExpiry: dateStr.nullable(),
};
export const transportVehicleCreateBody = z.object({
  registrationNo: vehicleFields.registrationNo,
  model: vehicleFields.model.optional(),
  capacity: vehicleFields.capacity.default(40),
  driverName: vehicleFields.driverName.optional(),
  driverPhone: vehicleFields.driverPhone.optional(),
  attendantName: vehicleFields.attendantName.optional(),
  insuranceExpiry: vehicleFields.insuranceExpiry.optional(),
});
export const transportVehicleUpdateBody = z.object({ ...vehicleFields, isActive: z.boolean() }).partial();
export const transportVehicle = z.object({
  id: uuid,
  registrationNo: z.string(),
  model: z.string().nullable(),
  capacity: z.number().int(),
  driverName: z.string().nullable(),
  driverPhone: z.string().nullable(),
  attendantName: z.string().nullable(),
  insuranceExpiry: dateStr.nullable(),
  /** `expiring` = within 30 days */
  insuranceStatus: z.enum(INSURANCE_STATUSES),
  isActive: z.boolean(),
  /** active routes using this vehicle */
  routeCount: z.number().int(),
  createdAt: isoDateTime,
});
export type TransportVehicle = z.infer<typeof transportVehicle>;
export const transportVehicleListQuery = pageQuery.extend({
  active: opsBool.optional(),
  /** only vehicles whose insurance is `expiring` or `expired` */
  insuranceAlert: opsBool.optional(),
});

const routeFields = {
  name: z.string().trim().min(1).max(100),
  vehicleId: uuid.nullable(),
  pickupStartTime: timeStr.nullable(),
  dropStartTime: timeStr.nullable(),
};
export const transportRouteCreateBody = z.object({ name: routeFields.name, vehicleId: routeFields.vehicleId.optional(), pickupStartTime: routeFields.pickupStartTime.optional(), dropStartTime: routeFields.dropStartTime.optional() });
export const transportRouteUpdateBody = z.object({ ...routeFields, isActive: z.boolean() }).partial();
export const transportRoute = z.object({
  id: uuid,
  name: z.string(),
  vehicle: z.object({ id: uuid, registrationNo: z.string(), capacity: z.number().int(), driverName: z.string().nullable(), driverPhone: z.string().nullable() }).nullable(),
  pickupStartTime: timeStr.nullable(),
  dropStartTime: timeStr.nullable(),
  isActive: z.boolean(),
  stopCount: z.number().int(),
  studentCount: z.number().int(),
  /** seats of the assigned vehicle (null when no vehicle is assigned: unlimited) */
  capacity: z.number().int().nullable(),
  seatsLeft: z.number().int().nullable(),
  createdAt: isoDateTime,
});
export type TransportRoute = z.infer<typeof transportRoute>;
export const transportRouteListQuery = pageQuery.extend({ active: opsBool.optional() });

const stopFields = {
  name: z.string().trim().min(1).max(100),
  pickupTime: timeStr.nullable(),
  dropTime: timeStr.nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  feeMinor: z.number().int().min(0).nullable(),
};
export const transportStopCreateBody = z.object({
  name: stopFields.name,
  /** 1-based position; later stops shift down. Omit to append. */
  ordinal: z.number().int().min(1).optional(),
  pickupTime: stopFields.pickupTime.optional(),
  dropTime: stopFields.dropTime.optional(),
  lat: stopFields.lat.optional(),
  lng: stopFields.lng.optional(),
  feeMinor: stopFields.feeMinor.optional(),
});
export const transportStopUpdateBody = z.object(stopFields).partial();
export const transportStop = z.object({
  id: uuid,
  routeId: uuid,
  name: z.string(),
  ordinal: z.number().int(),
  pickupTime: timeStr.nullable(),
  dropTime: timeStr.nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** optional monthly/term fee for this stop, minor units */
  feeMinor: z.number().int().nullable(),
  studentCount: z.number().int(),
});
export type TransportStop = z.infer<typeof transportStop>;
export const transportStopOrderBody = z.object({ stopIds: z.array(uuid).min(1).max(200) });
export const transportRouteDetail = transportRoute.extend({ stops: z.array(transportStop) });

export const transportAllocationBody = z.object({ routeId: uuid, stopId: uuid.nullable().optional(), startDate: dateStr.optional() });
export const transportAllocation = z.object({
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  grade: z.string().nullable(),
  section: z.string().nullable(),
  routeId: uuid,
  routeName: z.string(),
  stopId: uuid.nullable(),
  stopName: z.string().nullable(),
  pickupTime: timeStr.nullable(),
  dropTime: timeStr.nullable(),
  startDate: dateStr.nullable(),
});
export type TransportAllocation = z.infer<typeof transportAllocation>;
export const transportAllocationQuery = pageQuery.extend({ routeId: uuid.optional(), stopId: uuid.optional(), studentId: uuid.optional() });

export const transportManifest = z.object({
  route: transportRoute,
  stops: z.array(z.object({ stop: transportStop.nullable(), students: z.array(transportAllocation) })),
});
export type TransportManifest = z.infer<typeof transportManifest>;

export const transportMyBusItem = z.object({
  studentId: uuid,
  studentName: z.string(),
  allocated: z.boolean(),
  route: z.object({ id: uuid, name: z.string(), pickupStartTime: timeStr.nullable(), dropStartTime: timeStr.nullable() }).nullable(),
  stop: z.object({ id: uuid, name: z.string(), pickupTime: timeStr.nullable(), dropTime: timeStr.nullable() }).nullable(),
  vehicle: z.object({ registrationNo: z.string(), model: z.string().nullable() }).nullable(),
  /** contact details of the bus staff — only returned for the student's own / linked children */
  driver: z.object({ name: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  attendantName: z.string().nullable(),
});
export type TransportMyBusItem = z.infer<typeof transportMyBusItem>;

export const transportPickup = z.object({ name: z.string(), relationship: z.string().nullable(), phone: z.string(), active: z.boolean() });

// ═══ Library ═════════════════════════════════════════════════════════════════════════════════════
const bookFields = {
  accessionNo: z.string().trim().min(1).max(40),
  isbn: z.string().trim().max(20).nullable(),
  title: z.string().trim().min(1).max(250),
  author: z.string().trim().max(200).nullable(),
  publisher: z.string().trim().max(200).nullable(),
  category: z.string().trim().max(80).nullable(),
  shelf: z.string().trim().max(40).nullable(),
  totalCopies: z.number().int().min(1).max(1000),
};
export const libraryBookCreateBody = z.object({
  accessionNo: bookFields.accessionNo,
  isbn: bookFields.isbn.optional(),
  title: bookFields.title,
  author: bookFields.author.optional(),
  publisher: bookFields.publisher.optional(),
  category: bookFields.category.optional(),
  shelf: bookFields.shelf.optional(),
  totalCopies: bookFields.totalCopies.default(1),
});
/** Changing `totalCopies` moves `availableCopies` by the same amount; it cannot go below the copies currently on loan. */
export const libraryBookUpdateBody = z.object(bookFields).partial();
export const libraryBook = z.object({
  id: uuid,
  accessionNo: z.string(),
  isbn: z.string().nullable(),
  title: z.string(),
  author: z.string().nullable(),
  publisher: z.string().nullable(),
  category: z.string().nullable(),
  shelf: z.string().nullable(),
  totalCopies: z.number().int(),
  availableCopies: z.number().int(),
  available: z.boolean(),
  archived: z.boolean(),
  createdAt: isoDateTime,
});
export type LibraryBook = z.infer<typeof libraryBook>;
export const libraryBookListQuery = pageQuery.extend({
  category: z.string().trim().max(80).optional(),
  /** only titles with at least one copy on the shelf */
  available: opsBool.optional(),
  /** librarians only */
  includeArchived: opsBool.optional(),
});
export const libraryCategories = z.object({ data: z.array(z.string()) });

export const LIBRARY_LOAN_STATUSES = ['borrowed', 'overdue', 'returned'] as const;
export const libraryIssueCreateBody = z.object({
  bookId: uuid,
  /** exactly one of studentId / staffId */
  studentId: uuid.optional(),
  staffId: uuid.optional(),
  /** defaults to today + the school's loan period */
  dueOn: dateStr.optional(),
});
export const libraryReturnBody = z.object({ waiveFine: z.boolean().default(false) });
export const libraryIssue = z.object({
  id: uuid,
  book: z.object({ id: uuid, title: z.string(), author: z.string().nullable(), accessionNo: z.string() }),
  borrower: z.object({
    type: z.enum(['student', 'staff']),
    id: uuid,
    name: z.string(),
    /** admission no. (student) or employee id (staff) */
    code: z.string(),
    grade: z.string().nullable(),
    section: z.string().nullable(),
  }),
  issuedOn: dateStr,
  dueOn: dateStr,
  returnedOn: dateStr.nullable(),
  status: z.enum(LIBRARY_LOAN_STATUSES),
  daysOverdue: z.number().int(),
  /** final fine once returned; accrued fine so far while overdue (minor units) */
  fineMinor: z.number().int(),
});
export type LibraryIssue = z.infer<typeof libraryIssue>;
export const libraryIssueListQuery = pageQuery.extend({
  status: z.enum(['active', 'overdue', 'returned', 'all']).default('active'),
  bookId: uuid.optional(),
  studentId: uuid.optional(),
  staffId: uuid.optional(),
});
export const libraryOverdueResponse = z.object({
  data: z.array(libraryIssue),
  meta: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
  totals: z.object({ count: z.number().int(), fineMinor: z.number().int() }),
});
export const libraryMyBooksQuery = z.object({ studentId: uuid.optional(), includeReturned: opsBool.optional() });
export const libraryMyBooks = z.object({ data: z.array(libraryIssue) });

export const libraryPolicy = z.object({
  loanDays: z.number().int().min(1).max(365),
  staffLoanDays: z.number().int().min(1).max(365),
  finePerDayMinor: z.number().int().min(0),
  maxLoansPerStudent: z.number().int().min(1).max(50),
  maxLoansPerStaff: z.number().int().min(1).max(50),
});
export type LibraryPolicy = z.infer<typeof libraryPolicy>;
export const libraryPolicyUpdateBody = libraryPolicy.partial();

export const transportVehiclePage = paged(transportVehicle);
