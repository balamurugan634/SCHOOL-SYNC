/**
 * Permission catalog — the single source of truth for "Role + Scope + Action".
 *
 *   permission key = `${resource}:${action}`
 *   a role grants   permission -> scope
 *
 * Used by the API (enforcement), the web app and the mobile app (UI gating only —
 * the API is always the authority).
 */

export const ACTIONS = ['view', 'create', 'edit', 'approve', 'publish', 'export', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

/** Narrowest -> widest. A user holding several roles gets the widest scope per permission. */
export const SCOPES = ['own', 'linked', 'assigned', 'school'] as const;
export type Scope = (typeof SCOPES)[number];
const SCOPE_RANK: Record<Scope, number> = { own: 0, linked: 1, assigned: 2, school: 3 };

export function widerScope(a: Scope | undefined, b: Scope | undefined): Scope | undefined {
  if (!a) return b;
  if (!b) return a;
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}
export function scopeAtLeast(have: Scope | undefined, need: Scope): boolean {
  return have !== undefined && SCOPE_RANK[have] >= SCOPE_RANK[need];
}

export const MODULES = {
  people: 'Student & Parent Management',
  academics: 'Academic Structure',
  attendance: 'Attendance & Leave',
  learning: 'Teaching & Learning',
  exams: 'Examinations & Results',
  fees: 'Fees & Finance',
  communication: 'Communication & Events',
  staff: 'Staff & HR',
  operations: 'Transport & Library',
  reports: 'Reports & Insights',
  settings: 'Settings, Permissions & Audit',
} as const;
export type ModuleKey = keyof typeof MODULES;

type ResourceDef = { module: ModuleKey; label: string; actions: readonly Action[] };

export const PERMISSION_CATALOG = {
  // ── people
  students: { module: 'people', label: 'Student records', actions: ['view', 'create', 'edit', 'export', 'delete'] },
  guardians: { module: 'people', label: 'Parents & guardians', actions: ['view', 'create', 'edit', 'delete'] },
  student_documents: { module: 'people', label: 'Student documents (sensitive)', actions: ['view', 'create', 'delete'] },
  admissions: { module: 'people', label: 'Admissions', actions: ['view', 'create', 'edit', 'approve', 'export'] },
  // ── academics
  academics: { module: 'academics', label: 'Academic structure (years, classes, sections, subjects)', actions: ['view', 'create', 'edit', 'delete'] },
  promotions: { module: 'academics', label: 'Year-end promotion', actions: ['view', 'create', 'approve'] },
  // ── attendance
  attendance: { module: 'attendance', label: 'Student attendance', actions: ['view', 'create', 'edit', 'approve', 'export'] },
  leave: { module: 'attendance', label: 'Student leave requests', actions: ['view', 'create', 'edit', 'approve'] },
  staff_attendance: { module: 'attendance', label: 'Staff attendance', actions: ['view', 'create', 'edit', 'export'] },
  staff_leave: { module: 'attendance', label: 'Staff leave requests', actions: ['view', 'create', 'edit', 'approve'] },
  // ── learning
  timetable: { module: 'learning', label: 'Timetable', actions: ['view', 'create', 'edit', 'publish'] },
  homework: { module: 'learning', label: 'Homework & assignments', actions: ['view', 'create', 'edit', 'publish', 'delete'] },
  submissions: { module: 'learning', label: 'Homework submissions', actions: ['view', 'create', 'edit'] },
  materials: { module: 'learning', label: 'Study materials', actions: ['view', 'create', 'edit', 'delete'] },
  syllabus: { module: 'learning', label: 'Syllabus & lesson progress', actions: ['view', 'create', 'edit'] },
  tasks: { module: 'learning', label: 'Personal to-do tasks', actions: ['view', 'create', 'edit', 'delete'] },
  // ── exams
  exams: { module: 'exams', label: 'Exams & schedules', actions: ['view', 'create', 'edit', 'publish', 'delete'] },
  marks: { module: 'exams', label: 'Marks & results', actions: ['view', 'create', 'edit', 'approve', 'publish', 'export'] },
  report_cards: { module: 'exams', label: 'Report cards & remarks', actions: ['view', 'create', 'edit', 'publish', 'export'] },
  // ── fees
  fees: { module: 'fees', label: 'Fee structures, plans & invoices', actions: ['view', 'create', 'edit', 'approve', 'export', 'delete'] },
  payments: { module: 'fees', label: 'Payments, receipts & refunds', actions: ['view', 'create', 'edit', 'approve', 'export'] },
  expenses: { module: 'fees', label: 'Expenses', actions: ['view', 'create', 'edit', 'approve', 'export', 'delete'] },
  // ── communication
  announcements: { module: 'communication', label: 'Announcements & circulars', actions: ['view', 'create', 'edit', 'publish', 'delete'] },
  events: { module: 'communication', label: 'Calendar & events', actions: ['view', 'create', 'edit', 'publish', 'delete'] },
  event_responses: { module: 'communication', label: 'Event registration & consent', actions: ['view', 'create'] },
  meetings: { module: 'communication', label: 'Parent–teacher meetings', actions: ['view', 'create', 'edit', 'approve'] },
  notifications: { module: 'communication', label: 'Notifications inbox', actions: ['view', 'edit'] },
  // ── staff
  staff: { module: 'staff', label: 'Staff profiles & assignments', actions: ['view', 'create', 'edit', 'export', 'delete'] },
  // ── operations
  transport: { module: 'operations', label: 'Transport', actions: ['view', 'create', 'edit', 'delete'] },
  library: { module: 'operations', label: 'Library', actions: ['view', 'create', 'edit', 'delete'] },
  // ── reports
  reports: { module: 'reports', label: 'Reports & dashboards', actions: ['view', 'export'] },
  // ── settings
  users: { module: 'settings', label: 'User accounts', actions: ['view', 'create', 'edit', 'delete'] },
  roles: { module: 'settings', label: 'Roles & permissions', actions: ['view', 'create', 'edit', 'delete'] },
  settings: { module: 'settings', label: 'School settings & branding', actions: ['view', 'edit'] },
  audit: { module: 'settings', label: 'Audit log', actions: ['view', 'export'] },
} as const satisfies Record<string, ResourceDef>;

export type Resource = keyof typeof PERMISSION_CATALOG;
type ActionsOf<R extends Resource> = (typeof PERMISSION_CATALOG)[R]['actions'][number];
export type PermissionKey = { [R in Resource]: `${R}:${ActionsOf<R>}` }[Resource];

export const ALL_PERMISSIONS: PermissionKey[] = (Object.keys(PERMISSION_CATALOG) as Resource[]).flatMap((r) =>
  PERMISSION_CATALOG[r].actions.map((a) => `${r}:${a}` as PermissionKey),
);

export function isPermissionKey(v: string): v is PermissionKey {
  return (ALL_PERMISSIONS as string[]).includes(v);
}

export type Grants = Partial<Record<PermissionKey, Scope>>;

// ─────────────────────────────────────────────────────────────────────────────
// System role presets (seeded into every school; schools may customise via the role editor)
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_ROLE_KEYS = [
  'student',
  'parent',
  'teacher',
  'class_teacher',
  'principal',
  'administrator',
  'accountant',
  'hr',
  'librarian',
  'transport_manager',
  'super_admin',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const USER_TYPES = ['student', 'parent', 'staff'] as const;
export type UserType = (typeof USER_TYPES)[number];

/** Which experience (app shell) a role belongs to. */
export type Experience = 'student' | 'parent' | 'teacher' | 'management';

export interface RolePreset {
  key: SystemRoleKey;
  name: string;
  description: string;
  userTypes: readonly UserType[];
  experience: Experience;
  grants: Grants;
}

function grant(scope: Scope, ...perms: PermissionKey[]): Grants {
  return Object.fromEntries(perms.map((p) => [p, scope])) as Grants;
}
function merge(...parts: Grants[]): Grants {
  const out: Grants = {};
  for (const part of parts) {
    for (const [k, v] of Object.entries(part) as [PermissionKey, Scope][]) out[k] = widerScope(out[k], v);
  }
  return out;
}

/** What a learner (student `own`, parent `linked`) can see. Writes are added per role below. */
const learnerView = (s: Scope): Grants =>
  grant(
    s,
    'students:view',
    'academics:view',
    'timetable:view',
    'attendance:view',
    'leave:view',
    'homework:view',
    'submissions:view',
    'materials:view',
    'syllabus:view',
    'exams:view',
    'marks:view',
    'report_cards:view',
    'fees:view',
    'payments:view',
    'reports:view',
    'meetings:view',
    'transport:view',
    'library:view',
    'event_responses:view',
  );

const everyoneInbox: Grants = {
  ...grant('own', 'notifications:view', 'notifications:edit'),
  ...grant('own', 'announcements:view'),
  ...grant('school', 'events:view'),
};

export const ROLE_PRESETS: Record<SystemRoleKey, RolePreset> = {
  student: {
    key: 'student',
    name: 'Student',
    description: 'Own timetable, attendance, homework, results and personal tasks.',
    userTypes: ['student'],
    experience: 'student',
    grants: merge(
      everyoneInbox,
      learnerView('own'),
      grant('own', 'leave:create', 'submissions:create', 'submissions:edit', 'event_responses:create'),
      grant('own', 'tasks:view', 'tasks:create', 'tasks:edit', 'tasks:delete'),
    ),
  },
  parent: {
    key: 'parent',
    name: 'Parent / Guardian',
    description: 'Verified-linked children: progress, attendance, leave, fees, communication.',
    userTypes: ['parent'],
    experience: 'parent',
    grants: merge(
      everyoneInbox,
      learnerView('linked'),
      grant('linked', 'leave:create', 'leave:edit', 'payments:create', 'meetings:create', 'event_responses:create'),
    ),
  },
  teacher: {
    key: 'teacher',
    name: 'Teacher',
    description: 'Assigned classes and subjects: attendance, homework, marks.',
    userTypes: ['staff'],
    experience: 'teacher',
    grants: merge(
      everyoneInbox,
      grant(
        'assigned',
        'students:view',
        'guardians:view',
        'academics:view',
        'timetable:view',
        'attendance:view',
        'attendance:create',
        'leave:view',
        'homework:view',
        'homework:create',
        'homework:edit',
        'homework:publish',
        'homework:delete',
        'submissions:view',
        'submissions:edit',
        'materials:view',
        'materials:create',
        'materials:edit',
        'materials:delete',
        'syllabus:view',
        'syllabus:create',
        'syllabus:edit',
        'exams:view',
        'marks:view',
        'marks:create',
        'marks:edit',
        'report_cards:view',
        'announcements:create',
        'announcements:edit',
        'announcements:publish',
        'meetings:view',
        'meetings:edit',
        'reports:view',
        'library:view',
      ),
      grant('own', 'staff:view', 'staff_attendance:view', 'staff_attendance:create', 'staff_leave:view', 'staff_leave:create', 'staff_leave:edit'),
    ),
  },
  class_teacher: {
    key: 'class_teacher',
    name: 'Class Teacher',
    description: 'Extra rights for the class they lead: leave approval, remarks, attendance corrections.',
    userTypes: ['staff'],
    experience: 'teacher',
    grants: grant(
      'assigned',
      'attendance:edit',
      'attendance:approve',
      'leave:approve',
      'report_cards:create',
      'report_cards:edit',
      'events:create',
      // may edit and publish the events they created for their own sections (parent consent / trips / class events)
      'events:edit',
      'events:publish',
      'meetings:approve',
    ),
  },
  principal: {
    key: 'principal',
    name: 'Principal',
    description: 'Academic oversight, attendance review, exam approvals, school reports.',
    userTypes: ['staff'],
    experience: 'management',
    grants: merge(
      everyoneInbox,
      grant(
        'school',
        'students:view',
        'students:export',
        'guardians:view',
        'admissions:view',
        'admissions:approve',
        'academics:view',
        'promotions:view',
        'promotions:approve',
        'attendance:view',
        'attendance:approve',
        'attendance:export',
        'leave:view',
        'leave:approve',
        'staff_attendance:view',
        'staff_leave:view',
        'staff_leave:approve',
        'timetable:view',
        'homework:view',
        'submissions:view',
        'materials:view',
        'syllabus:view',
        'exams:view',
        'exams:create',
        'exams:edit',
        'exams:publish',
        'marks:view',
        'marks:approve',
        'marks:publish',
        'marks:export',
        'report_cards:view',
        'report_cards:publish',
        'report_cards:export',
        'fees:view',
        'payments:view',
        'expenses:view',
        'announcements:view',
        'announcements:create',
        'announcements:edit',
        'announcements:publish',
        'events:create',
        'events:edit',
        'events:publish',
        'meetings:view',
        'meetings:approve',
        'staff:view',
        'transport:view',
        'library:view',
        'reports:view',
        'reports:export',
        'audit:view',
      ),
      grant('own', 'staff_leave:create', 'staff_leave:edit', 'staff_attendance:create'),
    ),
  },
  administrator: {
    key: 'administrator',
    name: 'Administrator',
    description: 'Admissions, student records, class structure, timetable, user assignments.',
    userTypes: ['staff'],
    experience: 'management',
    grants: merge(
      everyoneInbox,
      grant(
        'school',
        'students:view',
        'students:create',
        'students:edit',
        'students:export',
        'students:delete',
        'guardians:view',
        'guardians:create',
        'guardians:edit',
        'guardians:delete',
        'student_documents:view',
        'student_documents:create',
        'student_documents:delete',
        'admissions:view',
        'admissions:create',
        'admissions:edit',
        'admissions:approve',
        'admissions:export',
        'academics:view',
        'academics:create',
        'academics:edit',
        'academics:delete',
        'promotions:view',
        'promotions:create',
        'attendance:view',
        'attendance:edit',
        'attendance:export',
        'leave:view',
        'leave:approve',
        'timetable:view',
        'timetable:create',
        'timetable:edit',
        'timetable:publish',
        'homework:view',
        'materials:view',
        'syllabus:view',
        'syllabus:create',
        'syllabus:edit',
        'exams:view',
        'exams:create',
        'exams:edit',
        'exams:delete',
        'announcements:view',
        'announcements:create',
        'announcements:edit',
        'announcements:publish',
        'announcements:delete',
        'events:create',
        'events:edit',
        'events:publish',
        'events:delete',
        'meetings:view',
        'meetings:approve',
        'staff:view',
        'users:view',
        'users:create',
        'users:edit',
        'users:delete',
        'roles:view',
        'settings:view',
        'settings:edit',
        'reports:view',
        'reports:export',
      ),
      grant('own', 'staff_leave:create', 'staff_leave:edit', 'staff_attendance:view', 'staff_attendance:create'),
    ),
  },
  accountant: {
    key: 'accountant',
    name: 'Accounts',
    description: 'Fee structures, collection, receipts, refunds, finance reports.',
    userTypes: ['staff'],
    experience: 'management',
    grants: merge(
      everyoneInbox,
      grant(
        'school',
        'students:view',
        'guardians:view',
        'academics:view',
        'fees:view',
        'fees:create',
        'fees:edit',
        'fees:approve',
        'fees:export',
        'payments:view',
        'payments:create',
        'payments:edit',
        'payments:approve',
        'payments:export',
        'expenses:view',
        'expenses:create',
        'expenses:edit',
        'expenses:approve',
        'expenses:export',
        'expenses:delete',
        'reports:view',
        'reports:export',
      ),
      grant('own', 'staff_leave:create', 'staff_leave:edit', 'staff_attendance:view', 'staff_attendance:create'),
    ),
  },
  hr: {
    key: 'hr',
    name: 'HR',
    description: 'Staff records, staff attendance and leave.',
    userTypes: ['staff'],
    experience: 'management',
    grants: merge(
      everyoneInbox,
      grant(
        'school',
        'staff:view',
        'staff:create',
        'staff:edit',
        'staff:export',
        'staff:delete',
        'staff_attendance:view',
        'staff_attendance:create',
        'staff_attendance:edit',
        'staff_attendance:export',
        'staff_leave:view',
        'staff_leave:approve',
        'academics:view',
        'users:view',
        'users:create',
        'reports:view',
        'reports:export',
      ),
      grant('own', 'staff_leave:create', 'staff_leave:edit'),
    ),
  },
  librarian: {
    key: 'librarian',
    name: 'Librarian',
    description: 'Library catalogue, issue and return.',
    userTypes: ['staff'],
    experience: 'management',
    grants: merge(everyoneInbox, grant('school', 'library:view', 'library:create', 'library:edit', 'library:delete', 'students:view'), grant('own', 'staff_leave:create', 'staff_leave:edit', 'staff_attendance:view', 'staff_attendance:create')),
  },
  transport_manager: {
    key: 'transport_manager',
    name: 'Transport manager',
    description: 'Routes, stops, vehicles and student allocation.',
    userTypes: ['staff'],
    experience: 'management',
    grants: merge(everyoneInbox, grant('school', 'transport:view', 'transport:create', 'transport:edit', 'transport:delete', 'students:view'), grant('own', 'staff_leave:create', 'staff_leave:edit', 'staff_attendance:view', 'staff_attendance:create')),
  },
  super_admin: {
    key: 'super_admin',
    name: 'Super administrator',
    description: 'User roles, school configuration, security settings, access policies.',
    userTypes: ['staff'],
    experience: 'management',
    grants: Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, 'school'])) as Grants,
  },
};

/** Which dashboard a set of roles lands on. Management > teacher > parent > student. */
export function experienceFor(roleKeys: readonly string[]): Experience {
  const exps = new Set<Experience>();
  for (const k of roleKeys) {
    const preset = ROLE_PRESETS[k as SystemRoleKey];
    if (preset) exps.add(preset.experience);
  }
  for (const e of ['management', 'teacher', 'parent', 'student'] as const) if (exps.has(e)) return e;
  return 'student';
}
