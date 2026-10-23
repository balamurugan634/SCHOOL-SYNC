'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, BarChart3, Bus, ClipboardCheck, GraduationCap, Library, Receipt, UsersRound } from 'lucide-react';
import type { PermissionKey, SiteInfo } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useMgmt } from '../common/use-mgmt';

interface ReportDef {
  id: string;
  title: string;
  description: string;
  /** path below the management base */
  href: string;
  /** any-of: the card is shown when the user holds one of them */
  perms: PermissionKey[];
  /** all-of, for reports that read two resources */
  also?: PermissionKey[];
  feature?: keyof SiteInfo['features'];
  /** the permission that allows CSV export from the report (shows "CSV export" or "View only") */
  exportPerm?: PermissionKey;
}
interface Area {
  id: string;
  title: string;
  blurb: string;
  Icon: React.ComponentType<{ className?: string }>;
  reports: ReportDef[];
}

const AREAS: Area[] = [
  {
    id: 'attendance',
    title: 'Attendance',
    blurb: 'Who is in school, who is missing, and the trend.',
    Icon: ClipboardCheck,
    reports: [
      { id: 'att-report', title: 'Attendance and absenteeism', description: 'By class and period, with the share present and shortage alerts.', href: '/reports/attendance', perms: ['reports:view'], exportPerm: 'attendance:export' },
      { id: 'att-today', title: 'Today’s attendance', description: 'Which classes have marked attendance today, and correction requests.', href: '/attendance', perms: ['attendance:view'], exportPerm: 'attendance:export' },
      { id: 'leave', title: 'Leave requests', description: 'Student leave waiting for a decision, and past decisions.', href: '/leave', perms: ['leave:view'] },
    ],
  },
  {
    id: 'fees',
    title: 'Fees and finance',
    blurb: 'What has been collected, what is owed and what the school spends.',
    Icon: Receipt,
    reports: [
      { id: 'fee-out', title: 'Outstanding and aging', description: 'Unpaid fees in age buckets, by grade or class.', href: '/reports/fees?tab=outstanding', perms: ['fees:view', 'payments:view'], feature: 'fees', exportPerm: 'fees:export' },
      { id: 'fee-def', title: 'Defaulters', description: 'Students with overdue balances, worst first, with the guardian’s phone.', href: '/reports/fees?tab=defaulters', perms: ['fees:view'], feature: 'fees', exportPerm: 'fees:export' },
      { id: 'fee-col', title: 'Collection', description: 'Collected by day or month, by payment method and by fee category.', href: '/reports/fees?tab=collection', perms: ['fees:view', 'payments:view'], feature: 'fees', exportPerm: 'fees:export' },
      { id: 'fin-ov', title: 'Finance overview', description: 'Collection against expenses by month, collection rate and approvals waiting.', href: '/finance', perms: ['fees:view'], also: ['payments:view'], feature: 'fees' },
      { id: 'pay', title: 'Payments and receipts', description: 'Every payment with its receipt; filter by method, status and date.', href: '/finance/payments', perms: ['payments:view'], feature: 'fees', exportPerm: 'payments:export' },
      { id: 'exp', title: 'Expense summary', description: 'Spending by month and category, with the approval queue.', href: '/finance/expenses?tab=summary', perms: ['expenses:view'], feature: 'fees', exportPerm: 'expenses:export' },
    ],
  },
  {
    id: 'exams',
    title: 'Exams and results',
    blurb: 'How classes and subjects are performing.',
    Icon: GraduationCap,
    reports: [
      { id: 'acad', title: 'Academic performance', description: 'Class results and subject comparison.', href: '/reports/academics', perms: ['reports:view'], exportPerm: 'marks:export' },
      { id: 'exams', title: 'Exams and mark sheets', description: 'Schedules, mark-sheet approvals and published results.', href: '/exams', perms: ['exams:view'], exportPerm: 'marks:export' },
      { id: 'rc', title: 'Report cards', description: 'Generate, review and publish report cards.', href: '/report-cards', perms: ['report_cards:view'], exportPerm: 'report_cards:export' },
    ],
  },
  {
    id: 'staff',
    title: 'Staff',
    blurb: 'Staff attendance and leave.',
    Icon: UsersRound,
    reports: [
      { id: 'staff-att', title: 'Staff attendance and leave', description: 'Daily staff attendance, leave requests and balances.', href: '/staff/attendance', perms: ['staff_attendance:view', 'staff_leave:view'], exportPerm: 'staff_attendance:export' },
      { id: 'staff-dir', title: 'Staff directory', description: 'Staff profiles and assignments.', href: '/staff', perms: ['staff:view'], exportPerm: 'staff:export' },
    ],
  },
  {
    id: 'library',
    title: 'Library',
    blurb: 'Loans, overdue books and fines.',
    Icon: Library,
    reports: [
      { id: 'lib-over', title: 'Overdue loans and fines', description: 'Books past their due date, who has them and the fines so far.', href: '/operations/library?tab=overdue', perms: ['library:view'], feature: 'library' },
      { id: 'lib-loans', title: 'Loans', description: 'Books out now, returned loans and per-borrower history.', href: '/operations/library?tab=loans', perms: ['library:view'], feature: 'library' },
    ],
  },
  {
    id: 'transport',
    title: 'Transport',
    blurb: 'Routes, who rides where and the buses’ paperwork.',
    Icon: Bus,
    reports: [
      { id: 'tr-man', title: 'Route manifests', description: 'Every student per stop in driving order, to print or download as CSV.', href: '/operations/transport', perms: ['transport:view'], feature: 'transport' },
      { id: 'tr-ins', title: 'Vehicle insurance', description: 'Buses whose insurance has expired or runs out within 30 days.', href: '/operations/transport?tab=vehicles&alert=1', perms: ['transport:view'], feature: 'transport' },
    ],
  },
];

