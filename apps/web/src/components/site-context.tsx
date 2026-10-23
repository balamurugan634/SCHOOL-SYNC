'use client';

import * as React from 'react';
import type { SiteInfo } from '@school-sync/shared';

const SiteContext = React.createContext<SiteInfo | null>(null);

export function SiteProvider({ site, children }: { site: SiteInfo | null; children: React.ReactNode }) {
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

/** The school this deployment is serving, or null on the "Find your school" page. */
export function useSite(): SiteInfo | null {
  return React.useContext(SiteContext);
}
export function useRequiredSite(): SiteInfo {
  const s = React.useContext(SiteContext);
  if (!s) throw new Error('useRequiredSite called outside a school context');
  return s;
}
