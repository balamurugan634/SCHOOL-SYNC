'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTabParam } from '../common/url-state';
import { AllocationsTab } from './allocations-tab';
import { RoutesTab } from './routes-tab';
import { VehiclesTab } from './vehicles-tab';

export function TransportPage() {
  const tabs = [
    { value: 'routes', label: 'Routes' },
    { value: 'students', label: 'Students on the bus' },
    { value: 'vehicles', label: 'Vehicles' },
  ];
  const [tab, setTab] = useTabParam(tabs.map((t) => t.value));
  return (
    <>
      <PageHeader title="Transport" description="Routes and stops, buses and drivers, and which students ride where." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Transport sections">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="routes">
          <RoutesTab />
        </TabsContent>
        <TabsContent value="students">
          <AllocationsTab />
        </TabsContent>
        <TabsContent value="vehicles">
          <VehiclesTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
