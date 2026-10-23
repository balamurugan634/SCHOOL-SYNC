// Local PostgreSQL for development — a real Postgres server (embedded binaries), no Docker or root needed.
// Production uses a managed/Docker Postgres 17+; see infra/.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), '../../.data/postgres');
const port = Number(process.env.PG_PORT ?? 54329);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: process.env.PG_USER ?? 'postgres', password: process.env.PG_PASSWORD ?? 'postgres', port, persistent: true, onLog: () => {}, onError: (e) => console.error(String(e)) });

if (!existsSync(resolve(dir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
console.log(`PostgreSQL ready on 127.0.0.1:${port}  (data: ${dir})  — Ctrl+C to stop`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
