'use client';

import Link from 'next/link';
import { useSetupProgress } from '@/lib/client/use-setup';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { useMeContext } from '../me-context';
import { useSite } from '../site-context';

/** Compact setup progress for the management dashboard. */
export function SetupProgressCard() {
  const site = useSite();
  const { base } = useMeContext();
  const p = useSetupProgress(site);
  const next = p.states.find((s) => s.status === 'todo');
  return (
    <Card>
      <CardHeader
        title="School setup"
        description={p.loading ? undefined : `${p.done} of ${p.total} steps complete`}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={`${base}/setup`}>Open setup</Link>
          </Button>
        }
      />
      <CardBody className="pt-3">
        {p.loading ? (
          <Skeleton className="h-1.5 w-full" />
        ) : (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="School setup progress" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{p.done === p.total ? 'Everything is set up.' : next ? <>Next: <span className="font-medium text-foreground">{next.def.title}</span></> : 'Work through the checklist at your own pace.'}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
