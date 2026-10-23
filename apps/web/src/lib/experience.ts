import type { Experience } from '@school-sync/shared';

export type { Experience };

export interface ExperienceMeta {
  key: Experience;
  /** URL prefix of the experience */
  base: string;
  label: string;
}

/** Roles differ by navigation and content, not by colour (design.md). */
export const EXPERIENCES: Record<Experience, ExperienceMeta> = {
  student: { key: 'student', base: '/student', label: 'Student' },
  parent: { key: 'parent', base: '/parent', label: 'Parent' },
  teacher: { key: 'teacher', base: '/teacher', label: 'Teacher' },
  management: { key: 'management', base: '/admin', label: 'Management' },
};

export const homeFor = (exp: Experience): string => EXPERIENCES[exp].base;

/** `?as=` values on the sign-in page → which kind of account is signing in. */
export const AUDIENCES = ['student', 'parent', 'teacher', 'staff'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const isAudience = (v: unknown): v is Audience => typeof v === 'string' && (AUDIENCES as readonly string[]).includes(v);
