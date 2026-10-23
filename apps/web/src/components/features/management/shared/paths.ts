/** Canonical URLs of the management screens (part 1) — use these for every cross-link so routes can move in one place. */
const q = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const paths = {
  // academics
  years: '/admin/academics/years',
  periods: '/admin/academics/years?tab=periods',
  classes: '/admin/academics/classes',
  subjects: '/admin/academics/subjects',
  assignments: (sectionId?: string) => `/admin/academics/assignments${q({ sectionId })}`,
  timetable: (sectionId?: string) => `/admin/academics/timetable${q({ sectionId })}`,
  promotions: '/admin/academics/promotions',
  // people
  students: (f: { q?: string; gradeId?: string; sectionId?: string; status?: string } = {}) => `/admin/people/students${q(f)}`,
  student: (id: string, tab?: string) => `/admin/people/students/${id}${q({ tab })}`,
  studentNew: '/admin/people/students/new',
  studentImport: '/admin/people/students/import',
  guardians: '/admin/people/guardians',
  guardian: (id: string) => `/admin/people/guardians/${id}`,
  staff: '/admin/people/staff',
  staffMember: (id: string) => `/admin/people/staff/${id}`,
  staffNew: '/admin/people/staff/new',
  admissions: '/admin/people/admissions',
  corrections: '/admin/people/corrections',
  // attendance
  attendance: '/admin/attendance',
  attendanceClass: (sectionId?: string, date?: string) => `/admin/attendance/class${q({ sectionId, date })}`,
  attendanceCorrections: '/admin/attendance/corrections',
  studentLeave: '/admin/attendance/leave',
  staffLeave: '/admin/attendance/staff-leave',
  staffAttendance: '/admin/attendance/staff',
  // exams
  exams: '/admin/exams',
  exam: (id: string, tab?: string) => `/admin/exams/${id}${q({ tab })}`,
  gradeScales: '/admin/exams/grade-scales',
  reviewQueue: '/admin/exams/review',
  reportCards: '/admin/exams/report-cards',
  // settings & access
  setup: '/admin/setup',
  school: (tab?: string) => `/admin/settings/school${q({ tab })}`,
  users: '/admin/settings/users',
  roles: '/admin/settings/roles',
  role: (id: string) => `/admin/settings/roles/${id}`,
  audit: '/admin/settings/audit',
  license: '/admin/settings/license',
};
