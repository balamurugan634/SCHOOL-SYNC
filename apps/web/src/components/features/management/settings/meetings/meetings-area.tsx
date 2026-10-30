'use client';

import * as React from 'react';
import { ONLINE_PROVIDER_LABEL, type MeetingProviderOut, type OnlineProvider } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Skeleton } from '@/components/ui/skeleton';
import { useDisconnectProvider, useMeetingSettings, useSetDefaultProvider } from '@/lib/client/online-meetings';
import { cn } from '@/lib/cn';
import { AsyncConfirm } from '../../common/dialogs';
import { useAccess } from '../../shared/access';
import { ErrorPanel, Panel } from '../../shared/detail';
import { GoogleCard } from './google-card';
import { ZoomCard } from './zoom-card';

/** Which provider new meetings use when nobody picks one. */
function DefaultChoice({ providers, current, editable }: { providers: MeetingProviderOut[]; current: OnlineProvider | null; editable: boolean }) {
  const setDefault = useSetDefaultProvider();
  const usable = providers.filter((p) => p.connected && p.enabled);
  const name = React.useId();
  return (
    <Panel title="Default provider" description="Used when a parent–teacher meeting is scheduled online without choosing a service. An event always uses the service chosen on the event." bodyClassName="space-y-3">
      {usable.length === 0 ? (
        <p className="text-sm text-ink-2">Connect Zoom or Google Meet below, then choose which one is the default.</p>
      ) : (
        <div role="radiogroup" aria-label="Default provider" className="grid gap-2 sm:grid-cols-2">
          {providers.map((p) => {
            const ok = p.connected && p.enabled;
            const on = current === p.provider;
            return (
              <label
                key={p.provider}
                className={cn('tr-colors flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', on ? 'border-brand bg-brand-soft' : 'border-border bg-surface', ok && editable && !on ? 'cursor-pointer hover:border-border-strong' : !ok || !editable ? 'cursor-not-allowed opacity-70' : '')}
              >
                <input
                  type="radio"
                  name={name}
                  className="mt-1 size-4 accent-[var(--brand)]"
                  checked={on}
                  disabled={!ok || !editable || setDefault.isPending}
                  onChange={() => void setDefault.run(p.provider)}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{ONLINE_PROVIDER_LABEL[p.provider]}</span>
                  <span className="t-caption block text-ink-2">{!p.connected ? 'Not connected' : !p.enabled ? 'Switched off' : on ? 'Default for new meetings' : 'Available'}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/** Settings → School profile → Online meetings: the school's own Zoom and Google Meet connections. */
export function MeetingsArea({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const q = useMeetingSettings();
  const access = useAccess();
  const editable = access.ok('settings:edit', 'school');
  const disconnect = useDisconnectProvider();
  const [dirty, setDirty] = React.useState({ zoom: false, google: false });
  const [confirm, setConfirm] = React.useState<OnlineProvider | null>(null);
  React.useEffect(() => onDirtyChange(dirty.zoom || dirty.google), [dirty, onDirtyChange]);
  // leaving the tab (after the unsaved-changes guard) must not leave the parent believing there is something unsaved
  React.useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const setZoom = React.useCallback((d: boolean) => setDirty((s) => (s.zoom === d ? s : { ...s, zoom: d })), []);
  const setGoogle = React.useCallback((d: boolean) => setDirty((s) => (s.google === d ? s : { ...s, google: d })), []);

  if (q.isPending) {
    return (
      <div className="space-y-4" aria-busy aria-label="Loading online meeting settings">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the online meeting settings" />;

  const zoom = q.data.providers.find((p) => p.provider === 'zoom')!;
  const google = q.data.providers.find((p) => p.provider === 'google')!;
  const target = confirm ? q.data.providers.find((p) => p.provider === confirm) : null;
  const name = confirm ? ONLINE_PROVIDER_LABEL[confirm] : '';

  return (
    <div className="max-w-3xl space-y-6">
      {!editable && <Banner tone={access.readOnly ? 'locked' : 'info'}>{access.hint('settings:edit', 'school') ?? 'You can see these settings but not change them.'}</Banner>}
      <Banner tone="info" title="Meetings that schedule themselves">
        Connect your school’s own Zoom or Google Workspace account. SchoolSync then creates the meeting when an event is published or a parent–teacher meeting is confirmed, keeps it in step when the time changes, and cancels it with the event. If Zoom or Google is unreachable, the event or meeting is still saved and the link is retried for you.
      </Banner>
      <DefaultChoice providers={q.data.providers} current={q.data.defaultProvider} editable={editable} />
      <ZoomCard p={zoom} editable={editable} onDirtyChange={setZoom} onDisconnect={() => setConfirm('zoom')} />
      <GoogleCard p={google} editable={editable} onDirtyChange={setGoogle} onDisconnect={() => setConfirm('google')} />
      <AsyncConfirm
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Disconnect ${name}?`}
        confirmLabel="Disconnect"
        destructive
        description={
          <>
            The saved credentials are deleted from SchoolSync. New meetings can no longer be created at {name}.
            {target && target.liveMeetings > 0 && (
              <>
                {' '}
                <strong>
                  {target.liveMeetings} meeting{target.liveMeetings === 1 ? '' : 's'} already created there stay open
                </strong>{' '}
                and cannot be cancelled by SchoolSync until you connect {name} again.
              </>
            )}{' '}
            Events and meetings set to use {name} will show a problem until you pick another service.
          </>
        }
        onConfirm={async () => {
          if (confirm) await disconnect.mutateAsync(confirm);
        }}
      />
    </div>
  );
}
