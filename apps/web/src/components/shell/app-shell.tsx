'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronsLeft, ChevronsRight, Menu, MoreHorizontal, Search } from 'lucide-react';
import type { Experience } from '@/lib/experience';
import { EXPERIENCES } from '@/lib/experience';
import { navFor, type NavGroup, type NavItem } from '@/lib/nav';
import { ROLE_TINT } from '@/lib/color';
import { assetUrl } from '@/lib/assets';
import { cn } from '@/lib/cn';
import { SchoolMark } from '../brand/school-mark';
import { ThemeToggle } from '../brand/theme-toggle';
import { Avatar } from '../ui/avatar';
import { IconButton } from '../ui/icon-button';
import { Sheet, SheetContent } from '../ui/dialog';
import { Tooltip } from '../ui/tooltip';
import { useMediaQuery } from '@/lib/client/use-media-query';
import { useMeContext } from '../me-context';
import { useSite } from '../site-context';
import { ChildSwitcher } from './child-switcher';
import { OPEN_COMMAND_EVENT } from './events';
import { NotificationsBell } from './notifications-bell';
import { ReadOnlyBanner } from './readonly-banner';
import { DeferredShellExtras } from './deferred-extras';
import { UserMenu } from './user-menu';

const OPEN_KEY = 'ss:nav-open:v1';
const COLLAPSE_KEY = 'ss:sidebar-collapsed';

function isActive(pathname: string, href: string, home: string): boolean {
  const full = `${home}${href}`;
  return href === '' ? pathname === home : pathname === full || pathname.startsWith(`${full}/`);
}

/** The most specific item wins (e.g. /staff/attendance over /staff). */
function activeItem(pathname: string, base: string, groups: NavGroup[]): { item: NavItem; group: NavGroup } | null {
  let best: { item: NavItem; group: NavGroup } | null = null;
  for (const g of groups) for (const i of g.items) if (isActive(pathname, i.href, base) && (!best || i.href.length > best.item.href.length)) best = { item: i, group: g };
  return best;
}

export function AppShell({ experience, children }: { experience: Experience; children: React.ReactNode }) {
  const { me, base } = useMeContext();
  const site = useSite();
  const pathname = usePathname();
  const groups = React.useMemo(() => navFor(experience, me, site), [experience, me, site]);
  const current = activeItem(pathname, base, groups);
  const [drawer, setDrawer] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const flat = experience !== 'management';
  const items = groups.flatMap((g) => g.items);

  React.useEffect(() => setDrawer(false), [pathname]);
  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {}
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {}
      return !c;
    });

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-[100] rounded-md bg-brand px-4 py-2 text-sm font-medium text-on-brand focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <ReadOnlyBanner />
      <div className="flex">
        {/* ≥ 1024: 248 px sidebar (collapsible to a 72 px rail) · 768–1023: rail · < 768: drawer / bottom bar */}
        <aside
          className={cn('sticky top-[var(--banner-h,0px)] z-30 hidden h-[calc(100dvh-var(--banner-h,0px))] shrink-0 border-r border-border bg-surface transition-[width] duration-200 ease-[var(--ease-std)] md:block', collapsed ? 'w-[72px]' : 'w-[72px] lg:w-[248px]')}
          aria-label="Sidebar"
        >
          <SidebarBody groups={groups} current={current?.item.id ?? null} experience={experience} collapsed={collapsed} />
          {/* one toggle for both states, on the sidebar's edge where the eye looks for it (desktop widths only: below 1024 px the sidebar is always a rail) */}
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            tooltipSide="right"
            variant="secondary"
            size="icon-sm"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            className="absolute -right-3.5 top-[72px] z-50 hidden size-7 rounded-full border-border-strong bg-surface shadow-card hover:bg-surface-subtle lg:inline-flex"
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </IconButton>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar experience={experience} onMenu={() => setDrawer(true)} showMenu={!flat} context={current} />
          <main id="main" className={cn('mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8', flat ? 'pb-24 md:pb-10' : 'pb-10')}>
            <div className="page-in">{children}</div>
          </main>
        </div>
      </div>

      {flat && <BottomNav items={items} current={current?.item.id ?? null} onMore={() => setDrawer(true)} />}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" title="Navigation" className="p-0">
          <SidebarBody groups={groups} current={current?.item.id ?? null} experience={experience} inDrawer />
        </SheetContent>
      </Sheet>

      <DeferredShellExtras experience={experience} />
    </div>
  );
}

