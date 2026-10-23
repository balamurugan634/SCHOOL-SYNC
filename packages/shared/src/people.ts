import { z } from 'zod';
import { dateStr, isoDateTime, pageQuery, paged, uuid } from './common';
import { GENDERS, RELATIONSHIPS, STUDENT_STATUSES, ADMISSION_STATUSES } from './enums';

/** Shared zod schemas for the people module: students, guardians, staff, admissions, self-service, correction requests. */

export const CORRECTION_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

/** Official student record fields a parent / the student may ask the school to correct. */
export const CORRECTION_FIELDS = ['firstName', 'lastName', 'dob', 'gender', 'bloodGroup', 'nationality', 'religion', 'category', 'address', 'medicalNotes'] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

export const STUDENT_DOCUMENT_KINDS = ['birth_certificate', 'transfer_certificate', 'id_proof', 'medical', 'address_proof', 'other'] as const;
export const STAFF_TYPES = ['teaching', 'non_teaching'] as const;
export const STAFF_STATUSES = ['active', 'on_leave', 'resigned', 'terminated'] as const;

// ── small building blocks ───────────────────────────────────────────────────────────────────────
export const phoneStr = z
  .string()
  .trim()
  .min(6)
  .max(20)
  .regex(/^\+?[\d\s\-()]{6,19}$/, 'Enter a valid phone number');
const shortText = (max = 120) => z.string().trim().max(max);

export const addressSchema = z.object({
  line1: shortText().optional(),
  line2: shortText().optional(),
  city: shortText(80).optional(),
  state: shortText(80).optional(),
  postalCode: shortText(20).optional(),
  country: shortText(80).optional(),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const contactPersonSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: shortText(40).optional(),
  phone: phoneStr,
  altPhone: phoneStr.optional(),
});
export type ContactPersonInput = z.infer<typeof contactPersonSchema>;
export const pickupPersonSchema = contactPersonSchema.extend({ idProof: shortText(80).optional(), active: z.boolean().optional() });
export type PickupPersonInput = z.infer<typeof pickupPersonSchema>;
const contactList = z.array(contactPersonSchema).max(10);
const pickupList = z.array(pickupPersonSchema).max(10);

/** A login that was just created. The password is shown ONCE; the user must change it at first sign-in. */
export const issuedCredentialOut = z.object({ username: z.string(), temporaryPassword: z.string() });
export type IssuedCredential = z.infer<typeof issuedCredentialOut>;

// ── guardian ↔ student links ────────────────────────────────────────────────────────────────────
export const guardianLinkOut = z.object({
  guardianId: uuid,
  name: z.string(),
  relationship: z.enum(RELATIONSHIPS),
  isPrimary: z.boolean(),
  canPickup: z.boolean(),
  isEmergencyContact: z.boolean(),
  /** only verified links give the parent access to the child */
  verified: z.boolean(),
  verifiedAt: isoDateTime.nullable(),
  /** contact details are hidden from callers without guardians:view (except a parent's own entry) */
  phone: z.string().nullable(),
  email: z.string().nullable(),
  hasLogin: z.boolean(),
});
export type GuardianLinkOut = z.infer<typeof guardianLinkOut>;

export const studentGuardianLinkBody = z.object({
  guardianId: uuid,
  relationship: z.enum(RELATIONSHIPS).default('guardian'),
  isPrimary: z.boolean().optional(),
  canPickup: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
  /** verify in the same step (the school has checked the relationship). Default: the link waits for `/verify`. */
  verified: z.boolean().default(false),
});
export const studentGuardianUpdateBody = z.object({
  relationship: z.enum(RELATIONSHIPS).optional(),
  isPrimary: z.boolean().optional(),
  canPickup: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
});
export const studentGuardianParam = z.object({ id: uuid, guardianId: uuid });

// ── students ────────────────────────────────────────────────────────────────────────────────────
export const studentListQuery = pageQuery.extend({
  gradeId: uuid.optional(),
  sectionId: uuid.optional(),
  /** default: students who are currently at the school (active + suspended); pass a status to list archived ones */
  status: z.enum(STUDENT_STATUSES).optional(),
});
export type StudentListQuery = z.infer<typeof studentListQuery>;

