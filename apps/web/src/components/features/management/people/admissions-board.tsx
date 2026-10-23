'use client';

import * as React from 'react';
import Link from 'next/link';
import { Pencil, Plus } from 'lucide-react';
import type { AdmissionEnrollOut, AdmissionOut, SectionOut } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { gradeOptions, sectionLabel, useGradeList, useSectionList } from '@/lib/client/options';
import { ADMISSION_STAGES, fetchAllAdmissions, useAdmissionActions, useAdmissionCounts, useAdmissions } from '@/lib/client/people-staff';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { CredentialsDialog, ReasonDialog, type IssuedLogin } from '../shared/dialogs';
import { DefList } from '../shared/detail';
import { LabelledSelect } from '../shared/controls';
import { paths } from '../shared/paths';
import { AdmissionCreateForm, AdmissionEditForm } from './admission-form';
import { CsvExportButton } from './csv-export';
import { ErrorBanner } from './errors';
import { FormDrawer } from './form-drawer';
import { ADMISSION_LABEL, ADMISSION_OPTIONS, AdmissionStatusChip, asArray, relationshipLabel, titleCase } from './ui';

const EDITABLE = ['submitted', 'under_review', 'waitlisted', 'accepted'];

export function AdmissionsBoard() {
  const acc = useAccess();
  const [f, set, reset] = useUrlState({ q: '', status: '', gradeId: '', page: 1, pageSize: 25 });
  const grades = useGradeList();
  const q = useAdmissions(f);
  const counts = useAdmissionCounts(f.gradeId || undefined);
  const [selected, setSelected] = React.useState<AdmissionOut | null>(null);
  const [creating, setCreating] = React.useState(false);

  // keep the drawer in step with refetched data
  React.useEffect(() => {
    if (!selected) return;
    const fresh = q.data?.data.find((a) => a.id === selected.id);
    if (fresh && fresh.updatedAt !== selected.updatedAt) setSelected(fresh);
  }, [q.data, selected]);

  const gradeName = grades.data?.find((g) => g.id === f.gradeId)?.name;
  const active = [
    f.q && { key: 'q' as const, label: `Search: ${f.q}` },
    f.status && { key: 'status' as const, label: ADMISSION_LABEL[f.status] ?? f.status },
    f.gradeId && { key: 'gradeId' as const, label: gradeName ?? 'Grade' },
  ].filter(Boolean) as { key: 'q' | 'status' | 'gradeId'; label: string }[];
  const clearAll = () => reset(['q', 'status', 'gradeId']);

  const columns: Column<AdmissionOut>[] = [
    { id: 'name', header: 'Applicant', mobile: 'title', cell: (r) => <span className="block min-w-0"><span className="block truncate text-sm font-medium">{r.name}</span><span className="t-caption block text-ink-2">{r.applicationNo}</span></span> },
    { id: 'grade', header: 'Grade applied', mobile: 'sub', cell: (r) => r.gradeAppliedName ?? '—' },
    { id: 'guardian', header: 'Parent', mobile: 'detail', cell: (r) => <span className="block min-w-0"><span className="block truncate">{r.guardianName}</span><span className="t-caption block text-ink-2">{r.guardianPhone}</span></span> },
    { id: 'applied', header: 'Applied', mobile: 'detail', cell: (r) => fmtDate(r.createdAt) },
    { id: 'status', header: 'Status', mobile: 'status', cell: (r) => <AdmissionStatusChip status={r.status} /> },
  ];

  const canCreate = acc.can('admissions:create', 'school');
  const total = counts.data ? ADMISSION_STAGES.reduce((s, k) => s + counts.data[k], 0) : undefined;

  return (
    <>
      <PageHeader
        title="Admissions"
        description="Applications from first enquiry to enrolment. Accepted applications become students with a login and a linked parent."
        actions={canCreate && <Button onClick={() => setCreating(true)} disabled={acc.readOnly} title={acc.hint('admissions:create', 'school')}><Plus /> New application</Button>}
      />

      <section aria-label="Pipeline" className="mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <PipelineButton label="All stages" count={total} active={f.status === ''} onClick={() => set({ status: '' })} loading={counts.isPending} />
          {ADMISSION_STAGES.map((s) => (
            <PipelineButton key={s} label={ADMISSION_LABEL[s]!} count={counts.data?.[s]} active={f.status === s} onClick={() => set({ status: f.status === s ? '' : s })} loading={counts.isPending} />
          ))}
        </div>
        {counts.isError && <p className="t-caption mt-2 text-danger">The stage counts could not be loaded. <button type="button" className="underline" onClick={() => void counts.refetch()}>Try again</button></p>}
      </section>

      <DataTable
        id="people-admissions"
        caption="Admission applications"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={columns}
        page={f.page}
        pageSize={f.pageSize}
        total={q.data?.meta.total}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize, page: 1 })}
        onRowClick={(r) => setSelected(r)}
        activeRowKey={selected?.id}
        filters={
          <>
            <SearchBox value={f.q} onChange={(v) => set({ q: v })} placeholder="Search name, number or parent" />
            <FilterSelect label="Grade" value={f.gradeId} onChange={(v) => set({ gradeId: v })} options={gradeOptions(grades.data)} allLabel="All grades" />
            <FilterSelect label="Status" value={f.status} onChange={(v) => set({ status: v })} options={ADMISSION_OPTIONS} allLabel="All statuses" />
            {active.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
                {active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: '' })} />)}
                <ClearFiltersButton onClick={clearAll} />
              </div>
            )}
          </>
        }
        toolbar={
          acc.can('admissions:export', 'school') && (
            <CsvExportButton
              filename="admissions.csv"
              disabled={!q.data || q.data.meta.total === 0}
              build={async () => {
                const all = await fetchAllAdmissions(f);
                return {
                  header: ['Application no', 'First name', 'Last name', 'Grade applied', 'Status', 'Parent', 'Parent phone', 'Parent email', 'Applied on'],
                  rows: all.map((a) => [a.applicationNo, a.firstName, a.lastName, a.gradeAppliedName, ADMISSION_LABEL[a.status] ?? a.status, a.guardianName, a.guardianPhone, a.guardianEmail, a.createdAt.slice(0, 10)]),
                };
              }}
            />
          )
        }
        empty={
          active.length > 0 ? (
            <EmptyState illustration="no-results" title="No applications match these filters" filters={active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: '' })} />)} action={<ClearFiltersButton onClick={clearAll} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No applications yet" description="Record an application when a family enquires. You can move it through review, accept it and enrol the student." action={canCreate && !acc.readOnly ? <Button onClick={() => setCreating(true)}>New application</Button> : undefined} />
          )
        }
      />

      {creating && (
        <FormDrawer open onOpenChange={setCreating} title="New application" description="Record an application received by the school.">
          <AdmissionCreateForm
            onSaved={(a) => {
              setCreating(false);
              setSelected(a);
            }}
          />
        </FormDrawer>
      )}
      <ApplicationDrawer admission={selected} onClose={() => setSelected(null)} onChange={setSelected} />
    </>
  );
}

