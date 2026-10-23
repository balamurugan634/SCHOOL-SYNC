'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import type { StaffCreated } from '@/lib/client/people-staff';
import { useAccess } from '../shared/access';
import { CredentialsDialog } from '../shared/dialogs';
import { paths } from '../shared/paths';
import { StaffCreateForm } from './staff-form';

export function StaffCreate() {
  const router = useRouter();
  const acc = useAccess();
  const [created, setCreated] = React.useState<StaffCreated | null>(null);
  const go = (s: StaffCreated) => router.push(paths.staffMember(s.id));
  return (
    <>
      <PageHeader title="Add staff" description="Teachers and other staff. Teaching staff get the Teacher role automatically." crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Staff', href: paths.staff }, { label: 'Add staff' }]} />
      <div className="max-w-3xl space-y-4">
        {!acc.can('staff:create', 'school') && <Banner tone="danger">Your role cannot add staff.</Banner>}
        <Card>
          <StaffCreateForm
            onCancel={() => router.push(paths.staff)}
            onCreated={(s) => {
              if (s.credentials) setCreated(s);
              else go(s);
            }}
          />
        </Card>
      </div>
      <CredentialsDialog
        open={!!created}
        onOpenChange={(o) => {
          if (!o && created) go(created);
        }}
        title={`${created?.name ?? 'Staff member'} was added`}
        logins={created?.credentials ? [{ label: `Staff (${created.name})`, username: created.credentials.username, temporaryPassword: created.credentials.temporaryPassword }] : []}
        note={created ? <p className="t-caption text-ink-2">Employee id {created.employeeId}. <Link href={paths.staffMember(created.id)} className="text-brand-ink hover:underline">Open the profile</Link> after you have copied the password.</p> : null}
      />
    </>
  );
}
