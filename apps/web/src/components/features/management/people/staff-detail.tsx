'use client';

import * as React from 'react';
import Link from 'next/link';
import { Pencil, UserCheck, UserX } from 'lucide-react';
import type { StaffDetailOut } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Field, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { assetUrl } from '@/lib/assets';
import { useRoleChoices, useStaffActions, useStaffMember, useStaffWorkload } from '@/lib/client/people-staff';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { useAccess } from '../shared/access';
import { LabelledSelect } from '../shared/controls';
import { DefList, ErrorPanel, Panel } from '../shared/detail';
import { paths } from '../shared/paths';
import { ErrorBanner } from './errors';
import { FormDrawer } from './form-drawer';
import { RolePicker, StaffEditForm } from './staff-form';
import { STAFF_STATUS_LABEL, StaffStatusChip, titleCase } from './ui';

export function StaffDetail({ id }: { id: string }) {
  const acc = useAccess();
  const q = useStaffMember(id);
  const [{ tab }, set] = useUrlState({ tab: 'profile' });
  const [editing, setEditing] = React.useState(false);
  const [deactivating, setDeactivating] = React.useState(false);
  const [reactivating, setReactivating] = React.useState(false);
  const { reactivate } = useStaffActions(id);
  const crumbs = [{ label: 'Home', href: '/admin' }, { label: 'Staff', href: paths.staff }];

  if (q.isPending)
    return (
      <div aria-busy>
        <Skeleton className="mb-8 h-12 w-72" />
        <Skeleton className="mb-5 h-10 w-full" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  if (q.isError)
    return (
      <>
        <PageHeader title="Staff member" crumbs={[...crumbs, { label: 'Staff member' }]} />
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this staff member" />
      </>
    );
  const s = q.data;
  const inactive = s.status === 'resigned' || s.status === 'terminated';
  const showWorkload = acc.can('staff:view');
  const current = tab === 'workload' && showWorkload ? 'workload' : tab === 'access' ? 'access' : 'profile';
  const canEdit = acc.ok('staff:edit', 'school');

  return (
    <>
      <PageHeader
        crumbs={[...crumbs, { label: s.name }]}
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Avatar name={s.name} src={assetUrl(s.photoUrl)} size="sm" />
            <span>{s.employeeId}</span>
            <span aria-hidden>·</span>
            <span>{[s.designation, s.department].filter(Boolean).join(' · ') || (s.staffType === 'teaching' ? 'Teaching staff' : 'Non-teaching staff')}</span>
            <StaffStatusChip status={s.status} />
          </span>
        }
        actions={
          <>
            {acc.can('staff:edit', 'school') && (
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={!canEdit} title={acc.hint('staff:edit', 'school')}>
                <Pencil /> Edit details
              </Button>
            )}
            {inactive
              ? acc.can('staff:edit', 'school') && (
                  <Button variant="secondary" onClick={() => setReactivating(true)} disabled={!canEdit} title={acc.hint('staff:edit', 'school')}>
                    <UserCheck /> Reactivate
                  </Button>
                )
              : acc.can('staff:delete', 'school') && (
                  <Button variant="danger" onClick={() => setDeactivating(true)} disabled={!acc.ok('staff:delete', 'school')} title={acc.hint('staff:delete', 'school')}>
                    <UserX /> Deactivate
                  </Button>
                )}
          </>
        }
      />

      <Tabs value={current} onValueChange={(v) => set({ tab: v })}>
        <TabsList aria-label="Staff sections">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {showWorkload && <TabsTrigger value="workload">Workload</TabsTrigger>}
          <TabsTrigger value="access">Login and roles</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">{current === 'profile' && <Profile s={s} />}</TabsContent>
        <TabsContent value="workload">{current === 'workload' && <Workload id={id} />}</TabsContent>
        <TabsContent value="access">{current === 'access' && <Access s={s} />}</TabsContent>
      </Tabs>

      {editing && (
        <FormDrawer open onOpenChange={setEditing} title="Edit staff details" description={`${s.name} · ${s.employeeId}`}>
          <StaffEditForm staff={s} onSaved={() => setEditing(false)} />
        </FormDrawer>
      )}
      <DeactivateDialog staff={s} open={deactivating} onClose={() => setDeactivating(false)} />
      <ConfirmDialog
        open={reactivating}
        onOpenChange={setReactivating}
        title={`Reactivate ${s.name}?`}
        description="Their login works again straight away with their previous roles. Classes they led or taught before are not restored; assign them again if needed."
        confirmLabel="Reactivate"
        loading={reactivate.isPending}
        onConfirm={async () => {
          const r = await reactivate.run(undefined);
          if (r.ok) setReactivating(false);
        }}
      />
    </>
  );
}

