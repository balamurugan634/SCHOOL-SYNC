'use client';

import * as React from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Remembers whether the (controlled) dialog/sheet is open so its content can be kept on screen while the exit animation plays.
 * Many screens render the body only while their `open` state is set, which would otherwise blank the panel the instant it starts closing.
 */
const OpenContext = React.createContext<boolean | undefined>(undefined);

function useRetainedChildren(children: React.ReactNode): React.ReactNode {
  const open = React.useContext(OpenContext);
  const [retained, setRetained] = React.useState<React.ReactNode>(children);
  React.useEffect(() => {
    if (open !== false && children != null && children !== false) setRetained(children);
  }, [open, children]);
  return open === false ? retained : children;
}

export function Dialog(props: React.ComponentProps<typeof D.Root>) {
  return (
    <OpenContext.Provider value={props.open}>
      <D.Root {...props} />
    </OpenContext.Provider>
  );
}
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const closeBtn = 'tr-colors absolute right-3 top-3 grid size-9 place-items-center rounded-md text-ink-3 hover:bg-surface-subtle hover:text-ink sm:size-8';

/**
 * Centred dialog (max 480 / 640), radius 16, over a 40 % scrim. On phones it becomes a bottom sheet.
 * Title, body, actions — no coloured header band. Focus is trapped and restored (Radix).
 */
export function DialogContent({
  className,
  children,
  title,
  description,
  hideClose,
  showTitle = true,
  size = 'md',
  ...props
}: React.ComponentProps<typeof D.Content> & { title: string; description?: string; hideClose?: boolean; showTitle?: boolean; size?: 'md' | 'lg' }) {
  const body = useRetainedChildren(children);
  return (
    <D.Portal>
      <D.Overlay className="anim-overlay fixed inset-0 z-[70] bg-[var(--scrim)]" />
      <D.Content
        className={cn(
          'anim-dialog fixed z-[71] overflow-y-auto border border-border bg-surface-raised p-5 shadow-dialog focus:outline-none',
          'max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[88dvh] max-sm:rounded-t-xl max-sm:border-b-0 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]',
          // centred with inset + auto margins, NOT a translate: the enter/exit animation uses `transform`, and Tailwind's translate would stack with it (dialog starts off-centre, then snaps)
          'sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[min(90dvh,760px)] sm:w-[calc(100vw-2rem)] sm:rounded-xl',
          size === 'lg' ? 'sm:max-w-[640px]' : 'sm:max-w-[480px]',
          className,
        )}
        {...props}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border-strong sm:hidden" aria-hidden />
        <div className={cn(!showTitle && 'sr-only', 'pr-8')}>
          <D.Title className="t-section">{title}</D.Title>
          {description ? <D.Description className="mt-1 text-sm text-ink-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        </div>
        {body}
        {!hideClose && (
          <D.Close className={closeBtn} aria-label="Close">
            <X className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

type Side = 'right' | 'left';

export function Sheet({ children, ...props }: React.ComponentProps<typeof D.Root>) {
  return (
    <OpenContext.Provider value={props.open}>
      <D.Root {...props}>{children}</D.Root>
    </OpenContext.Provider>
  );
}
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

/**
 * Drawer / sheet for forms and detail: 480 px from the right on desktop, a bottom sheet with a drag handle on phones.
 * `side="left"` is the navigation drawer. Forms inside should use the unsaved-changes guard (onInteractOutside).
 */
export function SheetContent({
  side = 'right',
  className,
  children,
  title,
  description,
  showTitle = false,
  ...props
}: React.ComponentProps<typeof D.Content> & { side?: Side; title: string; description?: string; showTitle?: boolean }) {
  const body = useRetainedChildren(children);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ y: number } | null>(null);

  // phone: drag the handle down to dismiss
  const onDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !contentRef.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    contentRef.current.style.transform = `translateY(${dy}px)`;
    contentRef.current.style.transition = 'none';
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current || !contentRef.current) return;
    const dy = e.clientY - drag.current.y;
    drag.current = null;
    contentRef.current.style.transition = '';
    contentRef.current.style.transform = '';
    if (dy > 90) closeRef.current?.click();
  };

  return (
    <D.Portal>
      <D.Overlay className="anim-overlay fixed inset-0 z-[70] bg-[var(--scrim)]" />
      <D.Content
        ref={contentRef}
        className={cn(
          'fixed z-[71] flex flex-col overflow-hidden border-border bg-surface-raised shadow-dialog focus:outline-none',
          side === 'left' ? 'anim-drawer-left inset-y-0 left-0 h-dvh w-[min(88vw,296px)] border-r' : 'anim-drawer-right max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[88dvh] max-sm:rounded-t-xl max-sm:border-t sm:inset-y-0 sm:right-0 sm:h-dvh sm:w-[480px] sm:border-l',
          className,
        )}
        {...props}
      >
        {side === 'right' && (
          <div className="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center sm:hidden" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} aria-hidden>
            <span className="h-1 w-9 rounded-full bg-border-strong" />
          </div>
        )}
        <div className={cn(!showTitle && 'sr-only', showTitle && 'shrink-0 border-b border-border px-5 py-4 pr-14')}>
          <D.Title className="t-section">{title}</D.Title>
          <D.Description className={cn('t-caption mt-0.5 text-ink-2', !description && 'sr-only')}>{description ?? title}</D.Description>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
        {side === 'right' && (
          <D.Close ref={closeRef} className={cn(closeBtn, 'max-sm:top-5')} aria-label="Close">
            <X className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

/** Drawer = the right-hand sheet for forms and detail (bottom sheet on phones). */
export const Drawer = Sheet;
export const DrawerTrigger = SheetTrigger;
export const DrawerClose = SheetClose;
export const DrawerContent = SheetContent;

/** Layout helpers for drawer content: scrolling body + sticky footer of actions. */
export function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('space-y-6 px-5 py-4', className)} {...props} />;
}
export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-raised px-5 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]', className)} {...props} />;
}
