'use client';

import * as React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { useBranding, useFeatures, useSettings } from '@/lib/client/settings';
import { useUrlState } from '@/lib/client/url-state';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { cn } from '@/lib/cn';
import { ErrorPanel, LoadingBlock } from '../shared/detail';
import { EmailArea } from './email/email-area';
import { MeetingsArea } from './meetings/meetings-area';
import { BrandingForm } from './branding-form';
import { FeaturesPanel } from './features-panel';
import { GroupForm } from './group-form';
import { GROUPS } from './groups';

const TABS = [
  { value: 'profile', label: 'Logo and colours' },
  { value: 'details', label: 'School details' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'academic', label: 'School days' },
  { value: 'exams', label: 'Exams' },
  { value: 'fees', label: 'Fees' },
  { value: 'library', label: 'Library' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'email', label: 'Email' },
  { value: 'meetings', label: 'Online meetings' },
  { value: 'features', label: 'Features' },
] as const;
type TabKey = (typeof TABS)[number]['value'];

function Loading() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading settings">
      <LoadingBlock height={120} />
      <Skeleton className="h-9 w-64" />
      <LoadingBlock height={260} />
    </div>
  );
}

/** School profile, branding, every settings group and the feature switches, one tab each (`?tab=`). */
export function SchoolSettings() {
  const [url, setUrl] = useUrlState({ tab: 'profile' });
  const tab = (TABS.some((t) => t.value === url.tab) ? url.tab : 'profile') as TabKey;
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty);
  const onDirty = React.useCallback((d: boolean) => setDirty(d), []);

  const settings = useSettings();
  const branding = useBranding();
  const features = useFeatures();

  const needs = tab === 'profile' ? branding : tab === 'features' ? features : tab === 'email' || tab === 'meetings' ? null : settings;

  return (
    <>
      {dialog}
      <PageHeader title="School profile and settings" description="Identity, colours, how attendance and exams work, and which features are on." crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Settings and access' }, { label: 'School profile' }]} />
      <Tabs value={tab} onValueChange={(v) => guard(() => setUrl({ tab: v === 'profile' ? undefined : v }))}>
        <TabsList aria-label="Settings sections">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className={cn('mt-6', tab !== 'email' && tab !== 'meetings' && 'max-w-3xl')}>
          {tab === 'email' ? (
            <TabsContent value="email" className="mt-0"><EmailArea /></TabsContent>
          ) : tab === 'meetings' ? (
            <TabsContent value="meetings" className="mt-0"><MeetingsArea onDirtyChange={onDirty} /></TabsContent>
          ) : needs?.isPending ? (
            <Loading />
          ) : needs?.isError ? (
            <ErrorPanel error={needs.error} onRetry={() => void needs.refetch()} title="We couldn’t load these settings" />
          ) : (
            <>
              <TabsContent value="profile" className="mt-0">{tab === 'profile' && branding.data && <BrandingForm data={branding.data} onDirtyChange={onDirty} />}</TabsContent>
              <TabsContent value="features" className="mt-0">{tab === 'features' && features.data && <FeaturesPanel data={features.data} />}</TabsContent>
              {(['details', 'attendance', 'academic', 'exams', 'fees', 'library', 'notifications'] as const).map((k) => {
                const spec = GROUPS[k]!;
                return (
                  <TabsContent key={k} value={k} className="mt-0">
                    {tab === k && settings.data && <GroupForm key={k} spec={spec} data={settings.data[spec.key] ?? {}} onDirtyChange={onDirty} />}
                  </TabsContent>
                );
              })}
            </>
          )}
        </div>
      </Tabs>
    </>
  );
}
