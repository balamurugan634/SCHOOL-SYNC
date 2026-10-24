import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { PlatformOperator } from '@school-sync/shared';
import { ApiError } from '../problem';
import { requestHost } from '../server/csrf';
import { operatorCookieName } from './cookies';
import { platformHostAllowed } from './host';
import { platformUpstream, readJson } from './upstream';

/** Pages of the console answer 404 on any host that is not a console host (the proxy does too; this is the belt to its braces). */
export async function assertConsoleHost(): Promise<void> {
  if (!platformHostAllowed(requestHost(await headers()))) notFound();
}

export const currentPath = async (): Promise<string> => (await headers()).get('x-url-path') ?? '/platform/schools';

export const getOperatorSession = cache(async () => {
  const jar = await cookies();
  return { token: jar.get(operatorCookieName('at'))?.value ?? null, hasRefresh: !!jar.get(operatorCookieName('rt'))?.value, justRefreshed: !!jar.get(operatorCookieName('rf'))?.value };
});

const refreshUrl = (next: string) => `/api/platform/auth/refresh?next=${encodeURIComponent(next)}`;

/** The signed-in operator, or null (never redirects): for the sign-in page. */
export const getOperator = cache(async (): Promise<PlatformOperator | null> => {
  const s = await getOperatorSession();
  if (!s.token) return null;
  const res = await platformUpstream({ path: '/auth/me', token: s.token });
  if (res.status === 401) return null;
  if (!res.ok) throw ApiError.fromProblem(res.status, await readJson(res));
  return (await readJson(res)) as PlatformOperator;
});

/**
 * The signed-in operator, or a redirect: through the refresh route when only a refresh cookie is left (a route handler may
 * set cookies, a server component may not), otherwise to the sign-in page.
 */
export const requireOperator = cache(async (): Promise<PlatformOperator> => {
  await assertConsoleHost();
  const s = await getOperatorSession();
  const next = await currentPath();
  if (!s.token) {
    if (s.hasRefresh && !s.justRefreshed) return redirect(refreshUrl(next));
    return redirect(`/platform/sign-in?next=${encodeURIComponent(next)}`);
  }
  const res = await platformUpstream({ path: '/auth/me', token: s.token });
  if (res.status === 401) {
    if (s.hasRefresh && !s.justRefreshed) return redirect(refreshUrl(next));
    return redirect(`/platform/sign-in?reason=expired&next=${encodeURIComponent(next)}`);
  }
  if (!res.ok) throw ApiError.fromProblem(res.status, await readJson(res));
  return (await readJson(res)) as PlatformOperator;
});
