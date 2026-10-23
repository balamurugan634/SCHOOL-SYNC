'use client';

import { useAllSections } from '@/lib/client/academics';
import * as React from 'react';
import { CalendarClock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { sectionOptions, staffOptions, useStaffPicker } from '@/lib/client/options';
import { useDeleteSubstitution, useSubstitutions } from '@/lib/client/timetable';
import { useUrlState } from '@/lib/client/url-state';
import { fmtClock, fmtDate, todayIso } from '@/lib/format';
import type { TimetableSubstitutionItem } from '@school-sync/shared';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterSelect } from '../shared/controls';
import { SubstitutionDialog } from './substitution-dialog';
import { shiftDays } from './timetable-helpers';

export function CoversPanel() {
  const access = useAccess();
  const today = todayIso();
  const [p, set, reset] = useUrlState({ from: today, to: shiftDays(today, 14), csec: '', cstaff: '', cpage: 1, csize: 25 });
  const q = useSubstitutions({ from: p.from, to: p.to, sectionId: p.csec || undefined, staffId: p.cstaff || undefined, page: p.cpage, pageSize: p.csize });
  const sections = useAllSections();
  const staff = useStaffPicker();
  const del = useDeleteSubstitution();
  const [creating, setCreating] = React.useState(false);
  const [removing, setRemoving] = React.useState<TimetableSubstitutionItem | null>(null);
  const canEdit = access.ok('timetable:edit');
  const filtered = !!(p.csec || p.cstaff || p.from !== today || p.to !== shiftDays(today, 14));

  return (
    <div className="space-y-4">
      <DataTable
        id="timetable-covers"
        caption="Arranged covers"
        rows={q.data?.data}
        rowKey={(s) => s.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        page={p.cpage}
        pageSize={p.csize}
        total={q.data?.meta.total}
        onPageChange={(cpage) => set({ cpage })}
        onPageSizeChange={(csize) => set({ csize, cpage: 1 })}
        filters={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-caption text-ink-2" id="cv-from">From</span>
              <DatePicker value={p.from} onChange={(v) => set({ from: v })} className="w-40" />
              <span className="t-caption text-ink-2" id="cv-to">to</span>
              <DatePicker value={p.to} onChange={(v) => set({ to: v })} min={p.from} className="w-40" />
            </div>
            <FilterSelect label="Class" value={p.csec} onChange={(v) => set({ csec: v })} options={sectionOptions(sections.data)} allLabel="All classes" />
            <FilterSelect label="Teacher" value={p.cstaff} onChange={(v) => set({ cstaff: v })} options={staffOptions(staff.data)} allLabel="Any teacher" />
            {filtered && <ClearFiltersButton onClick={() => reset(['from', 'to', 'csec', 'cstaff', 'cpage'])} />}
          </>
        }
        toolbar={
          <Button onClick={() => setCreating(true)} disabled={!canEdit} title={access.hint('timetable:edit')}>
            <CalendarClock /> Arrange cover
          </Button>
        }
        columns={[
          { id: 'date', header: 'Date', hideable: false, cell: (s) => <span className="font-medium">{fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>, sortable: true, sortValue: (s) => s.date, mobile: 'title' },
          { id: 'class', header: 'Class', cell: (s) => s.sectionName, mobile: 'sub' },
          { id: 'period', header: 'Period', cell: (s) => `${s.periodName} · ${fmtClock(s.startTime)}`, mobile: 'detail', label: 'Period' },
          { id: 'subject', header: 'Subject', cell: (s) => s.subjectName ?? '—', mobile: 'detail', label: 'Subject' },
          { id: 'cover', header: 'Cover', cell: (s) => <span><span className="font-medium">{s.substituteTeacherName}</span> <span className="text-ink-2">for {s.originalTeacherName ?? 'the class'}</span></span>, mobile: 'status' },
          { id: 'reason', header: 'Reason', cell: (s) => s.reason ?? <span className="text-ink-3">—</span>, defaultHidden: false, mobile: 'hide' },
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (s) => (
              <IconButton label={`Cancel cover on ${fmtDate(s.date)} for ${s.sectionName}`} size="icon-sm" variant="ghost" disabled={!canEdit} onClick={() => setRemoving(s)}>
                <Trash2 />
              </IconButton>
            ),
          },
        ]}
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No covers in this range" description="Widen the dates or clear the filters." action={<ClearFiltersButton onClick={() => reset(['from', 'to', 'csec', 'cstaff', 'cpage'])} />} compact />
          ) : (
            <EmptyState illustration="empty-events" title="No covers arranged for the next two weeks" description="When a teacher is away, arrange a one-day cover for a lesson. The substitute and the covered teacher are notified." compact action={canEdit ? <Button size="sm" onClick={() => setCreating(true)}>Arrange cover</Button> : undefined} />
          )
        }
      />
      {creating && <SubstitutionDialog onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Cancel this cover?"
        description={removing && `${removing.substituteTeacherName} will no longer cover ${removing.subjectName ?? 'the lesson'} for ${removing.sectionName} on ${fmtDate(removing.date, { weekday: 'long', day: 'numeric', month: 'long' })}. The lesson goes back to ${removing.originalTeacherName ?? 'its usual teacher'}.`}
        confirmLabel="Cancel cover"
        cancelLabel="Keep cover"
        destructive
        loading={del.isPending}
        onConfirm={async () => {
          if (!removing) return;
          const r = await del.run(removing.id);
          if (r.ok) setRemoving(null);
        }}
      />
    </div>
  );
}
