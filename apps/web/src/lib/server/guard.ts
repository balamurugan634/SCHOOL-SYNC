import 'server-only';
import { redirect } from 'next/navigation';
import type { Me } from '@school-sync/shared';
import { homeFor, type Experience } from '../experience';
import { requireMe } from './session';

/** A signed-in user may only use their own experience; anyone else is sent home. */
export async function requireExperience(exp: Experience): Promise<Me> {
  const me = await requireMe();
  if (me.experience !== exp) redirect(homeFor(me.experience));
  return me;
}
