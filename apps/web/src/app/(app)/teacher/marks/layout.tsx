import { MarksNav } from '@/components/features/teacher/marks/marks-shared';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MarksNav />
      {children}
    </>
  );
}