/** Index of every report the signed-in person can open, grouped by area. Cards a role cannot use are not shown. */
export function ReportsHub() {
  const { base, canAny, can, features } = useMgmt();
  const visible = AREAS.map((a) => ({
    ...a,
    reports: a.reports.filter((r) => (!r.feature || features?.[r.feature]) && canAny(...r.perms) && (r.also ?? []).every((p) => can(p))),
  })).filter((a) => a.reports.length > 0);
  const hidden = AREAS.reduce((n, a) => n + a.reports.length, 0) - visible.reduce((n, a) => n + a.reports.length, 0);

  return (
    <>
      <PageHeader title="Reports" description="Everything you can report on, grouped by area. Open one to see the numbers, filter them and export." />
      {visible.length === 0 ? (
        <Card>
          <EmptyState icon={<BarChart3 />} title="No reports are available to your role" description="Reports follow your permissions. Ask a school administrator if you need access to one." />
        </Card>
      ) : (
        <div className="space-y-10">
          {visible.map((a) => (
            <section key={a.id} aria-labelledby={`rep-${a.id}`}>
              <div className="mb-3 flex items-center gap-2">
                <a.Icon className="size-4 text-ink-2" aria-hidden />
                <h2 id={`rep-${a.id}`} className="t-section">
                  {a.title}
                </h2>
                <p className="t-caption text-ink-3">{a.blurb}</p>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {a.reports.map((r) => (
                  <li key={r.id}>
                    <Card interactive className="h-full">
                      <Link href={`${base}${r.href}`} className="flex h-full flex-col gap-2 rounded-lg p-5 max-sm:p-4">
                        <span className="flex items-start justify-between gap-3">
                          <span className="font-medium">{r.title}</span>
                          <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                        </span>
                        <span className="text-sm text-ink-2">{r.description}</span>
                        {r.exportPerm && (
                          <span className="mt-auto pt-2">
                            {can(r.exportPerm, 'school') ? <Badge variant="success">CSV export available</Badge> : <Badge variant="neutral">View only: export needs extra permission</Badge>}
                          </span>
                        )}
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {hidden > 0 && <p className="t-caption text-ink-3">{hidden} more report{hidden === 1 ? ' is' : 's are'} not shown because your role or this school’s settings do not include {hidden === 1 ? 'it' : 'them'}.</p>}
        </div>
      )}
    </>
  );
}
