'use client';

import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * A button that stays visible but disabled — with the reason as a tooltip — when the user may not do it
 * (no permission, or the school is read-only). `blocked` = the reason, or null/undefined when allowed.
 */
export function GuardedButton({ blocked, children, ...props }: ButtonProps & { blocked?: string | null }) {
  if (!blocked) return <Button {...props}>{children}</Button>;
  return (
    <Tooltip content={blocked}>
      <span className="inline-flex" tabIndex={0} role="group" aria-label={`${typeof children === 'string' ? children : 'Action'} unavailable: ${blocked}`}>
        <Button {...props} disabled aria-disabled>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}
