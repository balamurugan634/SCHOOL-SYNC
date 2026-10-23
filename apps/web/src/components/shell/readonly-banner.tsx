'use client';

import * as React from 'react';
import Link from 'next/link';
import { useReadOnly } from '@/lib/client/readonly-store';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { usePermissions, useMeContext } from '../me-context';
import { useSite } from '../site-context';

/** Persistent while the school's subscription has lapsed: reads work, every change is refused by the API. */
export function ReadOnlyBanner() {
  const site = useSite();
  const readOnly = useReadOnly(site?.readOnly ?? false);
  const { can } = usePermissions();
  const { base } = useMeContext();
  const ref = React.useRef<HTMLDivElement>(null);
  // the sticky sidebar / top bar sit below the banner: publish its height as a CSS variable
  React.useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!readOnly || !el) {
      root.style.removeProperty('--banner-h');
      return;
    }
    const set = () => root.style.setProperty('--banner-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--banner-h');
    };
  }, [readOnly]);
  if (!readOnly) return null;
  return (
    <Banner
      ref={ref}
      shape="bar"
      tone="locked"
      title="This school is in read-only mode"
      action={
        can('settings:view') && !base.startsWith('/dev') ? (
          <Button asChild size="sm" variant="secondary">
            <Link href="/admin/settings/license">View subscription</Link>
          </Button>
        ) : undefined
      }
      className="sticky top-0 z-[60]"
    >
      The subscription has expired, so records can be viewed but not changed until it is renewed. Please contact the school office.
    </Banner>
  );
}
