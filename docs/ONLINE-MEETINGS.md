# Online meetings: Zoom and Google Meet

SchoolSync can create a Zoom or Google Meet meeting for you when you schedule something that is held online, show its link to the people invited, and cancel it with the event.

* **Calendar events.** Choose *Online meeting → Google Meet / Zoom* on an event. When the event is **published**, the meeting is created for that day and time. A draft creates nothing. If you change the day, time, title or place, or switch the option off or to the other service, the meeting follows. Cancelling or deleting the event cancels the meeting.
* **Parent–teacher meetings.** When a teacher confirms a request as *Online*, the meeting is created with the school's default service (or the one chosen in the dialog) and its link is stored as the meeting's link. Rescheduling updates it; completing or cancelling the meeting removes it.
* **Everyone sees a Join button** (web and, from the same API, the mobile app) while the meeting is ready. The host link ("Start as host") and any problem details are only shown to people who may edit the event or decide on the meeting.
* **Each school connects its own account.** There is no SchoolSync-wide Zoom or Google account, and a school's credentials are never used for another school.

## What the school administrator does

Open **Settings → School profile and settings → Online meetings**. You can connect Zoom, Google Meet or both, choose the default, and use **Test connection** after saving (it signs in and reads one thing; it creates nothing).

### Zoom (Server-to-Server OAuth)

You need a Zoom account that can create apps (the account owner or an admin) and a licensed Zoom user to host the meetings.

1. Sign in at **marketplace.zoom.us** → **Develop → Build App**.
2. Choose **Server-to-Server OAuth App** and name it, for example "SchoolSync".
3. On **App Credentials** copy the **Account ID**, **Client ID** and **Client Secret** into SchoolSync.
4. On **Scopes** add `meeting:write:admin`, `meeting:read:admin` and `user:read:admin`.
5. **Activate** the app (the last step of the wizard). An app that is not activated is refused.
6. Enter the **host email**: the Zoom user who owns the meetings. Leave it empty to use the person who created the app (`me`).

| Field | What it is |
|---|---|
| Account ID, Client ID | Identify your Zoom account and app. Shown again on the screen (they are not secret). |
| Client secret | Proves the app is yours. **Write-only**: after saving it shows "Saved" with *Replace* and *Remove*; it is never shown or returned again. |
| Host email | The Zoom user the meetings belong to. Must be a user of the same Zoom account. |

Zoom's free plan ends group meetings after 40 minutes; a paid licence for the host avoids that. Meetings are created with a waiting room, so the host lets people in; the join link carries the passcode.

### Google Meet (Google Workspace service account)

This is the only way to connect without a sign-in pop-up, and it **needs Google Workspace. A personal Gmail account cannot use it.**

1. In the **Google Cloud console** (console.cloud.google.com) pick or create a project and enable the **Google Calendar API** (APIs & Services → Library).
2. **IAM & Admin → Service Accounts** → create a service account (no roles needed).
3. Open it → **Keys → Add key → Create new key → JSON**. A file downloads. Paste its whole contents into SchoolSync (or choose the file) and save. Keep the original file safe.
4. SchoolSync then shows the service account's numeric **Client ID** with a copy button.
5. A Google Workspace **super admin** opens **admin.google.com → Security → Access and data control → API controls → Manage domain-wide delegation → Add new**, pastes that Client ID and the scope `https://www.googleapis.com/auth/calendar.events`, and chooses **Authorise**. Google can take a few minutes to apply it.
6. Enter the **organizer email**: the Workspace user whose calendar will hold the meetings (for example `office@yourschool.org`). Meetings appear on that calendar; nobody is invited by email.

| Field | What it is |
|---|---|
| Service-account key (JSON) | Lets SchoolSync sign requests as the service account. **Write-only**, kept encrypted; only the service account's email and Client ID are shown back. |
| Organizer email | The Workspace user the service account acts for (`sub` in the delegated sign-in). |

People join with the link; as in any Google Meet, the organizer may have to admit someone who is outside the school's Google organisation.

## What happens when something goes wrong

