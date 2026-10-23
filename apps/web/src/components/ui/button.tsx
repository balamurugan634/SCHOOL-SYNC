'use client';

import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * 36 px (32 small), 44 px on touch, 48 for `lg` on phones. States: default · hover · focus-visible (global) · active
 * (darker + scale .98) · disabled (ink-disabled on subtle, no hover) · loading (spinner replaces the label, width fixed).
 */
export const buttonVariants = cva(
  [
    'press relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium leading-4',
    'disabled:pointer-events-none disabled:border-transparent disabled:bg-surface-subtle disabled:text-ink-disabled disabled:shadow-none',
    'aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-press',
        secondary: 'border border-border-strong bg-surface text-ink hover:bg-surface-subtle active:bg-surface-sunken',
        ghost: 'text-ink-2 hover:bg-surface-subtle hover:text-ink active:bg-surface-sunken',
        /** destructive = danger text on its soft tint; solid only inside confirm dialogs */
        danger: 'bg-danger-soft text-danger hover:brightness-95 active:brightness-90 dark:hover:brightness-125',
        'danger-solid': 'bg-danger text-white hover:brightness-95 active:brightness-90 dark:text-[#1b0d0a]',
        link: 'h-auto rounded-sm p-0 text-brand-ink underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-10 px-3 sm:h-8',
        md: 'h-11 px-4 sm:h-9 sm:px-3.5',
        lg: 'h-12 px-5 sm:h-10',
        icon: 'size-11 sm:size-9',
        'icon-sm': 'size-10 sm:size-8',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({ className, variant, size, asChild, loading, disabled, children, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} type={asChild ? undefined : (type ?? 'button')} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="absolute animate-spin" aria-hidden />}
          <span className={cn('inline-flex items-center justify-center gap-2', loading && 'invisible')}>{children}</span>
        </>
      )}
    </Comp>
  );
}
