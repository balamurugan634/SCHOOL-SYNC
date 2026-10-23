import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../app';

/** pnpm openapi → docs/openapi.json (+ docs/API-INDEX.md): the contract the web and mobile apps are built from. */
const out = resolve(process.cwd(), '../../docs');
mkdirSync(out, { recursive: true });
const app = await buildApp({ logger: false });
await app.ready();
const spec = app.swagger() as { paths: Record<string, Record<string, { tags?: string[]; summary?: string; security?: unknown }>>; info: { version: string } };
writeFileSync(resolve(out, 'openapi.json'), JSON.stringify(spec, null, 2));

const byTag = new Map<string, string[]>();
let count = 0;
for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    count++;
    const tag = op.tags?.[0] ?? 'Other';
    const list = byTag.get(tag) ?? [];
    list.push(`| \`${method.toUpperCase()}\` | \`${path}\` | ${op.summary ?? ''} |`);
    byTag.set(tag, list);
  }
}
const md = [`# API index (generated)`, ``, `${count} operations, API version ${spec.info.version}. Base: \`/api/v1\`, header \`X-Tenant: <site code>\`, \`Authorization: Bearer <token>\`. Full schemas: \`docs/openapi.json\`; live docs: \`/docs\`.`, `Regenerate with \`pnpm --filter @school-sync/api openapi\`.`, ``];
for (const [tag, rows] of [...byTag.entries()].sort()) md.push(`## ${tag}`, ``, `| | Path | Summary |`, `|---|---|---|`, ...rows, ``);
writeFileSync(resolve(out, 'API-INDEX.md'), md.join('\n'));
console.log(`openapi: ${count} operations → ${out}/openapi.json, API-INDEX.md`);
await app.close();
process.exit(0);
