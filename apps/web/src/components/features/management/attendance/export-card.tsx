'use client';

import * as React from 'react';
import { differenceInCalendarDays, format, parseISO, startOfMonth } from 'date-fns';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/input';
import { todayIso } from '@/lib/format';
import { useSectionList, sectionOptions } from '@/lib/client/options';
import { Select } from '@/components/ui/select';
import { ExportButton } from '../shared/controls';
import { Panel } from '../shared/detail';
import { useAccess } from '../shared/access';

export const MAX_EXPORT_DAYS = 93;

/** Validates an export range the same way the API does (start ≤ end, at most 93 days between them). */
export function rangeProblem(from: string, to: string, max = MAX_EXPORT_DAYS): string | null {
  if (!from || !to) return 'Pick both dates.';
  if (from > to) return 'The start date must not be after the end date.';
  if (differenceInCalendarDays(parseISO(to), parseISO(from)) > max) return `Choose at most ${max} days at a time.`;
  return null;
}

/** CSV export of attendance records for a date range (and optionally one class). */
export function ExportCard() {
  const a = useAccess();
  const today = todayIso();
  const [from, setFrom] = React.useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [to, setTo] = React.useState(today);
  const [sectionId, setSectionId] = React.useState('');
  const secQ = useSectionList({ enabled: a.can('academics:view') });
  const sections = Array.isArray(secQ.data) ? secQ.data : undefined;
  const problem = rangeProblem(from, to);
  const blocked = a.hint('attendance:export');
  return (
    <Panel title="Export attendance" description="One row per student per day, as a CSV file. Up to 93 days at a time.">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="att-export-from">
            <DatePicker id="att-export-from" value={from} onChange={setFrom} max={today} invalid={!!problem} />
          </Field>
          <Field label="To" htmlFor="att-export-to">
            <DatePicker id="att-export-to" value={to} onChange={setTo} max={today} invalid={!!problem} />
          </Field>
        </div>
        {problem && (
          <p role="alert" className="t-caption text-danger">
            {problem}
          </p>
        )}
        {sections && sections.length > 0 && (
          <Field label="Class" htmlFor="att-export-class">
            <Select id="att-export-class" value={sectionId || '__all'} onValueChange={(v) => setSectionId(v === '__all' ? '' : v)} options={[{ value: '__all', label: 'Whole school' }, ...sectionOptions(sections)]} />
          </Field>
        )}
        <ExportButton path="/attendance/export" query={{ from, to, sectionId: sectionId || undefined }} filename={`attendance-${from}-to-${to}.csv`} disabled={!!problem || !!blocked} title={blocked} />
      </div>
    </Panel>
  );
}
