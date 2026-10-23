import * as React from 'react';
import { cn } from '@/lib/cn';

/** Layered paper: surface + 1 px border + radius 12 + whisper shadow. Interactive cards lift on hover (150 ms). */
export function Card({ className, interactive, ...props }: React.ComponentProps<'div'> & { interactive?: boolean }) {
  return <div className={cn('rounded-lg border border-border bg-surface shadow-card', interactive && 'tr-colors hover:border-border-strong hover:shadow-card-hover', className)} {...props} />;
}

export function CardHeader({ className, title, description, action, ...props }: Omit<React.ComponentProps<'div'>, 'title'> & { title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5 max-sm:px-4 max-sm:pt-4', className)} {...props}>
      <div className="min-w-0">
        {title && <h2 className="t-section">{title}</h2>}
        {description && <p className="t-caption mt-0.5 text-ink-2">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-5 max-sm:p-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2 border-t border-border px-5 py-3 max-sm:px-4', className)} {...props} />;
}
