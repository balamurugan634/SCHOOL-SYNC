'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Search } from 'lucide-react';
import type { SiteInfo } from '@school-sync/shared';
import { ApiError, errorMessage } from '@/lib/problem';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/input';
import { SchoolMark } from '../brand/school-mark';
import { AuthShell } from './auth-shell';

type Recent = Pick<SiteInfo, 'code' | 'name' | 'primaryColor' | 'logoUrl'>;
const RECENT_KEY = 'ss:recent-schools';

function loadRecent(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[];
  } catch {
    return [];
  }
}
function saveRecent(s: SiteInfo) {
  try {
    const next = [{ code: s.code, name: s.name, primaryColor: s.primaryColor, logoUrl: s.logoUrl }, ...loadRecent().filter((r) => r.code !== s.code)].slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

async function select(input: string, commit: boolean) {
  const res = await fetch('/api/site/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input, commit }), credentials: 'same-origin' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw ApiError.fromProblem(res.status, body);
  return body as { site: SiteInfo; redirectTo: string; mode: 'cookie' | 'redirect' };
}

export function FindSchool({ currentCode }: { currentCode: string | null }) {
  const sp = useSearchParams();
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [found, setFound] = React.useState<{ site: SiteInfo; redirectTo: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<Recent[]>([]);
  const [going, setGoing] = React.useState(false);
  const urlError = sp.get('error') === 'not_found' ? `We couldn’t find a school called “${sp.get('code') ?? ''}”. Check the address your school shared.` : null;

  React.useEffect(() => setRecent(loadRecent()), []);

  const look = async (input: string) => {
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const r = await select(input, false);
      setFound({ site: r.site, redirectTo: r.redirectTo });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'We couldn’t find that school. Check the code or web address your school gave you.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const go = async (site: SiteInfo) => {
    setGoing(true);
    try {
      saveRecent(site);
      const r = await select(site.code, true);
      window.location.assign(r.redirectTo);
    } catch (e) {
      setGoing(false);
      setError(errorMessage(e));
    }
  };

  return (
    <AuthShell site={null}>
      <div className="page-in">
        <h1 className="text-xl font-semibold leading-7">Find your school</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the school code or web address your school gave you.</p>

        <div className="mt-5 space-y-3">
          {urlError && !error && !found && <Banner tone="warning">{urlError}</Banner>}
          {currentCode && !found && <Banner tone="info">You are currently on <strong className="font-medium">{currentCode}</strong>. Search for another school to switch.</Banner>}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim().length >= 2) void look(value);
          }}
          className="mt-4 space-y-4"
        >
          <Field label="School code or address" htmlFor="school" hint="For example greenvalley or greenvalley.schoolsync.app" error={error}>
            <Input id="school" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} leftIcon={<Search />} placeholder="School code" value={value} onChange={(e) => { setValue(e.target.value); setFound(null); setError(null); }} invalid={!!error} />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={value.trim().length < 2}>
            Find school
          </Button>
        </form>

        {found && (
          <div className="mt-5 rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-center gap-3">
              <SchoolMark name={found.site.name} logoUrl={found.site.logoUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{found.site.name}</p>
                <p className="text-xs text-muted-foreground">{found.site.code}</p>
              </div>
            </div>
            <Button className="mt-3 w-full" onClick={() => go(found.site)} loading={going}>
              Continue to sign in
            </Button>
          </div>
        )}

        {recent.length > 0 && !found && (
          <div className="mt-6">
            <p className="mb-1.5 text-xs font-medium text-subtle">Recent schools</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {recent.map((r) => (
                <li key={r.code}>
                  <button type="button" onClick={() => { setValue(r.code); void look(r.code); }} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">{r.code}</span>
                    </span>
                    <ArrowRight className="size-4 text-subtle" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
