'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, Monitor, Moon, PlayCircle, ShieldCheck, Sun, UserRound } from 'lucide-react';
import { Avatar } from '../ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { useMe, useMeContext } from '../me-context';
import { assetUrl } from '@/lib/assets';
import { EXPERIENCES } from '@/lib/experience';
import { replayTour } from './events';

export async function signOut(clear?: () => void) {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    clear?.();
    // hard navigation on purpose: drops every in-memory cache and re-resolves the session on the server
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/login?reason=signed-out');
  }
}

export function UserMenu() {
  const me = useMe();
  const { preview } = useMeContext();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const roleLabel = EXPERIENCES[me.experience].label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full p-0.5 hover:bg-surface-2" aria-label={`Account menu for ${me.displayName}`}>
          <Avatar name={me.displayName} src={assetUrl(me.avatarUrl)} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="truncate text-sm font-medium">{me.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{me.email ?? me.username}</p>
          <p className="mt-0.5 text-xs text-subtle">
            {preview ? 'Preview · ' : ''}
            {roleLabel}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound /> My profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/sessions">
            <ShieldCheck /> Sessions and devices
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/change-password">
            <KeyRound /> Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTimeout(replayTour, 150)}>
          <PlayCircle /> Replay welcome tour
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
        <DropdownMenuItem danger onSelect={() => void signOut(() => qc.clear())}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
