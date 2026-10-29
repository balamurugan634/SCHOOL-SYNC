import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { adminPgConfig, pgConfig } from '../src/core/tenancy/control-db';
import { demoDataAllowed } from '../src/core/platform/tenants';

const mutable = config as unknown as Record<string, unknown>;
const saved = { ...config };
afterEach(() => {
  for (const k of ['PG_HOST', 'PG_PORT', 'PG_ADMIN_HOST', 'PG_ADMIN_PORT', 'NODE_ENV', 'PLATFORM_ALLOW_DEMO_DATA']) mutable[k] = (saved as Record<string, unknown>)[k];
});

describe('provisioning connects to Postgres directly, not through the pooler', () => {
  it('uses PG_HOST/PG_PORT unless PG_ADMIN_HOST/PG_ADMIN_PORT are set', () => {
    mutable.PG_HOST = 'pgbouncer'; mutable.PG_PORT = 6432; mutable.PG_ADMIN_HOST = undefined; mutable.PG_ADMIN_PORT = undefined;
    expect(adminPgConfig('x')).toMatchObject({ host: 'pgbouncer', port: 6432, database: 'x' });
    mutable.PG_ADMIN_HOST = 'postgres'; mutable.PG_ADMIN_PORT = 5432;
    expect(adminPgConfig('x')).toMatchObject({ host: 'postgres', port: 5432, database: 'x' });
    expect(pgConfig('x')).toMatchObject({ host: 'pgbouncer', port: 6432 }); // normal traffic still goes through the pooler
  });
});

describe('demo data switch', () => {
  const cases: [string, unknown, boolean][] = [
    ['development, not set', undefined, true],
    ['development, set to false', false, false],
    ['production, not set', undefined, false],
    ['production, set to false', false, false],
    ['production, set to true (a demo or pilot server)', true, true],
  ];
  for (const [name, flag, expected] of cases) {
    it(`${name} → ${expected ? 'allowed' : 'refused'}`, () => {
      mutable.NODE_ENV = name.startsWith('production') ? 'production' : 'development';
      mutable.PLATFORM_ALLOW_DEMO_DATA = flag;
      expect(demoDataAllowed()).toBe(expected);
    });
  }
});
