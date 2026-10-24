import { parseArgs } from 'node:util';
import { upsertOperatorFromCli } from '../core/platform/operators';
import { ensureControlSchema } from '../core/tenancy/control-db';
import { shutdownTenancy } from '../core/tenancy/provision';

/** Break-glass for the operator console: create an operator, or reset a locked-out one (the password must be changed at the next sign-in). */
const { values: v } = parseArgs({ options: { email: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });

if (v.help || !v.email || !v.password) {
  console.log(`Create or reset a platform operator (the web console at /platform is the normal way to manage operators).

  pnpm platform:operator --email you@yourcompany.com --password 'Choose#AStrongOne1' [--name "Your Name"]

The password needs 10+ characters with upper case, lower case and a digit; the operator must change it at first sign-in.`);
  process.exit(v.help ? 0 : 1);
}
try {
  await ensureControlSchema();
  const r = await upsertOperatorFromCli(v.email, v.password, v.name);
  console.log(`\n✔ Operator ${r.created ? 'created' : 'reset (unlocked, enabled, signed out everywhere)'}: ${v.email.toLowerCase()}  — sign in at /platform/sign-in and choose a new password.`);
} catch (e) {
  console.error(`\n✖ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await shutdownTenancy();
}
