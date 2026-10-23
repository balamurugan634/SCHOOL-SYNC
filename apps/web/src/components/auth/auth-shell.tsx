'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { SchoolMark } from '../brand/school-mark';
import { ProductMark } from '../brand/product-mark';
import { ThemeToggle } from '../brand/theme-toggle';
import { Illustration, type IllustrationName } from '../illustrations/illustration';

/**
 * The one page pattern before sign-in (design.md): a centred 400 px card on the page background. When an
 * `illustration` is given (sign-in), wide screens get a flat side panel with it and the school's mark; phones get the
 * illustration as a header above the card. Pages without a school (find-your-school) show the SchoolSync product mark.
 */
export function AuthShell({
  site,
  children,
  footer,
  illustration,
  illustrationPaths,
  caption = 'Attendance, homework, results and school news in one place.',
}: {
  site: { name: string; logoUrl?: string | null } | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
  illustration?: IllustrationName;
  /** show the illustration only on these paths (e.g. ['/', '/login']) */
  illustrationPaths?: string[];
  caption?: string;
}) {
  const pathname = usePathname();
  const art = illustration && (!illustrationPaths || illustrationPaths.includes(pathname)) ? illustration : null;
  return (
    <div className={art ? 'min-h-dvh bg-bg lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(460px,560px)]' : 'min-h-dvh bg-bg'}>
      {art && (
        <aside className="hidden flex-col justify-between bg-surface-subtle p-10 lg:flex" aria-label="School">
          <div className="flex items-center gap-3">
            <SchoolMark name={site?.name ?? 'S'} logoUrl={site?.logoUrl} />
            <span className="text-sm font-semibold">{site?.name ?? 'SchoolSync'}</span>
          </div>
          <div className="mx-auto w-full max-w-[420px]">
            <Illustration name={art} />
            <p className="mt-6 max-w-[34ch] text-[15px] leading-6 text-ink-2">{caption}</p>
          </div>
          <p className="t-caption flex items-center gap-2 text-ink-3">
            <ProductMark size={16} /> Powered by SchoolSync
          </p>
        </aside>
      )}
      <div className="flex min-h-dvh flex-col">
        <div className="flex justify-end px-4 py-3 sm:px-6">
          <ThemeToggle />
        </div>
        <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-2 sm:items-center sm:pt-0">
          <div className="w-full max-w-[400px]">
            {art && (
              <div className="mx-auto mb-4 w-40 lg:hidden">
                <Illustration name={art} />
              </div>
            )}
            <div className="rounded-lg border border-border bg-surface p-6 shadow-card sm:p-8">
              {!art && (site ? <SchoolMark name={site.name} logoUrl={site.logoUrl} className="mb-5" /> : <ProductMark size={36} className="mb-5" wordmark />)}
              {children}
            </div>
            {footer && <div className="mt-4 text-center text-[13px] text-ink-2">{footer}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}
