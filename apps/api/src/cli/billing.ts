import { eq } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { issueSeatInvoice, issueTrueUp, upsertSubscription } from '../core/billing/invoicing';
import { getLicense, seatUsage } from '../core/billing/license';
import { snapshotAllTenants } from '../core/billing/metering';
import { tenants } from '../db/control/schema';
import { controlDb, ensureControlSchema } from '../core/tenancy/control-db';
import { tenantDb } from '../core/tenancy/pools';
import { shutdownTenancy } from '../core/tenancy/provision';
import { tenantByCode } from '../core/tenancy/registry';

const [cmd, ...rest] = process.argv.slice(2);
const { values: v } = parseArgs({
  args: rest,
  options: { code: { type: 'string' }, year: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, price: { type: 'string' }, seats: { type: 'string' }, policy: { type: 'string' }, grace: { type: 'string' }, trial: { type: 'boolean' }, kind: { type: 'string' } },
});

const HELP = `Per-student / per-academic-year billing

  pnpm billing subscribe --code <site> --year 2026-27 --start 2026-04-01 --end 2027-03-31 --price 150 [--seats 500] [--policy allow_and_bill|block] [--grace 30] [--trial]
  pnpm billing usage [--code <site>]          seats used vs licensed, license state
  pnpm billing snapshot                       meter every active site now (the API also does this every 6h)
  pnpm billing invoice --code <site> --year 2026-27 --kind seats|true_up`;

async function main() {
  await ensureControlSchema();
  switch (cmd) {
    case 'subscribe': {
      if (!v.code || !v.year || !v.start || !v.end || v.price === undefined) throw new Error(HELP);
      const sub = await upsertSubscription({ tenantCode: v.code, academicYear: v.year, startsOn: v.start, endsOn: v.end, pricePerStudent: Number(v.price), licensedStudents: v.seats ? Number(v.seats) : null, overagePolicy: v.policy === 'block' ? 'block' : 'allow_and_bill', graceDays: v.grace ? Number(v.grace) : undefined, trial: v.trial });
      console.log(`✔ Subscription ${sub.academicYear}: ${sub.licensedStudents ?? 'unlimited'} seats × ${(sub.pricePerStudentMinor / 100).toFixed(2)} ${sub.currency}`);
      break;
    }
    case 'usage': {
      const list = v.code ? await controlDb().select().from(tenants).where(eq(tenants.code, v.code)) : await controlDb().select().from(tenants).orderBy(tenants.code);
      for (const t of list) {
        const info = await tenantByCode(t.code);
        if (!info || t.status !== 'active') {
          console.log(`${t.code.padEnd(16)} ${t.status}`);
          continue;
        }
        const lic = await getLicense(t.id);
        const seats = await seatUsage(tenantDb(info), lic);
        console.log(`${t.code.padEnd(16)} ${lic.state.padEnd(10)} ${lic.subscription?.academicYear ?? '-'.padEnd(7)}  students ${seats.used}/${seats.licensed ?? '∞'}${seats.overBy ? `  (+${seats.overBy} over → true-up)` : ''}${lic.readOnly ? '  READ-ONLY' : ''}`);
      }
      break;
    }
    case 'snapshot':
      for (const r of await snapshotAllTenants()) console.log(`${r.ok ? '✔' : '✖'} ${r.code} ${r.ok ? `${r.billableStudents} billable students` : r.error}`);
      break;
    case 'invoice': {
      if (!v.code || !v.year || !v.kind) throw new Error(HELP);
      const t = await tenantByCode(v.code);
      const lic = t && (await getLicense(t.id));
      if (!lic?.subscription || lic.subscription.academicYear !== v.year) throw new Error('No such subscription');
      const inv = await (v.kind === 'true_up' ? issueTrueUp(lic.subscription.id) : issueSeatInvoice(lic.subscription.id));
      console.log(inv ? `✔ ${inv.number}: ${inv.students} students × ${inv.unitPriceMinor / 100} = ${inv.amountMinor / 100} ${inv.currency}` : 'Nothing to invoice.');
      break;
    }
    default:
      console.log(HELP);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => shutdownTenancy());
