'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { FeaturesOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useMe } from '@/components/me-context';
import { useSaveFeatures } from '@/lib/client/settings';
import { useAccess } from '../shared/access';
import { Panel } from '../shared/detail';

const FEATURES: { key: keyof FeaturesOut; label: string; hint: string; off: string }[] = [
  { key: 'fees', label: 'Fees and finance', hint: 'Fee structures, invoices, payments, receipts and expenses.', off: 'Fee screens disappear for staff, parents and students. Existing records are kept.' },
  { key: 'onlinePayments', label: 'Online payments', hint: 'Parents pay invoices through the payment gateway.', off: 'Parents can no longer start online payments. Offline payments are unaffected.' },
  { key: 'transport', label: 'Transport', hint: 'Routes, stops, vehicles and student allocation.', off: 'Transport screens disappear. Routes and allocations are kept.' },
  { key: 'library', label: 'Library', hint: 'Catalogue, issue and return, fines.', off: 'Library screens disappear. The catalogue and loans are kept.' },
  { key: 'studentLogin', label: 'Student sign-in', hint: 'Students can sign in with their own account.', off: 'Students are signed out at their next refresh and cannot sign in until it is switched back on.' },
];

/** Feature switches: super administrators only (the API refuses everyone else with ONLY_SUPER_ADMIN). */
export function FeaturesPanel({ data }: { data: FeaturesOut }) {
  const router = useRouter();
  const me = useMe();
  const access = useAccess();
  const save = useSaveFeatures();
  const isSuper = me.roles.includes('super_admin');
  const editable = isSuper && access.ok('settings:edit', 'school');
  const [pending, setPending] = React.useState<{ key: keyof FeaturesOut; on: boolean } | null>(null);
  const def = pending ? FEATURES.find((f) => f.key === pending.key) : null;

  const apply = async (key: keyof FeaturesOut, on: boolean) => {
    const r = await save.run({ [key]: on });
    if (r.ok) router.refresh();
    return r.ok;
  };

  return (
    <Panel title="Features" description="Switch whole areas of the product on or off for this school." bodyClassName="space-y-4">
      {!isSuper && <Banner tone="info">Only a super administrator can change feature switches. You can see which are on.</Banner>}
      {isSuper && access.readOnly && <Banner tone="locked">The school is in read-only mode, so switches cannot change until the subscription is renewed.</Banner>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {FEATURES.map((f) => {
          const id = `feature-${f.key}`;
          return (
            <li key={f.key} className="flex items-start gap-3 px-4 py-3">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={data[f.key]}
                disabled={!editable || save.isPending}
                onCheckedChange={(c) => {
                  const on = c === true;
                  if (on) void apply(f.key, true);
                  else setPending({ key: f.key, on: false });
                }}
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={id} className="text-sm font-medium">{f.label}</label>
                <p className="t-caption text-ink-2">{f.hint}</p>
              </div>
              <span className="t-caption shrink-0 pt-0.5 text-ink-2">{data[f.key] ? 'On' : 'Off'}</span>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={def ? `Switch off ${def.label.toLowerCase()}?` : 'Switch off?'}
        description={def?.off}
        confirmLabel="Switch off"
        destructive
        loading={save.isPending}
        onConfirm={async () => {
          if (pending && (await apply(pending.key, pending.on))) setPending(null);
        }}
      />
      <p className="t-caption text-ink-3">Changes apply to everyone at once.</p>
    </Panel>
  );
}
