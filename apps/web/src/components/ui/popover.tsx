'use client';

import * as React from 'react';
import { Popover as P } from 'radix-ui';
import { cn } from '@/lib/cn';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export function PopoverContent({ className, align = 'end', sideOffset = 6, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={sideOffset} collisionPadding={12} className={cn('anim-pop z-[80] w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-surface-raised p-0 shadow-pop focus:outline-none', className)} {...props} />
    </P.Portal>
  );
}
