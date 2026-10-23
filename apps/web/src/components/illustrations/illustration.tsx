import * as React from 'react';
import { ILLUSTRATIONS, type IllustrationName } from './generated';
import { cn } from '@/lib/cn';

export type { IllustrationName };
export const ILLUSTRATION_NAMES = Object.keys(ILLUSTRATIONS) as IllustrationName[];

/**
 * "Soft geometry" illustration (design.md §7), re-coloured by the school's colour through CSS variables.
 * Only for onboarding, sign-in, empty / no-results, success, error / offline and first-use screens — never in data views.
 * Decorative by default (`aria-hidden`); pass `title` to expose it to screen readers.
 */
export function Illustration({ name, title, className, role }: { name: IllustrationName; title?: string; className?: string; /** onboarding heroes take the role tint as their accent */ role?: 'student' | 'parent' | 'teacher' | 'management' }) {
  const def = ILLUSTRATIONS[name];
  if (!def) return null;
  return (
    <svg
      viewBox={def.viewBox}
      className={cn('h-auto w-full', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={role ? ({ ['--ill-accent' as string]: `var(--role-${role})`, ['--ill-accent-soft' as string]: `var(--role-${role}-soft)` } as React.CSSProperties) : undefined}
    >
      {def.body}
    </svg>
  );
}
