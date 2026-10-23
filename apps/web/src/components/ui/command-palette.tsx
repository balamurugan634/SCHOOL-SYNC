'use client';

import * as React from 'react';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import { Search } from 'lucide-react';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  keywords?: string[];
  onSelect: () => void;
}
export interface CommandGroup {
  heading: string;
  items: CommandItem[];
}

export function CommandPalette({ open, onOpenChange, groups, placeholder = 'Search pages and actions…' }: { open: boolean; onOpenChange: (o: boolean) => void; groups: CommandGroup[]; placeholder?: string }) {
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      loop
      overlayClassName="anim-overlay fixed inset-0 z-[70] bg-[var(--scrim)]"
      contentClassName="anim-palette fixed inset-x-0 top-[14vh] z-[71] mx-auto w-[calc(100vw-2rem)] max-w-xl overflow-hidden rounded-xl border border-border bg-surface-raised shadow-dialog focus:outline-none"
    >
      <D.Title className="sr-only">Command palette</D.Title>
      <D.Description className="sr-only">Type to search pages and actions, use the arrow keys to move and Enter to open.</D.Description>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search className="size-4 text-ink-3" aria-hidden />
        <Command.Input placeholder={placeholder} className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" />
        <kbd className="hidden rounded border border-border bg-surface-subtle px-1.5 text-[11px] leading-5 text-ink-3 sm:block">Esc</kbd>
      </div>
      <Command.List className="max-h-[min(55dvh,380px)] overflow-y-auto p-1.5">
        <Command.Empty className="px-4 py-8 text-center text-sm text-ink-2">Nothing matches that.</Command.Empty>
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <Command.Group key={g.heading} heading={g.heading} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
              {g.items.map((it) => (
                <Command.Item
                  key={it.id}
                  value={`${g.heading} ${it.label}`}
                  keywords={it.keywords}
                  onSelect={() => {
                    onOpenChange(false);
                    it.onSelect();
                  }}
                  className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm data-[selected=true]:bg-brand-soft data-[selected=true]:text-brand-ink"
                >
                  {it.icon && <span className="text-ink-3 [&_svg]:size-4">{it.icon}</span>}
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="truncate text-xs text-ink-3">{it.hint}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
      </Command.List>
    </Command.Dialog>
  );
}
