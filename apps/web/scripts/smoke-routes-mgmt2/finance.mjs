// Finance: overview, setup (every tab), invoices (+ drawer), payments (+ receipt drawer, refunds, online), expenses, fee reports.
const FIRST = (path) => async (api) => `${path}${(await api('/payments?pageSize=1')).data[0].id}`;
const SETUP = ['structures', 'plans', 'dues', 'concessions', 'categories'];
const REPORT = ['outstanding', 'defaulters', 'collection'];
export default {
  accounts: {
    routes: [
      '/admin/finance',
      '/admin/finance?from=2026-09-01&to=2026-10-21',
      ...SETUP.map((t) => `/admin/finance/structures?tab=${t}`),
      '/admin/finance/structures?tab=concessions&status=pending',
      { resolve: async (api) => `/admin/finance/structures?tab=structures&grade=${(await api('/academics/grades')).data[0].id}` },
      '/admin/finance/invoices',
      '/admin/finance/invoices?overdue=1&status=unpaid',
      { resolve: async (api) => `/admin/finance/invoices?invoice=${(await api('/fees/invoices?pageSize=1&status=paid')).data[0].id}` },
      { resolve: async (api) => `/admin/finance/invoices?invoice=${(await api('/fees/invoices?pageSize=1&overdue=true')).data[0].id}` },
      '/admin/finance/payments',
      '/admin/finance/payments?method=upi&pstatus=succeeded',
      '/admin/finance/payments?tab=refunds',
      '/admin/finance/payments?tab=refunds&rstatus=requested',
      '/admin/finance/payments?tab=online',
      { resolve: async (api) => `/admin/finance/payments?payment=${(await api('/payments?pageSize=1')).data[0].id}` },
      '/admin/finance/expenses',
      '/admin/finance/expenses?tab=approvals',
      '/admin/finance/expenses?tab=summary',
      { resolve: async (api) => `/admin/finance/expenses?expense=${(await api('/expenses?pageSize=1')).data[0].id}` },
      ...REPORT.map((t) => `/admin/reports/fees?tab=${t}`),
      '/admin/reports/fees?tab=outstanding&group=section',
      '/admin/reports/fees?tab=collection&by=day&from=2026-10-01&to=2026-10-21',
      '/admin/reports',
      '/admin/communication/preferences',
    ],
    api: ['/finance/summary', '/fees/categories', '/fees/structures?pageSize=5', '/fees/plans?pageSize=5', '/fees/concessions?pageSize=5', '/payments?pageSize=5', '/payments/refunds', '/expenses?pageSize=5', '/expenses/summary', '/fees/reports/outstanding?groupBy=grade', '/fees/reports/defaulters?pageSize=5', '/fees/reports/collection?groupBy=month'],
  },
  principal: {
    // can view finance, cannot export or approve: the pages render, the export / approve controls are disabled
    routes: ['/admin/finance', '/admin/finance/structures?tab=concessions', '/admin/finance/payments?tab=refunds', '/admin/finance/expenses', '/admin/reports/fees?tab=defaulters', '/admin/reports'],
    api: ['/finance/summary', { path: '/fees/reports/defaulters/export', expect: 403 }, { path: '/payments/export', expect: 403 }],
  },
  admin: { routes: ['/admin/finance', '/admin/finance/structures?tab=dues', '/admin/finance/invoices'], api: ['/finance/summary'] },
  // no fees permission: NoAccess page (a heading, 200)
  librarian: { routes: [{ path: '/admin/finance', expect: 403 }, { path: '/admin/finance/invoices', expect: 403 }, { path: '/admin/reports/fees', expect: 403 }], api: [{ path: '/finance/summary', expect: 403 }] },
};
