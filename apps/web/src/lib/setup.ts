import type { LucideIcon } from 'lucide-react';
import { BookMarked, CalendarRange, CalendarDays, Coins, GraduationCap, Layers, ListChecks, Megaphone, Presentation, School, UsersRound, Clock, Rows3 } from 'lucide-react';
import type { SetupStepKey } from '@school-sync/shared';

export type StepStatus = 'done' | 'todo';

/**
 * The "Get your school ready" checklist. WHETHER a step is done, how many records exist and what to do next all come from
 * `GET /setup/status` (keyed by `key`); this file only adds the guidance and the deep link into the screen where the step is done.
 */
export interface SetupStepDef {
  key: SetupStepKey;
  /** kept as `id` for the dashboard card */
  id: SetupStepKey;
  title: string;
  summary: string;
  icon: LucideIcon;
  /** where the real screen lives (relative to /admin) */
  href: string;
  cta: string;
  secondary?: { label: string; href: string };
  guidance: string[];
  requires?: 'fees';
}

const step = (d: Omit<SetupStepDef, 'id'>): SetupStepDef => ({ ...d, id: d.key });

export const SETUP_STEPS: SetupStepDef[] = [
  step({
    key: 'school_profile',
    title: 'School profile and branding',
    summary: 'Name, logo, colours and contact details people see.',
    icon: School,
    href: '/settings/school?tab=details',
    cta: 'Add school details',
    secondary: { label: 'Logo and colours', href: '/settings/school' },
    guidance: ['Add the address, phone and email: they print on report cards and receipts.', 'Upload your logo. It appears on the sign-in page, the app and report cards.', 'Pick the brand colour; text colours adjust automatically so everything stays readable.'],
  }),
  step({
    key: 'academic_year',
    title: 'Academic year',
    summary: 'The calendar everything else hangs from.',
    icon: CalendarRange,
    href: '/academics/years',
    cta: 'Set up the academic year',
    guidance: ['Create the academic year with its start and end dates and make it current.', 'The subscription is priced per student per academic year, so this also anchors your licence.'],
  }),
  step({
    key: 'terms',
    title: 'Terms',
    summary: 'Terms or semesters inside the academic year.',
    icon: CalendarDays,
    href: '/academics/years',
    cta: 'Add terms',
    guidance: ['Terms sit inside the year and may not overlap each other.', 'Exams are linked to a term, so add them before you schedule an exam.'],
  }),
  step({
    key: 'grades',
    title: 'Grades',
    summary: 'Classes such as Grade 6.',
    icon: Layers,
    href: '/academics/classes?tab=grades',
    cta: 'Add grades',
    guidance: ['Add each grade in teaching order.', 'Then add the sections (6-A, 6-B) that students are placed in.'],
  }),
  step({
    key: 'sections',
    title: 'Sections and class teachers',
    summary: 'Sections for each grade, each with a class teacher.',
    icon: Rows3,
    href: '/academics/classes',
    cta: 'Add sections',
    guidance: ['Create at least one section per grade for the current year.', 'Give every section a class teacher once teachers exist, and set a capacity so full classes are flagged.'],
  }),
  step({
    key: 'subjects',
    title: 'Subjects',
    summary: 'What is taught, and in which grades.',
    icon: BookMarked,
    href: '/academics/subjects',
    cta: 'Add subjects',
    secondary: { label: 'Grade offerings', href: '/academics/subjects?tab=offerings' },
    guidance: ['Add the subject catalogue (Mathematics, Science, English).', 'Then choose the subjects each grade offers and the periods per week.'],
  }),
  step({
    key: 'teaching_assignments',
    title: 'Subject teachers',
    summary: 'Who teaches which subject in each section.',
    icon: ListChecks,
    href: '/academics/assignments',
    cta: 'Assign teachers',
    guidance: ['Every section needs a teacher for each subject its grade offers.', 'Teachers only see the classes and subjects assigned here, and mark sheets are created from these assignments.'],
  }),
  step({
    key: 'teachers',
    title: 'Teachers',
    summary: 'Staff accounts with the right role.',
    icon: Presentation,
    href: '/people/staff',
    cta: 'Add teachers',
    guidance: ['Add teachers with their employee ID, which is what they sign in with.', 'They are asked to choose a new password the first time they sign in.'],
  }),
  step({
    key: 'students',
    title: 'Students',
    summary: 'Add students one by one or import a CSV.',
    icon: GraduationCap,
    href: '/people/students',
    cta: 'Add students',
    secondary: { label: 'Import a CSV', href: '/people/students/import' },
    guidance: ['Import your existing list, or add students individually.', 'Each student takes one licence seat for the academic year.', 'Every student is placed in a section so timetables and attendance work.'],
  }),
  step({
    key: 'parents_linked',
    title: 'Parents linked and verified',
    summary: 'Parents only see children whose link the school has verified.',
    icon: UsersRound,
    href: '/people/guardians',
    cta: 'Review parents',
    guidance: ['Check each parent–child link against your records and verify it.', 'An unverified link gives the parent no access to the child.'],
  }),
  step({
    key: 'timetable',
    title: 'Timetable',
    summary: 'Weekly periods for every section.',
    icon: Clock,
    href: '/academics/timetable',
    cta: 'Build the timetable',
    secondary: { label: 'School-day periods', href: '/academics/years?tab=periods' },
    guidance: ['Define the period timings first, then fill the weekly grid for each section.', 'Clashes (a teacher in two places) are flagged as you go.'],
  }),
  step({
    key: 'fee_structure',
    title: 'Fee structure',
    summary: 'Categories, instalments and who pays what.',
    icon: Coins,
    href: '/finance/structures',
    cta: 'Set up fees',
    requires: 'fees',
    guidance: ['Create fee categories and a structure per grade.', 'Add instalments with due dates, then assign the structure to students and generate dues.'],
  }),
  step({
    key: 'communication',
    title: 'First announcement or event',
    summary: 'Tell everyone the school is live.',
    icon: Megaphone,
    href: '/communication/announcements',
    cta: 'Write an announcement',
    secondary: { label: 'Add an event', href: '/communication/events' },
    guidance: ['Post a welcome announcement to everyone.', 'Share each person’s username and temporary password; they must change it on first sign-in.'],
  }),
];
