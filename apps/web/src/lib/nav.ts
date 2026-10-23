import {
  BadgeCheck, Bell, BarChart3, BookMarked, BookOpen, Bus, CalendarDays, CalendarRange, ClipboardCheck, ClipboardList, Coins, CreditCard, FileBarChart2, FileText, GraduationCap, Home, KeyRound, Landmark, LayoutDashboard, Library, ListChecks, type LucideIcon, Megaphone, MessagesSquare, NotebookPen, Receipt, Rocket, ScrollText, Settings2, TrendingUp, UserCog, UserPlus, UserRound, UsersRound, Wallet, Wrench, Gauge, Layers, Trophy, School, Clock, CalendarCheck2, Presentation,
} from 'lucide-react';
import type { Me, PermissionKey, Scope, SiteInfo } from '@school-sync/shared';
import { can } from './permissions';
import type { Experience } from './experience';

export interface NavItem {
  id: string;
  label: string;
  /** path below the experience base: '' = home */
  href: string;
  icon: LucideIcon;
  /** any-of permission(s) required to see the item (UI gating only) */
  perm?: PermissionKey | PermissionKey[];
  minScope?: Scope;
  /** hidden when the school has the feature switched off */
  feature?: keyof SiteInfo['features'];
  /** one-liner for the Phase-1 "coming online" page and the command palette */
  blurb?: string;
  includes?: string[];
  /** shorter label for the 5-slot mobile bottom bar */
  short?: string;
}
export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const STUDENT_NAV: NavItem[] = [
  { id: 'home', label: 'Home', href: '', icon: Home },
  { id: 'tasks', label: 'My Tasks', href: '/tasks', icon: ListChecks, blurb: 'Homework to hand in and your own to-dos, in one list.', includes: ['Homework due this week', 'Personal tasks with reminders', 'Submit work and see feedback'] },
  { id: 'calendar', label: 'Calendar', href: '/calendar', icon: CalendarDays, blurb: 'Timetable, exams, holidays and school events.', includes: ['Today’s timetable', 'Exam schedule', 'Events and holidays'] },
  { id: 'learning', label: 'Learning', href: '/learning', icon: BookOpen, blurb: 'Study materials, syllabus progress and published results.', includes: ['Study materials by subject', 'Syllabus and lesson progress', 'Published results and report cards'] },
  { id: 'profile', label: 'Profile', href: '/profile', icon: UserRound, blurb: 'Your details, attendance record and leave requests.', includes: ['Your student record', 'Attendance percentage and history', 'Apply for leave'] },
];

export const PARENT_NAV: NavItem[] = [
  { id: 'home', label: 'Home', href: '', icon: Home },
  { id: 'attendance', label: 'Attendance', href: '/attendance', icon: CalendarCheck2, blurb: 'Daily attendance, absences and leave requests for your child.', includes: ['Attendance calendar and percentage', 'Apply for leave', 'Absence alerts'] },
  { id: 'academics', label: 'Academics', href: '/academics', icon: GraduationCap, blurb: 'Homework, exams and published results.', includes: ['Homework status', 'Exam schedule', 'Results and report cards'] },
  { id: 'fees', label: 'Fees', href: '/fees', icon: Wallet, feature: 'fees', blurb: 'Dues, payments and receipts.', includes: ['Outstanding balance and due dates', 'Pay online (when enabled)', 'Receipts and payment history'] },
  { id: 'communication', label: 'Communication', short: 'Messages', href: '/communication', icon: Megaphone, blurb: 'Announcements, events and parent–teacher meetings.', includes: ['Announcements and circulars', 'Events and permission slips', 'Request a meeting'] },
];

