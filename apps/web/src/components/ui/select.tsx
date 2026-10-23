'use client';

import * as React from 'react';
import { Select as S } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { controlBase } from './input';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  onValueChange?: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** Radix mounts every item even while the list is closed. Long lists (a staff picker repeated in a grid) mount only the chosen item until opened. */
const LAZY_ABOVE = 30;

export function Select({ value, onValueChange, options, placeholder = 'Select…', id, disabled, invalid, className, ...rest }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const shown = open || options.length <= LAZY_ABOVE ? options : options.filter((o) => o.value === value);
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled} open={open} onOpenChange={setOpen}>
      <S.Trigger id={id} aria-invalid={invalid || undefined} aria-label={rest['aria-label']} className={cn(controlBase, 'flex h-11 items-center justify-between gap-2 whitespace-nowrap px-3 text-left sm:h-9 data-[placeholder]:text-ink-3', className)}>
        {/* one line, ellipsis when it doesn't fit: the trigger has a fixed height, so wrapped text would spill over the border */}
        <S.Value placeholder={placeholder} className="block min-w-0 flex-1 truncate" />
        <S.Icon className="shrink-0">
          <ChevronDown className="size-4 text-ink-3" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="anim-pop z-[80] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface-raised p-1 shadow-pop">
          <S.Viewport>
            {shown.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className="relative flex h-9 cursor-pointer select-none items-center rounded-md pl-2.5 pr-8 text-sm outline-none data-[disabled]:text-ink-disabled data-[highlighted]:bg-surface-subtle data-[state=checked]:font-medium">
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="absolute right-2.5">
                  <Check className="size-4 text-brand-ink" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
