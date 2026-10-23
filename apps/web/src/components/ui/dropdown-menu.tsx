'use client';

import * as React from 'react';
import { DropdownMenu as M } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuRadioGroup = M.RadioGroup;

/** Keyboard type-ahead comes from Radix. */
export function DropdownMenuContent({ className, sideOffset = 6, align = 'end', ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={sideOffset} align={align} collisionPadding={12} className={cn('anim-pop z-[80] min-w-52 rounded-lg border border-border bg-surface-raised p-1 shadow-pop focus:outline-none', className)} {...props} />
    </M.Portal>
  );
}

const item =
  'tr-colors relative flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:text-ink-disabled data-[highlighted]:bg-surface-subtle [&_svg]:size-4 [&_svg]:text-ink-3';

export function DropdownMenuItem({ className, danger, ...props }: React.ComponentProps<typeof M.Item> & { danger?: boolean }) {
  return <M.Item className={cn(item, danger && 'text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger', className)} {...props} />;
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem className={cn(item, 'pr-8', className)} {...props}>
      {children}
      <M.ItemIndicator className="absolute right-2.5">
        <Check className="!text-brand-ink" />
      </M.ItemIndicator>
    </M.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(item, 'pr-8', className)} {...props}>
      {children}
      <M.ItemIndicator className="absolute right-2.5">
        <Check className="!text-brand-ink" />
      </M.ItemIndicator>
    </M.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('t-caption px-2.5 pb-1 pt-1.5 font-medium text-ink-3', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
