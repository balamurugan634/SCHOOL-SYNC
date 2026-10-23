'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, TriangleAlert, XCircle } from 'lucide-react';
import type { PromotionPreviewOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatTile } from '@/components/ui/stat-tile';
import { plural } from '@/lib/format';
import { paths } from '../shared/paths';

/** What the dry run found: totals, grade and section tables, problems (block applying), warnings and the seat check. */
export function PromotionReview({ preview }: { preview: PromotionPreviewOut }) {
  const t = preview.totals;
  const noSections = preview.problems.some((p) => p.code === 'NO_TARGET_SECTION');
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Students to move" value={t.eligible} hint={`${preview.fromYear.name} → ${preview.toYear.name}`} />
        <StatTile label="Promoted" value={t.promote} hint="Move up a grade" />
        <StatTile label="Stay in grade" value={t.retain} hint="Repeat the year" />
        <StatTile label="Leaving or graduating" value={t.leave + t.graduate} hint={`${t.graduate} graduate · ${t.leave} leave`} />
      </div>

      {preview.problems.length > 0 && (
        <Banner tone="danger" title={`${plural(preview.problems.length, 'problem')} to fix before you can apply`} role="alert">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {preview.problems.map((p, i) => (
              <li key={`${p.code}-${i}`}>{p.message}</li>
            ))}
          </ul>
          {noSections && (
            <Button asChild size="sm" variant="secondary" className="mt-3">
              <Link href={paths.years}>Open academic years to copy sections</Link>
            </Button>
          )}
        </Banner>
      )}
      {preview.warnings.length > 0 && (
        <Banner tone="warning" title={`${plural(preview.warnings.length, 'warning')} to be aware of`}>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {preview.warnings.slice(0, 8).map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
          {preview.warnings.length > 8 && <p className="mt-1">And {preview.warnings.length - 8} more of the same kind.</p>}
        </Banner>
      )}
      {preview.seat.ok ? (
        <Banner tone="success" title="Subscription seats are available">
          The {plural(t.newSeats, 'new enrolment')} in {preview.toYear.name} fit within the seats the school has licensed for that year.
        </Banner>
      ) : (
        <Banner tone="danger" title="Not enough subscription seats" role="alert" action={<Button asChild size="sm" variant="secondary"><Link href={paths.license}>View subscription</Link></Button>}>
          {preview.seat.message ?? 'The subscription for the new year does not cover these students.'} Each promoted or retained student takes one seat for {preview.toYear.name}.
        </Banner>
      )}
      {t.alreadyEnrolled > 0 && <Banner tone="info">{plural(t.alreadyEnrolled, 'student')} already have an enrolment in {preview.toYear.name} and are skipped.</Banner>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="By grade" description="Where each grade’s students go" />
          <CardBody className="pt-4">
            <DataTable
              id="promotion-by-grade"
              caption="Promotion by grade"
              compact
              rows={preview.byGrade}
              rowKey={(g) => g.fromGradeId}
              columns={[
                { id: 'from', header: 'From', hideable: false, cell: (g) => <span className="font-medium">{g.fromGradeName}</span>, mobile: 'title' },
                { id: 'to', header: 'To', cell: (g) => g.toGradeName ?? <Badge variant="accent">Graduates</Badge>, mobile: 'sub' },
                { id: 'n', header: 'Students', align: 'right', cell: (g) => g.students, mobile: 'value' },
                { id: 'promote', header: 'Promote', align: 'right', cell: (g) => g.promote, mobile: 'detail', label: 'Promoted' },
                { id: 'retain', header: 'Stay', align: 'right', cell: (g) => g.retain, mobile: 'detail', label: 'Stay in grade' },
                { id: 'leave', header: 'Leave', align: 'right', cell: (g) => g.leave, mobile: 'detail', label: 'Leave' },
                { id: 'grad', header: 'Graduate', align: 'right', cell: (g) => g.graduate, mobile: 'detail', label: 'Graduate' },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By new section" description={`Seats in ${preview.toYear.name}`} />
          <CardBody className="pt-4">
            <DataTable
              id="promotion-by-section"
              caption="Incoming students by section"
              compact
              rows={preview.bySection}
              rowKey={(s) => s.sectionId}
              empty={<p className="px-4 py-6 text-center text-sm text-ink-2">No student is placed in a section yet.</p>}
              columns={[
                { id: 'sec', header: 'Section', hideable: false, cell: (s) => <span className="font-medium">{s.gradeName} {s.name}</span>, mobile: 'title' },
                { id: 'in', header: 'Incoming', align: 'right', cell: (s) => s.incoming, mobile: 'value' },
                { id: 'ex', header: 'Already there', align: 'right', cell: (s) => s.existing, mobile: 'detail', label: 'Already there' },
                { id: 'cap', header: 'Capacity', align: 'right', cell: (s) => s.capacity ?? '—', mobile: 'detail', label: 'Capacity' },
                {
                  id: 'status',
                  header: 'Seats',
                  mobile: 'status',
                  cell: (s) =>
                    s.overCapacity ? (
                      <Badge variant="danger" icon={<XCircle aria-hidden />}>Over capacity</Badge>
                    ) : s.capacity == null ? (
                      <Badge variant="neutral">No limit</Badge>
                    ) : (
                      <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Fits</Badge>
                    ),
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>
      {preview.canApply ? (
        <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden /> Nothing blocks this promotion. You can continue to the confirmation.</p>
      ) : t.eligible === 0 && preview.problems.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-2"><TriangleAlert className="size-4" aria-hidden /> There is nobody left to move from {preview.fromYear.name}. They may already have been promoted.</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-danger"><TriangleAlert className="size-4" aria-hidden /> This promotion cannot be applied yet. Fix what is listed above, go back to change the settings, then refresh the preview.</p>
      )}
    </div>
  );
}