function PipelineButton({ label, count, active, onClick, loading }: { label: string; count?: number; active: boolean; onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('tr-colors rounded-lg border bg-surface p-3 text-left shadow-card hover:border-border-strong', active ? 'border-brand bg-brand-soft' : 'border-border')}
    >
      <span className="t-caption block text-ink-2">{label}</span>
      <span className="figure mt-0.5 block text-[24px] leading-8">{loading ? '…' : (count ?? '—').toLocaleString()}</span>
    </button>
  );
}

type Move = { status: 'under_review' | 'waitlisted' | 'accepted' | 'rejected'; label: string; perm: 'admissions:edit' | 'admissions:approve'; primary?: boolean };

function movesFor(status: string): Move[] {
  switch (status) {
    case 'submitted':
      return [{ status: 'under_review', label: 'Start review', perm: 'admissions:edit', primary: true }, { status: 'rejected', label: 'Reject', perm: 'admissions:approve' }];
    case 'under_review':
      return [{ status: 'accepted', label: 'Accept', perm: 'admissions:approve', primary: true }, { status: 'waitlisted', label: 'Waitlist', perm: 'admissions:approve' }, { status: 'rejected', label: 'Reject', perm: 'admissions:approve' }];
    case 'waitlisted':
      return [{ status: 'accepted', label: 'Accept', perm: 'admissions:approve', primary: true }, { status: 'under_review', label: 'Back to review', perm: 'admissions:approve' }, { status: 'rejected', label: 'Reject', perm: 'admissions:approve' }];
    case 'accepted':
      return [{ status: 'rejected', label: 'Reject', perm: 'admissions:approve' }];
    case 'rejected':
      return [{ status: 'under_review', label: 'Reopen for review', perm: 'admissions:approve' }];
    default:
      return [];
  }
}

const CONSEQUENCE: Record<Move['status'], string> = {
  under_review: 'The application moves into review. The family is not notified.',
  waitlisted: 'The application is placed on the waiting list. It can still be accepted later.',
  accepted: 'The application is accepted. You can then enrol the student into a section.',
  rejected: 'The application is rejected and can no longer be edited. It can be reopened for review later.',
};

