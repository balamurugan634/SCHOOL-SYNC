'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUrlState } from '@/lib/client/url-state';
import { GradesPanel } from './grades-panel';
import { SectionsPanel } from './sections-panel';

export function ClassesScreen() {
  const [p, set] = useUrlState({ tab: 'sections' });
  const tab = p.tab === 'grades' ? 'grades' : 'sections';
  return (
    <>
      <PageHeader
        title="Classes & sections"
        description="Grades, the sections inside them, class teachers and capacity."
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Academics' }, { label: 'Classes & sections' }]}
      />
      <Tabs value={tab} onValueChange={(t) => set({ tab: t })}>
        <TabsList aria-label="Classes">
          <TabsTrigger value="sections">Sections</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
        </TabsList>
        <TabsContent value="sections">
          <SectionsPanel />
        </TabsContent>
        <TabsContent value="grades">
          <GradesPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
