'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFieldArray } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { studentCreateBody, type GuardianOut, type StudentCreateOut } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { FormActions, FormCheckbox, FormDate, FormInput, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { useSite } from '@/components/site-context';
import { useCreateStudent } from '@/lib/client/people';
import { gradeOptions, sectionLabel, useGradeList, useSectionList } from '@/lib/client/options';
import { useLicense } from '@/lib/client/queries';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { applyApiErrors, hasDirtyFields } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { useAccess } from '../shared/access';
import { LabelledSelect } from '../shared/controls';
import { CredentialsDialog, type IssuedLogin } from '../shared/dialogs';
import { paths } from '../shared/paths';
import { ErrorBanner } from './errors';
import { AddressFields, anyControl, ChosenGuardian, Disclosure, FormNumber, GuardianPicker } from './fields';
import { rootError, usePeopleForm } from './form';
import { asArray, BLOOD_GROUPS, GENDER_OPTIONS, RELATIONSHIP_OPTIONS } from './ui';
import type { SectionOut } from '@school-sync/shared';

export function StudentCreate() {
  const router = useRouter();
  const acc = useAccess();
  const site = useSite();
  const create = useCreateStudent();
  const lic = useLicense();
  const gradesQ = useGradeList();
  const secQ = useSectionList();
  const sections = asArray<SectionOut>(secQ.data) ?? [];
  const [gradeId, setGradeId] = React.useState('');
  const [error, setError] = React.useState<unknown>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<StudentCreateOut | null>(null);

  const form = usePeopleForm(studentCreateBody, { defaultValues: { firstName: '', lastName: '', sectionId: '', createLogin: true, guardians: [] } });
  const { guard, dialog } = useUnsavedGuard(hasDirtyFields(form.formState) && !form.formState.isSubmitSuccessful);
  const { fields, append, remove } = useFieldArray({ control: anyControl(form.control), name: 'guardians' });
  const [chosen, setChosen] = React.useState<Record<string, GuardianOut | null>>({});
  const [modes, setModes] = React.useState<Record<string, 'new' | 'existing'>>({});

  const gradeSections = sections.filter((s) => !gradeId || s.gradeId === gradeId);
  const l = lic.data;
  const blocked = acc.readOnly || !acc.can('students:create', 'school');

  const logins: IssuedLogin[] = created
    ? [
        ...(created.credentials.student ? [{ label: `Student (${created.name})`, username: created.credentials.student.username, temporaryPassword: created.credentials.student.temporaryPassword }] : []),
        ...created.credentials.guardians.map((g) => ({ label: `Parent (${created.guardians.find((x) => x.guardianId === g.guardianId)?.name ?? 'new parent'})`, username: g.username, temporaryPassword: g.temporaryPassword })),
      ]
    : [];

  return (
    <>
      <PageHeader title="Add student" description="The student takes one licence seat for this academic year and is placed in a section straight away." crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Students', href: paths.students() }, { label: 'Add student' }]} />

      <div className="max-w-3xl space-y-4">
        {l && (
          <>
            {l.readOnly ? (
              <Banner tone="locked" title="The subscription has expired">The school is in read-only mode, so students cannot be added until it is renewed.</Banner>
            ) : l.seats.licensed !== null && (l.seats.remaining ?? 1) <= 0 ? (
              <Banner tone={l.overagePolicy === 'block' ? 'danger' : 'warning'} title={`All ${l.seats.licensed} seats are in use`}>
                {l.overagePolicy === 'block' ? 'Adding a student will be refused until seats are added to the subscription or students who left are archived.' : 'You can still add students; the extra seats are billed as a true-up at the end of the period.'}
              </Banner>
            ) : l.seats.licensed !== null ? (
              <Banner tone="info">
                {l.seats.used.toLocaleString()} of {l.seats.licensed.toLocaleString()} seats are in use{l.seats.remaining !== null ? `; ${l.seats.remaining.toLocaleString()} left` : ''} for {l.academicYear ?? 'this year'}.
              </Banner>
            ) : null}
          </>
        )}
        {!acc.can('students:create', 'school') && <Banner tone="danger">Your role cannot add students.</Banner>}

        <form
          noValidate
          onSubmit={form.handleSubmit(
            async (v) => {
              setError(null);
              setFormError(null);
              try {
                const res = await create.mutateAsync(v);
                form.reset(v); // clears the dirty state so leaving the page does not warn
                setCreated(res);
                if (!res.credentials.student && res.credentials.guardians.length === 0) router.push(paths.student(res.id));
              } catch (e) {
                const msg = applyApiErrors(form, e);
                if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && msg === null) return;
                setError(e);
              }
            },
            (errs) => setFormError(rootError(errs) ?? 'Some fields need attention. Check the highlighted fields.'),
          )}
        >
          <Card>
            <CardBody className="space-y-8">
              <FormSection title="Student">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormInput control={form.control} name="firstName" label="First name" required autoComplete="off" />
                  <FormInput control={form.control} name="lastName" label="Last name" autoComplete="off" />
                  <FormDate control={form.control} name="dob" label="Date of birth" max={new Date().toISOString().slice(0, 10)} />
                  <FormSelect control={form.control} name="gender" label="Gender" options={GENDER_OPTIONS} placeholder="Not set" />
                  <FormDate control={form.control} name="admissionDate" label="Admission date" hint="Defaults to today." />
                </div>
              </FormSection>

              <FormSection title="Class" description="Only sections of the current academic year can take new students.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <LabelledSelect
                    label="Grade"
                    value={gradeId}
                    onChange={(v) => {
                      setGradeId(v);
                      form.setValue('sectionId', '', { shouldDirty: true });
                    }}
                    options={gradeOptions(gradesQ.data)}
                    placeholder="Choose a grade"
                    required
                  />
                  <FormSelect
                    control={form.control}
                    name="sectionId"
                    label="Section"
                    required
                    placeholder={secQ.isPending ? 'Loading sections…' : gradeId ? 'Choose a section' : 'Choose a grade first'}
                    options={gradeSections.map((s) => ({ value: s.id, label: `${sectionLabel(s)} · ${s.studentCount}${s.capacity ? `/${s.capacity}` : ''} students` }))}
                  />
                  <FormNumber control={anyControl(form.control)} name="rollNo" label="Roll number" hint="Leave empty to assign the next one." min={1} max={9999} />
                </div>
                {secQ.isError && <Banner tone="danger">The sections could not be loaded. Reload the page to try again.</Banner>}
              </FormSection>

              <FormSection title="Sign-in">
                <FormCheckbox control={form.control} name="createLogin" label="Create a student login" hint={`The username is the admission number. A temporary password is shown once.${site && !site.features.studentLogin ? ' Student sign-in is switched off for this school, so the login stays unused until it is enabled.' : ''}`} />
              </FormSection>

              <FormSection title="Parents and guardians" description="Add up to four. A parent only sees the child after the school verifies the link.">
                <div className="space-y-4">
                  {fields.map((f, i) => {
                    const mode = modes[f.id] ?? 'new';
                    const pick = chosen[f.id];
                    const errs = (form.formState.errors as Record<string, unknown>).guardians as { message?: string; root?: { message?: string } }[] | undefined;
                    const itemErr = errs?.[i]?.message ?? errs?.[i]?.root?.message;
                    return (
                      <div key={f.id} className="space-y-4 rounded-lg border border-border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <p className="t-label">Parent {i + 1}</p>
                            <div className="inline-flex rounded-md border border-border bg-surface-subtle p-0.5" role="group" aria-label={`Parent ${i + 1} source`}>
                              {(['new', 'existing'] as const).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  aria-pressed={mode === m}
                                  onClick={() => {
                                    setModes((x) => ({ ...x, [f.id]: m }));
                                    if (m === 'new') {
                                      setChosen((c) => ({ ...c, [f.id]: null }));
                                      form.setValue(`guardians.${i}.guardianId` as never, undefined as never, { shouldDirty: true });
                                    }
                                  }}
                                  className={`tr-colors h-7 rounded-[6px] px-2.5 text-xs font-medium ${mode === m ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]' : 'text-ink-2 hover:text-ink'}`}
                                >
                                  {m === 'new' ? 'New parent' : 'Registered parent'}
                                </button>
                              ))}
                            </div>
                          </div>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove parent ${i + 1}`} onClick={() => remove(i)}>
                            <Trash2 />
                          </Button>
                        </div>
                        {mode === 'existing' ? (
                          pick ? (
                            <ChosenGuardian g={pick} onClear={() => { setChosen((c) => ({ ...c, [f.id]: null })); form.setValue(`guardians.${i}.guardianId` as never, undefined as never, { shouldDirty: true }); }} />
                          ) : (
                            <GuardianPicker
                              exclude={Object.values(chosen).filter((x): x is GuardianOut => !!x).map((x) => x.id)}
                              onPick={(g) => {
                                setChosen((c) => ({ ...c, [f.id]: g }));
                                form.setValue(`guardians.${i}.guardianId` as never, g.id as never, { shouldDirty: true });
                              }}
                            />
                          )
                        ) : (
                          <div className="grid gap-4 sm:grid-cols-2">
                            <FormInput control={anyControl(form.control)} name={`guardians.${i}.firstName`} label="First name" required autoComplete="off" />
                            <FormInput control={anyControl(form.control)} name={`guardians.${i}.lastName`} label="Last name" autoComplete="off" />
                            <FormInput control={anyControl(form.control)} name={`guardians.${i}.phone`} label="Mobile number" hint="Becomes the username." inputMode="tel" autoComplete="off" />
                            <FormInput control={anyControl(form.control)} name={`guardians.${i}.email`} label="Email" type="email" autoComplete="off" />
                          </div>
                        )}
                        <FormSelect control={anyControl(form.control)} name={`guardians.${i}.relationship`} label="Relationship to the student" options={RELATIONSHIP_OPTIONS} />
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <FormCheckbox control={anyControl(form.control)} name={`guardians.${i}.isPrimary`} label="Primary contact" />
                          <FormCheckbox control={anyControl(form.control)} name={`guardians.${i}.canPickup`} label="May pick the child up" />
                          <FormCheckbox control={anyControl(form.control)} name={`guardians.${i}.isEmergencyContact`} label="Emergency contact" />
                          {mode === 'new' && <FormCheckbox control={anyControl(form.control)} name={`guardians.${i}.createLogin`} label="Create a parent login" hint="Shown once after saving." />}
                          <FormCheckbox control={anyControl(form.control)} name={`guardians.${i}.verified`} label="Verify the relationship now" hint="Only when the school has checked it." className="sm:col-span-2" />
                        </div>
                        {itemErr && <p role="alert" className="t-caption text-danger">{itemErr}</p>}
                      </div>
                    );
                  })}
                  {fields.length < 4 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => append({ relationship: 'guardian', isPrimary: fields.length === 0, canPickup: true, isEmergencyContact: fields.length === 0, createLogin: true, verified: false })}
                    >
                      <Plus /> Add a parent
                    </Button>
                  )}
                </div>
              </FormSection>

              <Disclosure label="more details">
                <FormSection title="Background and health">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormSelect control={form.control} name="bloodGroup" label="Blood group" options={BLOOD_GROUPS.map((b) => ({ value: b, label: b }))} placeholder="Not set" />
                    <FormInput control={form.control} name="nationality" label="Nationality" autoComplete="off" />
                    <FormInput control={form.control} name="religion" label="Religion" autoComplete="off" />
                    <FormInput control={form.control} name="category" label="Category" autoComplete="off" />
                  </div>
                  <FormTextarea control={form.control} name="medicalNotes" label="Medical notes" hint="Allergies, conditions, medication." rows={3} />
                </FormSection>
                <FormSection title="Address">
                  <AddressFields control={anyControl(form.control)} />
                </FormSection>
              </Disclosure>

              {formError && <Banner tone="danger">{formError}</Banner>}
              <ErrorBanner error={error} />
            </CardBody>
            <FormActions className="rounded-b-lg">
              <Button type="button" variant="secondary" onClick={() => guard(() => router.push(paths.students()))}>
                Cancel
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting} disabled={blocked} title={blocked ? acc.hint('students:create', 'school') : undefined}>
                Add student
              </Button>
            </FormActions>
          </Card>
        </form>
      </div>
      {dialog}
      <CredentialsDialog
        open={!!created && logins.length > 0}
        onOpenChange={(o) => {
          if (!o && created) router.push(paths.student(created.id));
        }}
        title={`${created?.name ?? 'Student'} was added`}
        logins={logins}
        note={created ? <p className="t-caption text-ink-2">Admission number {created.admissionNo}. <Link href={paths.student(created.id)} className="text-brand-ink hover:underline">Open the record</Link> after you have copied the passwords.</p> : null}
      />
    </>
  );
}

