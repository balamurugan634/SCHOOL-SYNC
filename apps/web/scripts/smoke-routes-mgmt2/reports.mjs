// Reports hub: role-gated cards.
export default {
  admin: { routes: ['/admin/reports', '/admin/reports/fees'], api: [] },
  principal: { routes: ['/admin/reports'], api: [] },
  accounts: { routes: ['/admin/reports'], api: [] },
  office: { routes: ['/admin/reports'], api: [] },
  // no reports permission: NoAccess
  librarian: { routes: [{ path: '/admin/reports', expect: 403 }], api: [] },
};
