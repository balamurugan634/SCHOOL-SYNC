'use client';

import * as React from 'react';
import { AlertCircle, Lock, Send } from 'lucide-react';
import { z } from 'zod';
import { EMAIL_PROVIDERS, EMAIL_PROVIDER_PRESETS, EMAIL_SECURITY, emailAccountCreateBody, emailAddress, type EmailAccountCreateBody, type EmailAccountOut, type EmailAccountUpdateBody, type EmailProvider } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, SheetFooter } from '@/components/ui/dialog';
import { FormCheckbox, FormInput, FormSection } from '@/components/ui/form';
import { Field, PasswordInput } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useCreateEmailAccount, useUpdateEmailAccount } from '@/lib/client/email';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { applyApiErrors, hasDirtyFields, useZodForm } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { useAccess } from '../../shared/access';
import { SECURITY_LABEL } from './email-bits';

/** An empty input means "not given" (the shared schemas validate a present value). */
const blank = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), s.optional());

const schema = z
  .object({
    provider: z.enum(EMAIL_PROVIDERS),
    name: emailAccountCreateBody.shape.name,
    emailAddress: emailAccountCreateBody.shape.emailAddress,
    senderName: z.string().trim().max(100, 'Keep the sender name under 100 characters').refine((v) => !/[\r\n]/.test(v), 'Remove line breaks'),
    replyTo: blank(emailAddress),
    smtpHost: emailAccountCreateBody.shape.smtpHost,
    smtpPort: z.coerce.number({ message: 'Enter a port number, for example 587' }).int('Enter a whole number').min(1, 'Enter a port number, for example 587').max(65535, 'Ports go up to 65535'),
    smtpSecurity: z.enum(EMAIL_SECURITY),
    smtpUsername: z.string().trim().max(254),
    smtpPassword: z.string().max(512, 'That password is too long'),
    dailyLimit: blank(z.coerce.number({ message: 'Enter a number, or leave it empty' }).int('Enter a whole number').min(1, 'Use 1 or more, or leave it empty').max(1_000_000)),
    enabled: z.boolean(),
    alwaysUseAccountAddress: z.boolean(),
    isDefaultOutgoing: z.boolean(),
    allowInsecure: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.smtpSecurity === 'none' && !v.allowInsecure) ctx.addIssue({ code: 'custom', path: ['allowInsecure'], message: 'Tick this box to confirm, or choose STARTTLS or SSL/TLS.' });
  });
type Values = z.input<typeof schema>;

type PwMode = 'keep' | 'replace' | 'clear';

const blankValues = (hasDefault: boolean): Values => ({
  provider: 'gmail',
  name: '',
  emailAddress: '',
  senderName: '',
  replyTo: '',
  smtpHost: EMAIL_PROVIDER_PRESETS.gmail.host,
  smtpPort: EMAIL_PROVIDER_PRESETS.gmail.port,
  smtpSecurity: EMAIL_PROVIDER_PRESETS.gmail.security,
  smtpUsername: '',
  smtpPassword: '',
  dailyLimit: '',
  enabled: true,
  alwaysUseAccountAddress: true,
  isDefaultOutgoing: !hasDefault,
  allowInsecure: false,
});

const valuesOf = (a: EmailAccountOut): Values => ({
  provider: a.provider,
  name: a.name,
  emailAddress: a.emailAddress,
  senderName: a.senderName,
  replyTo: a.replyTo ?? '',
  smtpHost: a.smtpHost,
  smtpPort: a.smtpPort,
  smtpSecurity: a.smtpSecurity,
  smtpUsername: a.smtpUsername,
  smtpPassword: '',
  dailyLimit: a.dailyLimit ?? '',
  enabled: a.enabled,
  alwaysUseAccountAddress: a.alwaysUseAccountAddress,
  isDefaultOutgoing: a.isDefaultOutgoing,
  allowInsecure: a.smtpSecurity === 'none',
});

/** The server's refusals, attached to the field they are about. */
const CODE_FIELD: Record<string, keyof Values> = {
  SMTP_PORT_NOT_ALLOWED: 'smtpPort',
  SMTP_HOST_BLOCKED: 'smtpHost',
  INSECURE_NOT_ACKNOWLEDGED: 'allowInsecure',
  PASSWORD_REQUIRED: 'smtpPassword',
  EMAIL_ACCOUNT_NAME_TAKEN: 'name',
};

