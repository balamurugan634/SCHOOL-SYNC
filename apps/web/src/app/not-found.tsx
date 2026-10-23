import Link from 'next/link';
import { Illustration } from '@/components/illustrations/illustration';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm text-center">
        <Illustration name="no-results" className="mx-auto mb-5 w-48" />
        <h1 className="t-page">Page not found</h1>
        <p className="mt-2 text-sm text-ink-2">The link may be old, or the page may have moved.</p>
        <Button asChild className="mt-5">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}
