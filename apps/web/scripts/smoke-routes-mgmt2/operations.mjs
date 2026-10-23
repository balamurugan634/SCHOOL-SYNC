// Operations: transport (routes, vehicles, allocations, route detail + manifest) and library (catalogue, loans, overdue, policy).
const route = (tab) => ({ resolve: async (api) => `/admin/operations/transport/routes/${(await api('/transport/routes?pageSize=1')).data[0].id}${tab ? `?tab=${tab}` : ''}` });
export default {
  transport: {
    routes: [
      '/admin/operations/transport',
      '/admin/operations/transport?tab=students',
      '/admin/operations/transport?tab=students&q=arjun',
      '/admin/operations/transport?tab=vehicles',
      '/admin/operations/transport?tab=vehicles&alert=1',
      route(),
      route('manifest'),
      { path: '/admin/operations/library', expect: 403 },
    ],
    api: ['/transport/vehicles', '/transport/routes', '/transport/allocations?pageSize=5'],
  },
  librarian: {
    routes: ['/admin/operations/library', '/admin/operations/library?category=Fiction&avail=1', '/admin/operations/library?tab=loans', '/admin/operations/library?tab=loans&lstatus=overdue', '/admin/operations/library?tab=loans&lstatus=all', '/admin/operations/library?tab=overdue', '/admin/operations/library?tab=policy', { path: '/admin/operations/transport', expect: 403 }],
    api: ['/library/books?pageSize=5', '/library/issues?pageSize=5', '/library/overdue', '/library/policy'],
  },
  admin: { routes: ['/admin/operations/transport', '/admin/operations/library', '/admin/operations/library?tab=policy', route('manifest')], api: [] },
  principal: { routes: ['/admin/operations/transport', '/admin/operations/library?tab=overdue'], api: [] },
};
