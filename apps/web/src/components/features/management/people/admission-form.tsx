'use client';

import * as React from 'react';
import { admissionCreateBody, admissionUpdateBody, type AdmissionOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import type { SelectOption } from '@/components/ui/select';
import { FormActions, FormDate, FormInput, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { gradeOptions, useGradeList } from '@/lib/client/options';
import { useAdmissionActions, useCreateAdmission } from '@/lib/client/people-staff';
import { applyApiErrors, hasDirtyFields } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { ErrorBanner } from './errors';
import { AddressFields, anyControl, Disclosure } from './fields';
import { rootError, usePeopleForm } from './form';
import { useFormDrawer } from './form-drawer';
import { GENDER_OPTIONS, RELATIONSHIP_OPTIONS } from './ui';

const addr = (a: AdmissionOut['address']) => ({ line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', state: a?.state ?? '', postalCode: a?.postalCode ?? '', country: a?.country ?? '' });

function Fields({ control, grades, gradesLoading }: { control: unknown; grades: SelectOption[]; gradesLoading: boolean }) {
  const c = anyControl(control);
  return (
    <>
      <FormSection title="Applicant">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput control={c} name="firstName" label="First name" required autoComplete="off" />
          <FormInput control={c} name="lastName" label="Last name" autoComplete="off" />
          <FormDate control={c} name="dob" label="Date of birth" max={new Date().toISOString().slice(0, 10)} />
          <FormSelect control={c} name="gender" label="Gender" options={GENDER_OPTIONS} placeholder="Not set" />
          <FormSelect control={c} name="gradeAppliedId" label="Grade applied for" options={grades} placeholder={gradesLoading ? 'Loading grades…' : 'Choose a grade'} required />
          <FormInput control={c} name="previousSchool" label="Previous school" autoComplete="off" />
        </div>
      </FormSection>
      <FormSection title="Parent or guardian">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput control={c} name="guardianName" label="Name" required autoComplete="off" />
          <FormSelect control={c} name="guardianRelationship" label="Relationship" options={RELATIONSHIP_OPTIONS} />
          <FormInput control={c} name="guardianPhone" label="Mobile number" required inputMode="tel" autoComplete="off" hint="Used to find or create the parent’s account when enrolling." />
          <FormInput control={c} name="guardianEmail" label="Email" type="email" autoComplete="off" />
        </div>
      </FormSection>
      <Disclosure label="more details">
        <FormTextarea control={c} name="notes" label="Notes" rows={3} hint="Anything the admissions team should know." />
        <FormSection title="Address">
          <AddressFields control={c} />
        </FormSection>
      </Disclosure>
    </>
  );
}

export function AdmissionCreateForm({ onSaved }: { onSaved: (a: AdmissionOut) => void }) {
  const create = useCreateAdmission();
  const grades = useGradeList();
  const form = usePeopleForm(admissionCreateBody, { defaultValues: { firstName: '', lastName: '', gradeAppliedId: '', guardianName: '', guardianRelationship: 'guardian', guardianPhone: '', guardianEmail: '', previousSchool: '', notes: '' } });
  const { requestClose } = useFormDrawer(hasDirtyFields(form.formState) && !form.formState.isSubmitSuccessful);
  const [error, setError] = React.useState<unknown>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(
        async (v) => {
          setError(null);
          setFormError(null);
          try {
            onSaved(await create.mutateAsync(v));
          } catch (e) {
            const msg = applyApiErrors(form, e);
            if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && msg === null) return;
            setError(e);
          }
        },
        (errs) => setFormError(rootError(errs)),
      )}
    >
      <div className="space-y-6 px-5 py-4">
        <Fields control={form.control} grades={gradeOptions(grades.data)} gradesLoading={grades.isPending} />
        {formError && <Banner tone="danger">{formError}</Banner>}
        <ErrorBanner error={error} />
      </div>
      <FormActions>
        <Button type="button" variant="secondary" onClick={requestClose}>Cancel</Button>
        <Button type="submit" loading={form.formState.isSubmitting}>Record application</Button>
      </FormActions>
    </form>
  );
}

export function AdmissionEditForm({ admission, onSaved }: { admission: AdmissionOut; onSaved: (a: AdmissionOut) => void }) {
  const { update } = useAdmissionActions(admission.id);
  const grades = useGradeList();
  const form = usePeopleForm(admissionUpdateBody, {
    defaultValues: {
      firstName: admission.firstName,
      lastName: admission.lastName ?? '',
      dob: admission.dob ?? undefined,
      gender: admission.gender ?? undefined,
      gradeAppliedId: admission.gradeAppliedId ?? '',
      previousSchool: admission.previousSchool ?? '',
      guardianName: admission.guardianName,
      guardianRelationship: admission.guardianRelationship ?? 'guardian',
      guardianPhone: admission.guardianPhone,
      guardianEmail: admission.guardianEmail ?? '',
      notes: admission.notes ?? '',
      address: addr(admission.address),
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
          onSaved(await update.mutateAsync(v));
        } catch (e) {
          const msg = applyApiErrors(form, e);
          if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && msg === null) return;
          setError(e);
        }
      })}
    >
      <div className="space-y-6 px-5 py-4">
        <Fields control={form.control} grades={gradeOptions(grades.data)} gradesLoading={grades.isPending} />
        <p className="t-caption text-ink-3">Empty optional fields keep their current value.</p>
        <ErrorBanner error={error} />
      </div>
      <FormActions>
        <Button type="button" variant="secondary" onClick={requestClose}>Cancel</Button>
        <Button type="submit" loading={form.formState.isSubmitting}>Save changes</Button>
      </FormActions>
    </form>
  );
}
