import { parseArgs } from 'node:util';
import { createTenant, shutdownTenancy } from '../core/tenancy/provision';

const { values } = parseArgs({
  options: {
    code: { type: 'string' },
    name: { type: 'string' },
    'admin-name': { type: 'string' },
    'admin-email': { type: 'string' },
    'admin-username': { type: 'string' },
    'admin-password': { type: 'string' },
    timezone: { type: 'string' },
    currency: { type: 'string' },
    color: { type: 'string' },
    // commercial terms — priced per student per academic year
    price: { type: 'string', description: 'price per student for the academic year, major units (e.g. 150)' },
    seats: { type: 'string', description: 'committed student seats (omit = unlimited)' },
    policy: { type: 'string', description: 'allow_and_bill | block' },
    trial: { type: 'boolean' },
    demo: { type: 'boolean', description: 'also load demo data' },
    'demo-size': { type: 'string', description: 'small | full (default) | xl (~1,900 students, for load testing)' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || !values.code || !values.name) {
  console.log(`Create a school site (own database, default roles/data, first super-admin).

  pnpm site:create --code greenvalley --name "Green Valley School" --admin-email principal@gv.edu \\
                   [--price 150 --seats 500 --policy allow_and_bill] [--trial] [--demo]

Options: --code --name [--admin-name --admin-email --admin-username --admin-password]
         [--timezone Asia/Kolkata --currency INR --color #4f46e5]
         [--price <per-student> --seats <n> --policy allow_and_bill|block --trial]
         [--demo]  load demo students/teachers/attendance/etc.`);
  process.exit(values.help ? 0 : 1);
}

const policy = values.policy === 'block' ? 'block' : 'allow_and_bill';
try {
  const r = await createTenant({
    code: values.code,
    name: values.name,
    adminName: values['admin-name'],
    adminEmail: values['admin-email'],
    adminUsername: values['admin-username'],
    adminPassword: values['admin-password'],
    timezone: values.timezone,
    currency: values.currency,
    branding: values.color ? { primaryColor: values.color } : undefined,
    subscription: values.price !== undefined || values.seats !== undefined || values.trial ? { pricePerStudent: Number(values.price ?? 0), licensedStudents: values.seats ? Number(values.seats) : null, overagePolicy: policy, trial: values.trial } : undefined,
  });
  console.log(`\n✔ Site created: ${r.tenant.name}  (code: ${r.tenant.code}, database: ${r.tenant.dbName})`);
  console.log(`  Admin login   : ${r.admin.username}`);
  console.log(`  Password      : ${r.admin.password}${r.admin.generated ? '   (temporary — must be changed at first login; shown once)' : ''}`);
  if (values.demo) {
    const { seedDemo } = await import('./seed/index');
    await seedDemo(r.tenant.code, values['demo-size'] === 'xl' ? 'xl' : values['demo-size'] === 'small' ? 'small' : 'full');
  }
} catch (e) {
  console.error(`\n✖ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await shutdownTenancy();
}
