'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUrlState } from '@/lib/client/url-state';
import { PeriodsPanel } from './periods-panel';
import { YearsPanel } from './years-panel';

export function YearsScreen() {
  const [p, set] = useUrlState({ tab: 'years', year: '' });
  const tab = p.tab === 'periods' ? 'periods' : 'years';
  return (
    <>
      <PageHeader
        title="Academic years & terms"
        description="The calendar everything else hangs from: academic years, their terms, and the periods of the school day."
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Academics' }, { label: 'Years & terms' }]}
      />
      <Tabs value={tab} onValueChange={(t) => set({ tab: t })}>
        <TabsList aria-label="Calendar">
          <TabsTrigger value="years">Years & terms</TabsTrigger>
          <TabsTrigger value="periods">School-day periods</TabsTrigger>
        </TabsList>
        <TabsContent value="years">
          <YearsPanel selectedId={p.year} onSelect={(id) => set({ year: id })} />
        </TabsContent>
        <TabsContent value="periods">
          <PeriodsPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