export const studentListItem = z.object({
  id: uuid,
  admissionNo: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  name: z.string(),
  gender: z.enum(GENDERS).nullable(),
  dob: dateStr.nullable(),
  photoUrl: z.string().nullable(),
  status: z.enum(STUDENT_STATUSES),
  gradeId: uuid.nullable(),
  gradeName: z.string().nullable(),
  sectionId: uuid.nullable(),
  sectionName: z.string().nullable(),
  rollNo: z.number().nullable(),
});
export type StudentListItem = z.infer<typeof studentListItem>;
export const studentListOut = paged(studentListItem);

export const enrollmentOut = z.object({
  id: uuid,
  academicYearId: uuid,
  academicYearName: z.string(),
  gradeId: uuid,
  gradeName: z.string(),
  sectionId: uuid,
  sectionName: z.string(),
  rollNo: z.number().nullable(),
  status: z.enum(['enrolled', 'promoted', 'retained', 'transferred', 'left']),
  startedAt: dateStr.nullable(),
  endedAt: dateStr.nullable(),
});

export const studentDocumentOut = z.object({
  id: uuid,
  studentId: uuid,
  kind: z.enum(STUDENT_DOCUMENT_KINDS),
  title: z.string().nullable(),
  fileId: uuid,
  fileUrl: z.string(),
  verified: z.boolean(),
  verifiedAt: isoDateTime.nullable(),
  uploadedBy: uuid.nullable(),
  createdAt: isoDateTime,
});
export type StudentDocumentOut = z.infer<typeof studentDocumentOut>;

export const studentDetailOut = studentListItem.extend({
  bloodGroup: z.string().nullable(),
  nationality: z.string().nullable(),
  religion: z.string().nullable(),
  category: z.string().nullable(),
  address: addressSchema.nullable(),
  admissionDate: dateStr.nullable(),
  emergencyContacts: z.array(contactPersonSchema),
  authorizedPickups: z.array(pickupPersonSchema),
  /** sensitive: only school-wide editors and the child's verified guardians get this; `null` for everyone else */
  medicalNotes: z.string().nullable(),
  /** the student's login (staff with users:view only) */
  username: z.string().nullable(),
  guardians: z.array(guardianLinkOut),
  enrollments: z.array(enrollmentOut),
  /** sensitive: `null` unless the caller holds student_documents:view for this student */
  documents: z.array(studentDocumentOut).nullable(),
});
export type StudentDetailOut = z.infer<typeof studentDetailOut>;

const studentFields = {
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).nullish(),
  dob: dateStr.nullish(),
  gender: z.enum(GENDERS).nullish(),
  bloodGroup: z.string().trim().max(5).nullish(),
  nationality: z.string().trim().max(60).nullish(),
  religion: z.string().trim().max(60).nullish(),
  category: z.string().trim().max(60).nullish(),
  address: addressSchema.nullish(),
  medicalNotes: z.string().trim().max(2000).nullish(),
  emergencyContacts: contactList.optional(),
  authorizedPickups: pickupList.optional(),
  admissionDate: dateStr.nullish(),
  photoFileId: uuid.nullish(),
};

/** A guardian to link while creating a student: an existing one (`guardianId`) or a new one (name + phone). */
export const studentCreateGuardian = z
  .object({
    guardianId: uuid.optional(),
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    phone: phoneStr.optional(),
    email: z.email().max(160).optional(),
    occupation: z.string().trim().max(80).optional(),
    relationship: z.enum(RELATIONSHIPS).default('guardian'),
    isPrimary: z.boolean().optional(),
    canPickup: z.boolean().optional(),
    isEmergencyContact: z.boolean().optional(),
    /** new guardian only: create the parent login (username = phone, or email) */
    createLogin: z.boolean().default(true),
    verified: z.boolean().default(false),
  })
  .refine((g) => !!g.guardianId || (!!g.firstName && (!!g.phone || !!g.email)), { message: 'Give an existing guardianId, or a first name with a phone or email' });

