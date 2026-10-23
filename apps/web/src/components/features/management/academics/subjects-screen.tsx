'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { useUrlState } from '@/lib/client/url-state';
import { OfferingsPanel } from './offerings-panel';
import { SubjectsPanel } from './subjects-panel';

export function SubjectsScreen() {
  const [p, set] = useUrlState({ tab: 'subjects', grade: '' });
  const tab = p.tab === 'offerings' ? 'offerings' : 'subjects';
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty);
  return (
    <>
      <PageHeader
        title="Subjects"
        description="The subject catalogue, and which subjects each grade offers with how many periods a week."
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Academics' }, { label: 'Subjects' }]}
      />
      <Tabs value={tab} onValueChange={(t) => guard(() => set({ tab: t }))}>
        <TabsList aria-label="Subjects">
          <TabsTrigger value="subjects">Subjects</TabsTrigger>
          <TabsTrigger value="offerings">Grade offerings</TabsTrigger>
        </TabsList>
        <TabsContent value="subjects">
          <SubjectsPanel />
        </TabsContent>
        <TabsContent value="offerings">
          <OfferingsPanel gradeId={p.grade} onGrade={(g) => guard(() => set({ grade: g }))} onDirty={setDirty} />
        </TabsContent>
      </Tabs>
      {dialog}
    </>
  );
}
