import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { googleSettingsBody, meetingDefaultBody, meetingProviderParam, meetingSettingsOut, meetingTestOut, zoomSettingsBody } from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { requirePerm } from '../../plugins/guards';
import * as svc from './meeting-integrations';

/**
 * Online meetings: the school's own Zoom and Google Workspace connections (Settings → Online meetings). Reading needs
 * settings:view, changing anything needs settings:edit, both at school scope (school administrators). Credentials are write-only:
 * no route returns them and they never reach the audit log.
 */
const routes: FastifyPluginAsyncZod = async (app) => {
  const tag = ['Online meetings'];
  const ctxOf = (req: Parameters<typeof actorOf>[0] & { tenant: svc.MeetingCtx['tenant']; auth: svc.MeetingCtx['principal'] }): svc.MeetingCtx => ({ actor: actorOf(req), principal: req.auth, tenant: req.tenant });
  const view = [requirePerm('settings:view', 'school')];
  const edit = [requirePerm('settings:edit', 'school')];

  app.get('/settings/meetings', { preHandler: view, schema: { tags: tag, summary: 'The school’s Zoom and Google Meet connections and the default provider. Secrets are never returned (`secretSet` only)', response: { 200: meetingSettingsOut } } }, async (req) => svc.getSettings(req.db));

  app.put(
    '/settings/meetings/zoom',
    {
      preHandler: edit,
      schema: {
        tags: tag,
        summary: 'Connect or change Zoom (Server-to-Server OAuth app: Account ID, Client ID, Client Secret, host email). `clientSecret` "" = keep the saved one (required the first time)',
        description: 'Scopes the Zoom app needs: meeting:write:admin, meeting:read:admin, user:read:admin. The secret is encrypted at rest and write-only.',
        body: zoomSettingsBody,
        response: { 200: meetingSettingsOut },
      },
    },
    async (req) => req.db.transaction((tx) => svc.saveZoom(tx, ctxOf(req), req.body)),
  );

  app.put(
    '/settings/meetings/google',
    {
      preHandler: edit,
      schema: {
        tags: tag,
        summary: 'Connect or change Google Meet (Google Workspace service account with domain-wide delegation + the organizer to act for). `serviceAccountJson` "" = keep the saved key (required the first time)',
        description: 'The key file must be of type service_account with client_email and private_key. A personal Gmail account cannot use this. A Workspace admin must authorise the service account’s Client ID for the https://www.googleapis.com/auth/calendar.events scope. The key is encrypted at rest and write-only.',
        body: googleSettingsBody,
        response: { 200: meetingSettingsOut },
      },
    },
    async (req) => req.db.transaction((tx) => svc.saveGoogle(tx, ctxOf(req), req.body)),
  );

  app.delete(
    '/settings/meetings/:provider',
    { preHandler: edit, schema: { tags: tag, summary: 'Disconnect a provider (its credentials are deleted). Meetings already created there stay there', params: meetingProviderParam, response: { 200: meetingSettingsOut } } },
    async (req) => req.db.transaction((tx) => svc.disconnect(tx, ctxOf(req), req.params.provider)),
  );

  app.put(
    '/settings/meetings/default',
    { preHandler: edit, schema: { tags: tag, summary: 'Choose the provider used when a meeting is scheduled without picking one (must be connected and switched on)', body: meetingDefaultBody, response: { 200: meetingSettingsOut } } },
    async (req) => req.db.transaction((tx) => svc.setDefault(tx, ctxOf(req), req.body.provider)),
  );

  app.post(
    '/settings/meetings/:provider/test',
    {
      preHandler: edit,
      schema: {
        tags: tag,
        summary: 'Test the saved connection: sign in and make one harmless read (Zoom: token + the host user; Google: token + a one-event calendar listing). Nothing is created',
        description: 'Answers 200 with { ok, error, detail }: the error is plain language and sanitised. 5 tests per hour per school (429 beyond that), 10 s timeout per provider call.',
        params: meetingProviderParam,
        response: { 200: meetingTestOut },
      },
    },
    async (req) => svc.testProvider(req.db, ctxOf(req), req.params.provider),
  );
};

export default routes;