export const studentCreateBody = z.object({
  ...studentFields,
  /** section of the CURRENT academic year; the student is enrolled there (this uses a billable seat) */
  sectionId: uuid,
  rollNo: z.number().int().min(1).max(9999).optional(),
  /** create the student login (username = admission number, lower case) */
  createLogin: z.boolean().default(true),
  guardians: z.array(studentCreateGuardian).max(4).optional(),
});
export type StudentCreateBody = z.infer<typeof studentCreateBody>;

export const studentCreateOut = studentDetailOut.extend({
  credentials: z.object({
    student: issuedCredentialOut.nullable(),
    guardians: z.array(issuedCredentialOut.extend({ guardianId: uuid })),
  }),
});
export type StudentCreateOut = z.infer<typeof studentCreateOut>;

export const studentUpdateBody = z.object(studentFields).partial();
export type StudentUpdateBody = z.infer<typeof studentUpdateBody>;

export const studentStatusBody = z.object({
  status: z.enum(STUDENT_STATUSES),
  reason: z.string().trim().max(300).optional(),
  effectiveDate: dateStr.optional(),
});
export const studentMoveSectionBody = z.object({
  sectionId: uuid,
  rollNo: z.number().int().min(1).max(9999).optional(),
  /** move even if the target section is at capacity */
  force: z.boolean().default(false),
});

export const studentDocumentCreateBody = z.object({ kind: z.enum(STUDENT_DOCUMENT_KINDS), title: z.string().trim().max(120).optional(), fileId: uuid });
export const studentDocumentParam = z.object({ id: uuid, docId: uuid });

// ── bulk import ─────────────────────────────────────────────────────────────────────────────────
/** One row of the import sheet. Header names in CSV are matched loosely (`First Name`, `first_name`, `firstname`). */
export const studentImportRow = z.object({
  admissionNo: z.string().trim().max(30).optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  dob: z.string().trim().max(20).optional(),
  gender: z.string().trim().max(10).optional(),
  bloodGroup: z.string().trim().max(5).optional(),
  grade: z.string().trim().max(60).optional(),
  section: z.string().trim().max(20).optional(),
  sectionId: z.string().trim().max(40).optional(),
  rollNo: z.string().trim().max(6).optional(),
  guardianName: z.string().trim().max(120).optional(),
  guardianPhone: z.string().trim().max(20).optional(),
  guardianEmail: z.string().trim().max(160).optional(),
  guardianRelationship: z.string().trim().max(20).optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
});
export type StudentImportRow = z.infer<typeof studentImportRow>;
export const IMPORT_MAX_ROWS = 500;

export const studentImportBody = z
  .object({
    /** true (default) validates and reports only; false writes */
    dryRun: z.boolean().default(true),
    /** CSV text with a header row … */
    csv: z.string().max(900_000).optional(),
    /** … or JSON rows */
    rows: z.array(studentImportRow).max(IMPORT_MAX_ROWS).optional(),
    /** import the valid rows and skip the bad ones (default: any bad row rejects the whole import) */
    skipInvalid: z.boolean().default(false),
    /** create student + parent logins */
    createLogins: z.boolean().default(true),
  })
  .refine((b) => (b.csv ? 1 : 0) + (b.rows ? 1 : 0) === 1, { message: 'Send either csv or rows' });
export type StudentImportBody = z.infer<typeof studentImportBody>;

