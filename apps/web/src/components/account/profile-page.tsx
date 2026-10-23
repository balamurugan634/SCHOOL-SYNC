'use client';

import Link from 'next/link';
import { Avatar } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { PageHeader } from '../shell/page-header';
import { replayTour } from '../shell/events';
import { useMe } from '../me-context';
import { assetUrl } from '@/lib/assets';
import { EXPERIENCES } from '@/lib/experience';

const roleName = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function ProfilePage() {
  const me = useMe();
  const rows: [string, string | null][] = [
    ['Username', me.username],
    ['Email', me.email],
    ['Phone', me.phone],
    ['Account type', me.userType.replace(/^\w/, (c) => c.toUpperCase())],
  ];
  return (
    <>
      <PageHeader title="My profile" description="Your account details and security." crumbs={[{ label: 'Home', href: EXPERIENCES[me.experience].base }, { label: 'My profile' }]} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Card>
          <CardBody className="flex items-center gap-4">
            <Avatar name={me.displayName} src={assetUrl(me.avatarUrl)} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold leading-6">{me.displayName}</h2>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {me.roles.map((r) => (
                  <Badge key={r}>{roleName(r)}</Badge>
                ))}
              </div>
            </div>
          </CardBody>
          <dl className="divide-y divide-border border-t border-border text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-4 px-5 py-3">
                <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 flex-1 truncate">{v || <span className="text-subtle">Not set</span>}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-border px-5 py-3 text-[13px] text-muted-foreground">To change your name, phone or email, ask the school office — they keep the official record.</p>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Security" />
            <CardBody className="flex flex-col gap-2 pt-3">
              <Button asChild variant="secondary" className="justify-start">
                <Link href="/change-password">Change password</Link>
              </Button>
              <Button asChild variant="secondary" className="justify-start">
                <Link href="/account/sessions">Sessions and devices</Link>
              </Button>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Welcome tour" description="A short walk through your home screen." />
            <CardBody className="pt-3">
              <Button variant="secondary" onClick={replayTour}>
                Replay the tour
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
