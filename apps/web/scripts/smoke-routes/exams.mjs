// Exams admin: list, exam detail (every tab), review queue, grade scales, report cards. hr has no exams access (NoAccess page).
const exam = (status, tab) => ({
  resolve: async (api) => {
    const r = await api('/exams?pageSize=100');
    const e = r.data.find((x) => x.status === status && !x.name.startsWith('zz-'));
    return `/admin/exams/${e.id}${tab ? `?tab=${tab}` : ''}`;
  },
});
const TABS = ['overview', 'schedule', 'sheets', 'analytics', 'results', 'remarks'];

export default {
  admin: {
    routes: [
      '/admin/exams',
      '/admin/exams?status=published',
      '/admin/exams/review',
      '/admin/exams/grade-scales',
      '/admin/exams/report-cards',
      ...TABS.map((t) => exam('marks_entry', t)),
      ...TABS.map((t) => exam('published', t)),
      exam('scheduled', 'overview'),
      exam('scheduled', 'schedule'),
    ],
    api: ['/exams?pageSize=5', '/grade-scales', '/marks/sheets?pageSize=5'],
  },
  principal: {
    routes: ['/admin/exams', '/admin/exams/review', '/admin/exams/grade-scales', '/admin/exams/report-cards', exam('marks_entry', 'sheets'), exam('published', 'analytics'), exam('published', 'results'), exam('published', 'remarks')],
  },
  office: {
    // office has exams view/create/edit but no marks or report-card access: the marks tabs are hidden, the review / report-card pages show NoAccess
    routes: ['/admin/exams', '/admin/exams/grade-scales', exam('marks_entry', 'overview'), exam('marks_entry', 'schedule'), exam('marks_entry', 'sheets'), { path: '/admin/exams/review', expect: 403 }, { path: '/admin/exams/report-cards', expect: 403 }],
  },
  hr: {
    routes: [{ path: '/admin/exams', expect: 403 }, { path: '/admin/exams/grade-scales', expect: 403 }, { path: '/admin/exams/review', expect: 403 }],
  },
};
