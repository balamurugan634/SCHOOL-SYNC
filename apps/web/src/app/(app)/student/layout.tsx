import { ShellFrame } from '@/components/shell/shell-frame';
import { requireExperience } from '@/lib/server/guard';

export default async function Layout({ children }: { children: React.ReactNode }) {
  const me = await requireExperience('student');
  return (
    <ShellFrame me={me} experience="student" base="/student">
      {children}
    </ShellFrame>
  );
}
