'use client';

import * as React from 'react';
import { DatabaseZap } from 'lucide-react';
import type { PlatformMigrateOut, PlatformTenantDetail } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Panel } from '@/components/features/management/shared/detail';
import { plural } from '@/lib/format';
import { useMigrateSchools } from '@/lib/platform/queries';

/** Small chip for a school whose database is behind the newest structure. */
export function UpdateChip() {
  return <Badge variant="accent">Update available</Badge>;
}

/** What the last update run did: kept on screen, because a failure must not vanish with a toast. */
function Outcome({ r }: { r: PlatformMigrateOut }) {
  const failed = r.results.filter((x) => !x.ok);
  if (!failed.length) return null;
  return (
    <Banner tone="danger" title={`${plural(failed.length, 'school')} could not be updated`}>
      <ul className="mt-1 space-y-0.5">
        {failed.map((f) => (
          <li key={f.code}>
            <span className="font-mono">{f.code}</span>: {f.error ?? 'Unknown error'}
          </li>
        ))}
      </ul>
    </Banner>
  );
}

/** Above the schools list: how many schools are waiting for a database update, and one button to update them all. */
export function UpdateAllBanner({ waiting }: { waiting: number }) {
  const migrate = useMigrateSchools();
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<PlatformMigrateOut | null>(null);
  if (waiting <= 0 && !result) return null;
  return (
    <div className="mb-5 space-y-3">
      {waiting > 0 && (
        <Banner
          tone="warning"
          title={`${plural(waiting, 'school')} ${waiting === 1 ? 'is' : 'are'} waiting for a database update`}
          action={<Button size="sm" onClick={() => setOpen(true)}><DatabaseZap /> Update {waiting === 1 ? 'school' : `all ${waiting} schools`}</Button>}
        >
          New features need a small change to each school’s own database. Updating is safe to repeat, keeps all data, and takes seconds per school.
        </Banner>
      )}
      {result && <Outcome r={result} />}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Update ${plural(waiting, 'school')}?`}
        description="Each school’s database gets the newest structure. Nothing is deleted. Schools stay online while this runs."
        confirmLabel="Update now"
        loading={migrate.isPending}
        onConfirm={async () => {
          const r = await migrate.run(undefined);
          if (r.ok) setResult(r.data);
          setOpen(false);
        }}
      />
    </div>
  );
}

/** On a school's Settings tab: the database version and a button to bring it up to date. */
export function DatabasePanel({ detail }: { detail: PlatformTenantDetail }) {
  const t = detail.tenant;
  const migrate = useMigrateSchools();
  const [result, setResult] = React.useState<PlatformMigrateOut | null>(null);
  const canUpdate = t.status === 'active' || t.status === 'suspended';
  return (
    <Panel title="Database" description="Each school has its own database. New releases may add tables or columns; updating applies them without touching the data.">
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="t-caption text-ink-2">This school is on</dt><dd className="font-mono">{t.schemaVersion ?? 'not recorded'}</dd></div>
        <div><dt className="t-caption text-ink-2">Newest available</dt><dd className="font-mono">{t.schemaLatest}</dd></div>
      </dl>
      {t.schemaUpToDate ? (
        <p className="mt-3 text-sm text-success">Up to date.</p>
      ) : (
        <Banner tone="warning" title="An update is waiting" className="mt-3" action={canUpdate ? <Button size="sm" loading={migrate.isPending} onClick={async () => { const r = await migrate.run(t.code); if (r.ok) setResult(r.data); }}><DatabaseZap /> Update now</Button> : undefined}>
          {canUpdate ? 'Update before the school uses the newest features.' : `A school that is “${t.status}” cannot be updated from here.`}
        </Banner>
      )}
      {result && <div className="mt-3"><Outcome r={result} /></div>}
    </Panel>
  );
}
