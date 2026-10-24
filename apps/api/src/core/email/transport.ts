import nodemailer from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import { config } from '../../config';
import type { emailAccounts } from '../../db/tenant/schema';
import { resolveSmtpTarget, type SmtpTarget } from './guard';
import { openForTenant } from './secret';
import { emailTestHooks } from './test-hooks';

export type EmailAccountRow = typeof emailAccounts.$inferSelect;

export interface OutgoingMessage {
  from: { name: string; address: string };
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string;
  text: string | null;
  html: string | null;
}

/** What a transport must offer. nodemailer's Transporter satisfies it; tests plug in a stub (core/email/test-hooks.ts). */
export interface MailTransport {
  sendMail(m: Record<string, unknown>): Promise<{ messageId?: string }>;
  close(): void;
}

export interface SendResult {
  messageId: string | null;
}

/** Overall ceiling for one message, on top of nodemailer's connection (10 s), greeting (10 s) and socket (20 s) timeouts. */
export const SEND_TIMEOUT_MS = 45_000;

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

/** Parses `Name <a@b.c>` or `a@b.c` (the MAIL_FROM format). */
export function parseFromHeader(value: string): { name: string; address: string } {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(value);
  if (m) return { name: clean(m[1] ?? ''), address: m[2]! };
  const bare = value.trim();
  return { name: '', address: bare.includes('@') ? bare : 'no-reply@schoolsync.local' };
}

export const platformSenderAddress = (): string => parseFromHeader(config.MAIL_FROM).address;
export const isPlatformConfigured = (): boolean => !!config.SMTP_URL || emailTestHooks.platformConfigured === true;

function create(kind: 'platform' | 'account', options: SMTPPool.Options | string, accountId?: string): MailTransport {
  if (emailTestHooks.factory) return emailTestHooks.factory({ kind, options, accountId });
  return nodemailer.createTransport(options as SMTPPool.Options) as unknown as MailTransport;
}

/** nodemailer options for a school account, connecting to the ALREADY VALIDATED address (not the name) so DNS cannot change it. */
export function smtpOptionsFor(target: SmtpTarget, acct: Pick<EmailAccountRow, 'smtpSecurity' | 'smtpUsername'>, password: string | null): SMTPPool.Options {
  const isLiteral = /^[0-9.]+$/.test(target.host) || target.host.includes(':');
  const servername = isLiteral ? undefined : target.host;
  const ehlo = (() => {
    try {
      return new URL(config.PUBLIC_API_URL).hostname || 'schoolsync.local';
    } catch {
      return 'schoolsync.local';
    }
  })();
  return {
    host: target.address,
    port: target.port,
    name: ehlo,
    secure: acct.smtpSecurity === 'ssl',
    requireTLS: acct.smtpSecurity === 'starttls',
    ignoreTLS: acct.smtpSecurity === 'none',
    auth: acct.smtpUsername ? { user: acct.smtpUsername, pass: password ?? '' } : undefined,
    servername,
    tls: { servername, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    dnsTimeout: 5_000,
    // one connection, reused for the messages of one worker run (the queue is strictly sequential anyway)
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  };
}

let platformTransport: MailTransport | null = null;
function getPlatformTransport(): MailTransport | null {
  if (!isPlatformConfigured()) return null;
  if (emailTestHooks.factory) return create('platform', config.SMTP_URL ?? 'smtp://stub');
  platformTransport ??= create('platform', config.SMTP_URL!);
  return platformTransport;
}

function toNodemailer(msg: OutgoingMessage): Record<string, unknown> {
  return {
    from: { name: clean(msg.from.name), address: msg.from.address },
    to: msg.to,
    cc: msg.cc.length ? msg.cc : undefined,
    replyTo: msg.replyTo ?? undefined,
    subject: clean(msg.subject),
    text: msg.text ?? '',
    html: msg.html ?? undefined,
    headers: { 'Auto-Submitted': 'auto-generated' },
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('send timeout'), { code: 'ETIMEDOUT' })), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Transports for ONE worker run of ONE school. Account transports are built lazily from the school's own account row (host
 * re-validated and re-resolved now), reused for the rest of the run and closed at the end, so nothing outlives the run and a
 * settings change or DNS change takes effect on the next run.
 */
export class TransportSession {
  private readonly open = new Map<string, MailTransport>();
  constructor(private readonly tenantId: string) {}

  private async forAccount(acct: EmailAccountRow): Promise<MailTransport> {
    // keyed by everything that shapes the connection, so a settings change (or a re-sealed password) gets a fresh transport
    const key = [acct.id, acct.smtpHost, acct.smtpPort, acct.smtpSecurity, acct.smtpUsername, acct.smtpPasswordEnc ?? ''].join('|');
    const hit = this.open.get(key);
    if (hit) return hit;
    const target = await resolveSmtpTarget(acct.smtpHost, acct.smtpPort);
    const password = acct.smtpPasswordEnc ? openForTenant(acct.smtpPasswordEnc, this.tenantId, acct.id) : null;
    const t = create('account', smtpOptionsFor(target, acct, password), acct.id);
    this.open.set(key, t);
    return t;
  }

  async sendViaAccount(acct: EmailAccountRow, msg: OutgoingMessage): Promise<SendResult> {
    const t = await this.forAccount(acct);
    const info = await withTimeout(t.sendMail(toNodemailer(msg)), SEND_TIMEOUT_MS);
    return { messageId: info.messageId ?? null };
  }

  async sendViaPlatform(msg: OutgoingMessage): Promise<SendResult | null> {
    const t = getPlatformTransport();
    if (!t) return null;
    const info = await withTimeout(t.sendMail(toNodemailer(msg)), SEND_TIMEOUT_MS);
    return { messageId: info.messageId ?? null };
  }

  close(): void {
    for (const t of this.open.values()) {
      try {
        t.close();
      } catch {
        /* already closed */
      }
    }
    this.open.clear();
  }
}
