import { notFound } from 'next/navigation';
import { ComingOnline, NoAccess } from '@/components/dashboard/coming-online';
import { allItems, itemVisible } from '@/lib/nav';
import { requireMe } from '@/lib/server/session';
import { requireSite } from '@/lib/server/site';

export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const href = `/${slug.join('/')}`;
  const item = allItems('student').find((i) => i.href === href);
  if (!item) notFound();
  const [me, site] = await Promise.all([requireMe(), requireSite()]);
  if (!itemVisible(item, me, site)) return <NoAccess />;
  return <ComingOnline experience="student" itemId={item.id} />;
}
