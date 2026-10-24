'use client';

import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUrlState } from '@/lib/client/url-state';
import { AccountsPanel } from './accounts-panel';
import { QueuePanel } from './queue-panel';

const SUBS = [
  { value: 'accounts', label: 'Email accounts' },
  { value: 'queue', label: 'Email queue' },
] as const;

/** Settings → Email: the school's mail accounts and the queue of everything it sends (`?tab=email&sub=accounts|queue`). */
export function EmailArea() {
  const [url, setUrl] = useUrlState({ sub: 'accounts' });
  const sub = SUBS.some((s) => s.value === url.sub) ? url.sub : 'accounts';
  return (
    <Tabs value={sub} onValueChange={(v) => setUrl({ sub: v === 'accounts' ? undefined : v })}>
      <TabsList aria-label="Email sections">
        {SUBS.map((s) => (
          <TabsTrigger key={s.value} value={s.value}>
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="mt-5">
        <TabsContent value="accounts" className="mt-0">{sub === 'accounts' && <AccountsPanel />}</TabsContent>
        <TabsContent value="queue" className="mt-0">{sub === 'queue' && <QueuePanel />}</TabsContent>
      </div>
    </Tabs>
  );
}
