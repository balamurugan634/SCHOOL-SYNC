// Settings and access (school profile, users, roles, audit, licence) + the setup wizard. Run: node scripts/smoke-mgmt1.mjs --area=settings
const role = (key) => ({ resolve: async (api) => `/admin/settings/roles/${(await api('/roles')).data.find((r) => r.key === key).id}` });
const settingsTabs = ['profile', 'details', 'attendance', 'academic', 'exams', 'fees', 'library', 'notifications', 'features'].map((t) => `/admin/settings/school?tab=${t}`);
export default {
  admin: {
    routes: [
      '/admin/setup',
      ...settingsTabs,
      '/admin/settings/users',
      '/admin/settings/users?q=zzzz-no-such-user',
      '/admin/settings/users?type=staff&status=active',
      { resolve: async (api) => `/admin/settings/users?user=${(await api('/users?pageSize=1&userType=staff')).data[0].id}` },
      '/admin/settings/roles',
      role('teacher'),
      role('super_admin'),
      '/admin/settings/audit',
      '/admin/settings/audit?entity=student&from=2026-10-01',
      '/admin/settings/audit?entity=zzz-nothing',
      '/admin/settings/license',
    ],
    api: ['/setup/status', '/settings', '/settings/branding', '/settings/features', '/license', '/roles', '/permissions/catalog', '/audit?limit=5'],
  },
  office: {
    // office: settings:view/edit, users:*, roles:view only (cannot edit roles), no audit
    routes: ['/admin/setup', '/admin/settings/school', '/admin/settings/school?tab=features', '/admin/settings/users', '/admin/settings/roles', role('teacher'), '/admin/settings/license', { path: '/admin/settings/audit', expect: 403 }],
  },
  principal: { routes: ['/admin/settings/audit', { path: '/admin/settings/users', expect: 403 }, { path: '/admin/settings/roles', expect: 403 }, { path: '/admin/settings/school', expect: 403 }, { path: '/admin/settings/license', expect: 403 }, { path: '/admin/setup', expect: 403 }] },
  hr: { routes: ['/admin/settings/users', { path: '/admin/settings/roles', expect: 403 }, { path: '/admin/settings/audit', expect: 403 }, { path: '/admin/settings/school', expect: 403 }] },
};
