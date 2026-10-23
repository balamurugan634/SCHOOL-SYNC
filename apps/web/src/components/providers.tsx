'use client';

import * as React from 'react';
import { ThemeProvider } from 'next-themes';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SiteInfo } from '@school-sync/shared';
import { ApiError } from '@/lib/problem';
import { readOnlyStore } from '@/lib/client/readonly-store';
import { SiteProvider } from './site-context';
import { Toaster } from './ui/toaster';
import { TooltipProvider } from './ui/tooltip';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

export function Providers({ site, children }: { site: SiteInfo | null; children: React.ReactNode }) {
  const [client] = React.useState(makeClient);
  React.useEffect(() => {
    if (site?.readOnly) readOnlyStore.set(true);
  }, [site?.readOnly]);
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      {/* motion: LazyMotion + domAnimation (≈5 kB); CSS handles simple states. Reduced-motion is honoured globally. */}
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation} strict>
          <QueryClientProvider client={client}>
            <SiteProvider site={site}>
              <TooltipProvider>
                {children}
                <Toaster />
              </TooltipProvider>
            </SiteProvider>
          </QueryClientProvider>
        </LazyMotion>
      </MotionConfig>
    </ThemeProvider>
  );
}
