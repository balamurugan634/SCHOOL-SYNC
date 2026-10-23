'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Bus, CalendarCheck2, CalendarDays, FilePenLine, LayoutGrid, Library, type LucideIcon, Megaphone, UserRound, Wallet } from 'lucide-react';
import type { PermissionKey } from '@school-sync/shared';
import type { SiteInfo } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { useGates } from './use-learner';
import { useMeContext } from '@/components/me-context';

export interface MoreItem {
  id: string;
  label: string;
  /** relative to the experience base */
  href: string;
  icon: LucideIcon;
  blurb: string;
  perm?: PermissionKey;
  feature?: keyof SiteInfo['features'];
}

/** Student: everything that is not one of the five main tabs. */
export const STUDENT_MORE: MoreItem[] = [
  { id: 'profile', label: 'My profile', href: '/profile', icon: UserRound, blurb: 'Your details, photo and record corrections' },
  { id: 'attendance', label: 'Attendance', href: '/attendance', icon: CalendarCheck2, blurb: 'Your attendance record and leave requests', perm: 'attendance:view' },
  { id: 'fees', label: 'Fees', href: '/fees', icon: Wallet, blurb: 'Invoices and balance (view only)', perm: 'fees:view', feature: 'fees' },
  { id: 'announcements', label: 'Announcements', href: '/announcements', icon: Megaphone, blurb: 'Notices from the school', perm: 'announcements:view' },
  { id: 'events', label: 'Events', href: '/events', icon: CalendarDays, blurb: 'School events and registrations', perm: 'events:view' },
  { id: 'notifications', label: 'Notifications', href: '/notifications', icon: Bell, blurb: 'Everything we have told you', perm: 'notifications:view' },
  { id: 'library', label: 'My books', href: '/library', icon: Library, blurb: 'Books you have borrowed', perm: 'library:view', feature: 'library' },
  { id: 'transport', label: 'My bus', href: '/transport', icon: Bus, blurb: 'Route, stop and timings', perm: 'transport:view', feature: 'transport' },
];

/** Parent: the "More" area of the parent app. */
export const PARENT_MORE: MoreItem[] = [
  { id: 'transport', label: 'My bus', href: '/more/transport', icon: Bus, blurb: 'Route, stop, timings and driver contact', perm: 'transport:view', feature: 'transport' },
  { id: 'library', label: 'My books', href: '/more/library', icon: Library, blurb: 'Books your child has borrowed, due dates and fines', perm: 'library:view', feature: 'library' },
  { id: 'corrections', label: 'Record corrections', href: '/more/corrections', icon: FilePenLine, blurb: 'Ask the school to fix an official detail', perm: 'students:view' },
  { id: 'profile', label: 'Profile & contacts', href: '/more/profile', icon: UserRound, blurb: 'Your contact details and emergency contacts' },
];

export function useMoreItems(): MoreItem[] {
  const { me } = useMeContext();
  const { can, features } = useGates();
  const all = me.experience === 'parent' ? PARENT_MORE : STUDENT_MORE;
  return all.filter((i) => (!i.feature || features[i.feature]) && (!i.perm || can(i.perm)));
}

/** Pill links shown at the top of every "more" page, so the pages that are not in the main bar stay one tap apart. */
export function MoreNav({ className }: { className?: string }) {
  const { base, me } = useMeContext();
  const pathname = usePathname();
  const items = useMoreItems();
  const parent = me.experience === 'parent';
  const hub = parent ? { id: 'hub', label: 'Overview', href: '/more', icon: LayoutGrid } : null;
  const list = hub ? [hub, ...items] : items;
  if (list.length <= 1) return null;
  const on = (href: string) => (href === '/more' ? pathname === `${base}/more` : pathname === `${base}${href}` || pathname.startsWith(`${base}${href}/`));
  return (
    <nav aria-label={parent ? 'More from the school' : 'My school'} className={cn('-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0', className)}>
      <ul className="flex w-max gap-1.5 md:w-auto md:flex-wrap">
        {list.map((i) => {
          const active = on(i.href);
          return (
            <li key={i.id}>
              <Link
                href={`${base}${i.href}`}
                aria-current={active ? 'page' : undefined}
                className={cn('tr-colors inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium sm:h-9', active ? 'border-brand/30 bg-brand-soft text-brand-ink' : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink')}
              >
                <i.icon className="size-4" aria-hidden />
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