function Profile({ s }: { s: StaffDetailOut }) {
  const addr = s.address ? [s.address.line1, s.address.line2, s.address.city, s.address.state, s.address.postalCode, s.address.country].filter(Boolean).join(', ') : '';
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Panel title="Details">
        <DefList
          cols={2}
          items={[
            { label: 'Employee id', value: s.employeeId },
            { label: 'Type', value: s.staffType === 'teaching' ? 'Teaching' : 'Non-teaching' },
            { label: 'Designation', value: s.designation },
            { label: 'Department', value: s.department },
            { label: 'Joined', value: s.joinDate ? fmtDate(s.joinDate) : null },
            { label: 'Qualification', value: s.qualification },
            { label: 'Gender', value: s.gender ? titleCase(s.gender) : null },
            { label: 'Date of birth', value: s.dob ? fmtDate(s.dob) : null },
            { label: 'Mobile', value: s.phone },
            { label: 'Email', value: s.email },
            { label: 'Address', value: addr },
          ]}
        />
      </Panel>
      <Panel title="Emergency contact">
        {s.emergencyContact ? (
          <DefList items={[{ label: 'Name', value: s.emergencyContact.name }, { label: 'Relationship', value: s.emergencyContact.relationship }, { label: 'Phone', value: s.emergencyContact.phone }]} />
        ) : (
          <p className="text-sm text-ink-2">None recorded.</p>
        )}
      </Panel>
    </div>
  );
}

