'use client';

import * as React from 'react';
import { z } from 'zod';
import { roleCreateBody, roleUpdateBody, type RoleDetailOut, type RoleOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormInput, FormTextarea } from '@/components/ui/form';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/input';
import { useCreateRole, useUpdateRole } from '@/lib/client/settings';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { accessErrorMessage } from './user-bits';

const blank = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s);
const createSchema = z.object({ name: roleCreateBody.shape.name, description: blank(roleCreateBody.shape.description), cloneFromRoleId: blank(roleCreateBody.shape.cloneFromRoleId) });
const NONE = '__none__';

/** New custom role, optionally starting from another role's grants. */
export function CreateRoleDialog({ open, onOpenChange, roles, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; roles: RoleOut[]; onCreated: (r: RoleDetailOut) => void }) {
  const create = useCreateRole();
  const form = useZodForm(createSchema, { defaultValues: { name: '', description: '' } });
  const [formError, setFormError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      form.reset({ name: '', description: '' });
      setFormError(null);
    }
  }, [open, form]);
  const clone = (form.watch('cloneFromRoleId') as string | undefined) ?? NONE;
  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent title="Create a role" description="A custom role starts empty, or as a copy of an existing role that you then adjust.">
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            setFormError(null);
            try {
              const r = await create.mutateAsync(v as never);
              onOpenChange(false);
              onCreated(r);
            } catch (e) {
              setFormError(accessErrorMessage(e) ?? applyApiErrors(form, e));
            }
          })}
        >
          <FormInput control={form.control} name="name" label="Role name" required hint="For example Lab assistant or Front desk." autoComplete="off" />
          <FormTextarea control={form.control} name="description" label="Description" rows={2} maxLength={300} hint="Optional. Helps the next administrator understand who this role is for." />
          <Field label="Start from" htmlFor="role-clone" hint="Copies that role’s permissions. You can only copy access you hold yourself (unless you are a super administrator).">
            <Select id="role-clone" value={clone} onValueChange={(v) => form.setValue('cloneFromRoleId', v === NONE ? undefined : v, { shouldDirty: true })} options={[{ value: NONE, label: 'Nothing: no permissions' }, ...roles.filter((r) => r.key !== 'super_admin').map((r) => ({ value: r.id, label: r.name }))]} />
          </Field>
          {formError && <Banner tone="danger">{formError}</Banner>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Create role</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const editSchema = z.object({ name: roleUpdateBody.shape.name, description: z.string().trim().max(300) });

/** Rename / re-describe (the role key never changes). */
export function EditRoleDialog({ open, onOpenChange, role }: { open: boolean; onOpenChange: (o: boolean) => void; role: RoleDetailOut }) {
  const update = useUpdateRole(role.id);
  const form = useZodForm(editSchema, { defaultValues: { name: role.name, description: role.description ?? '' } });
  const [formError, setFormError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      form.reset({ name: role.name, description: role.description ?? '' });
      setFormError(null);
    }
  }, [open, role, form]);
  return (
    <Dialog open={open} onOpenChange={(o) => !update.isPending && onOpenChange(o)}>
      <DialogContent title="Edit role details" description={`The role key “${role.key}” never changes, so integrations keep working.`}>
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            setFormError(null);
            try {
              await update.mutateAsync({ name: v.name, description: v.description || null });
              onOpenChange(false);
            } catch (e) {
              setFormError(accessErrorMessage(e) ?? applyApiErrors(form, e));
            }
          })}
        >
          <FormInput control={form.control} name="name" label="Role name" required autoComplete="off" />
          <FormTextarea control={form.control} name="description" label="Description" rows={3} maxLength={300} />
          {formError && <Banner tone="danger">{formError}</Banner>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={update.isPending}>Cancel</Button>
            <Button type="submit" loading={update.isPending} disabled={!hasDirtyFields(form.formState)}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
