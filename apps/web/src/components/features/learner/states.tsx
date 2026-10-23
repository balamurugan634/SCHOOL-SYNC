'use client';

import * as React from 'react';
import Link from 'next/link';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@/lib/problem';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useLearner } from './use-learner';

/** Inline error with a retry — what every list / form / chart shows when its request fails. */
export function ErrorState({ error, onRetry, title = 'We couldn’t load this', compact }: { error: unknown; onRetry?: () => void; title?: string; compact?: boolean }) {
  const forbidden = error instanceof ApiError && (error.status === 403 || error.status === 404);
  return (
    <EmptyState
      compact={compact}
      illustration="error-offline"
      title={forbidden ? 'This isn’t available to you' : title}
      description={forbidden ? 'Your account doesn’t have access to this, or it no longer exists. If you think that’s a mistake, contact the school office.' : errorMessage(error)}
      action={onRetry && !forbidden ? <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button> : undefined}
    />
  );
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0 max-sm:px-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * One place that guarantees loading → error (retry) → empty → populated for a query.
 * `skeleton` should mirror the final layout; `isEmpty` decides the empty state.
 */
export function QueryView<T>({
  query,
  skeleton = <SkeletonRows />,
  isEmpty,
  empty,
  children,
  errorTitle,
}: {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'isError' | 'refetch'>;
  skeleton?: React.ReactNode;
  isEmpty?: (d: T) => boolean;
  empty?: React.ReactNode;
  children: (d: T) => React.ReactNode;
  errorTitle?: string;
}) {
  if (query.isPending) return <>{skeleton}</>;
  if (query.isError && query.data === undefined) return <ErrorState error={query.error} onRetry={() => void query.refetch()} title={errorTitle} />;
  const d = query.data as T;
  if (isEmpty?.(d)) return <>{empty ?? <EmptyState compact illustration="empty-generic" title="Nothing here yet" />}</>;
  return <>{children(d)}</>;
}

/** Parents without a verified child see this instead of any child data. */
export function NoChildState({ compact }: { compact?: boolean }) {
  return (
    <Card>
      <EmptyState
        compact={compact}
        illustration="first-use"
        title="No verified children yet"
        description="The school links each parent to their children only after the relationship has been checked. Until then there is nothing to show here. Please contact the school office and ask them to verify your link to your child — it appears here as soon as they do."
        action={<Button asChild variant="secondary" size="sm"><Link href="/account">View my account</Link></Button>}
      />
    </Card>
  );
}

/** Wrap a parent screen: renders `NoChildState` when no child is linked, otherwise the screen. Students pass straight through. */
export function NeedsLearner({ children }: { children: React.ReactNode }) {
  const l = useLearner();
  if (!l.ready) return <NoChildState />;
  return <>{children}</>;
}

/** A parent-only reminder of whose data is on screen. */
export function ChildContext({ className }: { className?: string }) {
  const l = useLearner();
  if (!l.isParent || !l.ready) return null;
  return (
    <p className={className ?? 't-caption mb-4 text-ink-2'}>
      Showing <span className="font-medium text-ink">{l.name}</span>
      {l.classLabel ? ` · ${l.classLabel}` : ''}. {l.kids.length > 1 ? 'Use the switcher in the top bar to change child.' : ''}
    </p>
  );
}

export function ReadOnlyNote() {
  return <Banner tone="locked">This school is in read-only mode, so changes are switched off until the subscription is renewed.</Banner>;
}
