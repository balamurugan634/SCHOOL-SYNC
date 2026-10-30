import { ONLINE_PROVIDER_LABEL, type OnlineProvider } from '@school-sync/shared';

/**
 * Provider failures are shown to school staff and stored on the event / meeting, so they are reduced to a fixed set of plain
 * sentences. The raw status text or body of Zoom / Google can echo account ids, e-mail addresses or parts of the credentials, so
 * it is never copied anywhere (database, API responses, audit or logs).
 */
export type ProviderErrorKind =
  | 'not_connected'
  | 'disabled'
  | 'invalid_credentials'
  | 'auth'
  | 'not_permitted'
  | 'not_found'
  | 'unavailable'
  | 'timeout'
  | 'rate_limited'
  | 'bad_request'
  | 'link_pending'
  | 'invalid_time';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly provider?: OnlineProvider,
  ) {
    super(kind); // the message is never a provider response
    this.name = 'ProviderError';
  }
}

const label = (p?: OnlineProvider) => (p ? ONLINE_PROVIDER_LABEL[p] : 'The meeting provider');

/** The one sentence a person sees for a failure. */
export function safeMessage(kind: ProviderErrorKind, provider?: OnlineProvider): string {
  const who = label(provider);
  switch (kind) {
    case 'not_connected':
      return `${who} is not connected. Connect it in Settings → Online meetings.`;
    case 'disabled':
      return `${who} is switched off in Settings → Online meetings.`;
    case 'invalid_credentials':
      return `${who} did not accept the saved credentials. Check them in Settings → Online meetings.`;
    case 'auth':
      return `${who} refused the sign-in. Check the credentials in Settings → Online meetings.`;
    case 'not_permitted':
      return provider === 'google'
        ? 'Google Calendar refused the request. A Google Workspace admin must allow the service account to use the calendar.events scope for the organizer.'
        : 'Zoom does not allow this app to manage meetings. Check the app’s scopes and that the app is activated.';
    case 'not_found':
      return provider === 'google' ? 'Google Calendar could not find the organizer or the event.' : 'Zoom could not find the host user or the meeting. Check the host email.';
    case 'rate_limited':
      return `${who} is limiting requests right now. It will be tried again.`;
    case 'timeout':
      return `${who} did not answer in time. It will be tried again.`;
    case 'unavailable':
      return `${who} is not reachable right now. It will be tried again.`;
    case 'bad_request':
      return `${who} could not use the meeting details (title, date or time).`;
    case 'link_pending':
      return 'Google Meet is still preparing the link. It will be tried again.';
    case 'invalid_time':
      return 'An online meeting needs a start and end time on a single day.';
  }
}

/** Anything thrown while talking to a provider, as a ProviderError (unknown errors are "unavailable", never echoed). */
export function toProviderError(e: unknown, provider?: OnlineProvider): ProviderError {
  if (e instanceof ProviderError) return e.provider || !provider ? e : new ProviderError(e.kind, provider);
  return new ProviderError('unavailable', provider);
}

export const errorText = (e: unknown, provider?: OnlineProvider): string => {
  const pe = toProviderError(e, provider);
  return safeMessage(pe.kind, pe.provider ?? provider);
};

/** HTTP status of an API call (after the token worked) → failure kind. */
export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'not_permitted';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}
