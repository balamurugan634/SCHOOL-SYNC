import * as React from 'react';
import { assetUrl } from '@/lib/assets';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/color';

const sizes = { sm: 'size-7 rounded-md text-[11px]', md: 'size-9 rounded-md text-[13px]', lg: 'size-12 rounded-lg text-base' } as const;

/** The school's logo, or a flat brand-colour tile with its initials until one is uploaded. */
export function SchoolMark({ name, logoUrl, size = 'md', className }: { name: string; logoUrl?: string | null; size?: keyof typeof sizes; className?: string; onDark?: boolean }) {
  const src = assetUrl(logoUrl);
  return (
    <span className={cn('inline-grid shrink-0 place-items-center overflow-hidden font-semibold', sizes[size], src ? 'border border-border bg-surface p-0.5' : 'bg-primary text-primary-foreground', className)} aria-hidden>
      {src ? <img src={src} alt="" className="size-full object-contain" /> : initials(name)}
    </span>
  );
}
