import { defineConfig } from 'drizzle-kit';

// Tenant (school) schema. The control-plane schema is tiny and bootstrapped in code (see core/tenancy/control-db.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/tenant/schema/index.ts',
  out: './src/db/tenant/migrations',
  casing: undefined,
});