const PROVIDER_OPTIONS = EMAIL_PROVIDERS.map((p) => ({ value: p, label: EMAIL_PROVIDER_PRESETS[p].label }));
const SECURITY_OPTIONS = [
  { value: 'starttls', label: 'STARTTLS (recommended, usually port 587)' },
  { value: 'ssl', label: 'SSL/TLS (usually port 465)' },
  { value: 'none', label: SECURITY_LABEL.none },
];

/** The password is write-only: a saved one shows as "Saved" with Replace / Remove, and its value never comes back from the server. */
function PasswordControl({ id, saved, mode, onMode, value, onChange, error, disabled }: { id: string; saved: boolean; mode: PwMode; onMode: (m: PwMode) => void; value: string; onChange: (v: string) => void; error?: string; disabled?: boolean }) {
  const label = 'Password or app password';
  if (saved && mode === 'keep') {
    return (
      <Field label={label} htmlFor={`${id}-saved`} hint="For Gmail, Microsoft 365 and Zoho this is an app password, not your normal password.">
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2" id={`${id}-saved`} role="group" aria-label="Saved password">
          <Badge variant="success" icon={<Lock aria-hidden />}>Saved</Badge>
          <span className="t-caption mr-auto text-ink-2">Hidden for your security</span>
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onMode('replace')}>Replace</Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onMode('clear')}>Remove</Button>
        </div>
      </Field>
    );
  }
  if (saved && mode === 'clear') {
    return (
      <Field label={label} htmlFor={`${id}-cleared`}>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2" id={`${id}-cleared`}>
          <span className="t-caption mr-auto text-ink-2">The saved password will be removed when you save.</span>
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onMode('keep')}>Keep it</Button>
        </div>
      </Field>
    );
  }
  return (
    <Field label={saved ? 'New password' : label} htmlFor={id} error={error} hint={saved ? 'It replaces the saved password when you save.' : 'For Gmail, Microsoft 365 and Zoho this is an app password, not your normal password.'} action={saved ? <Button type="button" size="sm" variant="ghost" onClick={() => { onChange(''); onMode('keep'); }}>Keep saved password</Button> : undefined}>
      <PasswordInput id={id} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" spellCheck={false} disabled={disabled} invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
    </Field>
  );
}

