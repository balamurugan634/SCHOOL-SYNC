'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useSite } from '@/components/site-context';
import { useStudentAttendance, useStudentInvoices, useStudentResults } from '@/lib/client/people';
import { fmtDate, fmtMonth, fmtMonthShort, money, percent } from '@/lib/format';
import { ApiError } from '@/lib/problem';
import type { StudentDetailOut } from '@school-sync/shared';
import { BarSeries } from '@/components/charts/series-charts';
import { paths } from '../shared/paths';
import { ErrorPanel } from '../shared/detail';

function Denied({ what }: { what: string }) {
  return (
    <Card>
      <EmptyState compact title={`${what} are not available for your role`} description="Your role does not include this information. Ask a school administrator if you need it." />
    </Card>
  );
}

const denied = (e: unknown) => e instanceof ApiError && e.status === 403;

export function StudentAttendanceTab({ student }: { student: StudentDetailOut }) {
  const q = useStudentAttendance(student.id);
  if (q.isPending) return <TilesSkeleton />;
  if (q.isError) return denied(q.error) ? <Denied what="Attendance records" /> : <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load attendance" />;
  const d = q.data;
  const t = d.totals;
  const months = d.months.map((m) => ({ month: fmtMonthShort(m.month), percentage: m.percentage ?? 0, present: m.present, absent: m.absent, late: m.late, leave: m.leave, total: m.total, label: fmtMonth(m.month) }));
  return (
    <div className="space-y-4">
      {d.shortage.isShort && (
        <Banner tone="warning" title="Attendance is below the school’s minimum">
          {student.firstName} is at {percent(t.percentage)}; the minimum is {d.shortage.thresholdPercent}%. Parents are alerted by the monthly shortage scan.
        </Banner>
      )}
      <p className="t-caption text-ink-2">
        {fmtDate(d.from)} to {fmtDate(d.to)} · {t.total} recorded {t.total === 1 ? 'day' : 'days'}
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Attendance" value={percent(t.percentage)} hint={t.percentage === null ? 'Nothing recorded yet' : undefined} />
        <StatTile label="Present" value={t.present} />
        <StatTile label="Absent" value={t.absent} />
        <StatTile label="Late" value={t.late} />
        <StatTile label="On leave" value={t.leave} />
      </div>
      <ChartCard
        title="Attendance by month"
        description="Share of recorded days present or late"
        height={220}
        empty={months.length === 0}
        emptyText="No attendance has been recorded for this student yet."
        summary={months.length ? `Attendance was ${months.map((m) => `${m.label} ${percent(m.percentage)}`).join(', ')}.` : undefined}
        table={{ columns: [{ key: 'label', label: 'Month' }, { key: 'percentage', label: '% present', align: 'right', format: (v) => percent(v as number) }, { key: 'present', label: 'Present', align: 'right' }, { key: 'absent', label: 'Absent', align: 'right' }, { key: 'late', label: 'Late', align: 'right' }, { key: 'leave', label: 'Leave', align: 'right' }], rows: months }}
      >
        <BarSeries data={months} xKey="month" yKey="percentage" label="Present" height={220} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} tooltipLabel={(m) => months.find((x) => x.month === m)?.label ?? String(m)} />
      </ChartCard>
      {student.sectionId && (
        <Button variant="secondary" asChild>
          <Link href={paths.attendanceClass(student.sectionId)}>Open {student.gradeName} {student.sectionName} attendance</Link>
        </Button>
      )}
    </div>
  );
}

