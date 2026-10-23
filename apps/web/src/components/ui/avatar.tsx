'use client';

import * as React from 'react';
import { Avatar as A } from 'radix-ui';
import { cn } from '@/lib/cn';
import { initials, ROLE_TINT } from '@/lib/color';

const sizes = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-[13px]', lg: 'size-14 text-base', xl: 'size-20 text-xl' } as const;

/** Initials on `--surface-sunken`. A ring in the role tint marks the signed-in user (and only them). */
export function Avatar({ name, src, size = 'md', className, ring, role }: { name: string; src?: string | null; size?: keyof typeof sizes; className?: string; ring?: boolean; role?: keyof typeof ROLE_TINT }) {
  const tint = ring && role ? ROLE_TINT[role] : undefined;
  return (
    <A.Root className={cn('relative inline-flex shrink-0 select-none overflow-hidden rounded-full', sizes[size], tint && 'ring-2 ring-offset-2 ring-offset-surface', className)} style={tint ? ({ ['--tw-ring-color' as string]: tint } as React.CSSProperties) : undefined}>
      {src && <A.Image src={src} alt="" className="size-full object-cover" />}
      <A.Fallback delayMs={src ? 300 : 0} className="grid size-full place-items-center bg-surface-sunken font-medium text-ink-2" aria-label={name}>
        {initials(name)}
      </A.Fallback>
    </A.Root>
  );
}

/** Overlapping stack (8 px overlap) with a "+N" overflow. */
export function AvatarStack({ names, max = 4, size = 'sm' }: { names: string[]; max?: number; size?: 'xs' | 'sm' | 'md' }) {
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size={size} className={cn('border-2 border-surface', i > 0 && '-ml-2')} />
      ))}
      {more > 0 && <span className={cn('-ml-2 grid place-items-center rounded-full border-2 border-surface bg-surface-sunken font-medium text-ink-2', sizes[size])}>+{more}</span>}
    </div>
  );
}
