'use client';

import Link from 'next/link';
import type { Experience } from '@/lib/experience';
import { allItems } from '@/lib/nav';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { PageHeader } from '../shell/page-header';
import { useMeContext } from '../me-context';

/** One quiet card used wherever live data is not connected yet. It never shows invented numbers. */
export function ComingSoonCard({ title = 'Coming online', intro, items }: { title?: string; intro: string; items: string[] }) {
  return (
    <Card>
      <CardHeader title={title} description={intro} />
      <CardBody className="pt-3">
        <ul className="space-y-1.5">
          {items.map((t) => (
            <li key={t} className="flex gap-2.5 text-sm text-muted-foreground">
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-subtle" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Stand-in for every feature screen that has not shipped yet. */
export function ComingOnline({ experience, itemId }: { experience: Experience; itemId: string }) {
  const { base } = useMeContext();
  const item = allItems(experience).find((i) => i.id === itemId);
  if (!item) return null;
  return (
    <>
      <PageHeader title={item.label} description={item.blurb} crumbs={[{ label: 'Home', href: base || '/' }, { label: item.label }]} />
      <div className="max-w-2xl">
        <ComingSoonCard intro="This area is not connected yet. Navigation and permissions are in place; the screen goes live in an upcoming release." items={item.includes ?? []} />
        <Button asChild variant="secondary" className="mt-4">
          <Link href={base || '/'}>Back to home</Link>
        </Button>
      </div>
    </>
  );
}

export function NoAccess() {
  const { base } = useMeContext();
  return (
    <div className="max-w-md">
      <h1 className="text-[22px] font-semibold leading-7">No access</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your role does not include this area. If you think that is a mistake, ask a school administrator to review your permissions.</p>
      <Button asChild variant="secondary" className="mt-4">
        <Link href={base || '/'}>Back to home</Link>
      </Button>
    </div>
  );
}
