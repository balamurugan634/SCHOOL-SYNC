'use client';

import * as React from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { userCreateBody } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer, DrawerContent } from '@/components/ui/dialog';
import { FormInput, FormSection } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useStaffPicker } from '@/lib/client/options';
import { useCreateUser, useRoles, type UserCreated } from '@/lib/client/settings';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { useAccess } from '../shared/access';
import { paths } from '../shared/paths';
import { accessErrorMessage } from './user-bits';

/** Empty inputs must mean "not given" (the shared schema validates a present value). */
const blank = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s);
const schema = z.object({
  displayName: userCreateBody.shape.displayName,
  username: blank(userCreateBody.shape.username),
  email: blank(userCreateBody.shape.email),
  phone: blank(userCreateBody.shape.phone),
  staffId: blank(userCreateBody.shape.staffId),
  roleIds: userCreateBody.shape.roleIds,
});

const NONE = '__none__';

/** Create a staff sign-in (POST /users). The temporary password comes back once, so the parent shows it in a copy dialog. */
export function UserCreateDrawer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (u: UserCreated) => void }) {
  const access = useAccess();
  const canRoles = access.can('roles:edit', 'school') && access.can('roles:view', 'school');
  const roles = useRoles(open && canRoles);
  const staff = useStaffPicker({ enabled: open });
  const create = useCreateUser();
  const form = useZodForm(schema, { defaultValues: { displayName: '', roleIds: [] } });
  const [formError, setFormError] = React.useState<string | null>(null);
  const { guard, dialog } = useUnsavedGuard(hasDirtyFields(form.formState));
  React.useEffect(() => {
    if (open) {
      form.reset({ displayName: '', roleIds: [] });
      setFormError(null);
    }
  }, [open, form]);

  const staffWithoutLogin = (staff.data ?? []).filter((s) => !s.hasLogin);
  const eligibleRoles = (roles.data ?? []).filter((r) => r.key !== 'student' && r.key !== 'parent');
  const roleIds = form.watch('roleIds') ?? [];

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      const body = { ...v, roleIds: canRoles && v.roleIds?.length ? v.roleIds : undefined };
      const out = await create.mutateAsync(body as never);
      onOpenChange(false);
      onCreated(out);
    } catch (e) {
      setFormError(applyApiErrors(form, e) ?? null);
      const friendly = accessErrorMessage(e);
      if (friendly) setFormError(friendly);
    }
  });

  return (
    <>
      {dialog}
      <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : guard(() => onOpenChange(false)))}>
        <DrawerContent title="Create a staff account" description="A sign-in for someone who works at the school." showTitle onInteractOutside={(e) => { if (hasDirtyFields(form.formState)) { e.preventDefault(); guard(() => onOpenChange(false)); } }}>
          <form onSubmit={onSubmit} noValidate className="flex min-h-full flex-col">
            <div className="flex-1 space-y-6 px-5 py-4">
              <Banner tone="info">
                This creates a sign-in only. To add a teacher with an employee ID, designation and class assignments, use <Link className="font-medium text-brand-ink underline underline-offset-4" href={paths.staffNew}>People → Staff</Link>.
              </Banner>
              <FormSection title="Who">
                <FormInput control={form.control} name="displayName" label="Full name" required autoComplete="off" />
                <FormInput control={form.control} name="username" label="Username" hint="Optional. Letters, digits and . _ @ - (3 or more). Leave it empty and one is generated." autoComplete="off" />
                <FormInput control={form.control} name="email" label="Email" type="email" hint="Used for password recovery. Optional." autoComplete="off" />
                <FormInput control={form.control} name="phone" label="Phone" type="tel" autoComplete="off" />
              </FormSection>
              {staff.isSuccess && staffWithoutLogin.length > 0 && (
                <FormSection title="Staff record" description="Optional. Attach the sign-in to a staff member who does not have one yet; otherwise a minimal profile is created.">
                  <Field label="Staff member" htmlFor="uc-staff">
                    <Select id="uc-staff" value={(form.watch('staffId') as string | undefined) ?? NONE} onValueChange={(v) => form.setValue('staffId', v === NONE ? undefined : v, { shouldDirty: true })} options={[{ value: NONE, label: 'Create a new minimal profile' }, ...staffWithoutLogin.map((s) => ({ value: s.id, label: `${s.name} (${s.employeeId})` }))]} />
                  </Field>
                </FormSection>
              )}
              <FormSection title="Roles" description={canRoles ? 'What this person can do. You can change it later.' : undefined}>
                {!canRoles ? (
                  <p className="text-sm text-ink-2">Your role cannot assign roles. The account is created without any; someone with the “edit roles” permission can add them afterwards.</p>
                ) : roles.isPending ? (
                  <p className="text-sm text-ink-2">Loading roles…</p>
                ) : roles.isError ? (
                  <Banner tone="warning">We could not load the roles. You can create the account now and assign roles afterwards.</Banner>
                ) : (
                  <ul className="space-y-1 rounded-lg border border-border p-2">
                    {eligibleRoles.map((r) => {
                      const id = `ucr-${r.id}`;
                      return (
                        <li key={r.id} className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-subtle">
                          <Checkbox id={id} className="mt-0.5" checked={roleIds.includes(r.id)} onCheckedChange={(c) => form.setValue('roleIds', c === true ? [...roleIds, r.id] : roleIds.filter((x) => x !== r.id), { shouldDirty: true })} />
                          <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                            <span className="font-medium">{r.name}</span>
                            {r.description && <span className="t-caption block text-ink-2">{r.description}</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </FormSection>
              {formError && <Banner tone="danger">{formError}</Banner>}
            </div>
            <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-raised px-5 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button type="button" variant="secondary" onClick={() => guard(() => onOpenChange(false))}>Cancel</Button>
              <Button type="submit" loading={create.isPending} disabled={access.readOnly} title={access.hint('users:create', 'school')}>Create account</Button>
            </div>
          </form>
        </DrawerContent>
      </Drawer>
    </>
  );
}
