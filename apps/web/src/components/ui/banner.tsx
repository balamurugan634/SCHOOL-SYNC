'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, Lock, X, XCircle } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const banner = cva('flex items-start gap-3 border px-4 py-3 text-sm', {
  variants: {
    tone: {
      info: 'border-brand/20 bg-brand-soft text-ink',
      success: 'border-success/25 bg-success-soft text-ink',
      warning: 'border-warning/25 bg-warning-soft text-ink',
      danger: 'border-danger/25 bg-danger-soft text-ink',
      locked: 'border-warning/25 bg-warning-soft text-ink',
    },
    shape: { inline: 'rounded-lg', bar: 'border-x-0 border-t-0' },
  },
  defaultVariants: { tone: 'info', shape: 'inline' },
});

const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle, locked: Lock } as const;
const iconColor = { info: 'text-brand-ink', success: 'text-success', warning: 'text-warning', danger: 'text-danger', locked: 'text-warning' } as const;

export interface BannerProps extends VariantProps<typeof banner> {
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
  role?: 'status' | 'alert';
  ref?: React.Ref<HTMLDivElement>;
}

/** Flat tint with a status icon (status is never colour alone). */
export function Banner({ tone = 'info', shape, title, children, action, onDismiss, className, role, ref }: BannerProps) {
  const t = tone ?? 'info';
  const Icon = icons[t];
  return (
    <div ref={ref} role={role ?? (t === 'danger' ? 'alert' : 'status')} className={cn(banner({ tone, shape }), className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconColor[t])} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium leading-5">{title}</p>}
        {children && <div className={cn('leading-5 text-ink-2', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="tr-colors -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:text-ink">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
