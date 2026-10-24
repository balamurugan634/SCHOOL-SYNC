import { AuthShell } from '@/components/auth/auth-shell';

/** Operator sign-in and forced password change share the quiet centred card (no school, no school branding). */
export default function PlatformAuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell site={null}>{children}</AuthShell>;
}
