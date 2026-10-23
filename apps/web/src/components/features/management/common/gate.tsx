import 'server-only';
import type * as React from 'react';
import type { PermissionKey, Scope, SiteInfo } from '@school-sync/shared';
import { NoAccess } from '@/components/dashboard/coming-online';
import { can } from '@/lib/permissions';
import { requireMe } from '@/lib/server/session';
import { requireSite } from '@/lib/server/site';
import { FeatureOff } from './states';

/**
 * Server-side page gate for a management screen. Returns the element to render INSTEAD of the page
 * (feature switched off, or no permission), or `null` when the visitor may see it. UI gating only — the API enforces.
 *   const denied = await gate({ any: ['fees:view'], feature: 'fees' }); if (denied) return denied;
 */
export async function gate(opts: { any?: PermissionKey[]; all?: PermissionKey[]; min?: Scope; feature?: keyof SiteInfo['features'] }): Promise<React.ReactElement | null> {
  const [me, site] = await Promise.all([requireMe(), requireSite()]);
  if (opts.feature && !site.features[opts.feature]) return <FeatureOff feature={opts.feature} />;
  const min = opts.min ?? 'own';
  if (opts.any && !opts.any.some((p) => can(me.permissions, p, min))) return <NoAccess />;
  if (opts.all && !opts.all.every((p) => can(me.permissions, p, min))) return <NoAccess />;
  return null;
}
