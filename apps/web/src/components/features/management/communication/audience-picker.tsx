'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { ROLE_PRESETS, USER_TYPES, scopeAtLeast, type AudienceTargetIn, type AudienceTargetOut, type AudienceTargetType } from '@school-sync/shared';
import { useGetQuery, useGradeList, useSectionList } from '@/lib/client/mgmt';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useMgmt } from '../common/use-mgmt';

const TYPE_LABEL: Record<AudienceTargetType, string> = { all: 'Everyone', user_type: 'A group of people', role: 'A role', grade: 'A grade', section: 'A class (section)' };
const USER_TYPE_LABEL: Record<string, string> = { student: 'All students', parent: 'All parents and guardians', staff: 'All staff' };

/**
 * Who a message or event is for: everyone, a user type, a role, a grade or a section. What a person may choose follows their
 * permission scope: school-wide editors can use every kind; a teacher (assigned scope) can only pick the sections they lead
 * or teach. The API enforces the same rule.
 */
export function AudiencePicker({
  value,
  onChange,
  perm,
  initialLabels,
  error,
  hint,
}: {
  value: AudienceTargetIn[];
  onChange: (v: AudienceTargetIn[]) => void;
  perm: 'announcements:create' | 'events:create';
  /** labels the API already gave us for an existing audience (edit mode) */
  initialLabels?: AudienceTargetOut[];
  error?: string | null;
  hint?: string;
}) {
  const { me, can } = useMgmt();
  const broad = scopeAtLeast(me.permissions[perm], 'school');
  const grades = useGradeList();
  const sections = useSectionList();
  const roles = useGetQuery<{ data: { key: string; name: string }[] }>(['mgmt', 'roles'], '/roles', undefined, { enabled: broad && can('roles:view'), staleTime: 5 * 60_000 });
  const allowedSections = React.useMemo(() => (sections.data ?? []).filter((s) => broad || me.profile.assignedSectionIds.includes(s.id)), [sections.data, broad, me.profile.assignedSectionIds]);
  const roleOptions = React.useMemo(() => {
    const preset = Object.values(ROLE_PRESETS).map((r) => ({ value: r.key, label: r.name }));
    const custom = (roles.data?.data ?? []).filter((r) => !preset.some((p) => p.value === r.key)).map((r) => ({ value: r.key, label: r.name }));
    return [...preset, ...custom];
  }, [roles.data]);

  const types: AudienceTargetType[] = broad ? ['all', 'user_type', 'role', 'grade', 'section'] : ['section'];
  const [type, setType] = React.useState<AudienceTargetType>(types[0]!);
  const [target, setTarget] = React.useState('');
  React.useEffect(() => setTarget(''), [type]);

  const label = (t: AudienceTargetIn): string => {
    const known = initialLabels?.find((l) => l.type === t.type && l.id === (t.id ?? '*'))?.label;
    if (t.type === 'all') return 'Everyone';
    if (t.type === 'user_type') return USER_TYPE_LABEL[t.id ?? ''] ?? known ?? t.id ?? '';
    if (t.type === 'role') return `Role: ${roleOptions.find((r) => r.value === t.id)?.label ?? known ?? t.id}`;
    if (t.type === 'grade') return grades.data?.find((g) => g.id === t.id)?.name ?? known ?? 'Grade';
    const s = sections.data?.find((x) => x.id === t.id);
    return s ? `${s.gradeName} ${s.name}` : (known ?? 'Class');
  };

  const needsTarget = type !== 'all';
  const options =
    type === 'user_type'
      ? USER_TYPES.map((u) => ({ value: u, label: USER_TYPE_LABEL[u] ?? u }))
      : type === 'role'
        ? roleOptions
        : type === 'grade'
          ? (grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))
          : type === 'section'
            ? allowedSections.map((s) => ({ value: s.id, label: `${s.gradeName} ${s.name}` }))
            : [];

  const add = () => {
    if (needsTarget && !target) return;
    const next: AudienceTargetIn = type === 'all' ? { type: 'all' } : { type, id: target };
    if (value.some((v) => v.type === next.type && (v.id ?? '') === (next.id ?? ''))) return;
    onChange(type === 'all' ? [next] : [...value.filter((v) => v.type !== 'all'), next]);
    setTarget('');
  };
  const idKey = React.useId();

  return (
    <Field label="Audience" required error={error} hint={hint ?? (broad ? 'Students and parents are reached through their grade or class; staff through a role or group.' : 'You can post to the classes you lead or teach.')}>
      <div className="space-y-3">
        {value.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Selected audience">
            {value.map((t) => (
              <li key={`${t.type}:${t.id ?? ''}`} className="inline-flex items-center gap-1 rounded-md bg-brand-soft py-1 pl-2.5 pr-1 text-[13px] font-medium text-brand-ink">
                {label(t)}
                <button type="button" onClick={() => onChange(value.filter((v) => v !== t))} aria-label={`Remove ${label(t)}`} className="tr-colors grid size-5 place-items-center rounded-full hover:bg-brand/15">
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          {types.length > 1 && (
            <div className="w-full sm:w-48">
              <Select aria-label="Audience type" value={type} onValueChange={(v) => setType(v as AudienceTargetType)} options={types.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
            </div>
          )}
          {needsTarget && (
            <div className="w-full min-w-0 sm:w-56">
              <Select aria-label={`Choose ${TYPE_LABEL[type].toLowerCase()}`} id={idKey} value={target} onValueChange={setTarget} options={options} placeholder={options.length === 0 && (sections.isPending || grades.isPending) ? 'Loading…' : 'Choose'} />
            </div>
          )}
          <Button type="button" variant="secondary" onClick={add} disabled={needsTarget && !target}>
            <Plus /> Add
          </Button>
        </div>
        {!broad && allowedSections.length === 0 && !sections.isPending && <p className="t-caption text-warning">You have no classes assigned yet, so there is nobody you can post to.</p>}
      </div>
    </Field>
  );
}
