import { redirect } from 'next/navigation';

/** Finance reports live with the other reports. */
export default function Page() {
  redirect('/admin/reports/fees');
}
