import { ShellFrame } from '@/components/shell/shell-frame';
import { requireExperience } from '@/lib/server/guard';

export default async function Layout({ children }: { children: React.ReactNode }) {
  const me = await requireExperience('management');
  return (
    <ShellFrame me={me} experience="management" base="/admin">
      {children}
    </ShellFrame>
  );
}
