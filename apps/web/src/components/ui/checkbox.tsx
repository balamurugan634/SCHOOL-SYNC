'use client';

import * as React from 'react';
import { Checkbox as C } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

/** 18 px box; checked / indeterminate fill with the brand colour. */
export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        'tr-colors grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-border-strong bg-surface text-on-brand hover:border-ink-3',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand',
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-subtle',
        className,
      )}
      {...props}
    >
      <C.Indicator>{props.checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}</C.Indicator>
    </C.Root>
  );
}
