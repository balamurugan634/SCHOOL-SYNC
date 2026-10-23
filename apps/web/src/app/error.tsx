'use client';

import { useEffect } from 'react';
import { Illustration } from '@/components/illustrations/illustration';
import { Button } from '@/components/ui/button';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm text-center">
        <Illustration name="error-offline" className="mx-auto mb-5 w-48" />
        <h1 className="t-page">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-2">We hit an unexpected problem loading this page. Please try again.</p>
        {error.digest && <p className="t-caption mt-2 text-ink-3">Reference: {error.digest}</p>}
        <Button onClick={reset} className="mt-5">
          Try again
        </Button>
      </div>
    </main>
  );
}
