'use client';

import * as React from 'react';
import { Send } from 'lucide-react';
import { useNotificationPreferences, useSavePreferences, useSendTestPush } from '@/lib/client/communication';
import { friendlyError } from '@/lib/client/mgmt';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { GuardedButton } from '../common/guarded';
import { ErrorPanel } from '../common/states';
import { useMgmt } from '../common/use-mgmt';

interface Row {
  category: string;
  label: string;
  push: boolean;
  email: boolean;
  quietFrom: string;
  quietTo: string;
}

/** How the signed-in person is notified: push and email per category, and quiet hours (school default unless they set their own). */
export function NotificationPreferencesPage() {
  const q = useNotificationPreferences();
  const save = useSavePreferences();
  const test = useSendTestPush();
  const { writeBlock } = useMgmt();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [orig, setOrig] = React.useState<string>('');
  const [err, setErr] = React.useState<string | null>(null);
  const d = q.data;

  React.useEffect(() => {
    if (!d) return;
    const r = d.categories.map((c) => ({ category: c.category, label: c.label, push: c.push, email: c.email, quietFrom: c.quietFrom ?? '', quietTo: c.quietTo ?? '' }));
    setRows(r);
    setOrig(JSON.stringify(r));
  }, [d]);

  const dirty = JSON.stringify(rows) !== orig;
  const { dialog } = useUnsavedGuard(dirty);
  const set = (cat: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.category === cat ? { ...r, ...patch } : r)));

  const submit = async () => {
    setErr(null);
    const changed = rows.filter((r) => JSON.stringify(r) !== JSON.stringify(JSON.parse(orig).find((o: Row) => o.category === r.category)));
    for (const r of changed) {
      if ((r.quietFrom && !r.quietTo) || (!r.quietFrom && r.quietTo)) {
        setErr(`${r.label}: set both quiet-hours times, or clear both to use the school default.`);
        return;
      }
    }
    try {
      await save.mutateAsync({
        preferences: changed.map((r) => ({ category: r.category as 'system', push: r.push, email: r.email, quietFrom: r.quietFrom || null, quietTo: r.quietTo || null })),
      });
      toast.success('Notification settings saved');
    } catch (e) {
      setErr(friendlyError(e));
    }
  };

  return (
    <>
      <PageHeader title="My notifications" description="Choose how you hear about fees, announcements, events, meetings and more." />
      {q.isPending ? (
        <Card>
          <CardBody className="space-y-3" aria-busy>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardBody>
        </Card>
      ) : q.isError || !d ? (
        <Card>
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load your settings" compact={false} />
        </Card>
      ) : (
        <div className="max-w-4xl space-y-6">
          <Banner tone="info">
            Quiet hours hold push notifications until morning. Unless you set your own below, the school default applies: {d.schoolDefaults.quietFrom} to {d.schoolDefaults.quietTo} ({d.timezone}). Setting both times the same switches quiet hours off for that category.
          </Banner>
          <Card>
            <div className="overflow-x-auto">
              <table className="t-table w-full">
                <caption className="sr-only">Notification settings by category</caption>
                <thead>
                  <tr>
                    <th scope="col" className="t-colhead h-10 bg-surface-subtle px-4 text-left text-ink-2">Category</th>
                    <th scope="col" className="t-colhead h-10 bg-surface-subtle px-4 text-center text-ink-2">Push</th>
                    <th scope="col" className="t-colhead h-10 bg-surface-subtle px-4 text-center text-ink-2">Email</th>
                    <th scope="col" className="t-colhead h-10 bg-surface-subtle px-4 text-left text-ink-2">Quiet from</th>
                    <th scope="col" className="t-colhead h-10 bg-surface-subtle px-4 text-left text-ink-2">Quiet until</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.category} className="border-t border-border">
                      <th scope="row" className="h-14 px-4 text-left font-medium">{r.label}</th>
                      <td className="px-4 text-center">
                        <Checkbox checked={r.push} onCheckedChange={(v) => set(r.category, { push: v === true })} aria-label={`${r.label}: push notifications`} />
                      </td>
                      <td className="px-4 text-center">
                        <Checkbox checked={r.email} onCheckedChange={(v) => set(r.category, { email: v === true })} aria-label={`${r.label}: email`} />
                      </td>
                      <td className="px-4">
                        <Input type="time" className="w-28" value={r.quietFrom} onChange={(e) => set(r.category, { quietFrom: e.target.value })} aria-label={`${r.label}: quiet hours start`} />
                      </td>
                      <td className="px-4">
                        <Input type="time" className="w-28" value={r.quietTo} onChange={(e) => set(r.category, { quietTo: e.target.value })} aria-label={`${r.label}: quiet hours end`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {err && <Banner tone="danger">{err}</Banner>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="secondary"
              loading={test.isPending}
              onClick={async () => {
                try {
                  const r = await test.mutateAsync();
                  toast.message(r.status === 'sent' ? 'Test notification sent to your device' : r.status === 'held' ? 'Held until quiet hours end' : r.devices === 0 ? 'No device is registered for push yet' : 'The test was skipped (push may be off for System)');
                } catch (e) {
                  toast.error(friendlyError(e), { duration: 8000 });
                }
              }}
            >
              <Send /> Send a test notification
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={!dirty} onClick={() => setRows(JSON.parse(orig))}>
                Discard changes
              </Button>
              <GuardedButton blocked={writeBlock('notifications:edit')} loading={save.isPending} disabled={!dirty} onClick={() => void submit()}>
                Save settings
              </GuardedButton>
            </div>
          </div>
        </div>
      )}
      {dialog}
    </>
  );
}
