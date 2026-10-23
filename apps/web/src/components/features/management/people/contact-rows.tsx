'use client';

import * as React from 'react';
import { useFieldArray } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { anyControl } from './fields';

/** Repeatable contact rows (emergency contacts, authorised pickups): name · relationship · phone (+ ID proof for pickups). */
export function ContactRows({ control, name, addLabel, max = 10, withIdProof, emptyText }: { control: unknown; name: string; addLabel: string; max?: number; withIdProof?: boolean; emptyText: string }) {
  const c = anyControl(control);
  const { fields, append, remove } = useFieldArray({ control: c, name });
  return (
    <div className="space-y-3">
      {fields.length === 0 && <p className="text-sm text-ink-3">{emptyText}</p>}
      {fields.map((f, i) => (
        <div key={f.id} className="rounded-lg border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormInput control={c} name={`${name}.${i}.name`} label="Name" required autoComplete="off" />
            <FormInput control={c} name={`${name}.${i}.relationship`} label="Relationship" autoComplete="off" />
            <FormInput control={c} name={`${name}.${i}.phone`} label="Phone" required inputMode="tel" autoComplete="off" />
            {withIdProof && <FormInput control={c} name={`${name}.${i}.idProof`} label="ID proof" hint="For example, Aadhaar last 4 digits" autoComplete="off" />}
          </div>
          <div className="mt-2 flex justify-end">
            <IconButton label={`Remove row ${i + 1}`} variant="ghost" size="icon-sm" onClick={() => remove(i)}>
              <Trash2 />
            </IconButton>
          </div>
        </div>
      ))}
      {fields.length < max && (
        <Button type="button" variant="secondary" size="sm" onClick={() => append({ name: '', relationship: '', phone: '' })}>
          <Plus /> {addLabel}
        </Button>
      )}
    </div>
  );
}
