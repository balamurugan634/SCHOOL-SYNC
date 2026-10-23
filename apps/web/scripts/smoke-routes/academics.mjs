// Academics (years, classes, subjects, assignments, timetable, promotions). Run: node scripts/smoke-mgmt1.mjs --area=academics
const sectionId = (n = 0) => ({ resolve: async (api) => `/admin/academics/timetable?sectionId=${(await api('/academics/sections?pageSize=20')).data[n].id}` });
const assignSection = { resolve: async (api) => `/admin/academics/assignments?sectionId=${(await api('/academics/sections?pageSize=20')).data[3].id}` };
const common = [
  '/admin/academics/years',
  '/admin/academics/years?tab=periods',
  '/admin/academics/classes',
  '/admin/academics/classes?tab=grades',
  '/admin/academics/subjects',
  '/admin/academics/subjects?tab=offerings',
  '/admin/academics/assignments',
  assignSection,
  '/admin/academics/timetable',
  sectionId(2),
  '/admin/academics/timetable?tab=covers',
  '/admin/academics/promotions',
];
export default {
  admin: { routes: common, api: ['/academics/overview', '/academics/years', '/academics/sections?pageSize=5', '/timetable/substitutions'] },
  office: { routes: common, api: ['/academics/grades', '/timetable/substitutions'] },
  principal: { routes: ['/admin/academics/years', '/admin/academics/classes', '/admin/academics/assignments', '/admin/academics/timetable', '/admin/academics/promotions'] },
  // hr may view the academic structure (academics:view) but has no timetable permission → the NoAccess screen (one h1)
  hr: { routes: ['/admin/academics/classes', '/admin/academics/subjects', { path: '/admin/academics/timetable', expect: 403 }, { path: '/admin/academics/promotions', expect: 403 }] },
};