export const studentImportOut = z.object({
  dryRun: z.boolean(),
  total: z.number(),
  valid: z.number(),
  invalid: z.number(),
  /** students written (0 for a dry run) */
  created: z.number(),
  /** would the licence allow all valid rows? (real runs throw 402 instead of reporting) */
  seats: z.object({ adding: z.number(), ok: z.boolean(), code: z.string().optional(), message: z.string().optional() }),
  rows: z.array(
    z.object({
      row: z.number(),
      ok: z.boolean(),
      name: z.string().nullable(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
      admissionNo: z.string().nullable(),
      studentId: uuid.nullable(),
    }),
  ),
  /** temporary logins, real runs only — shown once */
  credentials: z.array(z.object({ row: z.number(), admissionNo: z.string(), student: issuedCredentialOut.nullable(), guardian: issuedCredentialOut.nullable() })),
});
export type StudentImportOut = z.infer<typeof studentImportOut>;

// ── guardians ───────────────────────────────────────────────────────────────────────────────────
export const guardianChildOut = z.object({ studentId: uuid, name: z.string(), admissionNo: z.string(), gradeName: z.string().nullable(), sectionName: z.string().nullable(), relationship: z.enum(RELATIONSHIPS), verified: z.boolean() });

export const guardianOut = z.object({
  id: uuid,
  firstName: z.string(),
  lastName: z.string().nullable(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  occupation: z.string().nullable(),
  address: addressSchema.nullable(),
  hasLogin: z.boolean(),
  /** login name, for callers with users:view */
  username: z.string().nullable(),
  children: z.array(guardianChildOut),
  createdAt: isoDateTime,
});
export type GuardianOut = z.infer<typeof guardianOut>;
export const guardianListQuery = pageQuery.extend({ studentId: uuid.optional(), hasLogin: z.enum(['true', 'false']).optional() });
export const guardianListOut = paged(guardianOut);

export const guardianCreateBody = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).optional(),
    phone: phoneStr.optional(),
    email: z.email().max(160).optional(),
    occupation: z.string().trim().max(80).optional(),
    address: addressSchema.optional(),
    /** create the parent login now (username = phone, or email) */
    createLogin: z.boolean().default(false),
  })
  .refine((g) => !g.createLogin || !!g.phone || !!g.email, { message: 'A phone or email is needed to create a login' });
export const guardianCreateOut = guardianOut.extend({ credentials: issuedCredentialOut.nullable() });
export const guardianUpdateBody = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().max(80).nullish(),
  phone: phoneStr.nullish(),
  email: z.email().max(160).nullish(),
  occupation: z.string().trim().max(80).nullish(),
  address: addressSchema.nullish(),
});
export const guardianLoginOut = issuedCredentialOut;

// ── staff ───────────────────────────────────────────────────────────────────────────────────────
export const staffListQuery = pageQuery.extend({
  staffType: z.enum(STAFF_TYPES).optional(),
  status: z.enum(STAFF_STATUSES).optional(),
  department: z.string().max(80).optional(),
});
export const staffListItem = z.object({
  id: uuid,
  employeeId: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  name: z.string(),
  designation: z.string().nullable(),
  department: z.string().nullable(),
  staffType: z.enum(STAFF_TYPES),
  status: z.enum(STAFF_STATUSES),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  photoUrl: z.string().nullable(),
  hasLogin: z.boolean(),
  roles: z.array(z.string()),
});
export type StaffListItem = z.infer<typeof staffListItem>;
export const staffListOut = paged(staffListItem);

export const staffDetailOut = staffListItem.extend({
  gender: z.enum(GENDERS).nullable(),
  dob: dateStr.nullable(),
  joinDate: dateStr.nullable(),
  qualification: z.string().nullable(),
  address: addressSchema.nullable(),
  emergencyContact: contactPersonSchema.nullable(),
  userId: uuid.nullable(),
  username: z.string().nullable(),
  userStatus: z.enum(['invited', 'active', 'suspended', 'deactivated']).nullable(),
});
export type StaffDetailOut = z.infer<typeof staffDetailOut>;

