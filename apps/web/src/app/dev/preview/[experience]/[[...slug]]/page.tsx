import { notFound } from 'next/navigation';
import { ComingOnline } from '@/components/dashboard/coming-online';
import { ManagementDashboard } from '@/components/dashboard/management-dashboard';
import { ParentHome } from '@/components/dashboard/parent-home';
import { StudentHome, TeacherHome } from '@/components/dashboard/homes';
import { allItems } from '@/lib/nav';
import type { Experience } from '@/lib/experience';

export default async function PreviewPage({ params }: { params: Promise<{ experience: string; slug?: string[] }> }) {
  const { experience, slug } = await params;
  const exp = experience as Experience;
  if (!slug?.length) return { student: <StudentHome />, parent: <ParentHome />, teacher: <TeacherHome />, management: <ManagementDashboard /> }[exp] ?? notFound();
  const item = allItems(exp).find((i) => i.href === `/${slug.join('/')}`);
  if (!item) notFound();
  return <ComingOnline experience={exp} itemId={item.id} />;
}
