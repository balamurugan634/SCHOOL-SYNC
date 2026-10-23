import type { NextResponse } from 'next/server';
import type { CookieSpec } from '../cookies';

export function applyCookies<T extends NextResponse>(res: T, specs: CookieSpec[]): T {
  for (const c of specs) res.cookies.set({ name: c.name, value: c.value, ...c.options });
  return res;
}
