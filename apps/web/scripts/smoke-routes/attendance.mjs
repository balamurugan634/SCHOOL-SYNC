// Attendance admin (fork C). Users: admin (everything), principal (approves, no staff marking), office (leave approve, no corrections), hr (staff only).
const classRoute = (suffix = '') => ({ resolve: async (api) => `/admin/attendance/class?sectionId=${(await api('/academics/sections?pageSize=1')).data[0].id}${suffix}` });

export default {
  admin: {
    routes: [
      '/admin/attendance',
      '/admin/attendance?days=31',
      '/admin/attendance/class',
      classRoute(),
      classRoute('&tab=range'),
      '/admin/attendance/corrections',
      '/admin/attendance/corrections?status=approved',
      '/admin/attendance/leave',
      '/admin/attendance/leave?status=all',
      '/admin/attendance/staff-leave',
      '/admin/attendance/staff-leave?status=all',
      '/admin/attendance/staff',
      '/admin/attendance/staff?tab=summary',
    ],
    api: ['/attendance/summary?trendDays=7', '/attendance/corrections', '/leave?pageSize=5', '/staff-leave?pageSize=5', '/staff-attendance?pageSize=5', '/staff-attendance/summary'],
  },
  principal: {
    routes: ['/admin/attendance', '/admin/attendance/corrections', '/admin/attendance/leave', '/admin/attendance/staff-leave', '/admin/attendance/staff'],
  },
  office: {
    routes: ['/admin/attendance', '/admin/attendance/leave', { path: '/admin/attendance/corrections', expect: 403 }, { path: '/admin/attendance/staff', expect: 403 }],
    api: [{ path: '/attendance/corrections', expect: 403 }],
  },
  hr: {
    routes: ['/admin/attendance/staff', '/admin/attendance/staff-leave', { path: '/admin/attendance', expect: 403 }, { path: '/admin/attendance/leave', expect: 403 }, { path: '/admin/attendance/corrections', expect: 403 }],
    api: [{ path: '/attendance/summary', expect: 403 }, '/staff-attendance/summary'],
  },
};
