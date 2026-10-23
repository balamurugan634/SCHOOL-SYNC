import { AttendanceNav } from '@/components/features/teacher/attendance/attendance-nav';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AttendanceNav />
      {children}
    </>
  );
}
