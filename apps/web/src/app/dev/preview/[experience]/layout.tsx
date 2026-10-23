import { notFound } from 'next/navigation';
import type { Me } from '@school-sync/shared';
import { ROLE_PRESETS, experienceFor, type Grants, type SystemRoleKey } from '@school-sync/shared';
import { ShellFrame } from '@/components/shell/shell-frame';
import { env } from '@/lib/env';
import { EXPERIENCES, type Experience } from '@/lib/experience';
import { currentUrl, requireMe } from '@/lib/server/session';

const EXPS = ['student', 'parent', 'teacher', 'management'] as const;
const DEFAULT_ROLE: Record<Experience, SystemRoleKey> = { student: 'student', parent: 'parent', teacher: 'teacher', management: 'principal' };

/**
 * DEV ONLY — previews a role shell with a SYNTHETIC user built from the role presets in @school-sync/shared.
 * Needs a real signed-in session (so the BFF works) but nothing here is real school data. 404 in production.
 *   /dev/preview/management?role=hr   /dev/preview/parent   /dev/preview/teacher …
 */
export default async function PreviewLayout({ children, params }: { children: React.ReactNode; params: Promise<{ experience: string }> }) {
  if (!env.devPreview) notFound();
  const { experience } = await params;
  if (!(EXPS as readonly string[]).includes(experience)) notFound();
  const exp = experience as Experience;
  await requireMe();
  // layouts don't receive searchParams; proxy.ts hands us the requested URL
  const roleKey = (new URL(await currentUrl(), 'http://x').searchParams.get('role') as SystemRoleKey | null) ?? DEFAULT_ROLE[exp];
  const preset = ROLE_PRESETS[roleKey] ?? ROLE_PRESETS[DEFAULT_ROLE[exp]];
  const grants: Grants = preset.grants;
  const synthetic: Me = {
    id: '00000000-0000-7000-8000-000000000000',
    userType: preset.userTypes[0] ?? 'staff',
    displayName: `Preview ${preset.name}`,
    username: 'preview',
    email: null,
    phone: null,
    avatarUrl: null,
    locale: 'en',
    mustChangePassword: false,
    roles: [preset.key],
    experience: experienceFor([preset.key]),
    permissions: grants as Me['permissions'],
    profile: {
      studentId: null,
      guardianId: null,
      staffId: null,
      children: exp === 'parent' ? [{ studentId: '00000000-0000-7000-8000-000000000001', name: 'Sample child (preview)', admissionNo: 'PREVIEW', grade: 'Grade 6', section: 'A', sectionId: null, photoUrl: null }] : [],
      sectionId: null,
      gradeName: exp === 'student' ? 'Grade 6' : null,
      sectionName: exp === 'student' ? 'A' : null,
      classTeacherSectionIds: [],
      assignedSectionIds: [],
    },
  };
  return (
    <ShellFrame me={{ ...synthetic, experience: exp }} experience={exp} base={`/dev/preview/${exp}`} preview>
      <div className="mb-6 rounded-lg border border-dashed border-warning/50 bg-warning-soft px-4 py-2.5 text-[13px] text-warning-ink" role="note">
        DEV PREVIEW · {EXPERIENCES[exp].label} shell with a synthetic user (“{synthetic.displayName}”, role {preset.key}). Not real data, not available in production.
      </div>
      {children}
    </ShellFrame>
  );
}
