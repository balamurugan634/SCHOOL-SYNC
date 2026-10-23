import * as shared from '@school-sync/shared';
import { describe, expect, it } from 'vitest';

/**
 * Zod 4 re-applies `.default()` inside `.partial()`. A PATCH body built as `createBody.partial()` therefore turns an
 * EMPTY patch (or one that omits a field) into "reset that field to its default" — silently overwriting stored data.
 * Every exported schema whose name ends in Update or Patch (optionally followed by Body) that accepts `{}` must parse it to `{}`.
 */
describe('PATCH bodies never inject defaults', () => {
  const patchSchemas = Object.entries(shared).filter(([name, s]) => /(Update|Patch)(Body)?$/.test(name) && typeof (s as { safeParse?: unknown })?.safeParse === 'function');

  it('finds the patch schemas', () => {
    expect(patchSchemas.length).toBeGreaterThan(10);
  });

  it.each(patchSchemas)('%s: an empty patch stays empty', (_name, schema) => {
    const r = (schema as { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } }).safeParse({});
    if (!r.success) return; // has genuinely required keys
    expect(Object.keys(r.data ?? {})).toEqual([]);
  });
});
