import { z } from 'zod';

/**
 * The school settings groups, mirrored from the API (apps/api/src/core/settings.ts). The API validates again, so a drift can
 * only produce a server error that lands on the field, never bad data. Money is stored in minor units and edited in major units.
 */
export type FieldSpec = { name: string; label: string; hint?: string; required?: boolean } & (
  | { kind: 'text'; max?: number; format?: 'email' | 'phone' | 'url' | 'prefix'; placeholder?: string }
  | { kind: 'number'; min: number; max: number; unit?: string }
  | { kind: 'money'; hint?: string }
  | { kind: 'bool' }
  | { kind: 'select'; options: { value: string; label: string }[] }
  | { kind: 'time' }
  | { kind: 'weekdays' }
  | { kind: 'categories' }
);

export interface GroupSpec {
  key: string;
  title: string;
  description: string;
  fields: FieldSpec[];
  /** shows an informational banner when this feature is switched off for the school */
  feature?: 'fees' | 'library';
  /** extra consequence text shown above the save bar */
  note?: string;
}

export const NOTIFICATION_CATEGORIES = [
  { value: 'attendance', label: 'Attendance' },
  { value: 'homework', label: 'Homework' },
  { value: 'marks', label: 'Marks and results' },
  { value: 'fees', label: 'Fees' },
  { value: 'announcement', label: 'Announcements' },
  { value: 'event', label: 'Events' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'leave', label: 'Leave' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'system', label: 'System' },
];

export const GROUPS: Record<string, GroupSpec> = {
  details: {
    key: 'school',
    title: 'School details',
    description: 'Contact details printed on report cards, receipts and letters.',
    fields: [
      { kind: 'text', name: 'address', label: 'Address', max: 300 },
      { kind: 'text', name: 'phone', label: 'Phone', format: 'phone', max: 30 },
      { kind: 'text', name: 'email', label: 'Email', format: 'email', max: 160 },
      { kind: 'text', name: 'website', label: 'Website', format: 'url', max: 200, placeholder: 'https://' },
      { kind: 'text', name: 'affiliation', label: 'Board or affiliation', hint: 'For example CBSE affiliation number', max: 120 },
    ],
  },
  attendance: {
    key: 'attendance',
    title: 'Attendance',
    description: 'How attendance is taken, when parents are told, and how long teachers can edit a submitted roll call.',
    fields: [
      {
        kind: 'select',
        name: 'mode',
        label: 'Attendance is taken',
        hint: 'Once a day by the class teacher, or in every period by each subject teacher. Teachers see the new roll call straight away.',
        options: [
          { value: 'daily', label: 'Once a day' },
          { value: 'period', label: 'In every period' },
        ],
      },
      { kind: 'number', name: 'shortagePercent', label: 'Minimum attendance', min: 0, max: 100, unit: '%', hint: 'Students below this share get a shortage alert and are flagged in reports.' },
      { kind: 'number', name: 'editWindowHours', label: 'Teachers can edit a submitted roll call for', min: 0, max: 168, unit: 'hours', hint: 'After this, a correction request that you approve is needed. 0 locks it immediately.' },
      { kind: 'bool', name: 'notifyParentsOnAbsent', label: 'Tell parents when their child is marked absent', hint: 'Verified guardians get a notification when the roll call is submitted.' },
      { kind: 'bool', name: 'leaveMarksAttendance', label: 'Approved leave marks attendance as “on leave”', hint: 'Days on approved leave are also left out of the attendance percentage.' },
    ],
  },
  academic: {
    key: 'academic',
    title: 'School days',
    description: 'Which weekdays are school days. Timetables, attendance and the calendar follow this.',
    note: 'Changing working days does not move existing timetable slots; check the timetable of any class that used a day you remove.',
    fields: [{ kind: 'weekdays', name: 'workingDays', label: 'School days' }],
  },
  exams: {
    key: 'exams',
    title: 'Exams',
    description: 'How marks reach students and parents.',
    fields: [{ kind: 'bool', name: 'requireApproval', label: 'Marks need approval before students see them', hint: 'On: teachers submit, a reviewer approves, then the school publishes. Off: a submitted sheet is approved and published directly.' }],
  },
  fees: {
    key: 'fees',
    title: 'Fees',
    description: 'Numbering, late fees, online payment by parents and the expense approval limit.',
    feature: 'fees',
    fields: [
      { kind: 'money', name: 'lateFeePerDayMinor', label: 'Late fee per day', hint: 'Charged for each day an invoice is overdue. 0 means no late fee.' },
      { kind: 'text', name: 'invoicePrefix', label: 'Invoice number prefix', format: 'prefix', max: 12 },
      { kind: 'text', name: 'receiptPrefix', label: 'Receipt number prefix', format: 'prefix', max: 12 },
      { kind: 'bool', name: 'parentsCanPayOnline', label: 'Parents can pay online', hint: 'Also needs the “Online payments” feature switch to be on.' },
      { kind: 'money', name: 'expenseApprovalThresholdMinor', label: 'Expense approval limit', hint: 'Expenses above this amount wait for approval. 0 means every expense needs approval.' },
    ],
  },
  library: {
    key: 'library',
    title: 'Library',
    description: 'Loan periods, limits and fines.',
    feature: 'library',
    fields: [
      { kind: 'number', name: 'loanDays', label: 'Student loan period', min: 1, max: 365, unit: 'days' },
      { kind: 'number', name: 'staffLoanDays', label: 'Staff loan period', min: 1, max: 365, unit: 'days' },
      { kind: 'number', name: 'maxLoansPerStudent', label: 'Books per student', min: 1, max: 50 },
      { kind: 'number', name: 'maxLoansPerStaff', label: 'Books per staff member', min: 1, max: 50 },
      { kind: 'money', name: 'finePerDayMinor', label: 'Fine per day overdue', hint: '0 means no fines.' },
    ],
  },
  notifications: {
    key: 'notifications',
    title: 'Notifications',
    description: 'Quiet hours for push notifications and which categories hide their content on lock screens.',
    fields: [
      { kind: 'time', name: 'quietFrom', label: 'Quiet hours start' },
      { kind: 'time', name: 'quietTo', label: 'Quiet hours end', hint: 'Push notifications are held back between these times. In-app notifications are unaffected.' },
      { kind: 'categories', name: 'privateCategories', label: 'Hide details on the lock screen for', hint: 'Notifications in these categories show a generic line instead of names and amounts.' },
    ],
  },
};

