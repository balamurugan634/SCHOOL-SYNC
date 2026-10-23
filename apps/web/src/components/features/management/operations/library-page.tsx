'use client';

import * as React from 'react';
import type { LibraryBook } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTabParam } from '../common/url-state';
import { CatalogueTab } from './catalogue-tab';
import { LoansTab } from './loans-tab';
import { OverdueTab } from './overdue-tab';
import { PolicyTab } from './policy-tab';

export function LibraryPage() {
  const tabs = [
    { value: 'catalogue', label: 'Catalogue' },
    { value: 'loans', label: 'Loans' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'policy', label: 'Policy' },
  ];
  const [tab, setTab] = useTabParam(tabs.map((t) => t.value));
  const [issue, setIssue] = React.useState<LibraryBook | null>(null);
  return (
    <>
      <PageHeader title="Library" description="The catalogue, who has which book, what is overdue, and the lending rules." />
      <Tabs
        value={issue ? 'loans' : tab}
        onValueChange={(v) => {
          setIssue(null);
          setTab(v);
        }}
      >
        <TabsList aria-label="Library sections">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="catalogue">
          <CatalogueTab onIssue={(b) => setIssue(b)} />
        </TabsContent>
        <TabsContent value="loans">
          <LoansTab issueBook={issue} onIssueClose={() => setIssue(null)} />
        </TabsContent>
        <TabsContent value="overdue">
          <OverdueTab />
        </TabsContent>
        <TabsContent value="policy">
          <PolicyTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
