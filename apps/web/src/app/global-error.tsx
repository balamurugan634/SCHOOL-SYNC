'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100dvh', margin: 0, background: '#faf8f5', color: '#1c1a17', fontSize: 14 }}>
        <div style={{ textAlign: 'left', maxWidth: 360, padding: 24, background: '#fff', border: '1px solid #e7e2d9', borderRadius: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ color: '#4f4a42', margin: '0 0 16px' }}>Please reload the page. If it keeps happening, contact your school office.</p>
          <button onClick={reset} style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#0e5a63', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
