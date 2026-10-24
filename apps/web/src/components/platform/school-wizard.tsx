'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2, XCircle } from 'lucide-react';
import { Controller, useWatch, type Control } from 'react-hook-form';
import { z } from 'zod';
import { hexColor, type PlatformTenantCreateBody, type PlatformTenantCreateOut } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { FormActions, FormCheckbox, FormDate, FormInput, FormSection, FormSelect } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Stepper } from '@/components/ui/stepper';
import { DefList } from '@/components/features/management/shared/detail';
import { applyApiErrors, hasDirtyFields, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { money } from '@/lib/format';
import { ApiError } from '@/lib/problem';
import { checkSiteCode, useCreateTenant, usePlatformConfig } from '@/lib/platform/queries';
import { currentAcademicYear, SecretDialog } from './bits';

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter the school’s name').max(120),
    code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{2,30}$/, 'Use 3 to 31 characters: letters, digits and hyphens, starting with a letter'),
    timezone: z.string().min(3, 'Choose a time zone'),
    currency: z.string().length(3, 'Choose a currency'),
    brandColor: hexColor,
    demoData: z.boolean(),
    adminName: z.string().trim().min(2, 'Enter the administrator’s name').max(120),
    adminEmail: z.email('Enter a valid email address'),
    adminUsername: z.string().trim().toLowerCase().max(60).refine((v) => v === '' || v.length >= 3, 'Use at least 3 characters, or leave it empty to sign in with the email'),
    withSubscription: z.boolean(),
    academicYear: z.string(),
    startsOn: z.string(),
    endsOn: z.string(),
    price: z.string(),
    seats: z.string(),
    overagePolicy: z.enum(['allow_and_bill', 'block']),
    graceDays: z.string(),
    trial: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.withSubscription) return;
    const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!/^\d{4}-\d{2}$/.test(v.academicYear)) bad('academicYear', 'Use a year like 2026-27');
    else if (Number(v.academicYear.slice(5)) !== (Number(v.academicYear.slice(0, 4)) + 1) % 100) bad('academicYear', 'The second part must be the next year, for example 2026-27');
    if (!v.startsOn) bad('startsOn', 'Pick the start date');
    if (!v.endsOn) bad('endsOn', 'Pick the end date');
    else if (v.startsOn && v.endsOn <= v.startsOn) bad('endsOn', 'The period must end after it starts');
    const price = num(v.price);
    if (!Number.isFinite(price) || price < 0) bad('price', 'Enter the price per student, for example 150');
    else if (Math.round(price * 100) !== price * 100 && Math.abs(Math.round(price * 100) - price * 100) > 1e-6) bad('price', 'Use at most two decimals');
    if (v.seats.trim() !== '' && !(Number.isInteger(num(v.seats)) && num(v.seats) >= 0)) bad('seats', 'Enter a whole number, or leave empty for no limit');
    const grace = num(v.graceDays);
    if (!Number.isInteger(grace) || grace < 0 || grace > 180) bad('graceDays', 'Enter 0 to 180 days');
  });
type Values = z.infer<typeof schema>;

const STEPS = [
  { id: 'school', label: 'School' },
  { id: 'admin', label: 'First admin' },
  { id: 'subscription', label: 'Subscription' },
];
const STEP_FIELDS: (keyof Values)[][] = [['name', 'code', 'timezone', 'currency', 'brandColor'], ['adminName', 'adminEmail', 'adminUsername'], ['academicYear', 'startsOn', 'endsOn', 'price', 'seats', 'overagePolicy', 'graceDays']];

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'LKR', 'NPR', 'BDT', 'KES', 'NGN', 'ZAR'].map((c) => ({ value: c, label: c }));
const FALLBACK_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Colombo', 'Asia/Kathmandu', 'Asia/Dhaka', 'Europe/London', 'America/New_York', 'Australia/Sydney', 'Africa/Nairobi', 'Africa/Lagos', 'UTC'];
function timezoneOptions() {
  let zones: string[] = FALLBACK_ZONES;
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (all?.length) zones = ['Asia/Kolkata', ...all.filter((z) => z !== 'Asia/Kolkata')];
  } catch {
    /* older browser: the short list */
  }
  return zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }));
}

