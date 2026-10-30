'use client';

import * as React from 'react';
import Link from 'next/link';
import { ONLINE_PROVIDER_LABEL, type OnlineProvider, type OnlineProvidersOut } from '@school-sync/shared';
import { Button } from '@/components/ui/button';
import { FormSection } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

export type OnlineChoice = 'none' | OnlineProvider;

/** Why an online meeting cannot be used for the event as it stands. */
export type OnlineBlock = 'all_day' | 'multi_day' | null;

/**
 * "Online meeting" selector of the event form: None / Google Meet / Zoom. Only providers the school has connected are offered;
 * with none connected it says how to connect one. It is disabled, with the reason and a one-click fix, while the event is
 * all-day or spans several days (a meeting needs a start and end time on one day).
 */
export function OnlineMeetingField({
  value,
  onChange,
  providers,
  loading,
  block,
  onSetTime,
  onUseOneDay,
  settingsHref,
  disabled,
  existing,
}: {
  value: OnlineChoice;
  onChange: (v: OnlineChoice) => void;
  providers: OnlineProvidersOut | undefined;
  loading?: boolean;
  block: OnlineBlock;
  onSetTime?: () => void;
  onUseOneDay?: () => void;
  /** where an administrator connects a provider; omit when the caller may not */
  settingsHref?: string;
  disabled?: boolean;
  /** the provider of the meeting that already exists, if any (changing it replaces the meeting) */
  existing?: OnlineProvider | null;
}) {
  const id = React.useId();
  const offered = providers?.providers ?? [];
  const options: SelectOption[] = [
    { value: 'none', label: 'No online meeting' },
    ...(['google', 'zoom'] as const)
      .filter((p) => offered.includes(p) || p === value)
      .map((p) => ({ value: p, label: offered.includes(p) ? ONLINE_PROVIDER_LABEL[p] : `${ONLINE_PROVIDER_LABEL[p]} (not connected any more)` })),
  ];
  const nothingConnected = !loading && providers !== undefined && offered.length === 0 && value === 'none';
  const stuck = !!block || disabled || nothingConnected;
  const hintId = `${id}-hint`;
  return (
    <FormSection title="Online meeting" description="Optional. Add a Google Meet or Zoom link that everyone invited can join.">
      {loading ? (
        <Skeleton className="h-9 w-full max-w-sm" aria-label="Loading online meeting options" />
      ) : (
        <Field label="Online meeting" htmlFor={id} hint={block || nothingConnected ? undefined : value === 'none' ? 'The link appears on the event for everyone who can see it.' : undefined}>
          <Select id={id} value={block ? 'none' : value} onValueChange={(v) => onChange(v as OnlineChoice)} options={options} disabled={stuck} className="max-w-sm" aria-label="Online meeting" />
        </Field>
      )}
      {block === 'all_day' && (
        <div id={hintId} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-ink-2">
          <span>An online meeting needs a start and end time, and this event is marked all-day.</span>
          {onSetTime && (
            <Button type="button" size="sm" variant="secondary" onClick={onSetTime}>
              Set a time
            </Button>
          )}
        </div>
      )}
      {block === 'multi_day' && (
        <div id={hintId} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-ink-2">
          <span>An online meeting must be on a single day, and this event runs over several days.</span>
          {onUseOneDay && (
            <Button type="button" size="sm" variant="secondary" onClick={onUseOneDay}>
              Use one day
            </Button>
          )}
        </div>
      )}
      {nothingConnected && !block && (
        <p id={hintId} className="rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-ink-2">
          No online meeting service is connected yet.{' '}
          {settingsHref ? (
            <>
              <Link href={settingsHref} className="font-medium text-brand-ink underline-offset-4 hover:underline">
                Connect Zoom or Google Meet
              </Link>{' '}
              in the school settings to use it here.
            </>
          ) : (
            'Ask a school administrator to connect Zoom or Google Meet in the school settings.'
          )}
        </p>
      )}
      {!block && value !== 'none' && (
        <p id={hintId} className="t-caption text-ink-2">
          {existing && existing !== value
            ? `The current ${ONLINE_PROVIDER_LABEL[existing]} meeting is cancelled and a ${ONLINE_PROVIDER_LABEL[value]} meeting is created in its place; the old link stops working.`
            : `A ${ONLINE_PROVIDER_LABEL[value]} meeting is created for that day and time when the event is published. If you change the day, time or title, or cancel the event, the meeting follows.`}
        </p>
      )}
    </FormSection>
  );
}
