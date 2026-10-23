'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { ExamsAreaTabs } from './meta';
import { SheetsQueue } from './exam-sheets';

/** `/admin/exams/review`: mark sheets from every exam, newest decisions first — what needs approving, returning or publishing. */
export function ReviewScreen() {
  return (
    <>
      <PageHeader title="Review queue" description="Mark sheets that teachers have submitted, across all exams. Approve them, return them with a note, or publish approved ones." />
      <ExamsAreaTabs />
      <SheetsQueue defaultStatus="submitted" />
    </>
  );
}
