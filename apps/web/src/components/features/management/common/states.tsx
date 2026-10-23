'use client';

import * as React from 'react';
import Link from 'next/link';
import { Lock, PowerOff } from 'lucide-react';
import { friendlyError, isFeatureDisabled, isForbidden } from '@/lib/client/mgmt';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useMeContext } from '@/components/me-context';

const FEATURE_NAME = { fees: 'Fees and finance', transport: 'Transport', library: 'Library', onlinePayments: 'Online payments', studentLogin: 'Student sign-in' } as const;

/** The school has this module switched off (403 FEATURE_DISABLED, or the site flag is off). */
export function FeatureOff({ feature }: { feature: keyof typeof FEATURE_NAME }) {
  const { base } = useMeContext();
  return (
    <Card className="mx-auto max-w-xl">
      <EmptyState
        icon={<PowerOff />}
        title={`${FEATURE_NAME[feature]} is not enabled for this school`}
        description="A school administrator can switch it on under Settings, School profile and features. Nothing here is lost while it is off."
        action={
          <Button asChild variant="secondary">
            <Link href={base || '/'}>Back to dashboard</Link>
          </Button>
        }
      />
    </Card>
  );
}

/** Inline error with Retry; understands FEATURE_DISABLED and 403 so those never look like a glitch. */
export function ErrorPanel({ error, onRetry, title = 'We couldn’t load this', compact = true }: { error: unknown; onRetry?: () => void; title?: string; compact?: boolean }) {
  if (isFeatureDisabled(error)) {
    return <EmptyState compact={compact} icon={<PowerOff />} title="Not enabled for this school" description={friendlyError(error)} />;
  }
  if (isForbidden(error)) {
    return <EmptyState compact={compact} icon={<Lock />} title="You don’t have access to this" description="Your role does not include it. If that seems wrong, ask a school administrator to review your permissions." />;
  }
  return (
    <EmptyState
      compact={compact}
      illustration="error-offline"
      title={title}
      description={friendlyError(error)}
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}

/** Card-sized skeleton that matches a typical block so nothing shifts when data arrives. */
export function BlockSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
