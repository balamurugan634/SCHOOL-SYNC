import { ShellFrame } from '@/components/shell/shell-frame';
import { EXPERIENCES } from '@/lib/experience';
import { requireMe } from '@/lib/server/session';

/** Profile & sessions are shared by every role, shown inside that role's own shell. */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMe();
  return (
    <ShellFrame me={me} experience={me.experience} base={EXPERIENCES[me.experience].base}>
      {children}
    </ShellFrame>
  );
}
