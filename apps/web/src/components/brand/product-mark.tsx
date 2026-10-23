import * as React from 'react';
import { cn } from '@/lib/cn';

/** The SchoolSync product mark (design/brand/mark.svg → public/brand/mark.svg). Not re-themed per school. */
export function ProductMark({ size = 28, className, wordmark }: { size?: number; className?: string; wordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img src="/brand/mark.svg" width={size} height={size} alt={wordmark ? '' : 'SchoolSync'} className="shrink-0" />
      {wordmark && <span className="text-sm font-semibold">SchoolSync</span>}
    </span>
  );
}
