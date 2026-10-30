'use client';

import * as React from 'react';
import { Check, Copy, ExternalLink, RefreshCw, Video } from 'lucide-react';
import { ONLINE_PROVIDER_LABEL, type OnlineMeetingOut, type OnlineProvider } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/cn';

export const providerLabel = (p: OnlineProvider | null | undefined): string => (p ? ONLINE_PROVIDER_LABEL[p] : 'Online meeting');

/** Only ever open http(s) links the provider gave us. */
const safeHref = (url: string | null | undefined): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

/**
 * "Join" for any screen that lists an event or a meeting. Opens the meeting in a new tab. Renders nothing when there is no link
 * (not scheduled, failed, cancelled). `stop` keeps a click from also activating a clickable table row or card around it.
 */
export function JoinButton({ url, provider, size = 'sm', variant = 'secondary', className, stop = true, label = 'Join' }: { url: string | null | undefined; provider?: OnlineProvider | null; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary'; className?: string; stop?: boolean; label?: string }) {
  const href = safeHref(url);
  if (!href) return null;
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={stop ? (e) => e.stopPropagation() : undefined} aria-label={label === 'Join' ? `Join the ${provider ? providerLabel(provider) : 'online'} meeting (opens in a new tab)` : `${label} (opens in a new tab)`}>
        <Video aria-hidden /> {label}
      </a>
    </Button>
  );
}

/** Join button for an object that carries the API's `onlineMeeting`. */
export function JoinFor({ meeting, ...rest }: { meeting: OnlineMeetingOut | null | undefined } & Omit<React.ComponentProps<typeof JoinButton>, 'url' | 'provider'>) {
  return <JoinButton url={meeting?.status === 'scheduled' ? meeting.joinUrl : null} provider={meeting?.provider} {...rest} />;
}

export function OnlineStatusChip({ status }: { status: OnlineMeetingOut['status'] }) {
  if (status === 'scheduled') return <Badge variant="success" icon={<Check aria-hidden />}>Link ready</Badge>;
  if (status === 'failed') return <Badge variant="danger" icon={<RefreshCw aria-hidden />}>Needs attention</Badge>;
  return <Badge variant="neutral">Cancelled</Badge>;
}

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [done, setDone] = React.useState(false);
  const id = React.useId();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      toast.success(`${label} copied`);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      toast.error('Could not copy. Select the text and copy it by hand.');
    }
  };
  return (
    <div className="min-w-0">
      <p id={id} className="t-caption text-ink-2">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <code aria-labelledby={id} className={cn('min-w-0 flex-1 truncate rounded-md border border-border bg-surface-subtle px-2.5 py-2 text-[13px] text-ink select-all', secret && 'tracking-wide')}>
          {value}
        </code>
        <IconButton label={`Copy ${label.toLowerCase()}`} variant="secondary" onClick={() => void copy()}>
          {done ? <Check /> : <Copy />}
        </IconButton>
      </div>
    </div>
  );
}

/**
 * The online meeting of an event or a parent–teacher meeting: link + passcode with copy buttons, the host link for people who may
 * edit, a status chip, and for a failure the safe reason with a Retry button. `chosen` is the provider picked for a draft that has
 * no meeting yet.
 */
export function JoinCard({ meeting, chosen, canEdit, onRetry, retrying, blockedReason, subject = 'event', className }: { meeting: OnlineMeetingOut | null; chosen?: OnlineProvider | null; canEdit: boolean; onRetry?: () => void; retrying?: boolean; blockedReason?: string | null; subject?: 'event' | 'meeting'; className?: string }) {
  if (!meeting) {
    if (!chosen || !canEdit) return null;
    return (
      <Card className={className}>
        <CardBody className="flex items-start gap-3">
          <Video className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <p className="text-sm text-ink-2">
            A {providerLabel(chosen)} meeting is created for this {subject} when you publish it. The link then shows here and to everyone who can see the {subject}.
          </p>
        </CardBody>
      </Card>
    );
  }
  const name = providerLabel(meeting.provider);
  return (
    <Card className={className} aria-label={`${name} online meeting`}>
      <CardHeader title={`Online meeting · ${name}`} action={<OnlineStatusChip status={meeting.status} />} />
      <CardBody className="space-y-4 pt-4">
        {meeting.status === 'scheduled' && meeting.joinUrl && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <JoinButton url={meeting.joinUrl} provider={meeting.provider} size="md" variant="primary" stop={false} label={`Join ${name}`} />
              {canEdit && meeting.startUrl && (
                <Button asChild variant="secondary">
                  <a href={safeHref(meeting.startUrl) ?? '#'} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden /> Start as host
                  </a>
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <CopyRow label="Meeting link" value={meeting.joinUrl} />
              {meeting.passcode && <CopyRow label="Passcode" value={meeting.passcode} secret />}
            </div>
            {canEdit && meeting.startUrl && <p className="t-caption text-ink-3">The host link starts the meeting as the host. Keep it to yourself: it is only shown to people who can edit this {subject}.</p>}
          </>
        )}
        {meeting.status === 'failed' && (
          <Banner
            tone="danger"
            title={canEdit ? `The ${name} meeting could not be set up` : 'The online link is not ready yet'}
            action={
              canEdit && onRetry ? (
                <Button size="sm" variant="secondary" loading={retrying} onClick={onRetry} disabled={!!blockedReason} title={blockedReason ?? undefined}>
                  <RefreshCw aria-hidden /> Retry
                </Button>
              ) : undefined
            }
          >
            {canEdit ? (meeting.error ?? 'Something went wrong while talking to the meeting service.') : `The school is still setting up the meeting. Check again a little later.`}
            {canEdit && <span className="mt-1 block">The {subject} itself is saved. SchoolSync also tries again every few minutes for a day.</span>}
          </Banner>
        )}
        {meeting.status === 'cancelled' && <p className="text-sm text-ink-2">This online meeting was cancelled. The link no longer works.</p>}
      </CardBody>
    </Card>
  );
}
