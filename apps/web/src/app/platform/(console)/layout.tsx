import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/shell';
import { currentPath, requireOperator } from '@/lib/platform/session';

/** Everything below needs a signed-in operator. An operator still on the temporary password is held on the change screen. */
export default async function PlatformConsoleLayout({ children }: { children: React.ReactNode }) {
  const operator = await requireOperator();
  if (operator.mustChangePassword) redirect(`/platform/change-password?next=${encodeURIComponent(await currentPath())}`);
  return <PlatformShell operator={operator}>{children}</PlatformShell>;
}
