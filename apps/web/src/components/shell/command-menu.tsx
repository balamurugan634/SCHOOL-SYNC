'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { LogOut, Moon, PlayCircle, ShieldCheck, Sun, UserRound } from 'lucide-react';
import { CommandPalette, type CommandGroup } from '../ui/command-palette';
import { useMeContext } from '../me-context';
import { useSite } from '../site-context';
import { navFor } from '@/lib/nav';
import { OPEN_COMMAND_EVENT, replayTour } from './events';
import { signOut } from './user-menu';

/** ⌘K / Ctrl+K: jump to any page the user can see, or run a quick action. */
export function CommandMenu() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { me, base, childId, setChildId } = useMeContext();
  const site = useSite();
  const { resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpen);
    };
  }, []);

  const groups = React.useMemo<CommandGroup[]>(() => {
    const nav = navFor(me.experience, me, site);
    const go: CommandGroup = {
      heading: 'Go to',
      items: nav.flatMap((g) =>
        g.items.map((i) => ({
          id: i.id,
          label: i.label,
          hint: me.experience === 'management' ? g.label : undefined,
          icon: <i.icon />,
          keywords: [g.label, i.blurb ?? ''],
          onSelect: () => router.push(`${base}${i.href}`),
        })),
      ),
    };
    const kids: CommandGroup = {
      heading: 'Switch child',
      items: me.profile.children.length > 1 ? me.profile.children.filter((c) => c.studentId !== childId).map((c) => ({ id: `child-${c.studentId}`, label: c.name, hint: [c.grade, c.section].filter(Boolean).join(' · '), icon: <UserRound />, onSelect: () => setChildId(c.studentId) })) : [],
    };
    const actions: CommandGroup = {
      heading: 'Actions',
      items: [
        { id: 'profile', label: 'My profile', icon: <UserRound />, onSelect: () => router.push('/account') },
        { id: 'sessions', label: 'Sessions & devices', icon: <ShieldCheck />, onSelect: () => router.push('/account/sessions') },
        { id: 'tour', label: 'Replay welcome tour', icon: <PlayCircle />, onSelect: () => setTimeout(replayTour, 150) },
        { id: 'theme', label: resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: resolvedTheme === 'dark' ? <Sun /> : <Moon />, onSelect: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark') },
        { id: 'signout', label: 'Sign out', icon: <LogOut />, onSelect: () => void signOut() },
      ],
    };
    return [go, kids, actions];
  }, [me, site, base, router, resolvedTheme, setTheme, childId, setChildId]);

  return <CommandPalette open={open} onOpenChange={setOpen} groups={groups} />;
}
