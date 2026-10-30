'use client';

import * as React from 'react';
import { Plug, Unplug } from 'lucide-react';
import { z } from 'zod';
import { zoomSettingsBody, type MeetingProviderOut, type MeetingTestOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { FormCheckbox, FormInput } from '@/components/ui/form';
import { Field, PasswordInput } from '@/components/ui/input';
import { useSaveZoom, useTestProvider } from '@/lib/client/online-meetings';
import { applyApiErrors, hasDirtyFields, useZodForm } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { Code, LastTest, ProviderBadges, SecretField, SetupHelp, Steps, TestResult, type SecretMode } from './provider-bits';

const schema = z.object({
  accountId: zoomSettingsBody.shape.accountId,
  clientId: zoomSettingsBody.shape.clientId,
  clientSecret: z.string().trim().max(200, 'That secret is too long'),
  hostEmail: zoomSettingsBody.shape.hostEmail,
  enabled: z.boolean(),
});
type Values = z.input<typeof schema>;

const valuesOf = (p: MeetingProviderOut): Values => ({ accountId: p.accountId ?? '', clientId: p.clientId ?? '', clientSecret: '', hostEmail: p.hostEmail && p.hostEmail !== 'me' ? p.hostEmail : '', enabled: p.connected ? p.enabled : true });

/** Zoom card: Server-to-Server OAuth credentials of the school's own Zoom account. */
export function ZoomCard({ p, editable, onDirtyChange, onDisconnect }: { p: MeetingProviderOut; editable: boolean; onDirtyChange: (d: boolean) => void; onDisconnect: () => void }) {
  const save = useSaveZoom();
  const test = useTestProvider();
  const form = useZodForm(schema, { defaultValues: valuesOf(p) });
  const [mode, setMode] = React.useState<SecretMode>('keep');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<MeetingTestOut | null>(null);
  const secretId = React.useId();
  const dirty = hasDirtyFields(form.formState) || mode !== 'keep';

  React.useEffect(() => {
    form.reset(valuesOf(p));
    setMode('keep');
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.updatedAt, p.connected]);
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const secretShown = !p.connected || mode === 'replace';
  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    const secret = secretShown ? v.clientSecret : '';
    if (secretShown && !secret) {
      form.setError('clientSecret', { type: 'validate', message: p.connected ? 'Enter the new client secret, or choose “Keep the saved client secret”.' : 'Enter the Client Secret from your Zoom app.' });
      return;
    }
    try {
      await save.mutateAsync({ accountId: v.accountId, clientId: v.clientId, clientSecret: secret, hostEmail: v.hostEmail, enabled: v.enabled });
      setResult(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CLIENT_SECRET_REQUIRED') form.setError('clientSecret', { type: 'server', message: e.message });
      else setFormError(applyApiErrors(form, e));
    }
  });

  const busy = save.isPending;
  return (
    <Card role="region" aria-labelledby="zoom-title">
      <CardHeader
        title={<span id="zoom-title">Zoom</span>}
        description="Meetings are created in your school’s own Zoom account."
        action={<ProviderBadges p={p} />}
      />
      <CardBody className="space-y-5 pt-4">
        <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Zoom settings" id="zoom-form">
          <fieldset disabled={!editable || busy} className="min-w-0 space-y-4 border-0 p-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput control={form.control} name="accountId" label="Account ID" required autoComplete="off" autoCapitalize="none" spellCheck={false} />
              <FormInput control={form.control} name="clientId" label="Client ID" required autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </div>
            <SecretField id={secretId} label="Client secret" saved={p.connected} mode={mode} onMode={setMode} onRemove={onDisconnect} disabled={!editable || busy} hint="It stays on our server, encrypted. You cannot read it back; replace it if it changes.">
              <Field
                label={p.connected ? 'New client secret' : 'Client secret'}
                htmlFor={secretId}
                required
                error={form.formState.errors.clientSecret?.message}
                hint={p.connected ? 'It replaces the saved secret when you save.' : 'Shown once in the Zoom Marketplace app page. It stays on our server, encrypted.'}
              >
                <PasswordInput id={secretId} value={form.watch('clientSecret')} onChange={(e) => form.setValue('clientSecret', e.target.value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })} autoComplete="new-password" spellCheck={false} invalid={!!form.formState.errors.clientSecret} aria-describedby={form.formState.errors.clientSecret ? `${secretId}-error` : undefined} />
              </Field>
            </SecretField>
            <FormInput control={form.control} name="hostEmail" label="Host email" type="email" inputMode="email" autoComplete="off" hint="The Zoom user who owns the meetings. Leave empty to use the person who created the Zoom app." />
            <FormCheckbox control={form.control} name="enabled" label="Use Zoom for new meetings" hint="Switch it off to pause Zoom without losing the saved credentials." />
          </fieldset>
          {formError && <Banner tone="danger">{formError}</Banner>}
        </form>
        <LastTest p={p} />
        {result && <TestResult r={result} />}
        <SetupHelp title="Where do I find these values?">
          <p>You need a Zoom account that can create apps (the account owner or an admin) and a licensed Zoom user to host the meetings.</p>
          <Steps
            items={[
              <>Sign in at <Code>marketplace.zoom.us</Code> and choose <strong>Develop → Build App</strong>.</>,
              <>Pick <strong>Server-to-Server OAuth App</strong> and give it a name such as “SchoolSync”.</>,
              <>On <strong>App Credentials</strong>, copy the <strong>Account ID</strong>, <strong>Client ID</strong> and <strong>Client Secret</strong> into the boxes above.</>,
              <>On <strong>Scopes</strong>, add <Code>meeting:write:admin</Code>, <Code>meeting:read:admin</Code> and <Code>user:read:admin</Code>.</>,
              <>Choose <strong>Activate</strong> on the last page. An app that is not activated is refused.</>,
              <>Type the email of the Zoom user who should host the meetings. Leave it empty to use the person who created the app.</>,
            ]}
          />
          <p>Zoom’s free plan ends group meetings after 40 minutes. A paid licence for the host avoids that.</p>
        </SetupHelp>
      </CardBody>
      <CardFooter className="flex-wrap justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!p.connected || dirty || !editable}
            loading={test.isPending}
            title={!p.connected ? 'Save the credentials first.' : dirty ? 'Save your changes first: the test uses the saved settings.' : undefined}
            onClick={async () => {
              setResult(null);
              try {
                setResult(await test.mutateAsync('zoom'));
              } catch (e) {
                setResult({ ok: false, error: e instanceof ApiError ? e.message : 'The test could not run. Try again.', detail: null, testedAt: new Date().toISOString() });
              }
            }}
          >
            <Plug /> Test connection
          </Button>
          {p.connected && (
            <Button type="button" variant="danger" disabled={!editable || busy} onClick={onDisconnect}>
              <Unplug /> Disconnect
            </Button>
          )}
        </div>
        {editable && (
          <Button type="submit" form="zoom-form" loading={busy} disabled={p.connected && !dirty}>
            {p.connected ? 'Save changes' : 'Connect Zoom'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
