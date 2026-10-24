'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Building2, KeyRound, LogOut, Monitor, Moon, Receipt, ScrollText, Sun, UsersRound } from 'lucide-react';
import type { PlatformOperator } from '@school-sync/shared';
import { ProductMark } from '@/components/brand/product-mark';
import { ThemeToggle } from '@/components/brand/theme-toggle';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import { usePlatformConfig } from '@/lib/platform/queries';

const NAV = [
  { id: 'schools', href: '/platform/schools', label: 'Schools', icon: Building2 },
  { id: 'billing', href: '/platform/billing', label: 'Billing', icon: Receipt },
  { id: 'operators', href: '/platform/operators', label: 'Operators', icon: UsersRound },
  { id: 'audit', href: '/platform/audit', label: 'Audit log', icon: ScrollText },
] as const;

export async function signOutOperator() {
  try {
    await fetch('/api/platform/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    // hard navigation on purpose: drops every in-memory cache
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/platform/sign-in?reason=signed-out');
  }
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The operator console shell: sidebar on tablets and desktops, bottom navigation on phones. Not tied to any school. */
export function PlatformShell({ operator, children }: { operator: PlatformOperator; children: React.ReactNode }) {
  const pathname = usePathname();
  const cfg = usePlatformConfig();
  const env = cfg.data?.environment;
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-[100] rounded-md bg-brand px-4 py-2 text-sm font-medium text-on-brand focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <div className="flex">
        <aside className="sticky top-0 z-30 hidden h-dvh w-[72px] shrink-0 flex-col border-r border-border bg-surface md:flex lg:w-[248px]" aria-label="Sidebar">
          <div className="flex h-[60px] shrink-0 items-center justify-center gap-2.5 border-b border-border lg:justify-start lg:px-4">
            <ProductMark size={28} />
            <div className="hidden min-w-0 leading-tight lg:block">
              <p className="truncate text-sm font-semibold">SchoolSync</p>
              <p className="t-caption text-ink-2">Operator console</p>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Console">
            <ul className="space-y-0.5">
              {NAV.map((n) => {
                const active = isActive(pathname, n.href);
                return (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      aria-current={active ? 'page' : undefined}
                      aria-label={n.label}
                      className={cn('tr-colors relative flex h-10 items-center justify-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium lg:h-9 lg:justify-start', active ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-surface-subtle hover:text-ink')}
                    >
                      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" aria-hidden />}
                      <n.icon className="size-4 shrink-0" aria-hidden />
                      <span className="hidden lg:inline">{n.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="shrink-0 border-t border-border p-3">
            <OperatorMenu operator={operator} side />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-[60px] items-center gap-2 border-b border-border bg-bg/90 px-4 backdrop-blur-md md:px-6 lg:px-8">
            <Link href="/platform/schools" className="flex items-center gap-2 md:hidden" aria-label="SchoolSync operator console home">
              <ProductMark size={26} />
              <span className="text-sm font-semibold">Operator console</span>
            </Link>
            {env && env !== 'production' && (
              <Badge variant="warning-outline" className="ml-auto md:ml-0">
                {env === 'development' ? 'Development server' : 'Test server'}
              </Badge>
            )}
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <span className="md:hidden">
                <OperatorMenu operator={operator} />
              </span>
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 pb-24 md:px-6 md:pb-10 lg:px-8 lg:py-8">
            <div className="page-in">{children}</div>
          </main>
        </div>
      </div>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface md:hidden" aria-label="Console">
        <ul className="grid grid-cols-4">
          {NAV.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <li key={n.id}>
                <Link href={n.href} aria-current={active ? 'page' : undefined} className={cn('tr-colors flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-brand-ink' : 'text-ink-2')}>
                  <n.icon className="size-5" aria-hidden />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function OperatorMenu({ operator, side }: { operator: PlatformOperator; side?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Account menu for ${operator.displayName}`} className={cn('tr-colors flex items-center gap-2.5 rounded-md p-1 hover:bg-surface-subtle', side ? 'w-full justify-center lg:justify-start' : 'rounded-full')}>
          <Avatar name={operator.displayName} size="sm" />
          {side && (
            <span className="hidden min-w-0 flex-1 text-left leading-tight lg:block">
              <span className="block truncate text-[13px] font-medium">{operator.displayName}</span>
              <span className="t-caption block truncate text-ink-2">{operator.email}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align={side ? 'start' : 'end'} side={side ? 'top' : 'bottom'}>
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="truncate text-sm font-medium">{operator.displayName}</p>
          <p className="truncate text-xs text-ink-2">{operator.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/platform/change-password">
            <KeyRound /> Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" onSelect={(e) => e.preventDefault()}>
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" onSelect={(e) => e.preventDefault()}>
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" onSelect={(e) => e.preventDefault()}>
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOutOperator()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
