'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Circle, RefreshCw } from 'lucide-react';
import { useSetupProgress, type StepState } from '@/lib/client/use-setup';
import { cn } from '@/lib/cn';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody } from '../ui/card';
import { ProgressBar } from '../ui/progress';
import { Skeleton } from '../ui/skeleton';
import { Illustration } from '../illustrations/illustration';
import { PageHeader } from '../shell/page-header';
import { replayTour } from '../shell/events';
import { useMeContext } from '../me-context';
import { useSite } from '../site-context';
import { ErrorPanel } from '../features/management/shared/detail';
import { LicenseCard } from './license-card';

function StatusMark({ s }: { s: StepState }) {
  if (s.loading) return <Skeleton className="size-5 rounded-full" />;
  if (s.status === 'done')
    return (
      <span className="grid size-5 place-items-center rounded-full bg-success-soft text-success" role="img" aria-label="Done">
        <Check className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  return <Circle className="size-5 text-border-strong" strokeWidth={1.5} role="img" aria-label="Still to do" />;
}

export function SetupWizard() {
  const site = useSite();
  const { base } = useMeContext();
  const p = useSetupProgress(site);
  const [open, setOpen] = React.useState<string | null>(null);
  const initial = React.useRef(false);

  // open "up next" once, after the first results land
  React.useEffect(() => {
    if (initial.current || p.loading || p.error) return;
    initial.current = true;
    setOpen(p.states.find((s) => s.status === 'todo')?.def.id ?? null);
  }, [p.loading, p.error, p.states]);

  const nextId = p.states.find((s) => s.status === 'todo')?.def.id;

  return (
    <>
      <PageHeader
        title="School setup"
        description="Work through these steps to get the school ready. Each one is checked against your real data and links to the screen where it is done."
        actions={
          <>
            <Button variant="secondary" onClick={() => void p.refetch()} loading={p.isFetching && !p.loading} aria-label="Check progress again">
              <RefreshCw /> Check again
            </Button>
            <Button variant="secondary" onClick={replayTour}>
              Replay welcome tour
            </Button>
          </>
        }
      />

      {p.error && !p.license ? (
        <ErrorPanel error={p.error} onRetry={() => void p.refetch()} title="We couldn’t check the setup progress" />
      ) : (
        <>
          {!p.loading && p.total > 0 && (p.done === 0 || p.done === p.total) && (
            <Card className="mb-6">
              <CardBody className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
                <Illustration name={p.done === p.total ? 'setup-complete' : 'first-use'} className="w-48 shrink-0" />
                <div>
                  <h2 className="t-section">{p.done === p.total ? 'Your school is set up' : 'Let’s set up your school'}</h2>
                  <p className="mt-1 max-w-[56ch] text-sm text-ink-2">
                    {p.done === p.total ? 'Every step is complete. You can come back to any step to change it later.' : 'Start with the profile and branding, then add classes, people and the timetable. Each step links to the screen where it is done.'}
                  </p>
                </div>
              </CardBody>
            </Card>
          )}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <Card>
              <CardBody className="border-b border-border py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium" aria-live="polite">{p.loading ? 'Checking progress…' : `${p.done} of ${p.total} steps complete`}</p>
                </div>
                <ProgressBar className="mt-2.5" value={p.done} max={Math.max(1, p.total)} label="Setup progress" tone={p.total > 0 && p.done === p.total ? 'success' : 'brand'} />
              </CardBody>
              <ol className="divide-y divide-border" aria-label="Setup steps">
                {p.states.map((s) => {
                  const isOpen = open === s.def.id;
                  return (
                    <li key={s.def.id}>
                      <button type="button" onClick={() => setOpen(isOpen ? null : s.def.id)} aria-expanded={isOpen} aria-controls={`step-${s.def.id}`} className="tr-colors flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-subtle max-sm:px-4">
                        <StatusMark s={s} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className={cn('text-sm font-medium', s.status === 'done' && 'text-ink-2')}>{s.def.title}</span>
                            {nextId === s.def.id && <Badge variant="primary">Up next</Badge>}
                          </span>
                          <span className="t-caption mt-0.5 block text-ink-2">{s.detail ?? s.def.summary}</span>
                        </span>
                        <ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform', isOpen && 'rotate-180')} aria-hidden />
                      </button>
                      {isOpen && (
                        <div id={`step-${s.def.id}`} className="border-t border-border bg-surface-subtle px-5 py-4 max-sm:px-4 sm:pl-[3.25rem]">
                          <p className="text-sm">{s.def.summary}</p>
                          <ul className="mt-2.5 space-y-1.5">
                            {s.def.guidance.map((g) => (
                              <li key={g} className="t-caption flex gap-2.5 text-ink-2">
                                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
                                {g}
                              </li>
                            ))}
                          </ul>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button asChild size="sm" variant={s.status === 'done' ? 'secondary' : 'primary'}>
                              <Link href={`${base}${s.def.href}`}>{s.status === 'done' ? 'Review' : s.def.cta}</Link>
                            </Button>
                            {s.def.secondary && (
                              <Button asChild size="sm" variant="ghost">
                                <Link href={`${base}${s.def.secondary.href}`}>{s.def.secondary.label}</Link>
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>

            <aside aria-label="Subscription">
              <LicenseCard />
            </aside>
          </div>
        </>
      )}
    </>
  );
}
