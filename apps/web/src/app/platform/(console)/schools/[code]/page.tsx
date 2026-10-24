import type { Metadata } from 'next';
import { SchoolDetail } from '@/components/platform/school-detail';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'School' };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // where a school's own site lives, e.g. http://{code}.localhost:3000 (the base host plus the code as a sub-domain)
  const siteUrlTemplate = `${env.secureCookies ? 'https' : 'http'}://{code}.${env.publicBase}`;
  return <SchoolDetail code={code.toLowerCase()} siteUrlTemplate={siteUrlTemplate} />;
}
