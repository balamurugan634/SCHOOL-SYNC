import type { TenantInfo } from '../tenancy/registry';
import { classifyMailError } from './errors';
import { platformSenderAddress, TransportSession, type EmailAccountRow, type OutgoingMessage } from './transport';

export interface TestSendResult {
  ok: boolean;
  /** plain-language and sanitised */
  error: string | null;
}

/**
 * Send one test message synchronously (not through the queue) so the admin sees the result immediately.
 * `account = null` tests the platform default sender. The result never contains a raw server response.
 */
export async function sendTestMessage(tenant: Pick<TenantInfo, 'id' | 'name'>, account: EmailAccountRow | null, to: string): Promise<TestSendResult> {
  const session = new TransportSession(tenant.id);
  const label = account ? `the email account “${account.name}”` : 'the SchoolSync default sender';
  const msg: OutgoingMessage = {
    from: account ? { name: account.senderName || tenant.name, address: account.emailAddress } : { name: tenant.name, address: platformSenderAddress() },
    to: [to],
    cc: [],
    replyTo: account?.replyTo ?? null,
    subject: `Test email from ${tenant.name}`,
    text: `This is a test message from SchoolSync for ${tenant.name}.\n\nIt was sent through ${label}. If you can read this, outgoing email is working.\n\nNo action is needed.`,
    html: null,
  };
  try {
    if (account) await session.sendViaAccount(account, msg);
    else if (!(await session.sendViaPlatform(msg))) return { ok: false, error: 'The platform has no default mail server configured. Add your own email account instead.' };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: classifyMailError(e).message };
  } finally {
    session.close();
  }
}
