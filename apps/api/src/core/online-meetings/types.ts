import type { OnlineProvider } from '@school-sync/shared';

/** What is pushed to a provider for one meeting. Times are the school's local wall-clock time plus its IANA zone. */
export interface MeetingSpec {
  topic: string;
  agenda: string;
  /** `YYYY-MM-DDTHH:mm:ss`, local to `timeZone` */
  startLocal: string;
  endLocal: string;
  timeZone: string;
  durationMin: number;
}

export interface RemoteMeeting {
  id: string;
  /** null while the provider is still preparing the link (Google Meet conferences can stay `pending` for a moment) */
  joinUrl: string | null;
  /** host link (Zoom `start_url`); Google Meet has none, the organizer opens the same link */
  startUrl: string | null;
  passcode: string | null;
}

/** One connected account at a provider. Every call has a 10 s timeout and fails with a ProviderError (safe message only). */
export interface MeetingProvider {
  readonly provider: OnlineProvider;
  create(spec: MeetingSpec): Promise<RemoteMeeting>;
  /** returns the join link when the provider knows it (used to finish a Meet link that was still pending) */
  update(id: string, spec: MeetingSpec, opts?: { needLink?: boolean }): Promise<{ joinUrl: string | null }>;
  /** an already-deleted meeting (404 / 410) counts as cancelled */
  cancel(id: string): Promise<void>;
  /** token + one harmless read; creates nothing. Returns a plain-language summary of what was checked. */
  test(): Promise<string>;
}
