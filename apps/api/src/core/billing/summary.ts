import type { z } from 'zod';
import type { licenseResponse } from '@school-sync/shared';
import type { Executor } from '../tenancy/pools';
import { getLicense, seatUsage } from './license';

/** The school-facing view of the subscription (GET /license, management dashboard). */
export async function licenseSummary(db: Executor, tenantId: string): Promise<z.infer<typeof licenseResponse>> {
  const lic = await getLicense(tenantId);
  const sub = lic.subscription;
  return {
    state: lic.state,
    readOnly: lic.readOnly,
    academicYear: sub?.academicYear ?? null,
    startsOn: sub?.startsOn ?? null,
    endsOn: sub?.endsOn ?? null,
    graceEndsOn: lic.graceEndsOn,
    daysLeft: lic.daysLeft,
    seats: await seatUsage(db, lic),
    overagePolicy: lic.overagePolicy,
    pricePerStudentMinor: sub?.pricePerStudentMinor ?? null,
    currency: sub?.currency ?? null,
  };
}