export const TEACHER_NAV: NavItem[] = [
  { id: 'home', label: 'Home', href: '', icon: Home },
  { id: 'classes', label: 'My Classes', short: 'Classes', href: '/classes', icon: School, blurb: 'The classes and subjects you teach, with student lists.', includes: ['Class and subject list', 'Student lists and profiles', 'Class-teacher extras'] },
  { id: 'attendance', label: 'Attendance', href: '/attendance', icon: ClipboardCheck, perm: 'attendance:create', blurb: 'Take attendance for your classes in a few taps.', includes: ['Quick mark: present, absent, late', 'Correction requests', 'Class attendance summary'] },
  { id: 'homework', label: 'Homework', href: '/homework', icon: NotebookPen, perm: 'homework:view', blurb: 'Create homework, collect submissions and give feedback.', includes: ['Create and publish homework', 'Submissions to review', 'Completion by student'] },
  { id: 'marks', label: 'Marks', href: '/marks', icon: Trophy, perm: 'marks:view', blurb: 'Enter marks for your subjects and track progress.', includes: ['Mark sheets by exam and subject', 'Submit for approval', 'Progress over time'] },
  { id: 'timetable', label: 'Timetable', href: '/timetable', icon: Clock, perm: 'timetable:view', blurb: 'Your week of lessons, with cover arrangements.', includes: ['Weekly grid', 'Substitutions covering you or your classes'] },
  { id: 'syllabus', label: 'Syllabus & materials', short: 'Syllabus', href: '/syllabus', icon: BookOpen, perm: 'syllabus:view', blurb: 'Lesson progress by class and subject, and study materials.', includes: ['Topic progress and coverage', 'Share study materials'] },
  { id: 'messages', label: 'Messages & events', short: 'Messages', href: '/messages', icon: MessagesSquare, blurb: 'Class announcements, events and parent meetings.', includes: ['Post to your classes', 'Parent–teacher meeting requests', 'Events you manage'] },
  { id: 'me', label: 'Me', href: '/me', icon: UserRound, blurb: 'Check in and out, your leave and your profile.', includes: ['Staff attendance check-in and check-out', 'Apply for leave', 'Profile and contact details'] },
];

