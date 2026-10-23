'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { Avatar } from '../ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { useMeContext } from '../me-context';
import { assetUrl } from '@/lib/assets';

/** Parent shell: pick which linked child the whole app is showing. */
export function ChildSwitcher() {
  const { me, childId, setChildId } = useMeContext();
  const kids = me.profile.children;
  const current = kids.find((k) => k.studentId === childId) ?? kids[0];

  if (!current) {
    return (
      <span className="inline-flex h-9 items-center whitespace-nowrap rounded-md border border-border px-3 text-[13px] text-muted-foreground" title="The school hasn’t verified a link between your account and a child yet.">
        <span className="hidden sm:inline">No linked children</span>
        <span className="sm:hidden">0 children</span>
      </span>
    );
  }
  const label = [current.grade, current.section].filter(Boolean).join(' · ');
  if (kids.length === 1) {
    return (
      <span className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-2">
        <Avatar name={current.name} src={assetUrl(current.photoUrl)} size="xs" />
        <span className="max-w-32 truncate text-[13px] font-medium">{current.name}</span>
        {label && <span className="hidden text-xs text-muted-foreground sm:inline">{label}</span>}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-2 hover:bg-surface-2" aria-label={`Viewing ${current.name}. Switch child`}>
          <Avatar name={current.name} src={assetUrl(current.photoUrl)} size="xs" />
          <span className="max-w-28 truncate text-[13px] font-medium">{current.name}</span>
          <ChevronsUpDown className="size-3.5 text-subtle" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your children</DropdownMenuLabel>
        {kids.map((k) => (
          <DropdownMenuItem key={k.studentId} onSelect={() => setChildId(k.studentId)} className="h-auto gap-3 py-1.5">
            <Avatar name={k.name} src={assetUrl(k.photoUrl)} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{k.name}</span>
              <span className="block text-xs text-muted-foreground">{[k.grade, k.section].filter(Boolean).join(' · ') || k.admissionNo}</span>
            </span>
            {k.studentId === current.studentId && <Check className="!text-primary-ink" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