function Workload({ id }: { id: string }) {
  const q = useStaffWorkload(id);
  if (q.isPending)
    return (
      <div className="space-y-4" aria-busy>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" state="loading" />)}</div>
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the workload" />;
  const w = q.data;
  const t = w.totals;
  const empty = w.sectionsLed.length === 0 && w.assignments.length === 0;
  return (
    <div className="space-y-6">
      <p className="t-caption text-ink-2">{w.academicYear ? `Academic year ${w.academicYear}, from the teaching assignments.` : 'There is no current academic year.'}</p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Sections" value={t.sections} hint="Led or taught" />
        <StatTile label="Subject assignments" value={t.subjects} />
        <StatTile label="Periods per week" value={t.periodsPerWeek} hint="From the grade offerings" />
        <StatTile label="Timetabled periods" value={t.timetabledPeriods} hint={t.periodsPerWeek && t.timetabledPeriods < t.periodsPerWeek ? `${t.periodsPerWeek - t.timetabledPeriods} not yet scheduled` : undefined} />
      </div>
      {empty ? (
        <Card>
          <EmptyState illustration="empty-generic" compact title="No classes assigned" description="Assign this person to a subject under Teaching assignments, or make them a class teacher under Classes & sections." action={<Button variant="secondary" asChild><Link href={paths.assignments()}>Open teaching assignments</Link></Button>} />
        </Card>
      ) : (
        <>
          {w.sectionsLed.length > 0 && (
            <Panel title="Class teacher of">
              <ul className="divide-y divide-border">
                {w.sectionsLed.map((s) => (
                  <li key={s.sectionId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="text-sm font-medium">{s.gradeName} {s.sectionName}</span>
                    <span className="t-caption text-ink-2">{s.studentCount} students</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {w.assignments.length > 0 && (
            <Card>
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <tr>
                      <TH>Class</TH>
                      <TH>Subject</TH>
                      <TH align="right">Periods per week</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {w.assignments.map((a) => (
                      <TR key={a.assignmentId}>
                        <TD>{a.gradeName} {a.sectionName}</TD>
                        <TD>{a.subjectName}</TD>
                        <TD align="right">{a.periodsPerWeek ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Access({ s }: { s: StaffDetailOut }) {
  const acc = useAccess();
  const [editing, setEditing] = React.useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Login">
        {s.hasLogin ? (
          <DefList
            items={[
              { label: 'Username', value: s.username ? <span className="font-mono text-[13px]">{s.username}</span> : null },
              { label: 'Account', value: s.userStatus ? <Badge variant={s.userStatus === 'active' ? 'success' : s.userStatus === 'invited' ? 'info' : 'danger'}>{titleCase(s.userStatus)}</Badge> : null },
            ]}
          />
        ) : (
          <p className="text-sm text-ink-2">This staff member has no login, so they cannot sign in.</p>
        )}
        <p className="t-caption mt-3 text-ink-2">
          To reset a password, unlock an account, sign someone out or see their devices, use <Link href={paths.users} className="text-brand-ink hover:underline">Settings → Users</Link>.
        </p>
      </Panel>
      <Panel
        title="Roles"
        description="What this person can do in the app."
        actions={s.hasLogin && acc.can('roles:edit') && <Button size="sm" variant="secondary" onClick={() => setEditing(true)} disabled={!acc.ok('staff:edit', 'school')} title={acc.hint('staff:edit', 'school')}>Change roles</Button>}
      >
        {s.roles.length === 0 ? (
          <p className="text-sm text-ink-2">No roles. They can sign in but see nothing until a role is assigned.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {s.roles.map((r) => (
              <Badge key={r} variant="neutral">{titleCase(r)}</Badge>
            ))}
          </div>
        )}
        {!acc.can('roles:edit') && <p className="t-caption mt-3 text-ink-3">Changing roles needs permission to edit roles.</p>}
      </Panel>
      {editing && <RolesDialog staff={s} onClose={() => setEditing(false)} />}
    </div>
  );
}

function RolesDialog({ staff, onClose }: { staff: StaffDetailOut; onClose: () => void }) {
  const { setRoles } = useStaffActions(staff.id);
  const q = useRoleChoices();
  const [keys, setKeys] = React.useState<string[]>(staff.roles);
  const [error, setError] = React.useState<unknown>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && !setRoles.isPending && onClose()}>
      <DialogContent title={`Roles for ${staff.name}`} description="Replace this person’s roles. Their access updates the next time their app refreshes, and they are notified.">
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const ids = (q.data ?? []).filter((r) => keys.includes(r.key)).map((r) => r.id);
            try {
              const r = await setRoles.mutateAsync(ids);
              toast.success(r.changed ? 'Roles updated' : 'Roles were already set that way');
              onClose();
            } catch (err) {
              setError(err);
            }
          }}
        >
          <RolePicker value={keys} onChange={setKeys} teachingStaff={staff.staffType === 'teaching'} />
          <ErrorBanner error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={setRoles.isPending}>Cancel</Button>
            <Button type="submit" loading={setRoles.isPending} disabled={!q.data}>Save roles</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({ staff, open, onClose }: { staff: StaffDetailOut; open: boolean; onClose: () => void }) {
  const { deactivate } = useStaffActions(staff.id);
  const w = useStaffWorkload(staff.id, open);
  const [status, setStatus] = React.useState<'resigned' | 'terminated'>('resigned');
  const [reason, setReason] = React.useState('');
  const [release, setRelease] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  React.useEffect(() => {
    if (open) {
      setStatus('resigned');
      setReason('');
      setRelease(false);
      setError(null);
    }
  }, [open]);
  const led = w.data?.sectionsLed.length ?? 0;
  const taught = w.data?.assignments.length ?? 0;
  const busy = led + taught > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !deactivate.isPending && onClose()}>
      <DialogContent title={`Deactivate ${staff.name}?`} description="Their login is switched off and they are signed out on every device. Their record, attendance and history are kept, and you can reactivate them later.">
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await deactivate.mutateAsync({ status, reason: reason.trim() || undefined, releaseAssignments: release });
              toast.success(`${staff.name} was deactivated`);
              onClose();
            } catch (err) {
              setError(err);
              if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'STAFF_HAS_ASSIGNMENTS') setRelease(false);
            }
          }}
        >
          <LabelledSelect label="Reason for leaving" value={status} onChange={(v) => setStatus(v as 'resigned' | 'terminated')} options={[{ value: 'resigned', label: STAFF_STATUS_LABEL.resigned! }, { value: 'terminated', label: STAFF_STATUS_LABEL.terminated! }]} />
          {busy && (
            <Banner tone="warning" title="They still have classes">
              {staff.name} is class teacher of {led} {led === 1 ? 'section' : 'sections'} and teaches {taught} subject {taught === 1 ? 'assignment' : 'assignments'}. Deactivation is refused until those are reassigned, unless you release them below.
            </Banner>
          )}
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={release} onChange={(e) => setRelease(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 accent-[var(--brand)]" />
            <span>
              Also release their assignments
              <span className="t-caption block text-ink-3">Removes them as class teacher and subject teacher. Those sections and subjects have no teacher until you assign someone else, and timetable slots keep working only once reassigned.</span>
            </span>
          </label>
          <Field label="Note" htmlFor="deact-reason" hint="Optional. Kept in the audit trail.">
            <Textarea id="deact-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
          </Field>
          <ErrorBanner error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={deactivate.isPending}>Cancel</Button>
            <Button type="submit" variant="danger-solid" loading={deactivate.isPending}>Deactivate</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
