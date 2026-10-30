import { z } from 'zod';
import { isoDateTime } from './common';
import { isEmailAddress } from './email';

// ─────────────────────────────────────────────────────────────────────────────
// Online meetings (Zoom / Google Meet): what an event or a parent–teacher meeting shows, and the school's own provider
// connections (Settings → Online meetings). Each school connects its OWN accounts; secrets are write-only.
// ─────────────────────────────────────────────────────────────────────────────

export const ONLINE_PROVIDERS = ['zoom', 'google'] as const;
export type OnlineProvider = (typeof ONLINE_PROVIDERS)[number];
export const ONLINE_PROVIDER_LABEL: Record<OnlineProvider, string> = { zoom: 'Zoom', google: 'Google Meet' };

/** Stored state of the meeting at the provider (`none` = nothing created yet, e.g. a draft event). */
export const ONLINE_STATUSES = ['none', 'scheduled', 'failed', 'cancelled'] as const;
export type OnlineStatus = (typeof ONLINE_STATUSES)[number];

/** What clients see (`none` is shown as `onlineMeeting: null`). */
export const ONLINE_MEETING_STATUSES = ['scheduled', 'failed', 'cancelled'] as const;
export type OnlineMeetingStatus = (typeof ONLINE_MEETING_STATUSES)[number];

/**
 * The online meeting of an event or a parent–teacher meeting. `null` on the parent object when there is none.
 * `joinUrl` / `passcode` are null while `failed` or `cancelled`. `startUrl` (the host link) and `error` are only present for callers
 * who may edit the event / decide on the meeting.
 */
export const onlineMeetingOut = z.object({
  provider: z.enum(ONLINE_PROVIDERS),
  status: z.enum(ONLINE_MEETING_STATUSES),
  joinUrl: z.string().nullable(),
  passcode: z.string().nullable(),
  startUrl: z.string().nullable().optional(),
  /** plain-language reason when `status` is `failed` (editors only) */
  error: z.string().nullable().optional(),
});
export type OnlineMeetingOut = z.infer<typeof onlineMeetingOut>;

/** Request side: choose the provider for an event (`null` = no online meeting). */
export const onlineMeetingChoice = z.object({ provider: z.enum(ONLINE_PROVIDERS) });
export type OnlineMeetingChoice = z.infer<typeof onlineMeetingChoice>;

// ── school settings ─────────────────────────────────────────────────────────────────────────────

const ident = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${what}`)
    .max(120)
    .regex(/^[\w.\-~]+$/, `The ${what} has letters, numbers, dots, dashes and underscores only`);

/** A mailbox, or Zoom's own `me` (the user the app belongs to). Empty = `me`. */
const zoomHost = z
  .string()
  .trim()
  .max(254)
  .refine((v) => v === '' || v.toLowerCase() === 'me' || isEmailAddress(v), 'Enter the host’s email address, or leave it empty to use “me”');

/** `clientSecret` is write-only: empty = keep the saved one (required the first time). */
export const zoomSettingsBody = z.object({
  accountId: ident('Account ID'),
  clientId: ident('Client ID'),
  clientSecret: z.string().trim().max(200),
  hostEmail: zoomHost,
  enabled: z.boolean().optional(),
});
export type ZoomSettingsBody = z.infer<typeof zoomSettingsBody>;

/** `serviceAccountJson` is write-only: empty = keep the saved key (required the first time). */
export const googleSettingsBody = z.object({
  serviceAccountJson: z.string().max(20_000),
  organizerEmail: z
    .string()
    .trim()
    .max(254)
    .refine(isEmailAddress, 'Enter the Workspace user’s email address, for example office@yourschool.org'),
  enabled: z.boolean().optional(),
});
export type GoogleSettingsBody = z.infer<typeof googleSettingsBody>;

export const meetingProviderParam = z.object({ provider: z.enum(ONLINE_PROVIDERS) });
export const meetingDefaultBody = z.object({ provider: z.enum(ONLINE_PROVIDERS) });

export const MEETING_PROVIDER_STATES = ['not_connected', 'connected', 'error'] as const;
/** One provider as the settings screen sees it. Never contains a secret. */
export const meetingProviderOut = z.object({
  provider: z.enum(ONLINE_PROVIDERS),
  /** credentials are saved */
  connected: z.boolean(),
  /** usable for new meetings (a switched-off provider keeps its credentials) */
  enabled: z.boolean(),
  state: z.enum(MEETING_PROVIDER_STATES),
  isDefault: z.boolean(),
  /** Zoom */
  accountId: z.string().nullable(),
  clientId: z.string().nullable(),
  hostEmail: z.string().nullable(),
  /** the client secret / service-account key is saved (write-only; its value is never returned) */
  secretSet: z.boolean(),
  /** Google */
  organizerEmail: z.string().nullable(),
  serviceAccountEmail: z.string().nullable(),
  /** the numeric Client ID the Workspace admin authorises in the Admin console */
  serviceAccountClientId: z.string().nullable(),
  lastTestAt: isoDateTime.nullable(),
  lastTestOk: z.boolean().nullable(),
  lastTestError: z.string().nullable(),
  /** meetings at this provider that are scheduled and would stay open if it were disconnected */
  liveMeetings: z.number().int(),
  updatedAt: isoDateTime.nullable(),
});
export type MeetingProviderOut = z.infer<typeof meetingProviderOut>;

export const meetingSettingsOut = z.object({
  providers: z.array(meetingProviderOut),
  defaultProvider: z.enum(ONLINE_PROVIDERS).nullable(),
});
export type MeetingSettingsOut = z.infer<typeof meetingSettingsOut>;

export const meetingTestOut = z.object({
  ok: z.boolean(),
  /** plain-language and sanitised: never a raw provider response */
  error: z.string().nullable(),
  /** what was checked, in plain language (no names or ids) */
  detail: z.string().nullable(),
  testedAt: isoDateTime,
});
export type MeetingTestOut = z.infer<typeof meetingTestOut>;

/** Which providers the signed-in person may pick for an event / meeting (connected and switched on), and the school's default. */
export const onlineProvidersOut = z.object({
  providers: z.array(z.enum(ONLINE_PROVIDERS)),
  defaultProvider: z.enum(ONLINE_PROVIDERS).nullable(),
});
export type OnlineProvidersOut = z.infer<typeof onlineProvidersOut>;
