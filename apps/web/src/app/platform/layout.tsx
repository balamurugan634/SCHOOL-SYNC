import { assertConsoleHost } from '@/lib/platform/session';

/** Everything under /platform is the operator console: tenant-free, on console hosts only. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  await assertConsoleHost();
  return children;
}
