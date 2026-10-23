'use client';

import * as React from 'react';
import { ATTENDANCE_STATUSES } from '@school-sync/shared';
import { useAttendanceRecords } from '@/lib/client/learner-attendance';
import { fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { StatusChip } from '@/components/ui/badge';
import { ErrorState, SkeletonRows } from '../states';
import { useLearner } from '../use-learner';
import { useUrlParams } from '../url-state';
import { STATUS_VIEW } from './status';

const FILTERS = [{ value: 'all', label: 'All statuses' }, ...ATTENDANCE_STATUSES.map((s) => ({ value: s, label: STATUS_VIEW[s].label }))];

/** Day-by-day history, newest first, loaded 30 at a time (keyset pagination). Status filter lives in the URL. */
export function AttendanceRecords() {
  const l = useLearner();
  const { get, set } = useUrlParams();
  const raw = get('rstatus');
  const status = (ATTENDANCE_STATUSES as readonly string[]).includes(raw ?? '') ? (raw as string) : '';
  const q = useAttendanceRecords(l.studentId, status);
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 max-sm:px-4">
        <p className="t-section">Attendance history</p>
        <Select aria-label="Filter by status" className="w-44" value={status || 'all'} onValueChange={(v) => set({ rstatus: v === 'all' ? null : v })} options={FILTERS} />
      </div>
      {q.isPending ? (
        <SkeletonRows rows={6} />
      ) : q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        status ? (
          <EmptyState illustration="no-results" title={`No “${STATUS_VIEW[status as keyof typeof STATUS_VIEW]?.label ?? status}” days`} filters={<Badge variant="outline">{STATUS_VIEW[status as keyof typeof STATUS_VIEW]?.label ?? status}</Badge>} action={<Button variant="secondary" size="sm" onClick={() => set({ rstatus: null })}>Clear filter</Button>} />
        ) : (
          <EmptyState illustration="empty-events" title="No attendance recorded yet" description="Marked days will be listed here, newest first." />
        )
      ) : (
        <>
          <ul className="divide-y divide-border border-t border-border" aria-busy={q.isFetching || undefined}>
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 max-sm:px-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{fmtDate(r.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                  {(r.periodName || r.subjectName || r.remarks) && (
                    <p className="t-caption text-ink-2">
                      {[r.periodName, r.subjectName].filter(Boolean).join(' · ')}
                      {r.remarks ? `${r.periodName || r.subjectName ? ' — ' : ''}${r.remarks}` : ''}
                    </p>
                  )}
                </div>
                {r.correctionPending && <Badge variant="info">Correction requested</Badge>}
                <StatusChip status={r.status} />
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 max-sm:px-4">
            <span className="t-caption tnum text-ink-2">{rows.length.toLocaleString()} days shown</span>
            {q.hasNextPage ? (
              <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                Load more
              </Button>
            ) : (
              <span className="t-caption text-ink-3">That’s the whole record</span>
            )}
          </div>
          {q.isError && q.data && <p className="px-5 pb-3 text-sm text-danger" role="alert">We couldn’t load more. <button type="button" className="underline" onClick={() => void q.fetchNextPage()}>Try again</button></p>}
        </>
      )}
    </Card>
  );
}
