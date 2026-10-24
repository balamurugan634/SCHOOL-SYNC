import { SmtpTargetError } from './guard';

/**
 * Mail failures are shown to school admins and stored in the queue, so they are reduced to a fixed set of plain-language
 * sentences (+ the 3-digit SMTP code). The raw message/response of a server can carry banners, hostnames, usernames or echo
 * parts of the authentication exchange, so it is never copied anywhere (not into the database, API responses, audit or logs).
 */
export interface MailFailure {
  message: string;
  /** false: retrying cannot help (rejected address, wrong password, blocked host) */
  retryable: boolean;
}

interface MailErrorLike {
  code?: unknown;
  responseCode?: unknown;
  command?: unknown;
  message?: unknown;
}

const CERT_RE = /cert|self[- ]signed|unable to verify|altname|hostname\/ip does not match/i;
const NET_CODES = new Set(['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);

const withCode = (msg: string, code: number | null) => (code ? `${msg} (server code ${code})` : msg);

export function classifyMailError(err: unknown): MailFailure {
  if (err instanceof SmtpTargetError) return { message: err.message, retryable: err.code === 'HOST_NOT_FOUND' };
  const e = (err && typeof err === 'object' ? err : {}) as MailErrorLike;
  const code = typeof e.code === 'string' ? e.code : '';
  const text = typeof e.message === 'string' ? e.message : '';
  const rc = typeof e.responseCode === 'number' && e.responseCode >= 200 && e.responseCode <= 599 ? e.responseCode : null;
  const temporary = rc !== null && rc >= 400 && rc < 500;

  if (CERT_RE.test(code) || (CERT_RE.test(text) && !/auth/i.test(code))) {
    return { message: 'The mail server’s security certificate was not accepted (it may be expired, self-signed or issued for a different name). Check the server name or ask your mail provider.', retryable: true };
  }
  if (code === 'EAUTH') {
    return temporary
      ? { message: withCode('The mail server could not sign in right now.', rc), retryable: true }
      : { message: withCode('The mail server rejected the username or password. Gmail, Microsoft 365 and Zoho need an app password, not your normal password.', rc), retryable: false };
  }
  if (code === 'ETLS' || code === 'EREQUIRETLS' || /wrong version number|ssl routines|tls/i.test(text)) {
    return { message: 'The mail server did not accept a secure connection. Try STARTTLS on port 587 or SSL on port 465.', retryable: true };
  }
  if (NET_CODES.has(code)) {
    return { message: 'Could not connect to the mail server. Check the server name and port.', retryable: true };
  }
  if (code === 'EENVELOPE' || (rc !== null && rc >= 500 && (code === '' || code === 'EENVELOPE') && /rcpt|mail from|envelope/i.test(String(e.command ?? '')))) {
    return temporary ? { message: withCode('The mail server is busy or limiting how fast mail can be sent. It will be tried again.', rc), retryable: true } : { message: withCode('The mail server refused the sender or recipient address.', rc), retryable: false };
  }
  if (temporary) return { message: withCode('The mail server is busy or limiting how fast mail can be sent. It will be tried again.', rc), retryable: true };
  if (rc !== null && rc >= 500) return { message: withCode('The mail server refused the message.', rc), retryable: false };
  if (code === 'EMESSAGE') return { message: 'The mail server refused the message.', retryable: false };
  return { message: 'The mail server returned an error. Check the account settings and send a test email.', retryable: true };
}

export const sanitiseMailError = (err: unknown): string => classifyMailError(err).message;