const slug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 31).replace(/-+$/, '');

type CodeState = { status: 'idle' | 'checking' | 'ok' | 'bad'; message: string | null };

/** Create a school in three steps: the school, its first administrator, and the subscription terms. */
export function SchoolWizard() {
  const router = useRouter();
  const cfg = usePlatformConfig();
  const create = useCreateTenant();
  const year = React.useMemo(() => currentAcademicYear(), []);
  const [step, setStep] = React.useState(0);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<PlatformTenantCreateOut | null>(null);
  const [wantedDemo, setWantedDemo] = React.useState(false);
  const [codeState, setCodeState] = React.useState<CodeState>({ status: 'idle', message: null });
  const codeTouched = React.useRef(false);
  const zones = React.useMemo(() => timezoneOptions(), []);

  const form = useZodForm(schema, {
    defaultValues: { name: '', code: '', timezone: 'Asia/Kolkata', currency: 'INR', brandColor: '#0e5a63', demoData: false, adminName: '', adminEmail: '', adminUsername: '', withSubscription: true, academicYear: year.name, startsOn: year.startsOn, endsOn: year.endsOn, price: '', seats: '', overagePolicy: 'allow_and_bill', graceDays: '30', trial: false },
  });
  const { control, setValue, trigger, handleSubmit, formState } = form;
  const dirty = hasDirtyFields(formState) && !result;
  const guard = useUnsavedGuard(dirty, { title: 'Leave without creating the school?', description: 'The school has not been created yet. If you leave now, what you typed is lost.' });

  const v = useWatch({ control });
  // suggest the site code from the name until the operator edits the code themselves
  React.useEffect(() => {
    if (!codeTouched.current) setValue('code', slug(v.name ?? ''), { shouldValidate: false });
  }, [v.name, setValue]);

  // live "is this code free?" check, debounced
  const code = (v.code ?? '').trim().toLowerCase();
  React.useEffect(() => {
    if (!code) return setCodeState({ status: 'idle', message: null });
    if (!/^[a-z][a-z0-9-]{2,30}$/.test(code)) return setCodeState({ status: 'bad', message: 'Use 3 to 31 characters: letters, digits and hyphens, starting with a letter.' });
    setCodeState({ status: 'checking', message: null });
    const ac = new AbortController();
    const t = setTimeout(() => {
      checkSiteCode(code, ac.signal).then(
        (r) => setCodeState(r.available ? { status: 'ok', message: r.message } : { status: 'bad', message: r.message ?? 'That code cannot be used.' }),
        (e) => {
          if (!(e instanceof DOMException)) setCodeState({ status: 'idle', message: null });
        },
      );
    }, 400);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [code]);

  const next = async () => {
    const ok = await trigger(STEP_FIELDS[step] as never);
    if (!ok) return;
    if (step === 0 && codeState.status !== 'ok') {
      form.setError('code', { type: 'server', message: codeState.status === 'checking' ? 'Still checking this code. Try again in a moment.' : (codeState.message ?? 'Enter the site code') });
      return;
    }
    setStep((s) => Math.min(2, s + 1));
  };

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    const price = Math.round(Number(values.price) * 100);
    const body: PlatformTenantCreateBody = {
      code: values.code,
      name: values.name,
      timezone: values.timezone,
      currency: values.currency,
      brandColor: values.brandColor,
      adminName: values.adminName,
      adminEmail: values.adminEmail,
      ...(values.adminUsername ? { adminUsername: values.adminUsername } : {}),
      ...(values.demoData && cfg.data?.demoDataAllowed ? { demoData: true } : {}),
      ...(values.withSubscription ? { subscription: { academicYear: values.academicYear, startsOn: values.startsOn, endsOn: values.endsOn, pricePerStudentMinor: price, licensedStudents: values.seats.trim() === '' ? null : Number(values.seats), overagePolicy: values.overagePolicy, graceDays: Number(values.graceDays), trial: values.trial } } : {}),
    };
    setWantedDemo(!!body.demoData);
    try {
      setResult(await create.mutateAsync(body));
    } catch (e) {
      const message = applyApiErrors(form, e, { 'subscription.academicYear': 'academicYear', 'subscription.endsOn': 'endsOn' });
      if (e instanceof ApiError) {
        const paths = e.errors.map((x) => x.path);
        if (paths.includes('code') || paths.includes('timezone')) setStep(0);
        else if (paths.includes('adminEmail') || paths.includes('adminName') || paths.includes('adminUsername')) setStep(1);
      }
      setBanner(message ?? 'Please check the highlighted fields.');
    }
  });

  const seatsText = v.seats?.trim() ? `${Number(v.seats).toLocaleString()} seats` : 'unlimited seats';
  const priceNum = Number(v.price);
  const priceOk = Number.isFinite(priceNum) && (v.price ?? '').trim() !== '';

  return (
    <>
      <PageHeader title="Create a school" description="A new school gets its own database, default roles and settings, and a first administrator. You can change everything later except the site code." crumbs={[{ label: 'Schools', href: '/platform/schools' }, { label: 'Create school' }]} />
      <Card className="mx-auto max-w-[760px]">
        <CardBody className="space-y-6">
          <Stepper steps={STEPS} current={step} />
          <form onSubmit={onSubmit} noValidate className="space-y-6" aria-label={`Step ${step + 1} of 3: ${STEPS[step]!.label}`}>
            {step === 0 && (
              <FormSection title="The school" description="How the school is named and where it lives on SchoolSync.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormInput control={control} name="name" label="School name" required autoComplete="off" className="sm:col-span-2" />
                  <div className="sm:col-span-2">
                    <FormInput
                      control={control}
                      name="code"
                      label="Site code"
                      required
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      hint="Letters, digits and hyphens. It becomes the school’s address, and people type it once in the mobile app. It cannot be changed later."
                      onInput={() => {
                        codeTouched.current = true;
                      }}
                    />
                    <p className="t-caption mt-1.5 flex items-center gap-1.5" role="status" aria-live="polite">
                      {codeState.status === 'checking' && (<><Loader2 className="size-3.5 animate-spin text-ink-3" aria-hidden /> <span className="text-ink-2">Checking…</span></>)}
                      {codeState.status === 'ok' && (<><Check className="size-3.5 text-success" aria-hidden /> <span className="text-success">{codeState.message ?? 'This code is free.'}</span></>)}
                      {codeState.status === 'bad' && (<><XCircle className="size-3.5 text-danger" aria-hidden /> <span className="text-danger">{codeState.message}</span></>)}
                    </p>
                  </div>
                  <FormSelect control={control} name="timezone" label="Time zone" options={zones} required />
                  <FormSelect control={control} name="currency" label="Currency" options={CURRENCIES} hint="Fees and our invoices to this school use it." required />
                  <BrandColorField control={control} />
                </div>
                {cfg.data?.demoDataAllowed && <FormCheckbox control={control} name="demoData" label="Load demo data (students, teachers, attendance, fees)" hint="Development servers only. Demo accounts use a well-known password, so never use this for a real school." />}
              </FormSection>
            )}

            {step === 1 && (
              <FormSection title="First administrator" description="The person who sets the school up. We generate a temporary password and show it once at the end; they must change it at first sign-in.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormInput control={control} name="adminName" label="Full name" required autoComplete="off" />
                  <FormInput control={control} name="adminEmail" label="Email" type="email" required autoComplete="off" />
                  <FormInput control={control} name="adminUsername" label="Username" autoComplete="off" autoCapitalize="none" spellCheck={false} hint="Optional. Empty means they sign in with their email." className="sm:col-span-2" />
                </div>
              </FormSection>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <FormSection title="Subscription" description="Priced per student for one academic year. You can also leave this for later and set it from the school’s page.">
                  <FormCheckbox control={control} name="withSubscription" label="Set up the subscription now" />
                  {v.withSubscription && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormInput control={control} name="academicYear" label="Academic year" required placeholder="2026-27" />
                      <FormInput control={control} name="price" label={`Price per student (${v.currency ?? 'INR'})`} required inputMode="decimal" placeholder="150" hint="Major units, for example 150 or 149.50." />
                      <FormDate control={control} name="startsOn" label="Starts" required />
                      <FormDate control={control} name="endsOn" label="Ends" required />
                      <FormInput control={control} name="seats" label="Committed seats" inputMode="numeric" placeholder="500" hint="Leave empty for no limit." />
                      <FormSelect control={control} name="overagePolicy" label="When seats run out" options={[{ value: 'allow_and_bill', label: 'Keep admitting and bill the extra' }, { value: 'block', label: 'Block new students' }]} />
                      <FormInput control={control} name="graceDays" label="Grace days after the period" inputMode="numeric" hint="Full access continues, then the school becomes read-only." />
                      <FormCheckbox control={control} name="trial" label="This is a trial" className="self-end pb-2" />
                    </div>
                  )}
                </FormSection>
                <section aria-label="Summary" className="rounded-lg border border-border bg-surface-subtle p-4">
                  <h3 className="t-label">Summary</h3>
                  <DefList
                    className="mt-3"
                    items={[
                      { label: 'School', value: v.name ? `${v.name} (${v.code || '…'})` : null },
                      { label: 'First admin', value: v.adminName ? `${v.adminName} · ${v.adminEmail}` : null },
                      { label: 'Time zone and currency', value: `${v.timezone} · ${v.currency}` },
                      { label: 'Subscription', value: v.withSubscription ? `${v.academicYear}: ${seatsText}${priceOk ? ` at ${money(Math.round(priceNum * 100), v.currency)} per student` : ''}${v.trial ? ' (trial)' : ''}` : 'Not set up yet' },
                      { label: 'Committed value', value: v.withSubscription && priceOk && v.seats?.trim() ? money(Math.round(priceNum * 100) * Number(v.seats), v.currency) : null },
                    ]}
                  />
                </section>
              </div>
            )}

            {banner && <Banner tone="danger" role="alert">{banner}</Banner>}
            <FormActions className="-mx-5 -mb-5 rounded-b-lg px-5 max-sm:-mx-4 max-sm:-mb-4">
              {step === 0 ? (
                <Button asChild variant="ghost"><Link href="/platform/schools">Cancel</Link></Button>
              ) : (
                <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>Back</Button>
              )}
              {step < 2 ? (
                <Button type="button" onClick={() => void next()}>Continue</Button>
              ) : (
                <Button type="submit" loading={formState.isSubmitting}>Create school</Button>
              )}
            </FormActions>
          </form>
        </CardBody>
      </Card>
      {guard.dialog}

      {result && (
        <SecretDialog
          open
          onOpenChange={(o) => {
            if (!o) router.push(`/platform/schools/${result.code}`);
          }}
          title={`${result.name} is ready`}
          description="Give the administrator these details. They sign in at the school’s own address and must choose a new password."
          secrets={[{ label: 'School administrator', username: result.admin.username, password: result.admin.password }]}
        >
          {wantedDemo && !result.demoDataLoaded && <Banner tone="warning" title="Demo data was not loaded">The school was created, but loading the demo data failed. See the audit log.</Banner>}
          <p className="t-caption text-ink-2">Site code <span className="font-mono">{result.code}</span>{result.subscription ? ` · subscription ${result.subscription.academicYear} saved` : ' · no subscription yet'}</p>
        </SecretDialog>
      )}
    </>
  );
}

/** Hex field with a colour swatch picker; the app normalises the school's real brand colour, so this stores what was chosen. */
function BrandColorField({ control }: { control: Control<Values> }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name="brandColor"
      render={({ field, fieldState }) => (
        <Field label="Brand colour" htmlFor={id} hint="The school’s main colour. The apps tone it so every choice looks calm." error={fieldState.error?.message} required>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick a colour"
              value={/^#[0-9a-f]{6}$/i.test(field.value) ? field.value : '#0e5a63'}
              onChange={(e) => field.onChange(e.target.value)}
              className="h-11 w-11 shrink-0 cursor-pointer rounded-md border border-border-strong bg-surface p-1 sm:h-9 sm:w-9"
            />
            <Input id={id} value={field.value} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} invalid={!!fieldState.error} autoComplete="off" spellCheck={false} className="font-mono" />
          </div>
        </Field>
      )}
    />
  );
}
