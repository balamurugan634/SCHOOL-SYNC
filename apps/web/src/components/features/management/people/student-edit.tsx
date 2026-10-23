'use client';

import * as React from 'react';
import { studentUpdateBody, type StudentDetailOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { FormActions, FormDate, FormInput, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { useStudentActions } from '@/lib/client/people';
import { applyApiErrors, hasDirtyFields } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { ContactRows } from './contact-rows';
import { ErrorBanner } from './errors';
import { AddressFields, anyControl, Disclosure, Restricted } from './fields';
import { nullMissing, rootError, usePeopleForm } from './form';
import { useFormDrawer } from './form-drawer';
import { BLOOD_GROUPS, GENDER_OPTIONS } from './ui';

/** The edit form of a student record, rendered inside a FormDrawer. Sends only what the API accepts; cleared fields become null. */
export function StudentEditForm({ student, onSaved }: { student: StudentDetailOut; onSaved: () => void }) {
  const { update } = useStudentActions(student.id);
  const a = student.address;
  const form = usePeopleForm(studentUpdateBody, {
    defaultValues: {
      firstName: student.firstName,
      lastName: student.lastName ?? '',
      dob: student.dob ?? undefined,
      gender: student.gender ?? undefined,
      admissionDate: student.admissionDate ?? undefined,
      bloodGroup: student.bloodGroup ?? '',
      nationality: student.nationality ?? '',
      religion: student.religion ?? '',
      category: student.category ?? '',
      medicalNotes: student.medicalNotes ?? '',
      address: { line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', state: a?.state ?? '', postalCode: a?.postalCode ?? '', country: a?.country ?? '' },
      emergencyContacts: student.emergencyContacts.map((c) => ({ name: c.name, relationship: c.relationship ?? '', phone: c.phone, altPhone: c.altPhone })),
      authorizedPickups: student.authorizedPickups.map((c) => ({ name: c.name, relationship: c.relationship ?? '', phone: c.phone, altPhone: c.altPhone, idProof: c.idProof ?? '', active: c.active })),
    },
  });
  const { requestClose } = useFormDrawer(hasDirtyFields(form.formState) && !form.formState.isSubmitSuccessful);
  const [error, setError] = React.useState<unknown>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const control = anyControl(form.control);
  const medicalRestricted = student.medicalNotes === null;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(
        async (v) => {
          setError(null);
          setFormError(null);
          const keys = ['lastName', 'dob', 'gender', 'admissionDate', 'bloodGroup', 'nationality', 'religion', 'category', 'address'];
          if (!medicalRestricted) keys.push('medicalNotes');
          const body = nullMissing(v, keys);
          if (medicalRestricted) delete body.medicalNotes;
          try {
            await update.mutateAsync(body);
            onSaved();
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
        <FormSection title="Student">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={form.control} name="firstName" label="First name" required autoComplete="off" />
            <FormInput control={form.control} name="lastName" label="Last name" autoComplete="off" />
            <FormDate control={form.control} name="dob" label="Date of birth" max={new Date().toISOString().slice(0, 10)} />
            <FormSelect control={form.control} name="gender" label="Gender" options={GENDER_OPTIONS} placeholder="Not set" />
            <FormDate control={form.control} name="admissionDate" label="Admission date" />
          </div>
        </FormSection>
        <FormSection title="Address">
          <AddressFields control={control} />
        </FormSection>
        <FormSection title="Emergency contacts" description="Who the school calls first.">
          <ContactRows control={form.control} name="emergencyContacts" addLabel="Add emergency contact" emptyText="No emergency contacts recorded." />
        </FormSection>
        <Disclosure label="more details">
          <FormSection title="Background and health">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormSelect control={form.control} name="bloodGroup" label="Blood group" options={BLOOD_GROUPS.map((b) => ({ value: b, label: b }))} placeholder="Not set" />
              <FormInput control={form.control} name="nationality" label="Nationality" autoComplete="off" />
              <FormInput control={form.control} name="religion" label="Religion" autoComplete="off" />
              <FormInput control={form.control} name="category" label="Category" autoComplete="off" />
            </div>
            {medicalRestricted ? <Restricted what="Medical notes" /> : <FormTextarea control={form.control} name="medicalNotes" label="Medical notes" hint="Allergies, conditions, medication. Only school-wide editors and verified parents can read this." rows={3} />}
          </FormSection>
          <FormSection title="Authorised pickups" description="People other than parents who may collect the child.">
            <ContactRows control={form.control} name="authorizedPickups" addLabel="Add pickup person" withIdProof emptyText="No extra pickup persons recorded." />
          </FormSection>
        </Disclosure>
        {formError && <Banner tone="danger">{formError}</Banner>}
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
