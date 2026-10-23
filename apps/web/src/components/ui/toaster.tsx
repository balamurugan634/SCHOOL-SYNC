'use client';

import * as React from 'react';
import { Toaster as Sonner } from 'sonner';
import { useTheme } from 'next-themes';

export { toast } from 'sonner';

/** Bottom-right on desktop, top on phones; 4 s (errors 8 s via `duration`); max 3 stacked; sonner announces via aria-live. */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return (
    <Sonner
      theme={(resolvedTheme as 'light' | 'dark' | undefined) ?? 'light'}
      position={phone ? 'top-center' : 'bottom-right'}
      offset={16}
      duration={4000}
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast: '!rounded-lg !border !border-border !bg-surface-raised !text-ink !shadow-pop !font-sans !text-sm',
          title: '!font-medium',
          description: '!text-ink-2',
          actionButton: '!bg-brand !text-on-brand',
        },
      }}
    />
  );
}
