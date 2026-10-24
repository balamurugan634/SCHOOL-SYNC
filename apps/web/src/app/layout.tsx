import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { Inter, Manrope } from 'next/font/google';
import { Providers } from '@/components/providers';
import { brandCss } from '@/lib/color';
import { env } from '@/lib/env';
import { getSiteState } from '@/lib/server/site';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// display face: page titles, hero and big figures (variable weight)
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });

/** The operator console (/platform) is not a school: it never resolves one (set by proxy.ts). */
const isConsolePath = async () => {
  const p = (await headers()).get('x-url-path') ?? '';
  return p === '/platform' || p.startsWith('/platform/');
};

export async function generateMetadata(): Promise<Metadata> {
  if (await isConsolePath()) {
    return { title: { default: 'SchoolSync operator console', template: '%s · Operator console' }, description: 'Onboarding and billing for SchoolSync schools.', applicationName: 'SchoolSync', icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }], apple: '/apple-touch-icon.png' }, robots: { index: false, follow: false } };
  }
  const s = await getSiteState();
  const name = s.status === 'ok' ? s.info.name : 'SchoolSync';
  return {
    title: { default: s.status === 'ok' ? name : 'SchoolSync — find your school', template: `%s · ${name}` },
    description: s.status === 'ok' ? `${name} — attendance, homework, results, fees and school news.` : 'Sign in to your school on SchoolSync.',
    applicationName: 'SchoolSync',
    icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }], apple: '/apple-touch-icon.png' },
    robots: { index: s.status === 'ok', follow: s.status === 'ok' },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f5' },
    { media: '(prefers-color-scheme: dark)', color: '#131211' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = (await isConsolePath()) ? ({ status: 'none' } as const) : await getSiteState();
  const site = s.status === 'ok' ? s.info : null;
  // dev only (ENABLE_DEV_PREVIEW): `ss_dev_brand` cookie previews another school colour, e.g. to check the normalisation
  const override = env.devPreview ? (await cookies()).get('ss_dev_brand')?.value : undefined;
  return (
    <html lang={site?.locale?.split('-')[0] ?? 'en'} className={`${inter.variable} ${manrope.variable}`} suppressHydrationWarning>
      <head>
        {/* the school's colour, normalised in OKLCH (lib/color.ts) and resolved per request */}
        <style id="brand-vars" dangerouslySetInnerHTML={{ __html: `html:root{${brandCss(override ? `#${override.replace('#', '')}` : site?.primaryColor)}}` }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers site={site}>{children}</Providers>
      </body>
    </html>
  );
}