const staffFields = {
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).nullish(),
  designation: z.string().trim().max(80).nullish(),
  department: z.string().trim().max(80).nullish(),
  staffType: z.enum(STAFF_TYPES),
  gender: z.enum(GENDERS).nullish(),
  dob: dateStr.nullish(),
  joinDate: dateStr.nullish(),
  qualification: z.string().trim().max(160).nullish(),
  phone: phoneStr.nullish(),
  email: z.email().max(160).nullish(),
  address: addressSchema.nullish(),
  emergencyContact: contactPersonSchema.nullish(),
  photoFileId: uuid.nullish(),
};
export const staffCreateBody = z.object({
  ...staffFields,
  staffType: z.enum(STAFF_TYPES).default('teaching'),
  /** create the login (username = employee id, lower case unless `username` is given) */
  createLogin: z.boolean().default(true),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._@-]{2,60}$/, 'Use 3-61 letters, digits or . _ @ -')
    .optional(),
  /** role keys (teacher is added automatically for teaching staff); anything else needs roles:edit */
  roleKeys: z.array(z.string().max(60)).max(10).optional(),
});
export type StaffCreateBody = z.infer<typeof staffCreateBody>;
export const staffCreateOut = staffDetailOut.extend({ credentials: issuedCredentialOut.nullable() });
export const staffUpdateBody = z.object(staffFields).partial();
export const staffDeactivateBody = z.object({
  status: z.enum(['resigned', 'terminated']).default('resigned'),
  reason: z.string().trim().max(300).optional(),
  /** also clear their class-teacher and subject-teacher assignments (otherwise deactivation is refused while they exist) */
  releaseAssignments: z.boolean().default(false),
});
export const staffRolesBody = z.object({ roleIds: z.array(uuid).max(20) });

export const staffWorkloadOut = z.object({
  staffId: uuid,
  name: z.string(),
  academicYear: z.string().nullable(),
  sectionsLed: z.array(z.object({ sectionId: uuid, gradeName: z.string(), sectionName: z.string(), studentCount: z.number() })),
  assignments: z.array(z.object({ assignmentId: uuid, sectionId: uuid, gradeName: z.string(), sectionName: z.string(), subjectId: uuid, subjectCode: z.string(), subjectName: z.string(), periodsPerWeek: z.number().nullable() })),
  totals: z.object({ sections: z.number(), subjects: z.number(), periodsPerWeek: z.number(), timetabledPeriods: z.number() }),
});
export type StaffWorkloadOut = z.infer<typeof staffWorkloadOut>;

// ── admissions ──────────────────────────────────────────────────────────────────────────────────
export const admissionListQuery = pageQuery.extend({ status: z.enum(ADMISSION_STATUSES).optional(), gradeId: uuid.optional(), yearId: uuid.optional() });
export const admissionOut = z.object({
  id: uuid,
  applicationNo: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  name: z.string(),
  dob: dateStr.nullable(),
  gender: z.enum(GENDERS).nullable(),
  gradeAppliedId: uuid.nullable(),
  gradeAppliedName: z.string().nullable(),
  academicYearId: uuid.nullable(),
  academicYearName: z.string().nullable(),
  guardianName: z.string(),
  guardianRelationship: z.enum(RELATIONSHIPS).nullable(),
  guardianPhone: z.string(),
  guardianEmail: z.string().nullable(),
  previousSchool: z.string().nullable(),
  address: addressSchema.nullable(),
  notes: z.string().nullable(),
  /** uploaded file ids */
  documents: z.array(uuid),
  status: z.enum(ADMISSION_STATUSES),
  decidedBy: uuid.nullable(),
  decidedAt: isoDateTime.nullable(),
  decisionNote: z.string().nullable(),
  studentId: uuid.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AdmissionOut = z.infer<typeof admissionOut>;
export const admissionListOut = paged(admissionOut);

export const admissionCreateBody = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  dob: dateStr.optional(),
  gender: z.enum(GENDERS).optional(),
  gradeAppliedId: uuid,
  /** default: the current academic year */
  academicYearId: uuid.optional(),
  guardianName: z.string().trim().min(1).max(120),
  guardianRelationship: z.enum(RELATIONSHIPS).default('guardian'),
  guardianPhone: phoneStr,
  guardianEmail: z.email().max(160).optional(),
  previousSchool: z.string().trim().max(160).optional(),
  address: addressSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  documents: z.array(uuid).max(10).optional(),
});
export type AdmissionCreateBody = z.infer<typeof admissionCreateBody>;
/** PATCH body: every field optional. (Not `.partial()` of the create body: Zod 4 would re-apply the create body's defaults and silently overwrite stored values.) */
export const admissionUpdateBody = admissionCreateBody.partial().extend({ guardianRelationship: z.enum(RELATIONSHIPS).optional() });
export const admissionStatusBody = z
  .object({ status: z.enum(['under_review', 'waitlisted', 'accepted', 'rejected']), note: z.string().trim().max(500).optional() })
  .refine((b) => b.status !== 'rejected' || (b.note && b.note.length >= 3), { message: 'Give a reason when rejecting an application', path: ['note'] });
