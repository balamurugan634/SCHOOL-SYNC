'use client';

import * as React from 'react';
import { staffCreateBody, staffUpdateBody, type StaffDetailOut, type RoleOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { FormActions, FormCheckbox, FormDate, FormInput, FormSection, FormSelect } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/components/me-context';
import { useCreateStaff, useRoleChoices, useStaffActions, type StaffCreated } from '@/lib/client/people-staff';
import { applyApiErrors, hasDirtyFields } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { useAccess } from '../shared/access';
import { ErrorBanner } from './errors';
import { AddressFields, anyControl, Disclosure } from './fields';
import { nullMissing, rootError, usePeopleForm } from './form';
import { useFormDrawer } from './form-drawer';
import { GENDER_OPTIONS, STAFF_TYPE_OPTIONS } from './ui';

const addr = (a: StaffDetailOut['address']) => ({ line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', state: a?.state ?? '', postalCode: a?.postalCode ?? '', country: a?.country ?? '' });

const HIDDEN_ROLE_KEYS = new Set(['student', 'parent']);

/** Role checkboxes. Teacher is automatic for teaching staff. Needs `roles:view` to list and `roles:edit` to assign. */
export function RolePicker({ value, onChange, teachingStaff, disabled }: { value: string[]; onChange: (v: string[]) => void; teachingStaff?: boolean; disabled?: boolean }) {
  const me = useMe();
  const q = useRoleChoices();
  if (q.isPending) return <Skeleton className="h-24 w-full rounded-lg" />;
  if (q.isError) return <Banner tone="info">The list of roles is not available to your role. Teaching staff still get the Teacher role automatically.</Banner>;
  const roles = q.data.filter((r: RoleOut) => !HIDDEN_ROLE_KEYS.has(r.key) && (r.key !== 'super_admin' || me.roles.includes('super_admin')));
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="sr-only">Roles</legend>
      {roles.map((r) => {
        const auto = r.key === 'teacher' && teachingStaff;
        const on = auto || value.includes(r.key);
        return (
          <label key={r.id} className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={on}
              disabled={auto || disabled}
              onChange={(e) => onChange(e.target.checked ? [...value, r.key] : value.filter((k) => k !== r.key))}
              className="mt-0.5 size-[18px] shrink-0 accent-[var(--brand)]"
            />
            <span>
              {r.name}
              {auto && <span className="t-caption ml-2 text-ink-3">Added automatically</span>}
              {r.description && <span className="t-caption block text-ink-3">{r.description}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Create form (full page). `onCreated` gets the new staff member with the one-time credential. */
export function StaffCreateForm({ onCreated, onCancel }: { onCreated: (s: StaffCreated) => void; onCancel: () => void }) {
  const acc = useAccess();
  const create = useCreateStaff();
  const form = usePeopleForm(staffCreateBody, { defaultValues: { firstName: '', lastName: '', staffType: 'teaching', designation: '', department: '', phone: '', email: '', username: '', createLogin: true, roleKeys: [] } });
  const [roles, setRoles] = React.useState<string[]>([]);
  const [error, setError] = React.useState<unknown>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const staffType = form.watch('staffType');
  const createLogin = form.watch('createLogin');
  const canRoles = acc.can('roles:edit');

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(
        async (v) => {
          setError(null);
          setFormError(null);
          try {
            const extra = roles.filter((k) => !(k === 'teacher' && staffType === 'teaching'));
            const res = await create.mutateAsync({ ...v, roleKeys: canRoles && createLogin && extra.length ? extra : undefined });
            form.reset(v);
            onCreated(res);
          } catch (e) {
            const msg = applyApiErrors(form, e);
            if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && msg === null) return;
            setError(e);
          }
        },
        (errs) => setFormError(rootError(errs) ?? 'Some fields need attention. Check the highlighted fields.'),
      )}
    >
      <div className="space-y-8 p-5 max-sm:p-4">
        <FormSection title="Person">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={form.control} name="firstName" label="First name" required autoComplete="off" />
            <FormInput control={form.control} name="lastName" label="Last name" autoComplete="off" />
            <FormSelect control={form.control} name="gender" label="Gender" options={GENDER_OPTIONS} placeholder="Not set" />
            <FormDate control={form.control} name="dob" label="Date of birth" max={new Date().toISOString().slice(0, 10)} />
            <FormInput control={form.control} name="phone" label="Mobile number" inputMode="tel" autoComplete="off" />
            <FormInput control={form.control} name="email" label="Email" type="email" autoComplete="off" />
          </div>
        </FormSection>
        <FormSection title="Job">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect control={form.control} name="staffType" label="Staff type" options={STAFF_TYPE_OPTIONS} required />
            <FormInput control={form.control} name="designation" label="Designation" hint="For example Maths Teacher, Accountant" autoComplete="off" />
            <FormInput control={form.control} name="department" label="Department" autoComplete="off" />
            <FormDate control={form.control} name="joinDate" label="Joining date" />
            <FormInput control={form.control} name="qualification" label="Qualification" autoComplete="off" className="sm:col-span-2" />
          </div>
        </FormSection>
        <FormSection title="Sign-in and roles">
          <FormCheckbox control={form.control} name="createLogin" label="Create a login" hint="A temporary password is shown once. The username is the employee id unless you choose one." />
          {createLogin && (
            <>
              <FormInput control={form.control} name="username" label="Username" hint="Optional. Leave empty to use the employee id." autoComplete="off" />
              {canRoles ? (
                <div className="space-y-2">
                  <p className="t-label">Roles</p>
                  <RolePicker value={roles} onChange={setRoles} teachingStaff={staffType === 'teaching'} />
                </div>
              ) : (
                <Banner tone="info">Teaching staff get the Teacher role automatically. Giving other roles needs permission to edit roles; ask a super administrator to assign them afterwards.</Banner>
              )}
            </>
          )}
        </FormSection>
        <Disclosure label="more details">
          <FormSection title="Emergency contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput control={anyControl(form.control)} name="emergencyContact.name" label="Name" autoComplete="off" />
              <FormInput control={anyControl(form.control)} name="emergencyContact.relationship" label="Relationship" autoComplete="off" />
              <FormInput control={anyControl(form.control)} name="emergencyContact.phone" label="Phone" inputMode="tel" autoComplete="off" />
            </div>
          </FormSection>
          <FormSection title="Address">
            <AddressFields control={anyControl(form.control)} />
          </FormSection>
        </Disclosure>
        {formError && <Banner tone="danger">{formError}</Banner>}
        <ErrorBanner error={error} />
      </div>
      <FormActions className="rounded-b-lg">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} disabled={!acc.ok('staff:create', 'school')} title={acc.hint('staff:create', 'school')}>
          Add staff member
        </Button>
      </FormActions>
    </form>
  );
}

/** Edit form inside a FormDrawer (the login's name / phone / email follow). */
export function StaffEditForm({ staff, onSaved }: { staff: StaffDetailOut; onSaved: () => void }) {
  const { update } = useStaffActions(staff.id);
  const ec = staff.emergencyContact;
  const form = usePeopleForm(staffUpdateBody, {
    defaultValues: {
      firstName: staff.firstName,
      lastName: staff.lastName ?? '',
      staffType: staff.staffType,
      designation: staff.designation ?? '',
      department: staff.department ?? '',
      gender: staff.gender ?? undefined,
      dob: staff.dob ?? undefined,
      joinDate: staff.joinDate ?? undefined,
      qualification: staff.qualification ?? '',
      phone: staff.phone ?? '',
      email: staff.email ?? '',
      address: addr(staff.address),
      emergencyContact: { name: ec?.name ?? '', relationship: ec?.relationship ?? '', phone: ec?.phone ?? '', altPhone: ec?.altPhone },
    },
  });
  const { requestClose } = useFormDrawer(hasDirtyFields(form.formState) && !form.formState.isSubmitSuccessful);
  const [error, setError] = React.useState<unknown>(null);
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await update.mutateAsync(nullMissing(v, ['lastName', 'designation', 'department', 'gender', 'dob', 'joinDate', 'qualification', 'phone', 'email', 'address', 'emergencyContact']));
          onSaved();
        } catch (e) {
          const msg = applyApiErrors(form, e);
          if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && msg === null) return;
          setError(e);
        }
      })}
    >
      <div className="space-y-6 px-5 py-4">
        <FormSection title="Person">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={form.control} name="firstName" label="First name" required autoComplete="off" />
            <FormInput control={form.control} name="lastName" label="Last name" autoComplete="off" />
            <FormSelect control={form.control} name="gender" label="Gender" options={GENDER_OPTIONS} placeholder="Not set" />
            <FormDate control={form.control} name="dob" label="Date of birth" />
            <FormInput control={form.control} name="phone" label="Mobile number" hint={staff.hasLogin ? 'The login’s phone follows.' : undefined} inputMode="tel" autoComplete="off" />
            <FormInput control={form.control} name="email" label="Email" type="email" hint={staff.hasLogin ? 'The login’s email follows.' : undefined} autoComplete="off" />
          </div>
        </FormSection>
        <FormSection title="Job">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect control={form.control} name="staffType" label="Staff type" options={STAFF_TYPE_OPTIONS} />
            <FormInput control={form.control} name="designation" label="Designation" autoComplete="off" />
            <FormInput control={form.control} name="department" label="Department" autoComplete="off" />
            <FormDate control={form.control} name="joinDate" label="Joining date" />
            <FormInput control={form.control} name="qualification" label="Qualification" autoComplete="off" className="sm:col-span-2" />
          </div>
        </FormSection>
        <Disclosure label="more details">
          <FormSection title="Emergency contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput control={anyControl(form.control)} name="emergencyContact.name" label="Name" autoComplete="off" />
              <FormInput control={anyControl(form.control)} name="emergencyContact.relationship" label="Relationship" autoComplete="off" />
              <FormInput control={anyControl(form.control)} name="emergencyContact.phone" label="Phone" inputMode="tel" autoComplete="off" />
            </div>
          </FormSection>
          <FormSection title="Address">
            <AddressFields control={anyControl(form.control)} />
          </FormSection>
        </Disclosure>
        <ErrorBanner error={error} />
      </div>
      <FormActions>
        <Button type="button" variant="secondary" onClick={requestClose}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Save changes
        </Button>
      </FormActions>
    </form>
  );
}
