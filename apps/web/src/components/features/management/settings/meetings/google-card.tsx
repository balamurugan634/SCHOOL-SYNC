'use client';

import * as React from 'react';
import { FileUp, Plug, Unplug } from 'lucide-react';
import { z } from 'zod';
import { googleSettingsBody, type MeetingProviderOut, type MeetingTestOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { FormCheckbox, FormInput } from '@/components/ui/form';
import { Field, Textarea } from '@/components/ui/input';
import { useSaveGoogle, useTestProvider } from '@/lib/client/online-meetings';
import { applyApiErrors, hasDirtyFields, useZodForm } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { Code, CopyValue, LastTest, ProviderBadges, SecretField, SetupHelp, Steps, TestResult, type SecretMode } from './provider-bits';

const schema = z.object({
  serviceAccountJson: z.string().max(20_000, 'That file is too large to be a key file'),
  organizerEmail: googleSettingsBody.shape.organizerEmail,
  enabled: z.boolean(),
});
type Values = z.input<typeof schema>;

const valuesOf = (p: MeetingProviderOut): Values => ({ serviceAccountJson: '', organizerEmail: p.organizerEmail ?? '', enabled: p.connected ? p.enabled : true });

/** A light look at the pasted text, so an obvious mistake is caught before the server is asked. The API checks it properly. */
function looksLikeKey(text: string): string | null {
  try {
    const j = JSON.parse(text) as { type?: unknown; client_email?: unknown; private_key?: unknown };
    if (j.type !== 'service_account') return 'This is not a service-account key. In Google Cloud choose “Add key → Create new key → JSON” on a service account.';
    if (typeof j.client_email !== 'string' || typeof j.private_key !== 'string') return 'The key file is missing its client_email or private_key. Download a fresh JSON key.';
    return null;
  } catch {
    return 'That is not valid JSON. Paste the whole contents of the key file you downloaded from Google Cloud.';
  }
}

/** Google Meet card: a Google Workspace service account with domain-wide delegation, acting for one organizer. */
export function GoogleCard({ p, editable, onDirtyChange, onDisconnect }: { p: MeetingProviderOut; editable: boolean; onDirtyChange: (d: boolean) => void; onDisconnect: () => void }) {
  const save = useSaveGoogle();
  const test = useTestProvider();
  const form = useZodForm(schema, { defaultValues: valuesOf(p) });
  const [mode, setMode] = React.useState<SecretMode>('keep');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<MeetingTestOut | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const keyId = React.useId();
  const dirty = hasDirtyFields(form.formState) || mode !== 'keep';

  React.useEffect(() => {
    form.reset(valuesOf(p));
    setMode('keep');
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.updatedAt, p.connected]);
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const keyShown = !p.connected || mode === 'replace';
  const keyError = form.formState.errors.serviceAccountJson?.message;
  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    const json = keyShown ? v.serviceAccountJson.trim() : '';
    if (keyShown) {
      const problem = json ? looksLikeKey(json) : p.connected ? 'Paste the new key file, or choose “Keep the saved key”.' : 'Paste the service-account key file (JSON) from Google Cloud.';
      if (problem) {
        form.setError('serviceAccountJson', { type: 'validate', message: problem });
        return;
      }
    }
    try {
      await save.mutateAsync({ serviceAccountJson: json, organizerEmail: v.organizerEmail, enabled: v.enabled });
      setResult(null);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'SERVICE_ACCOUNT_INVALID' || e.code === 'SERVICE_ACCOUNT_REQUIRED')) form.setError('serviceAccountJson', { type: 'server', message: e.message });
      else setFormError(applyApiErrors(form, e));
    }
  });

  const busy = save.isPending;
  return (
    <Card role="region" aria-labelledby="google-title">
      <CardHeader title={<span id="google-title">Google Meet</span>} description="Meetings are created in a Google Workspace calendar of your school’s own." action={<ProviderBadges p={p} />} />
      <CardBody className="space-y-5 pt-4">
        <Banner tone="info" title="Needs Google Workspace">
          A personal Gmail account cannot be used here. Your school needs Google Workspace, and a Workspace admin has to allow the connection once (see the steps below).
        </Banner>
        <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Google Meet settings" id="google-form">
          <fieldset disabled={!editable || busy} className="min-w-0 space-y-4 border-0 p-0">
            <SecretField id={keyId} label="Service-account key" saved={p.connected} mode={mode} onMode={setMode} onRemove={onDisconnect} disabled={!editable || busy} hint="The key file stays on our server, encrypted. You cannot read it back; paste a new one to replace it.">
              <Field
                label={p.connected ? 'New service-account key' : 'Service-account key'}
                htmlFor={keyId}
                required
                error={keyError}
                hint="Paste the whole contents of the JSON key file from Google Cloud, or choose the file."
                action={
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      tabIndex={-1}
                      aria-label="Choose the key file"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        if (f.size > 20_000) {
                          form.setError('serviceAccountJson', { type: 'validate', message: 'That file is too large to be a key file.' });
                          return;
                        }
                        form.setValue('serviceAccountJson', await f.text(), { shouldDirty: true, shouldValidate: true });
                      }}
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                      <FileUp /> Choose file
                    </Button>
                  </>
                }
              >
                <Textarea
                  id={keyId}
                  rows={5}
                  value={form.watch('serviceAccountJson')}
                  onChange={(e) => form.setValue('serviceAccountJson', e.target.value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })}
                  placeholder={'{\n  "type": "service_account",\n  …\n}'}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono text-[12px]"
                  invalid={!!keyError}
                  aria-describedby={keyError ? `${keyId}-error` : undefined}
                />
              </Field>
            </SecretField>
            {p.connected && p.serviceAccountEmail && (
              <div className="space-y-1.5">
                <p className="t-label">Saved service account</p>
                <CopyValue label="service account email" value={p.serviceAccountEmail} />
                {p.serviceAccountClientId && (
                  <>
                    <p className="t-caption pt-1 text-ink-2">Client ID to authorise in the Google Admin console:</p>
                    <CopyValue label="Client ID" value={p.serviceAccountClientId} />
                  </>
                )}
              </div>
            )}
            <FormInput control={form.control} name="organizerEmail" label="Organizer email" type="email" inputMode="email" required autoComplete="off" hint="The Workspace user whose calendar holds the meetings, for example office@yourschool.org. Meetings appear on their calendar." />
            <FormCheckbox control={form.control} name="enabled" label="Use Google Meet for new meetings" hint="Switch it off to pause Google Meet without losing the saved key." />
          </fieldset>
          {formError && <Banner tone="danger">{formError}</Banner>}
        </form>
        <LastTest p={p} />
        {result && <TestResult r={result} />}
        <SetupHelp title="Where do I find these values?">
          <Steps
            items={[
              <>In the <strong>Google Cloud console</strong> (<Code>console.cloud.google.com</Code>), pick or create a project and turn on the <strong>Google Calendar API</strong> (APIs &amp; Services → Library).</>,
              <>Under <strong>IAM &amp; Admin → Service Accounts</strong>, create a service account (any name, for example “SchoolSync meetings”). It needs no roles.</>,
              <>Open the service account → <strong>Keys → Add key → Create new key → JSON</strong>. A file downloads: paste its contents above (or choose the file). Keep the original safe.</>,
              <>Save here first. The <strong>Client ID</strong> of the service account then shows above with a copy button.</>,
              <>A Google Workspace <strong>super admin</strong> opens <Code>admin.google.com</Code> → <strong>Security → Access and data control → API controls → Manage domain-wide delegation → Add new</strong>, pastes that Client ID and the scope <Code>https://www.googleapis.com/auth/calendar.events</Code>, and chooses <strong>Authorise</strong>.</>,
              <>Type the <strong>organizer email</strong>: the Workspace user who will own the meetings. Then use <strong>Test connection</strong>.</>,
            ]}
          />
          <p>Google can take a few minutes to apply step 5. If the test says Google refused the request, wait a little and test again. Anyone with the link can ask to join; the organizer lets them in.</p>
        </SetupHelp>
      </CardBody>
      <CardFooter className="flex-wrap justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!p.connected || dirty || !editable}
            loading={test.isPending}
            title={!p.connected ? 'Save the key first.' : dirty ? 'Save your changes first: the test uses the saved settings.' : undefined}
            onClick={async () => {
              setResult(null);
              try {
                setResult(await test.mutateAsync('google'));
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
          <Button type="submit" form="google-form" loading={busy} disabled={p.connected && !dirty}>
            {p.connected ? 'Save changes' : 'Connect Google Meet'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
