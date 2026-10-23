import { ShellFrame } from '@/components/shell/shell-frame';
import { requireExperience } from '@/lib/server/guard';

export default async function Layout({ children }: { children: React.ReactNode }) {
  const me = await requireExperience('parent');
  return (
    <ShellFrame me={me} experience="parent" base="/parent">
      {children}
    </ShellFrame>
  );
}