function Topbar({ experience, onMenu, showMenu, context }: { experience: Experience; onMenu: () => void; showMenu: boolean; context: { item: NavItem; group: NavGroup } | null }) {
  const site = useSite();
  const { me } = useMeContext();
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header
      data-scrolled={scrolled || undefined}
      className="sticky top-[var(--banner-h,0px)] z-40 flex h-[60px] items-center gap-2 border-b border-transparent bg-bg px-3 transition-[background-color,border-color] duration-200 data-[scrolled]:border-border data-[scrolled]:bg-bg/80 data-[scrolled]:backdrop-blur-md sm:gap-3 md:px-6 lg:px-8"
    >
      {showMenu && <IconButton label="Open navigation" className="md:hidden" onClick={onMenu}><Menu /></IconButton>}
      {!showMenu && (
        <Link href="/" className="flex items-center md:hidden" aria-label="Home">
          <SchoolMark name={site?.name ?? 'School'} logoUrl={site?.logoUrl} size="sm" />
        </Link>
      )}
      {/* page context: group › page */}
      {context && (
        <p className="t-caption hidden min-w-0 items-center gap-1.5 truncate text-ink-2 md:flex" aria-hidden>
          {experience === 'management' && context.group.id !== 'main' && <><span>{context.group.label}</span><span className="text-ink-3">/</span></>}
          <span className="font-medium text-ink">{context.item.label}</span>
        </p>
      )}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT))}
        className="tr-colors ml-auto hidden h-9 w-full max-w-[280px] items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-left text-[13px] text-ink-3 hover:border-ink-3 lg:flex"
        aria-label="Search pages and actions (Control K)"
      >
        <Search className="size-4" />
        <span className="flex-1">Search</span>
        <kbd className="rounded border border-border bg-surface-subtle px-1.5 text-[11px] leading-5">⌘K</kbd>
      </button>
      {experience === 'parent' && <ChildSwitcher />}
      <div className="ml-auto flex items-center gap-0.5 sm:gap-1 lg:ml-0">
        <IconButton label="Search" className="lg:hidden" onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT))}><Search /></IconButton>
        <NotificationsBell />
        <ThemeToggle />
        <span className="ml-1"><UserMenu /></span>
        <span className="sr-only">Signed in as {me.displayName}</span>
      </div>
    </header>
  );
}

