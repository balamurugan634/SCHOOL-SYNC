import { createHash } from 'node:crypto';
import { and, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { ONLINE_PROVIDER_LABEL, type OnlineProvider, type OnlineStatus } from '@school-sync/shared';
import { audit, type AuditActor } from '../audit';
import { events, meetings, staff } from '../../db/tenant/schema';
import type { Executor } from '../tenancy/pools';
import type { TenantInfo } from '../tenancy/registry';
import { ProviderError, safeMessage, toProviderError } from './errors';
import { providerFor } from './integrations';
import { eventWindow, meetingWindow } from './schedule';
import { sealStartUrl } from './secret';
import { onlineMeetingTuning } from './tuning';
import type { MeetingSpec } from './types';

/**
 * Keeps the meeting at Zoom / Google in step with the event or parent–teacher meeting that owns it.
 *
 * The row says what is WANTED (`online_provider`, and whether the row is "live": a published event, a confirmed online
 * meeting) and what EXISTS (`online_remote_provider`, `online_meeting_id`, `online_sync_sig`). `syncOnline` compares the two and
 * creates, updates or cancels the meeting at the provider, then records the result. It is idempotent and never throws: a provider
 * failure becomes `online_status = 'failed'` with a safe message, and the same function (manual Retry, background job) finishes the
 * work later. It is always called AFTER the owning change has committed, so a provider outage can never block saving.
 */

export type SyncKind = 'event' | 'meeting';
export type SyncOutcome = 'done' | 'busy' | 'missing' | 'skipped';
export interface SyncOptions {
  /** a person pressed Retry: a new failure restarts the one-day retry window */
  manual?: boolean;
  /** who to credit in the audit log (a system actor when omitted, e.g. the background job) */
  actor?: AuditActor;
  /** where to report bookkeeping trouble (database errors); only a short code is ever passed on */
  log?: { error(o: unknown, m?: string): void };
}

type EventRow = typeof events.$inferSelect;
type MeetingRow = typeof meetings.$inferSelect;
/** events and meetings share the online columns; the code below only touches those (and `locationOrLink` for meetings) */
type AnyTable = typeof events;
type AnyRow = EventRow;

interface Desire {
  /** a meeting should exist at the provider */
  live: boolean;
  wanted: OnlineProvider | null;
  /** null when live but the row cannot give a valid single-day window */
  spec: MeetingSpec | null;
  sig: string;
}

interface Adapter {
  table: AnyTable;
  desire(db: Executor, tenant: TenantInfo, row: AnyRow): Promise<Desire>;
  /** extra columns to write with the result (meetings mirror the join link into `locationOrLink`) */
  extras(row: AnyRow, joinUrl: string | null, previousJoinUrl: string | null, status: OnlineStatus): { locationOrLink?: string | null };
  summary(row: AnyRow): string;
}

const sigOf = (provider: OnlineProvider | null, spec: MeetingSpec): string => createHash('sha256').update(JSON.stringify([provider, spec])).digest('hex').slice(0, 16);

const eventAdapter: Adapter = {
  table: events,
  async desire(_db, tenant, ev) {
    const wanted = ev.onlineProvider;
    if (!(ev.status === 'published' && wanted)) return { live: false, wanted, spec: null, sig: '' };
    const w = eventWindow(ev, tenant.timezone);
    if (!w) return { live: true, wanted, spec: null, sig: 'invalid' };
    const agenda = [ev.description?.trim(), ev.location ? `Place: ${ev.location}` : null].filter(Boolean).join('\n\n');
    const spec: MeetingSpec = { topic: ev.title, agenda, startLocal: w.startLocal, endLocal: w.endLocal, timeZone: tenant.timezone, durationMin: w.durationMin };
    return { live: true, wanted, spec, sig: sigOf(wanted, spec) };
  },
  extras: () => ({}),
  summary: (ev) => ev.title,
};

const meetingAdapter: Adapter = {
  table: meetings as unknown as AnyTable,
  async desire(db, tenant, row) {
    const m = row as unknown as MeetingRow;
    const wanted = m.onlineProvider;
    if (!(m.status === 'confirmed' && m.mode === 'online' && wanted && m.scheduledAt)) return { live: false, wanted, spec: null, sig: '' };
    const [t] = await db.select({ first: staff.firstName, last: staff.lastName }).from(staff).where(eq(staff.id, m.staffId)).limit(1);
    const w = meetingWindow(m.scheduledAt, m.durationMin, tenant.timezone);
    // no child's name and no parent-written topic: both would be readable in the provider's account and waiting room
    const spec: MeetingSpec = { topic: `Parent–teacher meeting${t ? ` with ${[t.first, t.last].filter(Boolean).join(' ')}` : ''}`, agenda: 'Scheduled through SchoolSync.', startLocal: w.startLocal, endLocal: w.endLocal, timeZone: tenant.timezone, durationMin: w.durationMin };
    return { live: true, wanted, spec, sig: sigOf(wanted, spec) };
  },
  extras(row, joinUrl, previous, status) {
    const m = row as unknown as MeetingRow;
    if (status === 'scheduled' && joinUrl) return { locationOrLink: joinUrl };
    // the link we wrote earlier is dead now (cancelled or moved elsewhere): do not leave it behind
    if (previous && m.locationOrLink === previous && !joinUrl) return { locationOrLink: null };
    return {};
  },
  summary: (m) => `Meeting ${m.id.slice(0, 8)}`,
};

const ADAPTERS: Record<SyncKind, Adapter> = { event: eventAdapter, meeting: meetingAdapter };

interface State {
  remote: OnlineProvider | null;
  meetingId: string | null;
  joinUrl: string | null;
  startEnc: string | null;
  passcode: string | null;
  sig: string | null;
}
const stateOf = (r: AnyRow): State => ({ remote: r.onlineRemoteProvider, meetingId: r.onlineMeetingId, joinUrl: r.onlineJoinUrl, startEnc: r.onlineStartUrlEnc, passcode: r.onlinePasscode, sig: r.onlineSyncSig });
const CLEARED: State = { remote: null, meetingId: null, joinUrl: null, startEnc: null, passcode: null, sig: null };

// ── per-row lease ───────────────────────────────────────────────────────────────────────────────

async function claim(db: Executor, t: AnyTable, id: string): Promise<AnyRow | null> {
  const [row] = await db
    .update(t)
    .set({ onlineLeaseUntil: sql`now() + (${onlineMeetingTuning.leaseSeconds} * interval '1 second')`, updatedAt: sql`${t.updatedAt}` })
    .where(and(eq(t.id, id), or(isNull(t.onlineLeaseUntil), lt(t.onlineLeaseUntil, sql`now()`))))
    .returning();
  return row ?? null;
}
const release = (db: Executor, t: AnyTable, id: string) => db.update(t).set({ onlineLeaseUntil: null, updatedAt: sql`${t.updatedAt}` }).where(eq(t.id, id));

// ── the reconciliation itself ───────────────────────────────────────────────────────────────────

interface RoundResult {
  ok: boolean;
  desire: Desire;
}

async function round(db: Executor, tenant: TenantInfo, kind: SyncKind, ad: Adapter, row: AnyRow, opts: SyncOptions): Promise<RoundResult> {
  const t = ad.table;
  const d = await ad.desire(db, tenant, row);
  const prev = stateOf(row);
  const hadRemote = !!prev.meetingId;
  let st: State = { ...prev };
  let err: ProviderError | null = null;
  let touched = false;

  // A ── a meeting that should not exist (any more) or lives at another provider: cancel it
  if (st.meetingId && st.remote && (!d.live || st.remote !== d.wanted)) {
    touched = true;
    try {
      await (await providerFor(db, tenant, st.remote, 'manage')).cancel(st.meetingId);
      st = { ...CLEARED };
    } catch (e) {
      err = toProviderError(e, st.remote ?? undefined);
    }
  }

  // B ── a meeting that should exist: create it, or bring it up to date
  if (!err && d.live) {
    if (!d.spec || !d.wanted) {
      err = new ProviderError('invalid_time', d.wanted ?? undefined);
    } else if (!st.meetingId) {
      touched = true;
      try {
        const m = await (await providerFor(db, tenant, d.wanted, 'create')).create(d.spec);
        st = { remote: d.wanted, meetingId: m.id, joinUrl: m.joinUrl, startEnc: m.startUrl ? sealStartUrl(m.startUrl, tenant.id, kind, row.id) : null, passcode: m.passcode, sig: d.sig };
        if (!m.joinUrl) err = new ProviderError('link_pending', d.wanted); // the meeting exists; a retry finishes it
      } catch (e) {
        err = toProviderError(e, d.wanted);
      }
    } else if (st.sig !== d.sig || row.onlineStatus !== 'scheduled' || !st.joinUrl) {
      touched = true;
      const provider = st.remote ?? d.wanted;
      try {
        const u = await (await providerFor(db, tenant, provider, 'manage')).update(st.meetingId, d.spec, { needLink: !st.joinUrl });
        st = { ...st, remote: provider, joinUrl: st.joinUrl ?? u.joinUrl, sig: d.sig };
        if (!st.joinUrl) err = new ProviderError('link_pending', provider);
      } catch (e) {
        err = toProviderError(e, provider);
      }
    }
  }

  // result
  let status: OnlineStatus;
  let error: string | null = null;
  let failedAt: Date | null = null;
  if (err) {
    status = 'failed';
    error = safeMessage(err.kind, err.provider);
    failedAt = row.onlineFailedAt && !opts.manual ? row.onlineFailedAt : new Date();
  } else if (d.live) {
    status = 'scheduled';
  } else {
    status = d.wanted && (hadRemote || row.onlineStatus === 'cancelled') ? 'cancelled' : 'none';
  }

  await db
    .update(t)
    .set({
      onlineStatus: status,
      onlineRemoteProvider: st.remote,
      onlineMeetingId: st.meetingId,
      onlineJoinUrl: st.joinUrl,
      onlineStartUrlEnc: st.startEnc,
      onlinePasscode: st.passcode,
      onlineError: error,
      onlineFailedAt: failedAt,
      onlineSyncSig: st.sig,
      updatedAt: sql`${t.updatedAt}`, // this is bookkeeping, not an edit
      ...ad.extras(row, st.joinUrl, prev.joinUrl, status),
    })
    .where(eq(t.id, row.id));

  if (touched) {
    const provider = (err?.provider ?? st.remote ?? prev.remote ?? d.wanted) as OnlineProvider | null;
    const word = status === 'scheduled' ? 'scheduled' : status === 'failed' ? 'failed' : 'cancelled';
    await audit(db, opts.actor ?? { userId: null, name: 'Online meetings' }, {
      action: `${kind}.online_${word}`,
      entity: kind,
      entityId: row.id,
      summary: `${provider ? ONLINE_PROVIDER_LABEL[provider] : 'Online'} meeting ${word === 'failed' ? 'could not be updated' : word}: ${ad.summary(row)}`,
      before: { status: row.onlineStatus },
      after: { provider, status, ...(error ? { error } : {}) },
    }).catch(() => undefined);
  }
  return { ok: !err, desire: d };
}

/**
 * Bring the provider's copy of one event / meeting in line with the row. Never throws. `busy` means another worker holds the
 * row right now (it re-checks the row before it lets go, so nothing is lost).
 */
export async function syncOnline(tenant: TenantInfo, db: Executor, kind: SyncKind, id: string, opts: SyncOptions = {}): Promise<SyncOutcome> {
  const ad = ADAPTERS[kind];
  const t = ad.table;
  try {
    const [peek] = await db.select({ p: t.onlineProvider, r: t.onlineRemoteProvider, s: t.onlineStatus }).from(t).where(eq(t.id, id)).limit(1);
    if (!peek) return 'missing';
    if (!peek.p && !peek.r && peek.s === 'none') return 'skipped';
    let row = await claim(db, t, id);
    if (!row) return 'busy';
    const startedAt = Date.now();
    try {
      for (let i = 0; i < 3; i++) {
        const res = await round(db, tenant, kind, ad, row, opts);
        if (!res.ok || Date.now() - startedAt > onlineMeetingTuning.runBudgetMs) break;
        // the row may have been edited while we talked to the provider: look again, and go round once more if so
        const [fresh] = await db.select().from(t).where(eq(t.id, id)).limit(1);
        if (!fresh) break;
        const again = await ad.desire(db, tenant, fresh);
        row = fresh;
        if (again.sig === res.desire.sig && again.live === res.desire.live && again.wanted === res.desire.wanted) break;
        await db.update(t).set({ onlineLeaseUntil: sql`now() + (${onlineMeetingTuning.leaseSeconds} * interval '1 second')`, updatedAt: sql`${t.updatedAt}` }).where(eq(t.id, id));
      }
    } finally {
      await release(db, t, id);
    }
    return 'done';
  } catch (e) {
    // bookkeeping failed (database trouble): the owning change is already saved. Report a short code only: a driver error
    // message carries the failed query's parameters (links, passcodes).
    const code = e && typeof e === 'object' ? String((e as { cause?: { code?: unknown }; code?: unknown }).cause?.code ?? (e as { code?: unknown }).code ?? (e as { name?: unknown }).name) : 'unknown';
    opts.log?.error({ kind, id, code }, 'online meeting bookkeeping failed');
    return 'skipped';
  }
}

// ── what the background job should pick up ──────────────────────────────────────────────────────

/** Events whose provider copy is out of step: a failure younger than a day, a stale meeting that must go, a published event never created. */
export function eventsNeedingSync(today: string): SQL {
  return sql`(${events.onlineLeaseUntil} is null or ${events.onlineLeaseUntil} < now()) and (
    (${events.onlineStatus} = 'failed' and ${events.onlineFailedAt} > now() - interval '1 day' and (${events.endDate} >= ${today} or ${events.onlineMeetingId} is not null))
    or (${events.onlineStatus} <> 'failed' and ${events.onlineMeetingId} is not null and not (${events.status} = 'published' and ${events.onlineProvider} is not null and ${events.onlineProvider} = ${events.onlineRemoteProvider}))
    or (${events.onlineStatus} = 'none' and ${events.status} = 'published' and ${events.onlineProvider} is not null and ${events.onlineMeetingId} is null and ${events.endDate} >= ${today})
  )`;
}

export function meetingsNeedingSync(): SQL {
  return sql`(${meetings.onlineLeaseUntil} is null or ${meetings.onlineLeaseUntil} < now()) and (
    (${meetings.onlineStatus} = 'failed' and ${meetings.onlineFailedAt} > now() - interval '1 day')
    or (${meetings.onlineStatus} <> 'failed' and ${meetings.onlineMeetingId} is not null and not (${meetings.status} = 'confirmed' and ${meetings.mode} = 'online' and ${meetings.onlineProvider} is not null and ${meetings.onlineProvider} = ${meetings.onlineRemoteProvider}))
    or (${meetings.onlineStatus} = 'none' and ${meetings.status} = 'confirmed' and ${meetings.mode} = 'online' and ${meetings.onlineProvider} is not null and ${meetings.onlineMeetingId} is null and ${meetings.scheduledAt} > now())
  )`;
}
