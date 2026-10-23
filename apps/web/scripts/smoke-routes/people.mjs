// People screens (students, guardians, staff, admissions, corrections). See scripts/smoke-mgmt1.mjs for the format.
const first = (path) => async (api) => {
  const r = await api(path);
  return r.data[0].id;
};
const student = (tab) => ({ resolve: async (api) => `/admin/people/students/${await first('/students?pageSize=1')(api)}${tab ? `?tab=${tab}` : ''}` });
const guardian = { resolve: async (api) => `/admin/people/guardians/${await first('/guardians?pageSize=1')(api)}` };
const staff = (tab) => ({ resolve: async (api) => `/admin/people/staff/${await first('/staff?pageSize=1')(api)}${tab ? `?tab=${tab}` : ''}` });

export default {
  admin: {
    routes: [
      '/admin/people/students',
      '/admin/people/students?q=zzzz-no-such-student',
      '/admin/people/students?status=alumni',
      student(),
      student('guardians'),
      student('documents'),
      student('attendance'),
      student('results'),
      student('fees'),
      '/admin/people/students/new',
      '/admin/people/students/import',
      '/admin/people/guardians',
      guardian,
      '/admin/people/staff',
      staff(),
      staff('workload'),
      staff('access'),
      '/admin/people/staff/new',
      '/admin/people/admissions',
      '/admin/people/corrections',
      '/admin/people/corrections?status=all',
    ],
    api: ['/students?pageSize=1', '/guardians?pageSize=1', '/staff?pageSize=1', '/admissions?pageSize=1', '/correction-requests?status=pending'],
  },
  office: {
    routes: [
      '/admin/people/students',
      student(),
      student('guardians'),
      student('documents'),
      '/admin/people/students/new',
      '/admin/people/students/import',
      '/admin/people/guardians',
      guardian,
      '/admin/people/staff',
      staff(),
      { path: '/admin/people/staff/new', expect: 403 },
      '/admin/people/admissions',
      '/admin/people/corrections',
    ],
  },
  hr: {
    routes: ['/admin/people/staff', staff(), staff('access'), '/admin/people/staff/new', { path: '/admin/people/students', expect: 403 }, { path: '/admin/people/admissions', expect: 403 }, { path: '/admin/people/corrections', expect: 403 }],
  },
  principal: {
    routes: ['/admin/people/students', student(), student('guardians'), student('attendance'), '/admin/people/guardians', '/admin/people/staff', '/admin/people/admissions', { path: '/admin/people/students/new', expect: 403 }, { path: '/admin/people/corrections', expect: 403 }],
  },
};
