'use client';

import * as React from 'react';
import { Send } from 'lucide-react';
import { emailAddress, type EmailTestOut } from '@school-sync/shared';
import { useMe } from '@/components/me-context';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { useSendTestEmail } from '@/lib/client/email';
import { ApiError, errorMessage } from '@/lib/problem';

export interface TestTarget {
  /** null = the SchoolSync default sender */
  id: string | null;
  name: string;
}

/**
 * "Send test email": sends right now through the saved settings of one account and shows the plain-language result in place.
 * The platform sender only ever writes to the signed-in admin's own address.
 */
export function TestEmailDialog({ target, onClose }: { target: TestTarget | null; onClose: () => void }) {
  const me = useMe();
  const test = useSendTestEmail();
  const fieldId = React.useId();
  const [to, setTo] = React.useState('');
  const [result, setResult] = React.useState<EmailTestOut | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [invalid, setInvalid] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (target) {
      setTo(me.email ?? '');
      setResult(null);
      setProblem(null);
      setInvalid(null);
      test.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, target?.name]);

  const own = target?.id === null;
  const send = async () => {
    setResult(null);
    setProblem(null);
    const typed = to.trim();
    if (!own && typed) {
      const parsed = emailAddress.safeParse(typed);
      if (!parsed.success) {
        setInvalid(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
        return;
      }
    }
    setInvalid(null);
    try {
      setResult(await test.mutateAsync({ accountId: target?.id ?? null, to: own || !typed ? undefined : typed }));
    } catch (e) {
      // the generic wording for a 429 says "wait a moment"; this limit is hourly, and the server says exactly that
      setProblem(e instanceof ApiError && e.code === 'RATE_LIMITED' ? (e.detail ?? e.message) : errorMessage(e));
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Send a test email" description={target ? (own ? 'Sends a short message through the SchoolSync default sender to your own address.' : `Sends a short message through “${target.name}” using the saved settings.`) : undefined}>
        <div className="mt-4 space-y-4">
          {own ? (
            <p className="text-sm text-ink-2">
              It will go to <strong className="font-medium text-ink">{me.email ?? 'your email address'}</strong>.{!me.email && ' Your login has no email address yet, so add one to your profile first.'}
            </p>
          ) : (
            <Field label="Send the test to" htmlFor={fieldId} hint="Your own address is filled in. Use another address to check how it looks to someone outside the school." error={invalid}>
              <Input id={fieldId} type="email" inputMode="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} invalid={!!invalid} placeholder="name@example.org" />
            </Field>
          )}
          <div aria-live="polite" className="space-y-2">
            {result?.ok && (
              <Banner tone="success" title="The mail server accepted the test email">
                It was sent to {result.sentTo}. Check that inbox (and the spam folder). If it never arrives, your provider may be filtering it: see the SPF and DKIM note on the accounts tab.
              </Banner>
            )}
            {result && !result.ok && (
              <Banner tone="danger" title="The test email was not sent">
                {result.error ?? 'The mail server returned an error.'}
              </Banner>
            )}
            {problem && <Banner tone="danger">{problem}</Banner>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={() => void send()} loading={test.isPending} disabled={own && !me.email}>
            <Send /> {result ? 'Send again' : 'Send test email'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
