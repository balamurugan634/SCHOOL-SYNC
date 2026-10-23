'use client';

import * as React from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { brandCss, brandVars, contrast, normalizeHex } from '@/lib/color';

/** CSS text `--a:1;--b:2;` → a React style object (custom properties). */
const styleOf = (css: string): React.CSSProperties =>
  Object.fromEntries(
    css
      .split(';')
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(':');
        return [d.slice(0, i), d.slice(i + 1)];
      }),
  ) as React.CSSProperties;

/** Re-declare the live brand tokens on the wrapper so `bg-brand`, `text-brand-ink`… inside it use THIS colour, not the school's current one. */
const LIGHT_TOKENS: React.CSSProperties = {
  ['--brand' as string]: 'var(--b-solid-l)',
  ['--brand-hover' as string]: 'var(--b-hover-l)',
  ['--brand-press' as string]: 'var(--b-press-l)',
  ['--brand-ink' as string]: 'var(--b-ink-l)',
  ['--on-brand' as string]: 'var(--b-on-l)',
  ['--brand-soft' as string]: 'color-mix(in srgb, var(--b-solid-l) 8%, var(--surface))',
  ['--ring' as string]: 'color-mix(in srgb, var(--b-solid-l) 35%, transparent)',
};
const DARK_TOKENS: React.CSSProperties = {
  ['--brand-soft' as string]: 'color-mix(in srgb, var(--b-solid-d) 14%, var(--surface))',
  ['--ring' as string]: 'color-mix(in srgb, var(--b-solid-d) 35%, transparent)',
};

function Sample({ dark, css }: { dark?: boolean; css: string }) {
  return (
    <div
      data-theme={dark ? 'dark' : undefined}
      style={{ ...styleOf(css), ...(dark ? DARK_TOKENS : LIGHT_TOKENS) }}
      className="space-y-3 rounded-lg border border-border bg-surface p-4 text-ink"
    >
      <p className="t-caption text-ink-2">{dark ? 'Dark mode' : 'Light mode'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" tabIndex={-1}>Primary action</Button>
        <Button size="sm" variant="secondary" tabIndex={-1}>Secondary</Button>
        <Badge variant="primary">Selected</Badge>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-brand-soft px-3 py-2 text-[13px] font-medium text-brand-ink">
        <span className="h-4 w-0.5 rounded-full bg-brand" aria-hidden /> Active menu item
      </div>
      <p className="text-sm">
        A <span className="font-medium text-brand-ink underline underline-offset-4">link in the school colour</span> on the page.
      </p>
    </div>
  );
}

/**
 * Live preview of what the app will really use for a school colour (design.md §2.2): the chosen colour is normalised in OKLCH
 * (chroma capped, lightness 0.36–0.50, darkened until white text is AA), so it is shown next to what was entered.
 */
export function BrandPreview({ value }: { value: string }) {
  const hex = normalizeHex(value);
  if (!hex) return <p className="t-caption text-ink-3">Enter a six-digit colour such as #1b6b4f to see a preview.</p>;
  const v = brandVars(hex);
  const css = brandCss(hex);
  const ratio = contrast('#ffffff', v.solid);
  const changed = v.solid.toLowerCase() !== hex.toLowerCase();
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <span className="size-6 rounded-md border border-border" style={{ background: hex }} aria-hidden /> You chose <span className="font-mono text-[13px]">{hex.toUpperCase()}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="size-6 rounded-md border border-border" style={{ background: v.solid }} aria-hidden /> The app uses <span className="font-mono text-[13px]">{v.solid.toUpperCase()}</span>
        </span>
      </div>
      <p className="t-caption flex items-start gap-1.5 text-ink-2">
        {changed ? <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden /> : <Check className="mt-px size-3.5 shrink-0 text-success" aria-hidden />}
        <span>
          {changed ? 'The colour is softened and darkened so it always looks calm and stays readable. ' : 'This colour is used as it is. '}
          White text on it has a contrast of {ratio.toFixed(1)}:1 ({ratio >= 4.5 ? 'passes' : 'below'} the 4.5:1 accessibility minimum).
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Sample css={css} />
        <Sample css={css} dark />
      </div>
    </div>
  );
}
