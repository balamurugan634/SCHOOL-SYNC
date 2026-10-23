import { parseArgs } from 'node:util';
import { migrateAllTenants, shutdownTenancy } from '../core/tenancy/provision';

const { values } = parseArgs({ options: { site: { type: 'string' }, concurrency: { type: 'string' } } });
try {
  const results = await migrateAllTenants({ only: values.site, concurrency: values.concurrency ? Number(values.concurrency) : 4 });
  for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.code}${r.error ? `  ${r.error}` : ''}`);
  if (!results.length) console.log('No active sites.');
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} finally {
  await shutdownTenancy();
}
