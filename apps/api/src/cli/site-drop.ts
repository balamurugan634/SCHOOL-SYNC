import { parseArgs } from 'node:util';
import { dropTenant, shutdownTenancy } from '../core/tenancy/provision';

const { values } = parseArgs({ options: { code: { type: 'string' }, yes: { type: 'boolean' } } });
if (!values.code || !values.yes) {
  console.log('DEV ONLY — deletes the school database.\n  pnpm site:drop --code demo --yes');
  process.exit(1);
}
await dropTenant(values.code);
console.log(`✔ Dropped site "${values.code}"`);
await shutdownTenancy();
