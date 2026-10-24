// Bundles the API (and CLIs) into dist/ with esbuild. Third-party deps stay external (installed in the image);
// the workspace package @school-sync/shared ships TypeScript source, so it is bundled in.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].filter((d) => d !== '@school-sync/shared');

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: { main: 'src/main.ts', 'cli/site-create': 'src/cli/site-create.ts', 'cli/site-migrate': 'src/cli/site-migrate.ts', 'cli/billing': 'src/cli/billing.ts', 'cli/platform-operator': 'src/cli/platform-operator.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'info',
});
// tenant schema migrations are read from disk at runtime (dist/migrations)
mkdirSync('dist/migrations', { recursive: true });
cpSync('src/db/tenant/migrations', 'dist/migrations', { recursive: true });
console.log('API built → apps/api/dist');
