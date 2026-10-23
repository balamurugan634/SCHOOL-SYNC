import { parseArgs } from 'node:util';
import { shutdownTenancy } from '../core/tenancy/provision';
import { seedDemo } from './seed/index';

const { values } = parseArgs({ options: { site: { type: 'string', default: 'demo' }, size: { type: 'string', default: 'full' } } });
try {
  await seedDemo(values.site!, values.size === 'small' ? 'small' : values.size === 'xl' ? 'xl' : 'full');
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await shutdownTenancy();
}
