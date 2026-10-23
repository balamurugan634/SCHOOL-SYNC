'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Mail, Phone } from 'lucide-react';
import type { StudentDetailOut } from '@school-sync/shared';
import { sectionOutLabel, useSectionDetail, useTeacherScope } from '@/lib/client/teacher';
import { useSectionHomeworkCompletion, useStudent, useStudentAttendanceRecords, useStudentAttendanceSummary, useStudentLeave, useStudentResults } from '@/lib/client/teacher-classes';
import { isOutOfScope } from '@/lib/client/teacher-errors';
import { fmtDate, fmtMonth, percent, plural } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { assetUrl } from '@/lib/assets';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar, ProgressRing } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { useMeContext, usePermissions } from '@/components/me-context';
import { ErrorCard, Meta, OutOfScope } from '../common';

const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : null);

export function StudentProfileScreen({ sectionId, studentId }: { sectionId: string; studentId: string }) {
  const { base } = useMeContext();
  const student = useStudent(studentId);
  const section = useSectionDetail(sectionId);
  const s = student.data;
  const sec = section.data;
  const crumbs = [{ label: 'Home', href: base || '/' }, { label: 'My classes', href: `${base}/classes` }, { label: sec ? sectionOutLabel(sec) : 'Class', href: `${base}/classes/${sectionId}` }, { label: s?.name ?? 'Student' }];

  if (student.isError && isOutOfScope(student.error)) {
    return (
      <>
        <PageHeader title="Student" crumbs={crumbs.slice(0, 3)} />
        <OutOfScope what="This student" backHref={`${base}/classes/${sectionId}`} backLabel="Back to the class" />
      </>
    );
  }
  if (student.isError && !s) {
    return (
      <>
        <PageHeader title="Student" crumbs={crumbs.slice(0, 3)} />
        <ErrorCard error={student.error} onRetry={() => void student.refetch()} title="We couldn’t load this student" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={s?.name ?? 'Student'}
        description={s ? [[s.gradeName, s.sectionName].filter(Boolean).join(' '), s.rollNo ? `Roll ${s.rollNo}` : null, `Admission ${s.admissionNo}`, s.status !== 'active' ? cap(s.status) : null].filter(Boolean).join(' · ') : undefined}
        crumbs={crumbs}
        actions={s && <Avatar name={s.name} src={assetUrl(s.photoUrl)} size="lg" />}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <AttendanceCard studentId={studentId} sectionId={sectionId} />
          <HomeworkCard studentId={studentId} sectionId={sectionId} />
          <ResultsCard studentId={studentId} sectionId={sectionId} />
        </div>
        <div className="space-y-6">
          {student.isPending || !s ? <Card><div className="space-y-3 p-5" aria-busy><Skeleton className="h-5 w-32" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div></Card> : <ContactCard s={s} />}
          {s && <DetailsCard s={s} />}
          <LeaveCard studentId={studentId} />
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── contact ───────────────────────── */

function ContactCard({ s }: { s: StudentDetailOut }) {
  const guardians = [...s.guardians].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const hidden = guardians.length > 0 && guardians.every((g) => !g.phone && !g.email);
  return (
    <Card>
      <CardHeader title="Parents and guardians" description="Contact details for school business, such as a note about a lesson or a missed assignment." />
      <CardBody className="pt-3">
        {guardians.length === 0 ? (
          <p className="text-sm text-ink-2">No guardian is linked to this student yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {guardians.map((g) => (
              <li key={g.guardianId} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-sm font-medium">{g.name}</p>
                  <span className="t-caption text-ink-2">{cap(g.relationship)}</span>
                  {g.isPrimary && <Badge variant="primary">Primary</Badge>}
                  {!g.verified && <Badge variant="warning-outline">Not verified</Badge>}
                </div>
                {(g.phone || g.email) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {g.phone && (
                      <a href={`tel:${g.phone}`} className="inline-flex min-h-8 items-center gap-1.5 text-brand-ink hover:underline">
                        <Phone className="size-3.5" aria-hidden /> {g.phone}
                      </a>
                    )}
                    {g.email && (
                      <a href={`mailto:${g.email}`} className="inline-flex min-h-8 max-w-full items-center gap-1.5 text-brand-ink hover:underline">
                        <Mail className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{g.email}</span>
                      </a>
                    )}
                  </div>
                )}
                {(g.canPickup || g.isEmergencyContact) && (
                  <p className="t-caption text-ink-2">{[g.isEmergencyContact ? 'Emergency contact' : null, g.canPickup ? 'May collect the child' : null].filter(Boolean).join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {hidden && <p className="t-caption mt-3 text-ink-2">Contact details are not shared with your role. Ask the school office if you need to reach a parent.</p>}
        {s.emergencyContacts.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="t-label mb-2">Emergency contacts</h3>
            <ul className="space-y-2">
              {s.emergencyContacts.map((c, i) => (
                <li key={`${c.phone}-${i}`} className="text-sm">
                  <span className="font-medium">{c.name}</span>
                  {c.relationship ? <span className="text-ink-2"> · {c.relationship}</span> : null}
                  <a href={`tel:${c.phone}`} className="ml-2 inline-flex items-center gap-1 text-brand-ink hover:underline">
                    <Phone className="size-3.5" aria-hidden /> {c.phone}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DetailsCard({ s }: { s: StudentDetailOut }) {
  const addr = s.address ? [s.address.line1, s.address.line2, s.address.city, s.address.state, s.address.postalCode].filter(Boolean).join(', ') : null;
  return (
    <Card>
      <CardHeader title="About" />
      <CardBody className="pt-3">
        <Meta
          cols={1}
          items={[
            { label: 'Date of birth', value: s.dob ? fmtDate(s.dob) : null },
            { label: 'Gender', value: cap(s.gender) },
            { label: 'Blood group', value: s.bloodGroup, hidden: !s.bloodGroup },
            { label: 'Address', value: addr, hidden: !addr },
            { label: 'Admitted', value: s.admissionDate ? fmtDate(s.admissionDate) : null, hidden: !s.admissionDate },
          ]}
        />
        {s.medicalNotes && (
          <Banner tone="warning" className="mt-4" title="Medical notes">
            {s.medicalNotes}
            <span className="t-caption mt-1 block">Shown because of your role. Please handle with care.</span>
          </Banner>
        )}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── attendance ───────────────────────── */

function AttendanceCard({ studentId, sectionId }: { studentId: string; sectionId: string }) {
  const { base } = useMeContext();
  const { can } = usePermissions();
  const sum = useStudentAttendanceSummary(studentId);
  const recs = useStudentAttendanceRecords(studentId);
  const d = sum.data;
  const records = recs.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <Card>
      <CardHeader title="Attendance" description={d ? `${fmtDate(d.from)} to ${fmtDate(d.to)}` : undefined} />
      <CardBody className="space-y-5 pt-4">
        {sum.isError && !d ? (
          <ErrorCard error={sum.error} onRetry={() => void sum.refetch()} title="We couldn’t load attendance" />
        ) : sum.isPending || !d ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            {d.shortage.isShort && (
              <Banner tone="warning" title="Attendance is below the school’s minimum">
                {percent(d.totals.percentage)} against a minimum of {percent(d.shortage.thresholdPercent, 0)}. Consider talking to the family.
              </Banner>
            )}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <ProgressRing value={(d.totals.percentage ?? 0) / 100} tone={d.shortage.isShort ? 'warning' : 'brand'} label="Attendance percentage">
                <span className="figure text-lg leading-6">{d.totals.percentage === null ? '—' : `${Math.round(d.totals.percentage)}%`}</span>
              </ProgressRing>
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
                {(['present', 'absent', 'late', 'half_day', 'leave'] as const).map((k) => (
                  <div key={k}>
                    <dt>
                      <StatusChip status={k} />
                    </dt>
                    <dd className="figure mt-1 text-xl leading-7">{d.totals[k]}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {d.months.length > 0 && (
              <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2" aria-label="Attendance by month">
                {d.months.map((m) => (
                  <li key={m.month}>
                    <div className="t-caption mb-1 flex justify-between text-ink-2">
                      <span>{fmtMonth(m.month)}</span>
                      <span className="tnum">{percent(m.percentage)}</span>
                    </div>
                    <ProgressBar value={m.percentage ?? 0} max={100} label={`${fmtMonth(m.month)} attendance`} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div>
          <h3 className="t-label mb-2">Recent days</h3>
          {recs.isPending ? (
            <Skeleton className="h-28 w-full" />
          ) : recs.isError ? (
            <ErrorCard error={recs.error} onRetry={() => void recs.refetch()} />
          ) : records.length === 0 ? (
            <p className="text-sm text-ink-2">No attendance has been recorded yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-md border border-border">
                {records.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="tnum w-28 shrink-0 text-[13px]">{fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <StatusChip status={r.status} />
                    {r.correctionPending && <Badge variant="warning-outline">Correction pending</Badge>}
                    <span className="t-caption min-w-0 flex-1 truncate text-ink-2">{[r.periodName, r.subjectName, r.remarks].filter(Boolean).join(' · ')}</span>
                    {can('attendance:create') && (
                      <Link href={`${base}/attendance/history?section=${sectionId}&date=${r.date}`} className="t-caption text-brand-ink underline-offset-4 hover:underline">
                        Open day
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              {recs.hasNextPage && (
                <Button variant="secondary" size="sm" className="mt-3" loading={recs.isFetchingNextPage} onClick={() => void recs.fetchNextPage()}>
                  Show earlier days
                </Button>
              )}
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── homework ───────────────────────── */

function HomeworkCard({ studentId, sectionId }: { studentId: string; sectionId: string }) {
  const hw = useSectionHomeworkCompletion(sectionId);
  const c = hw.data?.byStudent.get(studentId);
  const total = hw.data?.total ?? 0;
  const done = Math.min(c?.submitted ?? 0, total);
  return (
    <Card>
      <CardHeader title="Homework" description="Hand-ins for the homework in this class that takes online submissions." />
      <CardBody className="pt-4">
        {hw.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : hw.isError ? (
          <ErrorCard error={hw.error} onRetry={() => void hw.refetch()} />
        ) : total === 0 ? (
          <p className="text-sm text-ink-2">No homework in this class takes online hand-ins yet.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <p className="text-sm">
                  <span className="figure text-2xl">{done}</span> of {total} handed in
                </p>
                <span className="tnum text-sm text-ink-2">{percent((done / total) * 100, 0)}</span>
              </div>
              <ProgressBar value={done} max={total} tone={done / total < 0.5 ? 'warning' : 'brand'} label="Homework handed in" />
            </div>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ['Not handed in', total - done],
                ['Handed in late', c?.late ?? 0],
                ['Reviewed', c?.reviewed ?? 0],
                ['Returned for rework', c?.returned ?? 0],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="t-caption text-ink-2">{k}</dt>
                  <dd className="figure text-xl leading-7">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── results ───────────────────────── */

function ResultsCard({ studentId, sectionId }: { studentId: string; sectionId: string }) {
  const scope = useTeacherScope();
  const lead = scope.isLead(sectionId);
  // published results are the class teacher's to read; other teachers get the explanation without a failing request
  const res = useStudentResults(studentId, lead);
  if (!lead || (res.isError && isOutOfScope(res.error))) {
    return (
      <Card>
        <CardHeader title="Results" />
        <CardBody className="pt-3">
          <p className="text-sm text-ink-2">Published results are shown to this student’s class teacher.</p>
        </CardBody>
      </Card>
    );
  }
  const list = res.data ?? [];
  return (
    <Card>
      <CardHeader title="Results" description="Published exam results" />
      <CardBody className="pt-3">
        {res.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : res.isError ? (
          <ErrorCard error={res.error} onRetry={() => void res.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState compact illustration="empty-generic" title="No results published yet" />
        ) : (
          <ul className="space-y-5">
            {list.map((r) => (
              <li key={r.examId}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">{r.examName}</h3>
                  <p className="t-caption text-ink-2">
                    {percent(r.percent)}
                    {r.grade ? ` · Grade ${r.grade}` : ''}
                    {r.rank ? ` · Rank ${r.rank} of ${r.classSize}` : ''}
                    {r.result ? ` · ${r.result === 'pass' ? 'Pass' : 'Fail'}` : ''}
                  </p>
                </div>
                {!r.complete && <p className="t-caption mt-0.5 text-ink-2">Provisional: {r.subjectsPublished} of {r.subjectsExpected} subjects published.</p>}
                <div className="mt-2 overflow-x-auto rounded-md border border-border">
                  <table className="t-table w-full">
                    <thead>
                      <tr className="bg-surface-subtle">
                        <th scope="col" className="t-colhead h-8 px-3 text-left text-ink-2">Subject</th>
                        <th scope="col" className="t-colhead h-8 px-3 text-right text-ink-2">Marks</th>
                        <th scope="col" className="t-colhead h-8 px-3 text-right text-ink-2">%</th>
                        <th scope="col" className="t-colhead h-8 px-3 text-right text-ink-2">Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.subjects.map((sub) => (
                        <tr key={sub.subjectId} className="border-t border-border">
                          <td className="h-9 px-3">{sub.subjectName}</td>
                          <td className="h-9 px-3 text-right tabular-nums">{sub.isAbsent ? 'Absent' : sub.marksObtained === null ? '—' : `${sub.marksObtained} / ${sub.maxMarks}`}</td>
                          <td className="h-9 px-3 text-right tabular-nums">{percent(sub.percent)}</td>
                          <td className="h-9 px-3 text-right">{sub.grade ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── leave ───────────────────────── */

function LeaveCard({ studentId }: { studentId: string }) {
  const { base } = useMeContext();
  const leave = useStudentLeave(studentId);
  const list = leave.data ?? [];
  return (
    <Card>
      <CardHeader title="Leave" description="Recent requests" action={<Button asChild variant="ghost" size="sm"><Link href={`${base}/attendance/leave`}>All leave</Link></Button>} />
      <CardBody className="pt-3">
        {leave.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : leave.isError ? (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <AlertTriangle className="size-4 text-warning" aria-hidden /> Leave isn’t available for this student.
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-ink-2">No leave requests.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.slice(0, 5).map((l) => (
              <li key={l.id} className="space-y-0.5 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">
                    {fmtDate(l.fromDate, { day: 'numeric', month: 'short' })}
                    {l.toDate !== l.fromDate ? ` to ${fmtDate(l.toDate, { day: 'numeric', month: 'short' })}` : ''} · {plural(l.days, 'day')}
                  </p>
                  <StatusChip status={l.status} />
                </div>
                <p className="t-caption line-clamp-2 text-ink-2">{l.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
