'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTabParam } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { CategoriesTab } from './categories-tab';
import { ConcessionsTab } from './concessions-tab';
import { DuesTab } from './dues-tab';
import { PlansTab } from './plans-tab';
import { StructuresTab } from './structures-tab';

/** Fee setup: structures · categories · student plans · concessions · generate dues. One tab per URL (`?tab=`). */
export function FinanceSetupPage() {
  const { can, base } = useMgmt();
  const tabs = [
    { value: 'structures', label: 'Fee structures' },
    { value: 'plans', label: 'Student plans' },
    ...(can('fees:create', 'school') ? [{ value: 'dues', label: 'Generate dues' }] : []),
    { value: 'concessions', label: 'Concessions' },
    { value: 'categories', label: 'Categories' },
  ];
  const [tab, setTab] = useTabParam(tabs.map((t) => t.value));
  return (
    <>
      <PageHeader title="Fee setup" description="Define what is charged, assign it to students, and generate the dues." crumbs={[{ label: 'Finance', href: `${base}/finance` }, { label: 'Fee setup' }]} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Fee setup sections">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="structures">
          <StructuresTab />
        </TabsContent>
        <TabsContent value="plans">
          <PlansTab />
        </TabsContent>
        <TabsContent value="dues">
          <DuesTab />
        </TabsContent>
        <TabsContent value="concessions">
          <ConcessionsTab />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
