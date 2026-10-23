import { buildApp } from './app';
import { config } from './config';
import { snapshotAllTenants } from './core/billing/metering';
import { startJobScheduler } from './core/jobs';
import { startPushSweeper } from './core/notify/queue';
import { ensureControlSchema } from './core/tenancy/control-db';
import { shutdownTenancy } from './core/tenancy/provision';

async function main() {
  await ensureControlSchema();
  const app = await buildApp();
  await app.listen({ host: config.HOST, port: config.PORT });

  const stops: (() => void)[] = [];
  if (config.RUN_WORKERS) {
    stops.push(startPushSweeper());
    stops.push(startJobScheduler(app.log));
    // usage metering for per-student billing: idempotent per day, so running it a few times a day is harmless
    const meter = setInterval(() => void snapshotAllTenants().catch((e) => app.log.error(e, 'usage snapshot failed')), 6 * 60 * 60_000);
    meter.unref();
    stops.push(() => clearInterval(meter));
    setTimeout(() => void snapshotAllTenants().catch((e) => app.log.error(e, 'usage snapshot failed')), 15_000).unref();
  }

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    stops.forEach((s) => s());
    await app.close();
    await shutdownTenancy();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
