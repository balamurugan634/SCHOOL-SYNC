'use client';

import * as React from 'react';
import type { PermissionKey } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { FeatureGate } from '../gate';
import { ChildContext, NeedsLearner } from '../states';
import { useGates, useLearner } from '../use-learner';
import { UrlTabs, useUrlParams, type TabDef } from '../url-state';
import { ExamsView } from './exams';
import { HomeworkList } from './homework-list';
import { MaterialsView } from './materials';
import { ResultsView } from './results';
import { SyllabusView } from './syllabus';
import { TimetableView } from './timetable';

const TABS = ['homework', 'timetable', 'materials', 'syllabus', 'results', 'exams'] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { homework: 'Homework', timetable: 'Timetable', materials: 'Materials', syllabus: 'Syllabus', results: 'Results', exams: 'Exams' };
const PERM: Record<Tab, PermissionKey> = { homework: 'homework:view', timetable: 'timetable:view', materials: 'materials:view', syllabus: 'syllabus:view', results: 'marks:view', exams: 'exams:view' };
/** URL params that belong to one tab only; cleared when the tab changes so a page number never leaks across tabs. */
const TAB_PARAMS = ['page', 'size', 'status', 'q', 'sort', 'subject', 'week'];

/** Student "Learning" and parent "Academics": the same tabs, scoped to the student / the selected child. */
export function LearningScreen() {
  const l = useLearner();
  const { can } = useGates();
  const { get, set } = useUrlParams();
  const allowed = TABS.filter((t) => can(PERM[t]));
  const raw = get('tab');
  const tab: Tab = (allowed as readonly string[]).includes(raw ?? '') ? (raw as Tab) : (allowed[0] ?? 'homework');
  const tabs: TabDef<Tab>[] = allowed.map((t) => ({ value: t, label: LABEL[t] }));
  const choose = (t: Tab) => set({ tab: t === allowed[0] ? null : t, ...Object.fromEntries(TAB_PARAMS.map((p) => [p, null])) });

  return (
    <>
      <PageHeader
        title={l.isParent ? 'Academics' : 'Learning'}
        description={l.isParent ? 'Homework, timetable, syllabus, exams and results for your child.' : 'Homework, timetable, study materials, syllabus, exams and results.'}
      />
      <ChildContext />
      <NeedsLearner>
        {allowed.length === 0 ? (
          <FeatureGate perm="homework:view" what="Learning">
            {null}
          </FeatureGate>
        ) : (
          <>
            <UrlTabs tabs={tabs} tab={tab} onTab={choose} label="Learning sections" />
            <div role="tabpanel" aria-label={LABEL[tab]} key={`${tab}-${l.studentId}`}>
              {tab === 'homework' && <HomeworkList />}
              {tab === 'timetable' && <TimetableView />}
              {tab === 'materials' && <MaterialsView />}
              {tab === 'syllabus' && <SyllabusView />}
              {tab === 'results' && <ResultsView />}
              {tab === 'exams' && <ExamsView />}
            </div>
          </>
        )}
      </NeedsLearner>
    </>
  );
}
