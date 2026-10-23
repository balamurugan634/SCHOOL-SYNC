'use client';

import * as React from 'react';
import { Accordion as A } from 'radix-ui';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Accordion = A.Root;

export function AccordionItem({ className, ...props }: React.ComponentProps<typeof A.Item>) {
  return <A.Item className={cn('border-b border-border last:border-b-0', className)} {...props} />;
}

/** Height animates 200 ms; the chevron rotates. */
export function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof A.Trigger>) {
  return (
    <A.Header className="flex">
      <A.Trigger className={cn('tr-colors group flex flex-1 items-center gap-3 px-5 py-3 text-left hover:bg-surface-subtle max-sm:px-4', className)} {...props}>
        {children}
        <ChevronDown className="ml-auto size-4 shrink-0 text-ink-3 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden />
      </A.Trigger>
    </A.Header>
  );
}

export function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof A.Content>) {
  return (
    <A.Content className="anim-accordion overflow-hidden" {...props}>
      <div className={cn('px-5 pb-4 pt-1 max-sm:px-4', className)}>{children}</div>
    </A.Content>
  );
}
