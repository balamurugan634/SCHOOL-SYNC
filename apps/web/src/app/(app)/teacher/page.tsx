import type { Metadata } from 'next';
import { TeacherHomeScreen } from '@/components/features/teacher/home/teacher-home';

export const metadata: Metadata = { title: 'Home' };

export default function Page() {
  return <TeacherHomeScreen />;
}