export const admissionEnrollBody = z.object({
  /** section of the CURRENT academic year */
  sectionId: uuid,
  rollNo: z.number().int().min(1).max(9999).optional(),
  createStudentLogin: z.boolean().default(true),
  createParentLogin: z.boolean().default(true),
  /** if the guardian's phone already belongs to a registered parent, link to them and verify the link right away (otherwise it waits for verification) */
  verifyExistingGuardian: z.boolean().default(false),
});
export const admissionEnrollOut = z.object({
  admission: admissionOut,
  studentId: uuid,
  admissionNo: z.string(),
  guardianId: uuid,
  /** false when the guardian already existed and the link still needs `/verify` */
  guardianLinkVerified: z.boolean(),
  credentials: z.object({ student: issuedCredentialOut.nullable(), guardian: issuedCredentialOut.nullable() }),
});
export type AdmissionEnrollOut = z.infer<typeof admissionEnrollOut>;

// ── self-service profile ────────────────────────────────────────────────────────────────────────
export const myProfileOut = z.object({
  userType: z.enum(['student', 'parent', 'staff']),
  displayName: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: addressSchema.nullable(),
  avatarUrl: z.string().nullable(),
  /** student: themselves · parent: each verified-linked child · staff: empty */
  emergencyContacts: z.array(z.object({ studentId: uuid, studentName: z.string(), contacts: z.array(contactPersonSchema) })),
  staff: z.object({ employeeId: z.string(), designation: z.string().nullable(), department: z.string().nullable(), emergencyContact: contactPersonSchema.nullable() }).nullable(),
});
export type MyProfileOut = z.infer<typeof myProfileOut>;
export const myProfileUpdateBody = z.object({
  phone: phoneStr.nullish(),
  email: z.email().max(160).nullish(),
  address: addressSchema.nullish(),
  /** student: own emergency contacts · parent: those of `studentId` (default: the only child) */
  emergencyContacts: contactList.optional(),
  studentId: uuid.optional(),
  /** staff */
  emergencyContact: contactPersonSchema.nullish(),
  /** required when the email address changes (it is the account-recovery channel) */
  currentPassword: z.string().min(1).max(200).optional(),
});

// ── record-correction requests ──────────────────────────────────────────────────────────────────
export const correctionChanges = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).nullable(),
    dob: dateStr.nullable(),
    gender: z.enum(GENDERS).nullable(),
    bloodGroup: z.string().trim().max(5).nullable(),
    nationality: z.string().trim().max(60).nullable(),
    religion: z.string().trim().max(60).nullable(),
    category: z.string().trim().max(60).nullable(),
    address: addressSchema.nullable(),
    medicalNotes: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .strict();
export const correctionCreateBody = z.object({
  changes: correctionChanges.refine((c) => Object.keys(c).length > 0, { message: 'Propose at least one change' }),
  reason: z.string().trim().min(3).max(500),
});
export const correctionListQuery = pageQuery.extend({ status: z.enum(CORRECTION_STATUSES).optional(), studentId: uuid.optional() });
export const correctionOut = z.object({
  id: uuid,
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  requestedBy: uuid,
  requestedByName: z.string().nullable(),
  requesterRole: z.enum(['parent', 'student']),
  changes: z.record(z.string(), z.unknown()),
  original: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  status: z.enum(CORRECTION_STATUSES),
  decidedBy: uuid.nullable(),
  decidedAt: isoDateTime.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: isoDateTime,
});
export type CorrectionOut = z.infer<typeof correctionOut>;
export const correctionListOut = paged(correctionOut);
export const correctionApproveBody = z.object({ note: z.string().trim().max(500).optional() });
export const correctionRejectBody = z.object({ note: z.string().trim().min(3).max(500) });
