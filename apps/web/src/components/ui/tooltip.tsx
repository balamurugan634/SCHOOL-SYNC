'use client';

import * as React from 'react';
import { Tooltip as T } from 'radix-ui';
import { cn } from '@/lib/cn';

/** Delay 400 ms; Esc closes (Radix). */
export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <T.Provider delayDuration={400} skipDelayDuration={300}>
    {children}
  </T.Provider>
);

export function Tooltip({ content, children, side = 'bottom', className }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left'; className?: string }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} collisionPadding={10} className={cn('anim-pop t-caption z-[90] max-w-64 rounded-md bg-ink px-2 py-1 font-medium text-bg', className)}>
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
