import { redirect } from 'next/navigation';

/** Legacy path (older links and the dashboard approvals list) → the canonical screen. */
export default function Page() {
  redirect('/admin/attendance/staff');
}
