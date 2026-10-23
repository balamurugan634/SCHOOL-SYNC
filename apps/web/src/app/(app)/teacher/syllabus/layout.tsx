import { SubNav } from '@/components/features/teacher/common';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav
        label="Syllabus sections"
        items={[
          { href: '/syllabus', label: 'Progress', exact: true },
          { href: '/syllabus/materials', label: 'Study materials' },
        ]}
      />
      {children}
    </>
  );
}
