/**
 * Seams used ONLY by tests (and never set in production code paths): a stub transport factory so the queue can be exercised
 * without a mail server, a fake DNS lookup for the SSRF guard, and switches for the platform sender / immediate kick.
 */
export interface TransportFactoryArgs {
  kind: 'platform' | 'account';
  options: unknown;
  accountId?: string;
}

export const emailTestHooks: {
  factory?: (a: TransportFactoryArgs) => { sendMail(m: Record<string, unknown>): Promise<{ messageId?: string }>; close(): void };
  lookup?: (host: string) => Promise<{ address: string; family: number }[]>;
  /** pretend the platform operator configured SMTP_URL */
  platformConfigured?: boolean;
  /** run the non-blocking "send now" kick even though RUN_WORKERS is off (tests) */
  forceKick?: boolean;
  /** override the pause between sends (tests) */
  sendIntervalMs?: number;
} = {};
