import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'node:fs';
import { config } from '../../config';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** string-only key/values (FCM requirement) used by clients for deep-linking */
  data: Record<string, string>;
  priority: 'normal' | 'high';
  /** Android notification channel id */
  channel?: string;
}
export type PushResult = { ok: true } | { ok: false; invalidToken: boolean; error: string };

export interface PushProvider {
  readonly name: string;
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

class LogProvider implements PushProvider {
  readonly name = 'log';
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    for (const m of messages) console.info(`[push:dev] → …${m.token.slice(-8)} "${m.title}" ${JSON.stringify(m.data)}`);
    return messages.map(() => ({ ok: true }));
  }
}

class FcmProvider implements PushProvider {
  readonly name = 'fcm';
  constructor(private readonly app: App) {}
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const out: PushResult[] = [];
    // sendEach accepts up to 500 messages per call
    for (let i = 0; i < messages.length; i += 500) {
      const chunk = messages.slice(i, i + 500);
      const res = await getMessaging(this.app).sendEach(
        chunk.map((m) => ({
          token: m.token,
          notification: { title: m.title, body: m.body },
          data: m.data,
          android: { priority: m.priority === 'high' ? ('high' as const) : ('normal' as const), notification: { channelId: m.channel ?? 'general' } },
          apns: { headers: { 'apns-priority': m.priority === 'high' ? '10' : '5' }, payload: { aps: { sound: 'default' } } },
        })),
      );
      for (const r of res.responses) {
        if (r.success) out.push({ ok: true });
        else {
          const code = r.error?.code ?? 'unknown';
          out.push({ ok: false, invalidToken: code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token', error: code });
        }
      }
    }
    return out;
  }
}

let provider: PushProvider | undefined;
export function pushProvider(): PushProvider {
  if (provider) return provider;
  try {
    const json = config.FIREBASE_SERVICE_ACCOUNT_JSON ? (JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_JSON) as object) : config.GOOGLE_APPLICATION_CREDENTIALS ? (JSON.parse(readFileSync(config.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')) as object) : null;
    if (json) {
      const app = getApps()[0] ?? initializeApp({ credential: cert(json as never) });
      provider = new FcmProvider(app);
      return provider;
    }
  } catch (e) {
    console.error('[push] Firebase init failed — falling back to log provider:', e instanceof Error ? e.message : e);
  }
  provider = new LogProvider();
  return provider;
}

/** Test hook */
export function setPushProvider(p: PushProvider | undefined): void {
  provider = p;
}
