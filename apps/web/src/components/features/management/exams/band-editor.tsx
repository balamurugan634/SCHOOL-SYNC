'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { GradeBandIn, GradeBandOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

export interface BandRow {
  key: string;
  label: string;
  min: string;
  max: string;
  point: string;
  remark: string;
}

let seq = 0;
export const newBandRow = (p: Partial<BandRow> = {}): BandRow => ({ key: `b${++seq}`, label: '', min: '', max: '', point: '', remark: '', ...p });
export const bandsToRows = (bands: Pick<GradeBandOut, 'label' | 'minPercent' | 'maxPercent' | 'gradePoint' | 'remark'>[]): BandRow[] =>
  [...bands].sort((a, b) => b.minPercent - a.minPercent).map((b) => newBandRow({ label: b.label, min: String(b.minPercent), max: String(b.maxPercent), point: b.gradePoint === null ? '' : String(b.gradePoint), remark: b.remark ?? '' }));

export const bandsPayload = (rows: BandRow[]): GradeBandIn[] =>
  rows.map((r) => ({ label: r.label.trim(), minPercent: Number(r.min), maxPercent: Number(r.max), gradePoint: r.point.trim() === '' ? null : Number(r.point), remark: r.remark.trim() === '' ? null : r.remark.trim() }));

export interface BandCheck {
  rowErrors: Record<string, string[]>;
  /** blocking problems about the set as a whole (the API rejects these) */
  problems: string[];
  /** not rejected by the API, but worth knowing */
  warnings: string[];
  segments: { key: string; label: string; min: number; max: number; bad: boolean }[];
  valid: boolean;
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** The same rules as the API (starts at 0, ends at 100, no overlap, unique labels, min ≤ max) plus a heads-up for gaps. */
export function checkBands(rows: BandRow[]): BandCheck {
  const rowErrors: Record<string, string[]> = {};
  const problems: string[] = [];
  const warnings: string[] = [];
  const add = (k: string, m: string) => (rowErrors[k] ??= []).push(m);
  const parsed: { key: string; label: string; min: number; max: number }[] = [];

  if (rows.length === 0) problems.push('Add at least one band.');
  for (const r of rows) {
    const min = num(r.min);
    const max = num(r.max);
    if (!r.label.trim()) add(r.key, 'Give the band a label.');
    else if (r.label.trim().length > 10) add(r.key, 'Label is at most 10 characters.');
    if (Number.isNaN(min) || min < 0 || min > 100) add(r.key, 'From must be a number between 0 and 100.');
    if (Number.isNaN(max) || max < 0 || max > 100) add(r.key, 'To must be a number between 0 and 100.');
    if (!Number.isNaN(min) && !Number.isNaN(max) && min > max) add(r.key, 'From must not be higher than To.');
    if (r.point.trim() !== '' && (Number.isNaN(Number(r.point)) || Number(r.point) < 0 || Number(r.point) > 10)) add(r.key, 'Grade point must be between 0 and 10.');
    if (r.remark.length > 100) add(r.key, 'Remark is at most 100 characters.');
    if (!Number.isNaN(min) && !Number.isNaN(max)) parsed.push({ key: r.key, label: r.label.trim() || '(unnamed)', min, max });
  }

  const sorted = [...parsed].sort((a, b) => a.min - b.min);
  const bad = new Set<string>();
  if (sorted.length && sorted.length === rows.length) {
    if (sorted[0]!.min !== 0) problems.push(`The lowest band must start at 0%. It starts at ${sorted[0]!.min}%.`);
    if (Math.max(...sorted.map((s) => s.max)) !== 100) problems.push(`The highest band must end at 100%. It ends at ${Math.max(...sorted.map((s) => s.max))}%.`);
  }
  const seen = new Map<string, string>();
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]!;
    const key = b.label.toLowerCase();
    if (b.label !== '(unnamed)') {
      if (seen.has(key)) {
        problems.push(`The label “${b.label}” is used twice.`);
        bad.add(b.key);
        bad.add(seen.get(key)!);
      }
      seen.set(key, b.key);
    }
    const prev = sorted[i - 1];
    if (prev) {
      if (b.min <= prev.max) {
        problems.push(`“${prev.label}” (${prev.min}–${prev.max}) and “${b.label}” (${b.min}–${b.max}) overlap.`);
        bad.add(b.key);
        bad.add(prev.key);
      } else if (b.min - prev.max > 1) {
        warnings.push(`Nothing covers ${prev.max}% to ${b.min}%. Scores in that range get the grade of the band below (“${prev.label}”).`);
      }
    }
  }
  const valid = problems.length === 0 && Object.keys(rowErrors).length === 0;
  return { rowErrors, problems, warnings, segments: parsed.map((p) => ({ ...p, bad: bad.has(p.key) })), valid };
}

