'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRightLeft, ChevronDown, Pencil } from 'lucide-react';
import type { StudentDetailOut, StudentStatus } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { useSite } from '@/components/site-context';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { assetUrl } from '@/lib/assets';
import { useStudent } from '@/lib/client/people';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate } from '@/lib/format';
import { useAccess } from '../shared/access';
import { DefList, ErrorPanel, Panel } from '../shared/detail';
import { paths } from '../shared/paths';
import { Restricted } from './fields';
import { FormDrawer } from './form-drawer';
import { MoveSectionDialog, StatusDialog } from './student-dialogs';
import { StudentDocuments } from './student-documents';
import { StudentEditForm } from './student-edit';
import { StudentGuardians } from './student-guardians';
import { StudentAttendanceTab, StudentFeesTab, StudentResultsTab } from './student-summaries';
import { StudentStatusChip, titleCase } from './ui';

const ARCHIVED: StudentStatus[] = ['transferred', 'withdrawn', 'alumni'];

export function StudentDetail({ id }: { id: string }) {
  const q = useStudent(id);
  const acc = useAccess();
  const site = useSite();
  const [{ tab }, set] = useUrlState({ tab: 'overview' });
  const [editing, setEditing] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const [target, setTarget] = React.useState<StudentStatus | null>(null);

  if (q.isPending) return <DetailSkeleton />;
  if (q.isError) return (
    <>
      <PageHeader title="Student" crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Students', href: paths.students() }, { label: 'Student' }]} />
      <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this student" />
    </>
  );
  const s = q.data;
  const archived = ARCHIVED.includes(s.status);
  const tabs = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'guardians', label: `Parents${s.guardians.length ? ` (${s.guardians.length})` : ''}`, show: true },
    { id: 'documents', label: 'Documents', show: acc.can('student_documents:view') },
    { id: 'attendance', label: 'Attendance', show: acc.can('attendance:view') },
    { id: 'results', label: 'Results', show: acc.can('marks:view') || acc.can('exams:view') },
    { id: 'fees', label: 'Fees', show: !!site?.features.fees && acc.can('fees:view') },
  ].filter((t) => t.show);
  const current = tabs.some((t) => t.id === tab) ? tab : 'overview';
  const canEdit = acc.ok('students:edit');
  const canArchive = acc.ok('students:delete', 'school');
  const hint = acc.hint('students:edit');

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Students', href: paths.students() }, { label: s.name }]}
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Avatar name={s.name} src={assetUrl(s.photoUrl)} size="sm" />
            <span>{s.admissionNo}</span>
            <span aria-hidden>·</span>
            <span>{s.gradeName ? `${s.gradeName} ${s.sectionName ?? ''}`.trim() : 'Not placed in a class'}</span>
            <StudentStatusChip status={s.status} />
          </span>
        }
        actions={
          (acc.can('students:edit') || acc.can('students:delete', 'school')) && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={!canEdit} title={hint}>
                <Pencil /> Edit details
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary">
                    Actions <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {!archived && (
                    <DropdownMenuItem disabled={!canEdit} onSelect={() => setMoving(true)}>
                      <ArrowRightLeft /> Move to another section
                    </DropdownMenuItem>
                  )}
                  {s.status === 'active' && (
                    <DropdownMenuItem disabled={!canEdit} onSelect={() => setTarget('suspended')}>
                      Suspend
                    </DropdownMenuItem>
                  )}
                  {(s.status === 'suspended' || archived) && (
                    <DropdownMenuItem disabled={!canEdit} onSelect={() => setTarget('active')}>
                      Reinstate
                    </DropdownMenuItem>
                  )}
                  {!archived && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem danger disabled={!canArchive} onSelect={() => setTarget('transferred')}>
                        Record as transferred
                      </DropdownMenuItem>
                      <DropdownMenuItem danger disabled={!canArchive} onSelect={() => setTarget('withdrawn')}>
                        Withdraw
                      </DropdownMenuItem>
                      <DropdownMenuItem danger disabled={!canArchive} onSelect={() => setTarget('alumni')}>
                        Mark as alumni
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
      />

      <Tabs value={current} onValueChange={(v) => set({ tab: v })}>
        <TabsList aria-label="Student sections">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">{current === 'overview' && <Overview s={s} />}</TabsContent>
        <TabsContent value="guardians">{current === 'guardians' && <StudentGuardians student={s} />}</TabsContent>
        <TabsContent value="documents">{current === 'documents' && <StudentDocuments student={s} />}</TabsContent>
        <TabsContent value="attendance">{current === 'attendance' && <StudentAttendanceTab student={s} />}</TabsContent>
        <TabsContent value="results">{current === 'results' && <StudentResultsTab student={s} />}</TabsContent>
        <TabsContent value="fees">{current === 'fees' && <StudentFeesTab student={s} />}</TabsContent>
      </Tabs>

      {editing && (
        <FormDrawer open onOpenChange={setEditing} title="Edit student details" description={`${s.name} · ${s.admissionNo}`}>
          <StudentEditForm student={s} onSaved={() => setEditing(false)} />
        </FormDrawer>
      )}
      <MoveSectionDialog student={s} open={moving} onClose={() => setMoving(false)} />
      <StatusDialog student={s} target={target} onClose={() => setTarget(null)} />
    </>
  );
}

