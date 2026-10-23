import type { Metadata } from 'next';
import { ProfilePage } from '@/components/account/profile-page';

export const metadata: Metadata = { title: 'My profile' };

export default function Page() {
  return <ProfilePage />;
}
