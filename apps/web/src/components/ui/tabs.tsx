'use client';

import * as React from 'react';
import { Tabs as T } from 'radix-ui';
import { cn } from '@/lib/cn';

const Ctx = React.createContext<string | undefined>(undefined);

/** Underline tabs with an animated indicator (CSS transform, 200 ms). Controlled or uncontrolled. */
export function Tabs({ value, defaultValue, onValueChange, children, ...props }: React.ComponentProps<typeof T.Root>) {
  const [inner, setInner] = React.useState(defaultValue);
  const current = value ?? inner;
  return (
    <Ctx.Provider value={current}>
      <T.Root
        value={current}
        onValueChange={(v) => {
          setInner(v);
          onValueChange?.(v);
        }}
        {...props}
      >
        {children}
      </T.Root>
    </Ctx.Provider>
  );
}

export function TabsList({ className, children, ...props }: React.ComponentProps<typeof T.List>) {
  const value = React.useContext(Ctx);
  const ref = React.useRef<HTMLDivElement>(null);
  const [bar, setBar] = React.useState<{ x: number; w: number } | null>(null);

  React.useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLElement>('[data-state="active"]');
      if (el) setBar({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [value, children]);

  return (
    <T.List ref={ref} className={cn('relative flex items-center gap-1 overflow-x-auto border-b border-border', className)} {...props}>
      {children}
      {bar && <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-brand" style={{ width: bar.w, transform: `translateX(${bar.x}px)`, transition: 'transform var(--dur-menu) var(--ease-std), width var(--dur-menu) var(--ease-std)' }} />}
    </T.List>
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'tr-colors inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-medium text-ink-2 sm:h-10',
        'hover:text-ink data-[state=active]:text-brand-ink disabled:text-ink-disabled disabled:hover:text-ink-disabled',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return <T.Content className={cn('mt-5 focus-visible:outline-none', className)} {...props} />;
}