/** The 0–100 strip: each band is a block; overlaps show in the danger colour, gaps stay empty. */
function CoverageBar({ check }: { check: BandCheck }) {
  const summary = check.valid ? 'The bands cover 0 to 100 without overlap.' : `${check.problems.length} problem${check.problems.length === 1 ? '' : 's'} with the bands.`;
  return (
    <div>
      <div className="relative h-8 overflow-hidden rounded-md border border-border bg-surface-sunken" role="img" aria-label={`Coverage from 0 to 100 percent. ${summary}`}>
        {check.segments.map((s) => (
          <div
            key={s.key}
            className={cn('absolute inset-y-0 border-x border-surface text-center text-[11px] font-medium leading-8', s.bad ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-ink')}
            style={{ left: `${Math.max(0, Math.min(100, s.min))}%`, width: `${Math.max(0.6, Math.min(100, s.max) - Math.max(0, s.min))}%` }}
            title={`${s.label}: ${s.min}–${s.max}%`}
          >
            <span className="block truncate px-0.5">{s.max - s.min > 6 ? s.label : ''}</span>
          </div>
        ))}
      </div>
      <div className="t-caption tnum mt-1 flex justify-between text-ink-3" aria-hidden>
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

/** Editable list of grade bands with live validation and a coverage strip. */
export function BandEditor({ rows, onChange, disabled }: { rows: BandRow[]; onChange: (r: BandRow[]) => void; disabled?: boolean }) {
  const check = React.useMemo(() => checkBands(rows), [rows]);
  const patch = (key: string, p: Partial<BandRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  return (
    <div className="space-y-4">
      <CoverageBar check={check} />
      {check.problems.length > 0 && (
        <Banner tone="danger" title="Fix these before saving">
          <ul className="list-disc space-y-0.5 pl-4">
            {check.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Banner>
      )}
      {check.warnings.length > 0 && (
        <Banner tone="warning" title="Gaps between bands">
          <ul className="list-disc space-y-0.5 pl-4">
            {check.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Banner>
      )}
      <ul className="space-y-3" aria-label="Grade bands">
        {rows.map((r, i) => {
          const errs = check.rowErrors[r.key];
          return (
            <li key={r.key} className="rounded-lg border border-border p-3">
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 sm:grid-cols-[5rem_5.5rem_5.5rem_5.5rem_minmax(0,1fr)_auto] sm:items-end">
                <label className="space-y-1">
                  <span className="t-caption text-ink-2">Grade</span>
                  <Input value={r.label} onChange={(e) => patch(r.key, { label: e.target.value })} aria-label={`Band ${i + 1} label`} maxLength={10} invalid={!!errs?.some((m) => m.startsWith('Give') || m.startsWith('Label'))} disabled={disabled} />
                </label>
                <label className="space-y-1">
                  <span className="t-caption text-ink-2">From %</span>
                  <Input type="number" step="any" inputMode="decimal" value={r.min} onChange={(e) => patch(r.key, { min: e.target.value })} aria-label={`Band ${i + 1} from percent`} disabled={disabled} />
                </label>
                <label className="space-y-1">
                  <span className="t-caption text-ink-2">To %</span>
                  <Input type="number" step="any" inputMode="decimal" value={r.max} onChange={(e) => patch(r.key, { max: e.target.value })} aria-label={`Band ${i + 1} to percent`} disabled={disabled} />
                </label>
                <label className="col-span-1 space-y-1">
                  <span className="t-caption text-ink-2">Points</span>
                  <Input type="number" step="any" inputMode="decimal" value={r.point} onChange={(e) => patch(r.key, { point: e.target.value })} aria-label={`Band ${i + 1} grade point`} disabled={disabled} />
                </label>
                <label className="col-span-2 space-y-1 sm:col-span-1">
                  <span className="t-caption text-ink-2">Remark</span>
                  <Input value={r.remark} onChange={(e) => patch(r.key, { remark: e.target.value })} aria-label={`Band ${i + 1} remark`} maxLength={100} placeholder="Outstanding" disabled={disabled} />
                </label>
                <div className="flex justify-end sm:pb-0">
                  <IconButton label={`Remove band ${i + 1}`} size="icon-sm" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} disabled={disabled || rows.length <= 1}>
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
              {errs && errs.length > 0 && (
                <p role="alert" className="t-caption mt-2 text-danger">
                  {errs.join(' ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <Button variant="secondary" size="sm" onClick={() => onChange([...rows, newBandRow()])} disabled={disabled || rows.length >= 20}>
        <Plus /> Add band
      </Button>
    </div>
  );
}
