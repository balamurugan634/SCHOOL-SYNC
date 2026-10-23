import { sql } from 'drizzle-orm';
import { boolean, date, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid, integer } from 'drizzle-orm/pg-core';
import { ADMISSION_STATUSES, CORRECTION_STATUSES, GENDERS, RELATIONSHIPS, STUDENT_STATUSES } from '@school-sync/shared';
import { createdAt, pk, ts, updatedAt } from './_helpers';
import { academicYears, grades, sections } from './academics';
import { users } from './identity';

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}
export interface ContactPerson {
  name: string;
  relationship?: string;
  phone: string;
  altPhone?: string;
}
export interface PickupPerson extends ContactPerson {
  idProof?: string;
  active?: boolean;
}

export const students = pgTable(
  'students',
  {
    id: pk(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    admissionNo: text('admission_no').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    dob: date('dob', { mode: 'string' }),
    gender: text('gender', { enum: GENDERS }),
    bloodGroup: text('blood_group'),
    nationality: text('nationality'),
    religion: text('religion'),
    category: text('category'),
    photoFileId: uuid('photo_file_id'),
    address: jsonb('address').$type<Address>(),
    /** sensitive — only roles with students:edit / school scope or the guardian see it */
    medicalNotes: text('medical_notes'),
    emergencyContacts: jsonb('emergency_contacts').$type<ContactPerson[]>().notNull().default([]),
    authorizedPickups: jsonb('authorized_pickups').$type<PickupPerson[]>().notNull().default([]),
    status: text('status', { enum: STUDENT_STATUSES }).notNull().default('active'),
    admissionDate: date('admission_date', { mode: 'string' }),
    /** denormalised pointer to the current-year enrollment; history lives in `enrollments` */
    currentSectionId: uuid('current_section_id').references(() => sections.id, { onDelete: 'set null' }),
    currentGradeId: uuid('current_grade_id').references(() => grades.id, { onDelete: 'set null' }),
    rollNo: integer('roll_no'),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('students_admission_no_uq').on(t.admissionNo),
    uniqueIndex('students_user_uq').on(t.userId),
    index('students_section_idx').on(t.currentSectionId, t.status),
    index('students_grade_idx').on(t.currentGradeId),
    index('students_name_idx').on(sql`lower(${t.firstName})`, sql`lower(${t.lastName})`),
  ],
);

export const guardians = pgTable(
  'guardians',
  {
    id: pk(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    phone: text('phone'),
    email: text('email'),
    occupation: text('occupation'),
    address: jsonb('address').$type<Address>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('guardians_user_uq').on(t.userId), index('guardians_phone_idx').on(t.phone)],
);

/**
 * Parent↔child link. Only rows with `verifiedAt IS NOT NULL` grant access
 * (the "school-approved process" rule). Many guardians per student, many students per guardian.
 */
export const studentGuardians = pgTable(
  'student_guardians',
  {
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    guardianId: uuid('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    relationship: text('relationship', { enum: RELATIONSHIPS }).notNull().default('guardian'),
    isPrimary: boolean('is_primary').notNull().default(false),
    canPickup: boolean('can_pickup').notNull().default(true),
    isEmergencyContact: boolean('is_emergency_contact').notNull().default(false),
    verifiedAt: ts('verified_at'),
    verifiedBy: uuid('verified_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.guardianId] }), index('student_guardians_guardian_idx').on(t.guardianId)],
);

export const staff = pgTable(
  'staff',
  {
    id: pk(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    employeeId: text('employee_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    designation: text('designation'),
    department: text('department'),
    staffType: text('staff_type', { enum: ['teaching', 'non_teaching'] })
      .notNull()
      .default('teaching'),
    gender: text('gender', { enum: GENDERS }),
    dob: date('dob', { mode: 'string' }),
    joinDate: date('join_date', { mode: 'string' }),
    qualification: text('qualification'),
    phone: text('phone'),
    email: text('email'),
    address: jsonb('address').$type<Address>(),
    emergencyContact: jsonb('emergency_contact').$type<ContactPerson>(),
    photoFileId: uuid('photo_file_id'),
    status: text('status', { enum: ['active', 'on_leave', 'resigned', 'terminated'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('staff_employee_id_uq').on(t.employeeId), uniqueIndex('staff_user_uq').on(t.userId)],
);

/** One row per student per academic year. Promotion creates the next row and keeps history. */
export const enrollments = pgTable(
  'enrollments',
  {
    id: pk(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    rollNo: integer('roll_no'),
    status: text('status', { enum: ['enrolled', 'promoted', 'retained', 'transferred', 'left'] })
      .notNull()
      .default('enrolled'),
    startedAt: date('started_at', { mode: 'string' }),
    endedAt: date('ended_at', { mode: 'string' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('enrollments_student_year_uq').on(t.studentId, t.academicYearId), index('enrollments_section_idx').on(t.sectionId), index('enrollments_year_idx').on(t.academicYearId)],
);

export const admissions = pgTable(
  'admissions',
  {
    id: pk(),
    applicationNo: text('application_no').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    dob: date('dob', { mode: 'string' }),
    gender: text('gender', { enum: GENDERS }),
    gradeAppliedId: uuid('grade_applied_id').references(() => grades.id),
    academicYearId: uuid('academic_year_id').references(() => academicYears.id),
    guardianName: text('guardian_name').notNull(),
    guardianRelationship: text('guardian_relationship', { enum: RELATIONSHIPS }).default('guardian'),
    guardianPhone: text('guardian_phone').notNull(),
    guardianEmail: text('guardian_email'),
    previousSchool: text('previous_school'),
    address: jsonb('address').$type<Address>(),
    notes: text('notes'),
    documents: jsonb('documents').$type<string[]>().notNull().default([]),
    status: text('status', { enum: ADMISSION_STATUSES }).notNull().default('submitted'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    /** set once the admission is confirmed into a student */
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('admissions_no_uq').on(t.applicationNo), index('admissions_status_idx').on(t.status, t.createdAt.desc())],
);

export const studentDocuments = pgTable(
  'student_documents',
  {
    id: pk(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['birth_certificate', 'transfer_certificate', 'id_proof', 'medical', 'address_proof', 'other'] }).notNull(),
    title: text('title'),
    fileId: uuid('file_id').notNull(),
    uploadedBy: uuid('uploaded_by'),
    verifiedAt: ts('verified_at'),
    createdAt: createdAt(),
  },
  (t) => [index('student_documents_student_idx').on(t.studentId), index('student_documents_file_idx').on(t.fileId)],
);

/**
 * A parent (verified link) or the student asks the school to correct an official record field.
 * Nothing changes until a user with `students:edit` approves; approval applies `changes` in one audited transaction.
 */
export const recordCorrectionRequests = pgTable(
  'record_correction_requests',
  {
    id: pk(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').notNull(),
    requesterRole: text('requester_role', { enum: ['parent', 'student'] }).notNull(),
    /** proposed new values, keyed by whitelisted student field (see CORRECTION_FIELDS in shared/people) */
    changes: jsonb('changes').$type<Record<string, unknown>>().notNull(),
    /** values of those fields when the request was filed (for the reviewer and the audit trail) */
    original: jsonb('original').$type<Record<string, unknown>>().notNull().default({}),
    reason: text('reason'),
    status: text('status', { enum: CORRECTION_STATUSES }).notNull().default('pending'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('correction_requests_status_idx').on(t.status, t.createdAt.desc()),
    index('correction_requests_student_idx').on(t.studentId, t.createdAt.desc()),
    index('correction_requests_requester_idx').on(t.requestedBy, t.createdAt.desc()),
  ],
);
