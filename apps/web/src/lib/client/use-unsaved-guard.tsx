'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Unsaved-changes guard (design.md §8 forms): warns on tab close / reload, intercepts in-app link clicks, and
 * lets the screen wrap its own in-page switches in `guard(action)`. Render `dialog` once.
 */
export function useUnsavedGuard(dirty: boolean, { title = 'Leave without saving?', description = 'You have changes that have not been saved. If you leave now they will be lost.', confirmLabel = 'Discard and leave' } = {}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<(() => void) | null>(null);

  React.useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href') ?? '';
      if (!href || href.startsWith('#') || /^(mailto:|tel:)/.test(href)) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(() => () => router.push(url.pathname + url.search + url.hash));
    };
    window.addEventListener('beforeunload', onBefore);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBefore);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, router]);

  const guard = React.useCallback(
    (action: () => void) => {
      if (dirty) setPending(() => action);
      else action();
    },
    [dirty],
  );

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(o) => !o && setPending(null)}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel="Keep editing"
      destructive
      onConfirm={() => {
        const run = pending;
        setPending(null);
        run?.();
      }}
    />
  );
  return { guard, dialog };
}
