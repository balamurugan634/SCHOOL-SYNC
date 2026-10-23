'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/ui/avatar';
import { ApiError, errorMessage } from '@/lib/problem';
import { cn } from '@/lib/cn';

/** `label: value` rows (definition list). Empty values render an em dash. */
export function DefList({ items, className, cols = 1 }: { items: { label: string; value: React.ReactNode }[]; className?: string; cols?: 1 | 2 }) {
  return (
    <dl className={cn('grid gap-x-8 gap-y-3', cols === 2 && 'sm:grid-cols-2', className)}>
      {items.map((i) => (
        <div key={i.label} className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-baseline gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="t-caption text-ink-2">{i.label}</dt>
          <dd className="min-w-0 break-words text-sm">{i.value === null || i.value === undefined || i.value === '' ? <span className="text-ink-3">—</span> : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Avatar + name + secondary line, the first cell of most people tables. */
export function PersonCell({ name, sub, src, size = 'sm' }: { name: string; sub?: React.ReactNode; src?: string | null; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} src={src} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        {sub && <span className="t-caption block truncate text-ink-2">{sub}</span>}
      </span>
    </span>
  );
}

/** Card with a title row (and optional actions) — the standard block on detail and settings screens. */
export function Panel({ title, description, actions, children, className, bodyClassName }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <Card className={className}>
      {(title || actions) && <CardHeader title={title} description={description} action={actions} />}
      <CardBody className={cn(title && 'pt-4', bodyClassName)}>{children}</CardBody>
    </Card>
  );
}

/** Inline error with Retry (what happened + what to do). 403 / 404 get their own wording. */
export function ErrorPanel({ error, onRetry, title = 'We couldn’t load this', className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  const forbidden = error instanceof ApiError && error.status === 403;
  const missing = error instanceof ApiError && error.status === 404;
  return (
    <Card className={className}>
      <EmptyState
        illustration="error-offline"
        title={forbidden ? 'You do not have access to this' : missing ? 'We could not find this' : title}
        description={forbidden ? 'Your role does not include it. Ask a school administrator if you need it.' : missing ? 'It may have been removed, or it is outside the classes and records your role covers.' : errorMessage(error)}
        action={!forbidden && !missing && onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : undefined}
        compact
      />
    </Card>
  );
}

/** Skeleton block of the given height (keeps the layout from shifting while loading). */
export function LoadingBlock({ height = 200, className }: { height?: number; className?: string }) {
  return <Skeleton className={cn('w-full rounded-lg', className)} style={{ height }} />;
}

/** Route-based tabs for a feature area (Attendance, Exams …): links, current page marked with aria-current. */
export function AreaTabs({ items, className }: { items: { href: string; label: string; exact?: boolean }[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Section" className={cn('-mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-border', className)}>
      {items.map((i) => {
        const active = i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? 'page' : undefined}
            className={cn('tr-colors relative inline-flex h-11 shrink-0 items-center px-3 text-[13px] font-medium sm:h-10', active ? 'text-brand-ink after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-brand' : 'text-ink-2 hover:text-ink')}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