* **Saving is never blocked.** If Zoom or Google is unreachable, refuses the credentials or is slow, the event is still saved and published, the meeting is still confirmed. The meeting shows **"Needs attention"** with a plain-language reason (for example "Zoom did not accept the saved credentials"), and people who are not editors see only "the link is not ready yet". Reasons are a fixed set of sentences: provider replies, account ids and credentials are never copied into messages, logs or the audit trail.
* **Retry.** Editors get a **Retry** button on the event and the meeting. SchoolSync also retries failed items on its own every few minutes, for up to a day after the first failure; after that, use Retry.
* **Cancellations that fail** (the event is cancelled but Zoom is down) are recorded the same way and finished later. A **deleted** event whose meeting could not be cancelled is remembered and cleaned up by the same background job for a day.
* **Disconnecting** a service deletes its credentials. Meetings already created there stay open, and SchoolSync cannot cancel them until you connect again (the confirmation shows how many there are).
* **Time zone.** Times are the school's time zone (set when the school was created). Zoom and Google receive the local date and time plus the zone name, and the duration in real minutes, so daylight-saving changes are handled by the provider.
* **Google Meet links** are made asynchronously; SchoolSync waits up to about five seconds for the link and otherwise keeps the event it created and finishes the link on the next retry (it does not create a second one).
* **Privacy.** The provider only receives the event title, details and place. For parent–teacher meetings it receives "Parent–teacher meeting with <teacher>" and a generic agenda: never the child's name or the topic the parent wrote.

## For operators

* **Upgrade existing schools:** `pnpm site:migrate` (migration `0002_online_meetings`: table `meeting_integrations`, a clean-up table, and `online_*` columns on `events` and `meetings`). Restart the API afterwards.
* **Environment** (all optional; defaults are the real provider hosts; production refuses anything that is not `https`):

  | Variable | Default |
  |---|---|
  | `ZOOM_OAUTH_BASE` | `https://zoom.us` |
  | `ZOOM_API_BASE` | `https://api.zoom.us/v2` |
  | `GOOGLE_TOKEN_URL` | `https://oauth2.googleapis.com/token` |
  | `GOOGLE_CALENDAR_BASE` | `https://www.googleapis.com/calendar/v3` |

  They exist so tests and local checks can point at stub servers (`apps/api/test/stub-meetings.ts`).
* **Security.** Credentials and host links are sealed with AES-256-GCM under a per-school key (HKDF of `APP_ENCRYPTION_KEY` and the school id, purpose `meeting-secret`), with the row id bound in as additional authenticated data, exactly like the email passwords (docs/SECURITY.md). Rotating `APP_ENCRYPTION_KEY` makes saved credentials unreadable: administrators enter them again, and meanwhile meetings show "did not accept the saved credentials". Provider calls have a 10 s timeout, do not follow redirects, never log bodies or secrets, and the Google key file's own `token_uri` is ignored (the token endpoint comes from configuration). Connection tests are limited to 5 per hour per school (counted from the audit log). Every settings change is audited without credentials (`meeting_integration.*`).
* **Background job** `online-meetings.retry` (every 5 minutes per school): retries failed creations / updates / cancellations younger than a day, creates published events whose meeting was never made, and finishes clean-ups. A per-row lease (`online_lease_until`) keeps two API instances (or a person pressing Retry) from creating two meetings.
* **Known limits.** A request that times out *after* the provider created the meeting can leave an unused meeting at the provider (Zoom has no idempotency key; Google uses a request id). A process crash in the middle of a call can do the same. No attendees are invited and nothing is recorded.

## API (for the mobile app and integrations)

`onlineMeeting` is on every event and meeting item (`GET /events`, `/events/{id}`, `/meetings`, `/meetings/{id}`, `/meetings/upcoming`, the dashboards) and `joinUrl` on calendar items:

```
onlineMeeting: null | { provider: 'zoom' | 'google', status: 'scheduled' | 'failed' | 'cancelled',
                        joinUrl: string | null, passcode: string | null,
                        startUrl?: string | null,   // host link, only for callers who may edit
                        error?: string | null }     // reason when failed, only for callers who may edit
```

Events also carry `onlineProvider` (the choice, kept on a draft). Create / edit an event with `onlineMeeting: { provider } | null`; confirm / reschedule a meeting with `provider: 'zoom' | 'google' | null` (omitted = the school default). Retry: `POST /events/{id}/online-meeting/retry`, `POST /meetings/{id}/online-meeting/retry`. Which services a form may offer: `GET /events/online-providers`. Settings: `GET|PUT|DELETE /settings/meetings…` (see the OpenAPI document).