export function StudentResultsTab({ student }: { student: StudentDetailOut }) {
  const q = useStudentResults(student.id);
  if (q.isPending) return <TilesSkeleton />;
  if (q.isError) return denied(q.error) ? <Denied what="Results" /> : <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load results" />;
  if (q.data.length === 0)
    return (
      <Card>
        <EmptyState illustration="empty-generic" title="No published results yet" description="Results appear here once an exam’s marks have been approved and published." />
      </Card>
    );
  return (
    <Card>
      <CardHeader title="Published results" description="Only exams whose marks have been published are shown." />
      <Accordion type="single" collapsible className="mt-3 border-t border-border">
        {q.data.map((r) => (
          <AccordionItem key={r.examId} value={r.examId}>
            <AccordionTrigger>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.examName}</span>
                <span className="t-caption block text-ink-2">{r.termName ?? 'No term'} · {fmtDate(r.startDate)}</span>
              </span>
              <span className="mr-2 flex shrink-0 items-center gap-2">
                <span className="figure text-lg">{percent(r.percent)}</span>
                {r.grade && <Badge variant="primary">{r.grade}</Badge>}
                {r.result && <Badge variant={r.result === 'pass' ? 'success' : 'danger'}>{r.result === 'pass' ? 'Pass' : 'Fail'}</Badge>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {!r.complete && <p className="t-caption mb-2 text-ink-2">Provisional: {r.subjectsPublished} of {r.subjectsExpected} subjects are published so far.</p>}
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <THead>
                    <tr>
                      <TH>Subject</TH>
                      <TH align="right">Marks</TH>
                      <TH align="right">Percent</TH>
                      <TH>Grade</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {r.subjects.map((s) => (
                      <TR key={s.sheetId}>
                        <TD>{s.subjectName}</TD>
                        <TD align="right">{s.isAbsent ? 'Absent' : `${s.marksObtained ?? '—'} / ${s.maxMarks}`}</TD>
                        <TD align="right">{percent(s.percent)}</TD>
                        <TD>{s.grade ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
              <p className="t-caption mt-2 text-ink-2">
                Total {r.totalMarks} / {r.maxTotal}
                {r.rank ? ` · rank ${r.rank} of ${r.classSize}` : ''}
              </p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Card>
  );
}

export function StudentFeesTab({ student }: { student: StudentDetailOut }) {
  const site = useSite();
  const q = useStudentInvoices(student.id);
  const cur = site?.currency ?? 'INR';
  if (q.isPending) return <TilesSkeleton />;
  if (q.isError) return denied(q.error) ? <Denied what="Fee records" /> : <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load fees" />;
  const rows = q.data;
  const open = rows.filter((r) => r.status !== 'void');
  const balance = open.reduce((s, r) => s + r.balanceMinor, 0);
  const overdue = open.filter((r) => r.overdue).reduce((s, r) => s + r.balanceMinor, 0);
  if (rows.length === 0)
    return (
      <Card>
        <EmptyState illustration="empty-generic" title="No invoices for this student" description="Invoices appear after a fee plan is assigned and dues are generated." />
      </Card>
    );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="Outstanding" value={money(balance, cur)} hint={`${open.filter((r) => r.balanceMinor > 0).length} open invoices`} />
        <StatTile label="Overdue" value={money(overdue, cur)} />
        <StatTile label="Invoices" value={rows.length} />
      </div>
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <TH>Invoice</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
                  <TH align="right">Total</TH>
                  <TH align="right">Paid</TH>
                  <TH align="right">Balance</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <span className="block text-sm font-medium">{r.invoiceNo}</span>
                      <span className="t-caption block max-w-[28ch] truncate text-ink-2">{r.title}</span>
                    </TD>
                    <TD>{fmtDate(r.dueDate)}</TD>
                    <TD><StatusChip status={r.overdue ? 'overdue' : r.status} /></TD>
                    <TD align="right">{money(r.totalMinor - r.discountMinor, cur)}</TD>
                    <TD align="right">{money(r.paidMinor, cur)}</TD>
                    <TD align="right">{money(r.balanceMinor, cur)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function TilesSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <StatTile key={i} label="Loading" state="loading" />
        ))}
      </div>
      <Skeleton className="h-56 w-full rounded-lg" />
    </div>
  );
}

