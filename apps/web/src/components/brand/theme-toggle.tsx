'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';

/** One-click light/dark switch (system preference is the default). */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  return (
    <Tooltip content={dark ? 'Light mode' : 'Dark mode'}>
      <Button variant="ghost" size="icon" className={className} onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
        {mounted ? dark ? <Sun /> : <Moon /> : <Moon className="opacity-0" />}
      </Button>
    </Tooltip>
  );
}