export const MANAGEMENT_NAV: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    items: [
      { id: 'dashboard', label: 'Dashboard', href: '', icon: LayoutDashboard },
      { id: 'setup', label: 'School setup', href: '/setup', icon: Rocket, perm: 'settings:edit', minScope: 'school' },
    ],
  },
  {
    id: 'academics',
    label: 'Academics',
    icon: GraduationCap,
    items: [
      { id: 'years', label: 'Academic years & terms', href: '/academics/years', icon: CalendarRange, perm: 'academics:view', blurb: 'Create the academic year, terms, working days and holidays.', includes: ['Academic years and terms', 'Working days and holidays', 'Period timings'] },
      { id: 'classes', label: 'Classes & sections', href: '/academics/classes', icon: Layers, perm: 'academics:view', blurb: 'Grades, sections, class teachers and capacity.', includes: ['Grades and sections', 'Class teacher assignment', 'Student allocation'] },
      { id: 'subjects', label: 'Subjects', href: '/academics/subjects', icon: BookMarked, perm: 'academics:view', blurb: 'Subjects and who teaches them in each section.', includes: ['Subject catalogue', 'Teacher–subject–section assignments'] },
      { id: 'assignments', label: 'Teaching assignments', href: '/academics/assignments', icon: ListChecks, perm: 'academics:view', blurb: 'Who teaches which subject in each section.', includes: ['Section by subject grid', 'Change a teacher inline'] },
      { id: 'timetable', label: 'Timetable', href: '/academics/timetable', icon: Clock, perm: 'timetable:view', blurb: 'Build, review and publish section timetables.', includes: ['Weekly grid by section', 'Clash detection', 'Publish to students and parents'] },
      { id: 'attendance', label: 'Attendance', href: '/attendance', icon: ClipboardCheck, perm: 'attendance:view', blurb: 'School-wide attendance oversight and corrections.', includes: ['Today’s attendance by class', 'Correction approvals', 'Shortage alerts'] },
      { id: 'leave', label: 'Student leave', href: '/attendance/leave', icon: CalendarCheck2, perm: 'leave:view', blurb: 'Review and approve student leave.', includes: ['Pending requests', 'Approve or reject with a note'] },
      { id: 'homework', label: 'Homework & materials', href: '/homework', icon: NotebookPen, perm: 'homework:view', blurb: 'Oversight of homework, submissions and study materials.', includes: ['Homework by class', 'Completion rates'] },
      { id: 'exams', label: 'Exams & results', href: '/exams', icon: Trophy, perm: 'exams:view', blurb: 'Schedules, mark sheets, approvals and result publication.', includes: ['Exam schedules', 'Mark sheet approvals', 'Publish results'] },
      { id: 'report-cards', label: 'Report cards', href: '/exams/report-cards', icon: FileText, perm: 'report_cards:view', blurb: 'Generate, review and publish report cards.', includes: ['Remarks and grades', 'Bulk publish', 'Export PDFs'] },
      { id: 'promotions', label: 'Year-end promotion', href: '/academics/promotions', icon: TrendingUp, perm: 'promotions:view', blurb: 'Promote students to the next class with history preserved.', includes: ['Promotion rules', 'Review and approve', 'Move to new sections'] },
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: UsersRound,
    items: [
      { id: 'students', label: 'Students', href: '/people/students', icon: GraduationCap, perm: 'students:view', blurb: 'Student records, documents and class allocation.', includes: ['Search and filter', 'Add or import students (CSV)', 'Transfer, withdraw, alumni'] },
      { id: 'guardians', label: 'Parents & guardians', href: '/people/guardians', icon: UsersRound, perm: 'guardians:view', blurb: 'Guardian accounts and verified links to children.', includes: ['Guardian profiles', 'Verify parent–child links', 'Emergency contacts and pickup'] },
      { id: 'admissions', label: 'Admissions', href: '/people/admissions', icon: UserPlus, perm: 'admissions:view', blurb: 'Applications from submission to enrolment.', includes: ['Application pipeline', 'Review and accept', 'Create student and parent accounts'] },
      { id: 'corrections', label: 'Record corrections', href: '/people/corrections', icon: ClipboardList, perm: 'students:edit', minScope: 'school', blurb: 'Review requests to correct official student details.', includes: ['Approve or reject with a note'] },
      { id: 'staff', label: 'Staff', href: '/people/staff', icon: Presentation, perm: 'staff:view', blurb: 'Staff profiles, teaching assignments and roles.', includes: ['Staff directory', 'Subject and class assignments'] },
      { id: 'staff-attendance', label: 'Staff attendance & leave', href: '/attendance/staff', icon: Clock, perm: ['staff_attendance:view', 'staff_leave:view'], minScope: 'school', blurb: 'Staff attendance and leave approvals.', includes: ['Daily staff attendance', 'Leave requests and balances'] },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: Wallet,
    items: [
      { id: 'finance-overview', label: 'Finance overview', href: '/finance', icon: Gauge, perm: ['fees:view', 'payments:view'], feature: 'fees', blurb: 'Collection, expenses, outstanding fees and what needs approval.', includes: ['Collection vs expenses by month', 'Outstanding and overdue', 'Approvals waiting'] },
      { id: 'fee-structures', label: 'Fee structures', href: '/finance/structures', icon: Coins, perm: 'fees:view', feature: 'fees', blurb: 'Fee categories, structures and student fee plans.', includes: ['Categories and instalments', 'Concessions and scholarships'] },
      { id: 'invoices', label: 'Dues & invoices', href: '/finance/invoices', icon: Receipt, perm: 'fees:view', feature: 'fees', blurb: 'Generate dues, track outstanding and overdue amounts.', includes: ['Generate invoices', 'Outstanding and overdue', 'Reminders'] },
      { id: 'payments', label: 'Payments & receipts', href: '/finance/payments', icon: CreditCard, perm: 'payments:view', feature: 'fees', blurb: 'Record collections, issue receipts and approve refunds.', includes: ['Collect payment', 'Receipts', 'Refund approvals'] },
      { id: 'expenses', label: 'Expenses', href: '/finance/expenses', icon: Landmark, perm: 'expenses:view', feature: 'fees', blurb: 'School expenses and basic finance summaries.', includes: ['Record expenses', 'Approvals', 'Monthly summary'] },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    icon: Megaphone,
    items: [
      { id: 'announcements', label: 'Announcements', href: '/communication/announcements', icon: Megaphone, perm: 'announcements:view', blurb: 'Circulars to everyone or to specific audiences.', includes: ['Compose and publish', 'Audience targeting', 'Delivery and acknowledgement'] },
      { id: 'events', label: 'Events & calendar', href: '/communication/events', icon: CalendarDays, perm: 'events:view', blurb: 'The academic calendar, events and permission forms.', includes: ['School calendar', 'Registrations and consent'] },
      { id: 'meetings', label: 'Parent–teacher meetings', href: '/communication/meetings', icon: MessagesSquare, perm: 'meetings:view', blurb: 'Meeting requests, slots and outcomes.', includes: ['Requests and approvals', 'Scheduling'] },
      { id: 'notification-prefs', label: 'My notifications', href: '/communication/preferences', icon: Bell, perm: 'notifications:view', blurb: 'Choose push and email per category, and quiet hours.', includes: ['Push and email by category', 'Quiet hours'] },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: Wrench,
    items: [
      { id: 'transport', label: 'Transport', href: '/operations/transport', icon: Bus, perm: 'transport:view', feature: 'transport', blurb: 'Routes, stops, vehicles and student allocation.', includes: ['Routes and stops', 'Vehicles and drivers', 'Student allocation'] },
      { id: 'library', label: 'Library', href: '/operations/library', icon: Library, perm: 'library:view', feature: 'library', blurb: 'Catalogue, issue and return, fines.', includes: ['Catalogue', 'Issue and return', 'Overdue and fines'] },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart3,
    items: [
      { id: 'reports', label: 'All reports', href: '/reports', icon: FileBarChart2, perm: 'reports:view', blurb: 'Exportable school-wide reports.', includes: ['Attendance and absenteeism', 'Academic performance', 'Class results'] },
      { id: 'report-attendance', label: 'Attendance report', href: '/reports/attendance', icon: ClipboardList, perm: 'reports:view', blurb: 'Absenteeism and attendance trends.', includes: ['By class and period', 'Export'] },
      { id: 'report-academics', label: 'Academic performance', href: '/reports/academics', icon: TrendingUp, perm: 'reports:view', blurb: 'Class and subject performance.', includes: ['Class results', 'Subject comparison'] },
      { id: 'report-fees', label: 'Fee collection', href: '/reports/fees', icon: Receipt, perm: ['fees:view', 'payments:view'], feature: 'fees', blurb: 'Collection, dues and aging.', includes: ['Collection vs dues', 'Defaulters'] },
    ],
  },
  {
    id: 'settings',
    label: 'Settings & Access',
    icon: Settings2,
    items: [
      { id: 'school-profile', label: 'School profile & branding', href: '/settings/school', icon: School, perm: 'settings:view', blurb: 'School identity, logo, colours and features.', includes: ['Name, logo and colours', 'Feature switches', 'Timezone, currency'] },
      { id: 'users', label: 'Users', href: '/settings/users', icon: UserCog, perm: 'users:view', blurb: 'Accounts, sign-in details and deactivation.', includes: ['Create and invite users', 'Reset passwords', 'Sessions'] },
      { id: 'roles', label: 'Roles & permissions', href: '/settings/roles', icon: KeyRound, perm: 'roles:view', blurb: 'Who can do what — role, scope and action.', includes: ['Role presets', 'Custom roles', 'Permission matrix'] },
      { id: 'audit', label: 'Audit log', href: '/settings/audit', icon: ScrollText, perm: 'audit:view', blurb: 'Who did what, and when.', includes: ['Searchable history', 'Export'] },
      { id: 'license', label: 'Subscription & seats', href: '/settings/license', icon: BadgeCheck, perm: 'settings:view', blurb: 'Seats used, renewal date and invoices.', includes: ['Seat usage', 'Renewal and invoices'] },
    ],
  },
];

/** Visible = permission (if any) granted AND the school has the feature switched on. */
export function itemVisible(item: NavItem, me: Pick<Me, 'permissions'>, site: Pick<SiteInfo, 'features'> | null): boolean {
  if (item.feature && site && !site.features[item.feature]) return false;
  if (!item.perm) return true;
  const perms = Array.isArray(item.perm) ? item.perm : [item.perm];
  const min = item.minScope ?? 'own';
  return perms.some((p) => can(me.permissions, p, min));
}

export function navFor(exp: Experience, me: Pick<Me, 'permissions'>, site: Pick<SiteInfo, 'features'> | null): NavGroup[] {
  const filter = (items: NavItem[]) => items.filter((i) => itemVisible(i, me, site));
  switch (exp) {
    case 'student':
      return [{ id: 'main', label: 'Student', icon: GraduationCap, items: filter(STUDENT_NAV) }];
    case 'parent':
      return [{ id: 'main', label: 'Parent', icon: UsersRound, items: filter(PARENT_NAV) }];
    case 'teacher':
      return [{ id: 'main', label: 'Teacher', icon: Presentation, items: filter(TEACHER_NAV) }];
    case 'management':
      return MANAGEMENT_NAV.map((g) => ({ ...g, items: filter(g.items) })).filter((g) => g.items.length > 0);
  }
}

export function allItems(exp: Experience): NavItem[] {
  return exp === 'management' ? MANAGEMENT_NAV.flatMap((g) => g.items) : exp === 'student' ? STUDENT_NAV : exp === 'parent' ? PARENT_NAV : TEACHER_NAV;
}
