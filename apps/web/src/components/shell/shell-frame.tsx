import type { Me } from '@school-sync/shared';
import type { Experience } from '@/lib/experience';
import { MeProvider } from '../me-context';
import { AppShell } from './app-shell';

/** Wraps a role area: provides the user to client components and renders the shell. Roles share one palette. */
export function ShellFrame({ me, experience, base, preview, children }: { me: Me; experience: Experience; base: string; preview?: boolean; children: React.ReactNode }) {
  return (
    <MeProvider me={me} base={base} preview={preview}>
      <AppShell experience={experience}>{children}</AppShell>
    </MeProvider>
  );
}
