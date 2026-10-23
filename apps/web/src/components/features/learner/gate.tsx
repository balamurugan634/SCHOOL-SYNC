'use client';

import * as React from 'react';
import Link from 'next/link';
import type { PermissionKey, SiteInfo } from '@school-sync/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useGates, useLearner } from './use-learner';

/**
 * Hides a screen when the school switched the feature off or the account lacks the permission. The API still decides —
 * this only turns "403 everywhere" into one clear sentence.
 */
export function FeatureGate({ feature, perm, what, children }: { feature?: keyof SiteInfo['features']; perm?: PermissionKey; what: string; children: React.ReactNode }) {
  const { features, can } = useGates();
  const l = useLearner();
  if (feature && !features[feature]) {
    return (
      <Card>
        <EmptyState illustration="empty-generic" title={`${what} isn’t switched on at your school`} description="If you expected to see this here, please ask the school office." action={<Button asChild variant="secondary" size="sm"><Link href={l.base || '/'}>Back to home</Link></Button>} />
      </Card>
    );
  }
  if (perm && !can(perm)) {
    return (
      <Card>
        <EmptyState illustration="empty-generic" title={`${what} isn’t available for your account`} description="Your role doesn’t include this area. If you think that’s a mistake, ask the school office to review your access." action={<Button asChild variant="secondary" size="sm"><Link href={l.base || '/'}>Back to home</Link></Button>} />
      </Card>
    );
  }
  return <>{children}</>;
}