const money = z.coerce.number({ message: 'Enter an amount' }).min(0, 'Cannot be negative').max(10_000_000, 'That is too large');

/** zod object for a group's fields (form values: money in major units). */
export function groupSchema(fields: FieldSpec[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    switch (f.kind) {
      case 'text': {
        let s: z.ZodType = z.string().trim().max(f.max ?? 200, `Use at most ${f.max ?? 200} characters`);
        if (f.format === 'email') s = z.union([z.literal(''), z.email('Enter a valid email address').max(160)]);
        if (f.format === 'url') s = z.union([z.literal(''), z.string().trim().max(200).regex(/^https?:\/\/\S+\.\S+$/i, 'Start with http:// or https://')]);
        if (f.format === 'phone') s = z.union([z.literal(''), z.string().trim().max(30).regex(/^\+?[\d\s\-()]{6,29}$/, 'Enter a valid phone number')]);
        shape[f.name] = s;
        break;
      }
      case 'number':
        shape[f.name] = z.coerce.number({ message: 'Enter a number' }).int('Use a whole number').min(f.min, `At least ${f.min}`).max(f.max, `At most ${f.max}`);
        break;
      case 'money':
        shape[f.name] = money;
        break;
      case 'bool':
        shape[f.name] = z.boolean();
        break;
      case 'select':
        shape[f.name] = z.enum(f.options.map((o) => o.value) as [string, ...string[]]);
        break;
      case 'time':
        shape[f.name] = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 21:00');
        break;
      case 'weekdays':
        shape[f.name] = z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one school day');
        break;
      case 'categories':
        shape[f.name] = z.array(z.string());
        break;
    }
  }
  return z.object(shape);
}

/** API values → form values */
export function toFormValues(fields: FieldSpec[], data: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = data?.[f.name];
    if (f.kind === 'money') out[f.name] = typeof v === 'number' ? v / 100 : 0;
    else if (f.kind === 'bool') out[f.name] = v === true;
    else if (f.kind === 'weekdays') out[f.name] = Array.isArray(v) ? [...v].sort() : [];
    else if (f.kind === 'categories') out[f.name] = Array.isArray(v) ? [...v] : [];
    else out[f.name] = v ?? (f.kind === 'number' ? '' : '');
  }
  return out;
}

/** form values → the API body (only the fields that changed) */
export function toApiBody(fields: FieldSpec[], values: Record<string, unknown>, original: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    let v = values[f.name];
    if (f.kind === 'money') v = Math.round(Number(v) * 100);
    if (f.kind === 'number') v = Number(v);
    let orig = original[f.name];
    if (f.kind === 'weekdays' && Array.isArray(v) && Array.isArray(orig)) {
      v = [...v].sort();
      orig = [...orig].sort();
    }
    if (JSON.stringify(v) !== JSON.stringify(orig)) body[f.name] = v;
  }
  return body;
}
