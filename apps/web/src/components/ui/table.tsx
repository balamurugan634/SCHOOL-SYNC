import * as React from 'react';
import { cn } from '@/lib/cn';

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table className={cn('t-table w-full caption-bottom border-separate border-spacing-0', className)} {...props} />;
}
export function THead(props: React.ComponentProps<'thead'>) {
  return <thead {...props} />;
}
export function TBody(props: React.ComponentProps<'tbody'>) {
  return <tbody {...props} />;
}
export function TR({ className, interactive, selected, ...props }: React.ComponentProps<'tr'> & { interactive?: boolean; selected?: boolean }) {
  return <tr className={cn('group/row tr-colors', interactive && 'cursor-pointer', 'hover:bg-surface-subtle', selected && 'bg-brand-soft hover:bg-brand-soft', className)} {...props} />;
}
/** Sticky subtle header; column heads may be ≤ 11 px caps (+0.04em) per design.md §3. */
export function TH({ className, align = 'left', ...props }: React.ComponentProps<'th'> & { align?: 'left' | 'right' | 'center' }) {
  return <th className={cn('t-colhead sticky top-0 z-[1] h-10 whitespace-nowrap border-b border-border bg-surface-subtle px-4 text-ink-2', align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)} {...props} />;
}
/** 44 px rows (36 compact), hairline separators only — no cell borders, no zebra. */
export function TD({ className, align = 'left', compact, ...props }: React.ComponentProps<'td'> & { align?: 'left' | 'right' | 'center'; compact?: boolean }) {
  return <td className={cn(compact ? 'h-9' : 'h-11', 'border-b border-border px-4 align-middle group-last/row:border-b-0', align === 'right' ? 'text-right tabular-nums' : align === 'center' ? 'text-center' : 'text-left', className)} {...props} />;
}