function SidebarBody({ groups, current, experience, inDrawer, collapsed }: { groups: NavGroup[]; current: string | null; experience: Experience; inDrawer?: boolean; collapsed?: boolean }) {
  const site = useSite();
  const { base, me } = useMeContext();
  const isLg = useMediaQuery('(min-width: 1024px)', true);
  const flat = experience !== 'management';
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const activeGroup = groups.find((g) => g.items.some((i) => i.id === current))?.id;
  // rail = icons only (user-collapsed on desktop, or tablet width). The drawer always shows labels.
  const rail = !inDrawer && (!!collapsed || !isLg);

  React.useEffect(() => {
    try {
      setOpen(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>);
    } catch {}
  }, []);
  const toggle = (id: string, now: boolean) =>
    setOpen((o) => {
      const next = { ...o, [id]: !now };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-[60px] shrink-0 items-center gap-2.5 border-b border-border', rail ? 'justify-center px-0' : 'px-4')}>
        <SchoolMark name={site?.name ?? 'School'} logoUrl={site?.logoUrl} size="sm" />
        {!rail && <p className="min-w-0 flex-1 truncate text-sm font-semibold">{site?.shortName ?? site?.name}</p>}
      </div>

      <nav className="relative flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
        {flat ? (
          <ul className="space-y-0.5">
            {groups[0]?.items.map((i) => <NavLink key={i.id} item={i} base={base} active={current === i.id} rail={rail} />)}
          </ul>
        ) : (
          <div className="space-y-1">
            {groups.map((g, gi) => {
              const isOpen = open[g.id] ?? (g.id === 'overview' || g.id === activeGroup);
              const hid = `nav-${g.id}${inDrawer ? '-d' : ''}`;
              return (
                <section key={g.id} aria-labelledby={hid}>
                  {rail ? (
                    <>
                      {gi > 0 && <div className="my-1.5 h-px bg-border" aria-hidden />}
                      <span id={hid} className="sr-only">{g.label}</span>
                    </>
                  ) : (
                    <button type="button" id={hid} onClick={() => toggle(g.id, isOpen)} aria-expanded={isOpen} className="tr-colors flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-[11px] font-medium text-ink-3 hover:text-ink">
                      <span className="flex-1">{g.label}</span>
                      <ChevronDown className={cn('size-3.5 transition-transform duration-200', !isOpen && '-rotate-90')} aria-hidden />
                    </button>
                  )}
                  {(isOpen || rail) && (
                    <ul className="space-y-0.5 pb-1.5 pt-0.5">
                      {g.items.map((i) => <NavLink key={i.id} item={i} base={base} active={current === i.id} rail={rail} />)}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </nav>

      {/* footer: the signed-in user, with the role tint */}
      <div className="shrink-0 border-t border-border p-3">
        <Link href="/account" className={cn('tr-colors flex items-center gap-2.5 rounded-md p-1.5 hover:bg-surface-subtle', rail && 'justify-center')} aria-label="My profile">
          <Avatar name={me.displayName} src={assetUrl(me.avatarUrl)} size="sm" ring role={experience} />
          {!rail && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-medium">{me.displayName}</span>
              <span className="t-caption flex items-center gap-1.5 text-ink-2">
                <span className="size-1.5 rounded-full" style={{ background: ROLE_TINT[experience] }} aria-hidden />
                {EXPERIENCES[experience].label}
              </span>
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}

function NavLink({ item, base, active, rail }: { item: NavItem; base: string; active: boolean; rail?: boolean }) {
  const link = (
    <Link
      href={`${base}${item.href}`}
      aria-current={active ? 'page' : undefined}
      aria-label={rail ? item.label : undefined}
      className={cn('tr-colors relative flex h-9 items-center gap-2.5 rounded-md text-[13px] font-medium', rail ? 'justify-center' : 'px-2.5', active ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-surface-subtle hover:text-ink')}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" aria-hidden />}
      <item.icon className="size-4 shrink-0" aria-hidden />
      {!rail && <span className="truncate">{item.label}</span>}
    </Link>
  );
  return <li>{rail ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link}</li>;
}

function BottomNav({ items, current, onMore }: { items: NavItem[]; current: string | null; onMore: () => void }) {
  const { base } = useMeContext();
  const MAX = 5;
  const overflow = items.length > MAX;
  const shown = overflow ? items.slice(0, MAX - 1) : items;
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface md:hidden" aria-label="Main">
      <ul className="mx-auto flex max-w-xl items-stretch justify-around">
        {shown.map((i) => {
          const on = current === i.id;
          return (
            <li key={i.id} className="flex-1">
              <Link href={`${base}${i.href}`} aria-current={on ? 'page' : undefined} className={cn('tr-colors flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', on ? 'text-brand-ink' : 'text-ink-2')}>
                <i.icon className="size-5" aria-hidden />
                <span className="max-w-full truncate px-0.5">{i.short ?? i.label}</span>
              </Link>
            </li>
          );
        })}
        {overflow && (
          <li className="flex-1">
            <button type="button" onClick={onMore} className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink-2">
              <MoreHorizontal className="size-5" aria-hidden />
              More
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