function ApplicationDrawer({ admission, onClose, onChange }: { admission: AdmissionOut | null; onClose: () => void; onChange: (a: AdmissionOut) => void }) {
  const acc = useAccess();
  const { setStatus } = useAdmissionActions(admission?.id ?? '');
  const [move, setMove] = React.useState<Move | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [enrolling, setEnrolling] = React.useState(false);
  const [done, setDone] = React.useState<AdmissionEnrollOut | null>(null);
  const a = admission;

  return (
    <>
      <Drawer open={!!a} onOpenChange={(o) => !o && onClose()}>
        {a && (
          <DrawerContent title={a.name} description={`${a.applicationNo} · applied ${fmtDate(a.createdAt)}`} showTitle>
            <SheetBody>
              <div className="flex flex-wrap items-center gap-2">
                <AdmissionStatusChip status={a.status} />
                {a.decidedAt && <span className="t-caption text-ink-2">Decided {fmtDate(a.decidedAt)}</span>}
              </div>
              {a.decisionNote && <Banner tone="info" title="Decision note">{a.decisionNote}</Banner>}
              {a.status === 'enrolled' && a.studentId && (
                <Banner tone="success" title="Enrolled">
                  <Link href={paths.student(a.studentId)} className="text-brand-ink underline-offset-4 hover:underline">Open the student record</Link>
                </Banner>
              )}
              <DefList
                items={[
                  { label: 'Grade applied', value: a.gradeAppliedName },
                  { label: 'Academic year', value: a.academicYearName },
                  { label: 'Date of birth', value: a.dob ? fmtDate(a.dob) : null },
                  { label: 'Gender', value: a.gender ? titleCase(a.gender) : null },
                  { label: 'Previous school', value: a.previousSchool },
                  { label: 'Parent', value: `${a.guardianName}${a.guardianRelationship ? ` (${relationshipLabel(a.guardianRelationship).toLowerCase()})` : ''}` },
                  { label: 'Parent mobile', value: a.guardianPhone },
                  { label: 'Parent email', value: a.guardianEmail },
                  { label: 'Address', value: a.address ? [a.address.line1, a.address.line2, a.address.city, a.address.state, a.address.postalCode, a.address.country].filter(Boolean).join(', ') : null },
                  { label: 'Notes', value: a.notes },
                ]}
              />
            </SheetBody>
            <SheetFooter className="justify-between">
              <div className="flex flex-wrap gap-2">
                {EDITABLE.includes(a.status) && acc.can('admissions:edit', 'school') && (
                  <Button variant="secondary" onClick={() => setEditing(true)} disabled={!acc.ok('admissions:edit', 'school')} title={acc.hint('admissions:edit', 'school')}>
                    <Pencil /> Edit
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {movesFor(a.status).map((m) =>
                  acc.can(m.perm, 'school') ? (
                    <Button key={m.label} variant={m.status === 'rejected' ? 'danger' : m.primary ? 'primary' : 'secondary'} onClick={() => setMove(m)} disabled={!acc.ok(m.perm, 'school')} title={acc.hint(m.perm, 'school')}>
                      {m.label}
                    </Button>
                  ) : null,
                )}
                {a.status === 'accepted' && acc.can('admissions:approve', 'school') && (
                  <Button onClick={() => setEnrolling(true)} disabled={!acc.ok('admissions:approve', 'school') || !acc.can('students:create', 'school')} title={!acc.can('students:create', 'school') ? 'Enrolling creates a student, which needs permission to add students.' : acc.hint('admissions:approve', 'school')}>
                    Enrol as student
                  </Button>
                )}
              </div>
            </SheetFooter>
          </DrawerContent>
        )}
      </Drawer>

      {a && editing && (
        <FormDrawer open onOpenChange={setEditing} title="Edit application" description={`${a.name} · ${a.applicationNo}`}>
          <AdmissionEditForm admission={a} onSaved={(x) => { setEditing(false); onChange(x); }} />
        </FormDrawer>
      )}
      {a && (
        <ReasonDialog
          open={!!move}
          onOpenChange={(o) => !o && setMove(null)}
          title={`${move?.label ?? ''}: ${a.name}`}
          description={move ? CONSEQUENCE[move.status] : undefined}
          label={move?.status === 'rejected' ? 'Reason for rejecting' : 'Note'}
          required={move?.status === 'rejected'}
          confirmLabel={move?.label ?? 'Confirm'}
          destructive={move?.status === 'rejected'}
          onSubmit={async (note) => {
            if (!move) return false;
            const r = await setStatus.run({ status: move.status, note: note || undefined });
            if (r.ok) {
              onChange(r.data);
              return true;
            }
            return false;
          }}
        />
      )}
      {a && <EnrollDialog admission={a} open={enrolling} onClose={() => setEnrolling(false)} onDone={(r) => { setEnrolling(false); onChange(r.admission); setDone(r); }} />}
      <EnrollResult result={done} onClose={() => setDone(null)} />
    </>
  );
}

function EnrollDialog({ admission, open, onClose, onDone }: { admission: AdmissionOut; open: boolean; onClose: () => void; onDone: (r: AdmissionEnrollOut) => void }) {
  const { enroll } = useAdmissionActions(admission.id);
  const secQ = useSectionList({ gradeId: admission.gradeAppliedId ?? undefined, enabled: open });
  const sections = asArray<SectionOut>(secQ.data) ?? [];
  const [sectionId, setSectionId] = React.useState('');
  const [roll, setRoll] = React.useState('');
  const [studentLogin, setStudentLogin] = React.useState(true);
  const [parentLogin, setParentLogin] = React.useState(true);
  const [verify, setVerify] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  React.useEffect(() => {
    if (open) {
      setSectionId('');
      setRoll('');
      setStudentLogin(true);
      setParentLogin(true);
      setVerify(false);
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !enroll.isPending && onClose()}>
      <DialogContent title={`Enrol ${admission.name}`} description={`Creates the student record in ${admission.gradeAppliedName ?? 'the applied grade'}, a parent account and the link between them, in one step.`} size="lg">
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              onDone(await enroll.mutateAsync({ sectionId, rollNo: roll ? Number(roll) : undefined, createStudentLogin: studentLogin, createParentLogin: parentLogin, verifyExistingGuardian: verify }));
            } catch (err) {
              setError(err);
            }
          }}
        >
          {secQ.isError ? (
            <Banner tone="danger">The sections could not be loaded. Close this window and try again.</Banner>
          ) : (
            <LabelledSelect
              label="Section"
              required
              value={sectionId}
              onChange={setSectionId}
              placeholder={secQ.isPending ? 'Loading sections…' : sections.length === 0 ? 'No sections for this grade' : 'Choose a section'}
              options={sections.map((s) => ({ value: s.id, label: `${sectionLabel(s)} · ${s.studentCount}${s.capacity ? `/${s.capacity}` : ''} students` }))}
              hint="Sections of the current academic year for the grade applied."
            />
          )}
          <Field label="Roll number" htmlFor="enroll-roll" hint="Optional. Leave empty to assign the next one.">
            <Input id="enroll-roll" type="number" inputMode="numeric" min={1} max={9999} value={roll} onChange={(e) => setRoll(e.target.value)} />
          </Field>
          <div className="space-y-2.5">
            {[
              { v: studentLogin, s: setStudentLogin, l: 'Create the student login', h: 'Username is the new admission number. A temporary password is shown once.' },
              { v: parentLogin, s: setParentLogin, l: 'Create the parent login', h: `Username is ${admission.guardianPhone}. If a parent with that number is already registered they are linked instead.` },
              { v: verify, s: setVerify, l: 'Verify the link if the parent is already registered', h: 'Otherwise the link waits for verification and the parent cannot see the child yet.' },
            ].map((o) => (
              <label key={o.l} className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={o.v} onChange={(e) => o.s(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 accent-[var(--brand)]" />
                <span>{o.l}<span className="t-caption block text-ink-3">{o.h}</span></span>
              </label>
            ))}
          </div>
          <Banner tone="info">The student uses one licence seat for the current academic year. If the school has no seats left the enrolment is refused and nothing is created.</Banner>
          <ErrorBanner error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={enroll.isPending}>Cancel</Button>
            <Button type="submit" disabled={!sectionId} loading={enroll.isPending}>Enrol student</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EnrollResult({ result, onClose }: { result: AdmissionEnrollOut | null; onClose: () => void }) {
  const r = result;
  const logins: IssuedLogin[] = r
    ? [
        ...(r.credentials.student ? [{ label: `Student (${r.admission.name})`, username: r.credentials.student.username, temporaryPassword: r.credentials.student.temporaryPassword }] : []),
        ...(r.credentials.guardian ? [{ label: `Parent (${r.admission.guardianName})`, username: r.credentials.guardian.username, temporaryPassword: r.credentials.guardian.temporaryPassword }] : []),
      ]
    : [];
  const note = r && (
    <div className="space-y-1.5 text-sm text-ink-2">
      <p>{r.admission.name} is enrolled with admission number <strong className="font-medium text-ink">{r.admissionNo}</strong>. <Link href={paths.student(r.studentId)} className="text-brand-ink hover:underline">Open the student record</Link></p>
      {!r.guardianLinkVerified && <Banner tone="warning" title="The parent link needs verifying">This parent was already registered, so the link was not verified automatically. Verify it on the student’s Parents tab before they can see the child.</Banner>}
    </div>
  );
  if (r && logins.length === 0) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent title={`${r.admission.name} was enrolled`}>
          <div className="mt-3">{note}</div>
          <div className="mt-5 flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </DialogContent>
      </Dialog>
    );
  }
  return <CredentialsDialog open={!!r} onOpenChange={(o) => !o && onClose()} title={`${r?.admission.name ?? 'Student'} was enrolled`} logins={logins} note={note} />;
}

