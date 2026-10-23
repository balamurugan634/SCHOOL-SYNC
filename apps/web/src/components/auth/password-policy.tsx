'use client';

import * as React from 'react';
import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Mirrors `passwordPolicy` in @school-sync/shared (≥10 chars, upper, lower, digit). The API is the authority. */
export const POLICY_RULES = [
  { id: 'len', label: 'At least 10 characters', test: (v: string) => v.length >= 10 },
  { id: 'upper', label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'One lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { id: 'digit', label: 'One number', test: (v: string) => /\d/.test(v) },
] as const;

const COMMON = /(password|passw0rd|qwerty|123456|abcdef|letmein|welcome|iloveyou|school|admin)/i;

export function scorePassword(v: string): { score: 0 | 1 | 2 | 3 | 4; label: string; ok: boolean } {
  if (!v) return { score: 0, label: '', ok: false };
  const passed = POLICY_RULES.filter((r) => r.test(v)).length;
  const ok = passed === POLICY_RULES.length;
  if (!ok) return passed >= 3 ? { score: 2, label: 'Almost there', ok } : { score: 1, label: 'Too weak', ok };
  const symbol = /[^A-Za-z0-9]/.test(v);
  const repeated = /(.)\1{3,}/.test(v);
  if (COMMON.test(v) || repeated) return { score: 2, label: 'Easy to guess', ok };
  return symbol && v.length >= 12 ? { score: 4, label: 'Excellent', ok } : v.length >= 16 ? { score: 4, label: 'Excellent', ok } : { score: 3, label: 'Good', ok };
}

export function StrengthMeter({ value }: { value: string }) {
  const { score, label } = scorePassword(value);
  const color = ['bg-surface-3', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'][score];
  return (
    <div aria-live="polite">
      <div className="flex gap-1" role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={4} aria-valuenow={score} aria-valuetext={label || 'Empty'}>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors', i <= score ? color : 'bg-surface-3')} />
        ))}
      </div>
      <p className="mt-1.5 h-4 text-xs text-muted-foreground">{label && <>Strength: <span className={cn('font-medium', score <= 1 ? 'text-danger-ink' : score === 2 ? 'text-warning-ink' : 'text-success-ink')}>{label}</span></>}</p>
    </div>
  );
}

export function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="space-y-1.5" aria-label="Password requirements">
      {POLICY_RULES.map((r) => {
        const pass = r.test(value);
        return (
          <li key={r.id} className={cn('flex items-center gap-2 text-[13px]', pass ? 'text-success-ink' : 'text-muted-foreground')}>
            {pass ? <Check className="size-3.5 shrink-0" strokeWidth={2.5} /> : <Circle className="size-3.5 shrink-0 text-subtle" />}
            <span>
              {r.label}
              <span className="sr-only">{pass ? ' — met' : ' — not met yet'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
