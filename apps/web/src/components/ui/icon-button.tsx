'use client';

import * as React from 'react';
import { Button, type ButtonProps } from './button';
import { Tooltip } from './tooltip';

/** Icon-only button: always has a tooltip and an accessible name (`label`). 36×36, 44×44 on touch. */
export function IconButton({ label, variant = 'ghost', size = 'icon', children, tooltipSide, ...props }: Omit<ButtonProps, 'aria-label'> & { label: string; tooltipSide?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <Button variant={variant} size={size} aria-label={label} {...props}>
        {children}
      </Button>
    </Tooltip>
  );
}