function Overview({ s }: { s: StudentDetailOut }) {
  const addr = s.address ? [s.address.line1, s.address.line2, s.address.city, s.address.state, s.address.postalCode, s.address.country].filter(Boolean).join(', ') : '';
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-6">
        <Panel title="Details">
          <DefList
            cols={2}
            items={[
              { label: 'Admission no.', value: s.admissionNo },
              { label: 'Class', value: s.gradeName ? `${s.gradeName} ${s.sectionName ?? ''}`.trim() : null },
              { label: 'Roll number', value: s.rollNo },
              { label: 'Date of birth', value: s.dob ? fmtDate(s.dob) : null },
              { label: 'Gender', value: s.gender ? titleCase(s.gender) : null },
              { label: 'Admitted', value: s.admissionDate ? fmtDate(s.admissionDate) : null },
              { label: 'Blood group', value: s.bloodGroup },
              { label: 'Nationality', value: s.nationality },
              { label: 'Religion', value: s.religion },
              { label: 'Category', value: s.category },
              { label: 'Address', value: addr },
              { label: 'Medical notes', value: s.medicalNotes === null ? <Restricted what="Medical notes" /> : s.medicalNotes },
            ]}
          />
        </Panel>
        <Panel title="Enrolment history" description="One row per academic year, newest first.">
          {s.enrollments.length === 0 ? (
            <p className="text-sm text-ink-2">No enrolments recorded.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto sm:mx-0 sm:rounded-md sm:border sm:border-border">
              <Table>
                <THead>
                  <tr>
                    <TH>Year</TH>
                    <TH>Class</TH>
                    <TH align="right">Roll</TH>
                    <TH>Outcome</TH>
                    <TH>From</TH>
                    <TH>To</TH>
                  </tr>
                </THead>
                <TBody>
                  {[...s.enrollments].sort((a, b) => b.academicYearName.localeCompare(a.academicYearName)).map((e) => (
                    <TR key={e.id}>
                      <TD>{e.academicYearName}</TD>
                      <TD>{e.gradeName} {e.sectionName}</TD>
                      <TD align="right">{e.rollNo ?? '—'}</TD>
                      <TD><Badge variant={e.status === 'enrolled' ? 'success' : 'neutral'}>{titleCase(e.status)}</Badge></TD>
                      <TD>{fmtDate(e.startedAt)}</TD>
                      <TD>{fmtDate(e.endedAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel title="Emergency contacts">
          {s.emergencyContacts.length === 0 ? (
            <p className="text-sm text-ink-2">None recorded.</p>
          ) : (
            <ul className="space-y-3">
              {s.emergencyContacts.map((c, i) => (
                <li key={`${c.phone}-${i}`} className="text-sm">
                  <span className="font-medium">{c.name}</span>
                  {c.relationship && <span className="text-ink-2"> · {c.relationship}</span>}
                  <span className="t-caption block text-ink-2">{[c.phone, c.altPhone].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Authorised pickups">
          {s.authorizedPickups.length === 0 ? (
            <p className="text-sm text-ink-2">No extra pickup persons.</p>
          ) : (
            <ul className="space-y-3">
              {s.authorizedPickups.map((c, i) => (
                <li key={`${c.phone}-${i}`} className="text-sm">
                  <span className="font-medium">{c.name}</span>
                  {c.relationship && <span className="text-ink-2"> · {c.relationship}</span>}
                  {c.active === false && <Badge variant="neutral" className="ml-2">Inactive</Badge>}
                  <span className="t-caption block text-ink-2">{c.phone}{c.idProof ? ` · ID ${c.idProof}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Sign-in">
          <DefList items={[{ label: 'Username', value: s.username ? <span className="font-mono text-[13px]">{s.username}</span> : null }]} />
          <p className="t-caption mt-3 text-ink-2">
            Passwords are never shown again after the first time. To help someone who is locked out, use <Link href={paths.users} className="text-brand-ink hover:underline">Settings → Users</Link>.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy>
      <div className="mb-8 flex items-center gap-3">
        <Skeleton className="size-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <Skeleton className="mb-5 h-10 w-full" />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-80 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}
