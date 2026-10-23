// Communication: announcements (list, filters, compose, detail edit / delivery), events (calendar, list, compose, detail, responses), meetings, preferences.
const ann = (state, tab) => ({
  resolve: async (api) => {
    const r = await api(`/announcements/manage?pageSize=50${state ? `&state=${state}` : ''}`);
    const a = r.data.find((x) => !x.title.startsWith('zz-'));
    return `/admin/communication/announcements/${a.id}${tab ? `?tab=${tab}` : ''}`;
  },
});
const evt = (pred, tab) => ({
  resolve: async (api) => {
    const r = await api('/events?pageSize=100');
    const e = r.data.find(pred);
    return `/admin/communication/events/${e.id}${tab ? `?tab=${tab}` : ''}`;
  },
});
const common = [
  '/admin/communication/announcements',
  '/admin/communication/announcements?state=draft',
  '/admin/communication/announcements?state=published&mine=1',
  '/admin/communication/announcements?state=archived',
  '/admin/communication/announcements/new',
  ann('draft'),
  ann('published'),
  ann('published', 'delivery'),
  ann('draft', 'delivery'),
  '/admin/communication/events',
  '/admin/communication/events?tab=list',
  '/admin/communication/events?tab=list&kind=holiday',
  '/admin/communication/events?m=2026-11',
  '/admin/communication/events?cal=agenda',
  '/admin/communication/events/new',
  evt((e) => e.status === 'draft'),
  evt((e) => e.status === 'published' && e.registrationRequired),
  evt((e) => e.status === 'published' && e.registrationRequired, 'responses'),
  evt((e) => e.status === 'published' && e.consentRequired, 'responses'),
  evt((e) => e.status === 'cancelled'),
  '/admin/communication/meetings',
  '/admin/communication/meetings?status=requested',
  { resolve: async (api) => `/admin/communication/meetings?meeting=${(await api('/meetings?pageSize=1')).data[0].id}` },
  '/admin/communication/preferences',
];
export default {
  office: { routes: common, api: ['/announcements/manage', '/events', '/calendar?from=2026-10-01&to=2026-10-31', '/meetings'] },
  principal: { routes: common.slice(0, 12).concat(['/admin/communication/meetings', '/admin/communication/preferences']), api: ['/announcements/manage'] },
  admin: { routes: ['/admin/communication/announcements', '/admin/communication/events', '/admin/communication/meetings'], api: [] },
  // librarian: no announcement management or meetings access
  librarian: { routes: [{ path: '/admin/communication/announcements/new', expect: 403 }, { path: '/admin/communication/meetings', expect: 403 }, '/admin/communication/preferences'], api: [] },
};