/** Add (account = null) or edit one email account. Saved with PATCH sending only what changed; a password is only sent when you replace or remove it. */
export function AccountDrawer({ open, account, hasDefault, onClose, onSaved, onTest }: { open: boolean; account: EmailAccountOut | null; hasDefault: boolean; onClose: () => void; onSaved: (a: EmailAccountOut, created: boolean) => void; onTest: (a: EmailAccountOut) => void }) {
  const access = useAccess();
  const editable = access.ok('settings:edit', 'school');
  const create = useCreateEmailAccount();
  const update = useUpdateEmailAccount(account?.id ?? '');
  const form = useZodForm(schema, { defaultValues: blankValues(hasDefault) });
  const [pwMode, setPwMode] = React.useState<PwMode>('keep');
  const [formError, setFormError] = React.useState<string | null>(null);
  const pwId = React.useId();
  const saved = !!account?.passwordSet;
  const dirty = hasDirtyFields(form.formState) || pwMode !== 'keep';
  const { guard, dialog } = useUnsavedGuard(open && dirty);

  React.useEffect(() => {
    if (open) {
      form.reset(account ? valuesOf(account) : blankValues(hasDefault));
      setPwMode('keep');
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);

  const provider = form.watch('provider');
  const security = form.watch('smtpSecurity');
  const preset = EMAIL_PROVIDER_PRESETS[provider as EmailProvider];

  const pickProvider = (p: string) => {
    const next = p as EmailProvider;
    form.setValue('provider', next, { shouldDirty: true });
    if (next !== 'custom') {
      const pr = EMAIL_PROVIDER_PRESETS[next];
      form.setValue('smtpHost', pr.host, { shouldDirty: true, shouldValidate: true });
      form.setValue('smtpPort', pr.port, { shouldDirty: true, shouldValidate: true });
      form.setValue('smtpSecurity', pr.security, { shouldDirty: true });
    }
  };

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    const password = pwMode === 'replace' || !saved ? v.smtpPassword : '';
    if (v.smtpUsername && !saved && !password) {
      form.setError('smtpPassword', { type: 'validate', message: 'Enter the password for this username.' });
      return;
    }
    if (v.smtpUsername && saved && pwMode === 'replace' && !password) {
      form.setError('smtpPassword', { type: 'validate', message: 'Enter the new password, or choose “Keep saved password”.' });
      return;
    }
    try {
      if (!account) {
        const body: EmailAccountCreateBody = {
          name: v.name,
          emailAddress: v.emailAddress,
          senderName: v.senderName,
          provider: v.provider,
          smtpHost: v.smtpHost,
          smtpPort: v.smtpPort,
          smtpSecurity: v.smtpSecurity,
          smtpUsername: v.smtpUsername,
          ...(password ? { smtpPassword: password } : {}),
          replyTo: v.replyTo ?? null,
          isDefaultOutgoing: v.isDefaultOutgoing,
          enabled: v.enabled,
          alwaysUseAccountAddress: v.alwaysUseAccountAddress,
          dailyLimit: v.dailyLimit ?? null,
          ...(v.smtpSecurity === 'none' ? { allowInsecure: true } : {}),
        };
        const out = await create.mutateAsync(body);
        onSaved(out, true);
      } else {
        const body: EmailAccountUpdateBody = {};
        if (v.name !== account.name) body.name = v.name;
        if (v.emailAddress !== account.emailAddress) body.emailAddress = v.emailAddress;
        if (v.senderName !== account.senderName) body.senderName = v.senderName;
        if (v.provider !== account.provider) body.provider = v.provider;
        if (v.smtpHost !== account.smtpHost) body.smtpHost = v.smtpHost;
        if (v.smtpPort !== account.smtpPort) body.smtpPort = v.smtpPort;
        if (v.smtpSecurity !== account.smtpSecurity) body.smtpSecurity = v.smtpSecurity;
        if (v.smtpUsername !== account.smtpUsername) body.smtpUsername = v.smtpUsername;
        if (pwMode === 'replace') body.smtpPassword = password;
        if (pwMode === 'clear') body.smtpPassword = '';
        if ((v.replyTo ?? null) !== account.replyTo) body.replyTo = v.replyTo ?? null;
        if (v.enabled !== account.enabled) body.enabled = v.enabled;
        if (v.alwaysUseAccountAddress !== account.alwaysUseAccountAddress) body.alwaysUseAccountAddress = v.alwaysUseAccountAddress;
        if ((v.dailyLimit ?? null) !== account.dailyLimit) body.dailyLimit = v.dailyLimit ?? null;
        if (v.smtpSecurity === 'none' && account.smtpSecurity !== 'none') body.allowInsecure = true;
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        const out = await update.mutateAsync(body);
        onSaved(out, false);
      }
    } catch (e) {
      const field = e instanceof ApiError ? CODE_FIELD[e.code] : undefined;
      if (field && e instanceof ApiError) {
        form.setError(field, { type: 'server', message: e.message });
        return;
      }
      setFormError(applyApiErrors(form, e));
    }
  });

  const busy = create.isPending || update.isPending;
  const title = account ? `Edit ${account.name}` : 'Add an email account';
  return (
    <>
      {dialog}
      <Drawer open={open} onOpenChange={(o) => (o ? undefined : guard(onClose))}>
        <DrawerContent
          title={title}
          description={account ? 'Changes apply to mail sent from now on. Mail already waiting in the queue uses the new settings too.' : 'Send the school’s email from your own mail account, so replies and sender names look like yours.'}
          showTitle
          onInteractOutside={(e) => {
            if (dirty) {
              e.preventDefault();
              guard(onClose);
            }
          }}
        >
          <form onSubmit={onSubmit} noValidate className="flex min-h-full flex-col" aria-label={title}>
            <div className="flex-1 space-y-6 px-5 py-4">
              {!editable && <Banner tone={access.readOnly ? 'locked' : 'info'}>{access.hint('settings:edit', 'school') ?? 'You can view these settings but not change them.'}</Banner>}
              <fieldset disabled={!editable || busy} className="min-w-0 space-y-6 border-0 p-0">
                <FormSection title="Mail provider" description="Choosing a provider fills in the server details below. You can still change them.">
                  <Field label="Provider" htmlFor="ea-provider" hint={preset.hint}>
                    <Select id="ea-provider" value={provider} onValueChange={pickProvider} options={PROVIDER_OPTIONS} />
                  </Field>
                </FormSection>

                <FormSection title="Sender">
                  <FormInput control={form.control} name="name" label="Account name" required hint="A label only you see, for example Office mailbox." autoComplete="off" />
                  <FormInput control={form.control} name="emailAddress" label="From address" type="email" inputMode="email" required hint="The address the school’s email is sent from." autoComplete="off" />
                  <FormInput control={form.control} name="senderName" label="Sender name" hint="What recipients see before the address, for example Green Valley School." autoComplete="off" />
                  <FormInput control={form.control} name="replyTo" label="Reply-to address" type="email" inputMode="email" hint="Optional. Replies go here instead of the From address." autoComplete="off" />
                </FormSection>

                <FormSection title="Mail server (SMTP)">
                  <FormInput control={form.control} name="smtpHost" label="Server name" required placeholder="smtp.example.com" hint="Just the name, without https:// or a port." autoComplete="off" autoCapitalize="none" spellCheck={false} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormInput control={form.control} name="smtpPort" label="Port" type="number" inputMode="numeric" required hint="587 for STARTTLS, 465 for SSL/TLS." min={1} max={65535} />
                    <Field label="Security" htmlFor="ea-security" required>
                      <Select id="ea-security" value={security} onValueChange={(v) => form.setValue('smtpSecurity', v as (typeof EMAIL_SECURITY)[number], { shouldDirty: true, shouldValidate: true })} options={SECURITY_OPTIONS} />
                    </Field>
                  </div>
                  {security === 'none' && (
                    <div className="space-y-3">
                      <Banner tone="warning" title="This connection is not encrypted">
                        The password and every email travel across the internet as plain text, where others can read them. Only use this for a trusted server on a private route, and never for Gmail, Microsoft 365 or Zoho.
                      </Banner>
                      <FormCheckbox control={form.control} name="allowInsecure" label="I understand the risk and want an unencrypted connection" />
                      {form.formState.errors.allowInsecure?.message && (
                        <p role="alert" className="t-caption flex items-start gap-1.5 text-danger">
                          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                          {form.formState.errors.allowInsecure.message}
                        </p>
                      )}
                    </div>
                  )}
                  <FormInput control={form.control} name="smtpUsername" label="Username" hint="Usually the full email address. SendGrid uses the word apikey." autoComplete="off" autoCapitalize="none" spellCheck={false} />
                  <PasswordControl id={pwId} saved={saved} mode={pwMode} onMode={setPwMode} value={form.watch('smtpPassword')} onChange={(v) => form.setValue('smtpPassword', v, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })} error={form.formState.errors.smtpPassword?.message} disabled={!editable || busy} />
                </FormSection>

                <FormSection title="Options">
                  <FormInput control={form.control} name="dailyLimit" label="Daily limit" type="number" inputMode="numeric" min={1} hint="Optional. The most emails this account sends in a day; the rest wait for tomorrow. Gmail allows about 500 a day." className="max-w-xs" />
                  <FormCheckbox control={form.control} name="alwaysUseAccountAddress" label="Always send from this account’s address" hint="Recommended. Mail providers reject or mark as spam mail that claims a different sender." />
                  <FormCheckbox control={form.control} name="enabled" label="Account is switched on" hint="A switched-off account is never used." />
                  {!account && <FormCheckbox control={form.control} name="isDefaultOutgoing" label="Use as the default account for outgoing email" hint={hasDefault ? 'Replaces the current default account.' : 'Until you pick a default, the SchoolSync default sender is used.'} />}
                </FormSection>
              </fieldset>
              {formError && <Banner tone="danger">{formError}</Banner>}
            </div>
            <SheetFooter className="mt-auto">
              {account && (
                <Button type="button" variant="secondary" className="mr-auto" onClick={() => onTest(account)} disabled={dirty} title={dirty ? 'Save your changes first: the test uses the saved settings.' : undefined}>
                  <Send /> Send test email
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={() => guard(onClose)}>
                {editable ? 'Cancel' : 'Close'}
              </Button>
              {editable && (
                <Button type="submit" loading={busy} disabled={!dirty && !!account}>
                  {account ? 'Save changes' : 'Save account'}
                </Button>
              )}
            </SheetFooter>
          </form>
        </DrawerContent>
      </Drawer>
    </>
  );
}
