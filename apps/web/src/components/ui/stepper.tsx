import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface Step {
  id: string;
  label: string;
  description?: string;
}

/** Numbered (forms / wizards) or dots (tours) progress indicator. `current` is the active index. */
export function Stepper({ steps, current, variant = 'numbered', className }: { steps: Step[]; current: number; variant?: 'numbered' | 'dots'; className?: string }) {
  if (variant === 'dots') {
    return (
      <div className={cn('flex items-center gap-1.5', className)} role="group" aria-label={`Step ${current + 1} of ${steps.length}`}>
        {steps.map((s, i) => (
          <span key={s.id} aria-current={i === current ? 'step' : undefined} className={cn('h-1.5 rounded-full transition-[width,background-color] duration-200', i === current ? 'w-5 bg-brand' : 'w-1.5 bg-surface-sunken')} />
        ))}
      </div>
    );
  }
  return (
    <ol className={cn('flex w-full items-start', className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.id} className="relative flex flex-1 flex-col items-center text-center" aria-current={active ? 'step' : undefined}>
            {i > 0 && <span className={cn('absolute left-[-50%] right-[50%] top-3 h-px', done || active ? 'bg-brand' : 'bg-border-strong')} aria-hidden />}
            <span className={cn('relative z-10 grid size-6 place-items-center rounded-full border text-xs font-medium', done ? 'border-brand bg-brand text-on-brand' : active ? 'border-brand bg-surface text-brand-ink' : 'border-border-strong bg-surface text-ink-2')}>
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn('t-caption mt-1.5', active ? 'font-medium text-ink' : 'text-ink-2')}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
