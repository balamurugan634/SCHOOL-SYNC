import { z } from 'zod';
import { academicYearCreateBody, gradeCreateBody, periodCreateBody, sectionCreateBody, sectionUpdateBody, subjectCreateBody, termCreateBody } from '@school-sync/shared';

/**
 * The shared request schemas, with plain-language messages for the empty / wrong-format cases
 * (the shared ones say "Expected YYYY-MM-DD"). Same fields and limits, so the browser still validates what the API will.
 */
const date = (msg: string) => z.string(msg).regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const time = (msg: string) => z.string(msg).regex(/^([01]\d|2[0-3]):[0-5]\d$/, msg);
const text = (msg: string, max: number) => z.string(msg).trim().min(1, msg).max(max, `Use ${max} characters or fewer`);
const num = (msg: string) => z.number({ error: msg });

export const yearSchema = academicYearCreateBody
  .extend({ name: z.string('Enter a name, for example 2027-28').trim().min(3, 'Enter a name, for example 2027-28').max(20, 'Use 20 characters or fewer'), startDate: date('Pick the start date'), endDate: date('Pick the end date') })
  .refine((v) => v.startDate < v.endDate, { message: 'The year must end after it starts', path: ['endDate'] });

export const termSchema = termCreateBody
  .extend({ name: text('Enter a name', 60), ordinal: num('Enter the term number').int().min(1).max(12).optional(), startDate: date('Pick the start date'), endDate: date('Pick the end date') })
  .refine((v) => v.startDate < v.endDate, { message: 'The term must end after it starts', path: ['endDate'] });

export const periodSchema = periodCreateBody
  .extend({ name: text('Enter a name', 60), ordinal: num('Enter the order').int('Use a whole number').min(1).max(30), startTime: time('Pick a start time'), endTime: time('Pick an end time') })
  .refine((v) => v.startTime < v.endTime, { message: 'A period must end after it starts', path: ['endTime'] });

export const gradeSchema = gradeCreateBody.extend({ name: text('Enter a name', 60), ordinal: num('Enter a position').int('Use a whole number').min(-5).max(30) });

export const subjectSchema = subjectCreateBody.extend({ code: text('Enter a code', 20), name: text('Enter a name', 100) });

export const sectionCreateSchema = sectionCreateBody.extend({ gradeId: z.uuid('Choose a grade'), name: text('Enter a section name', 20) });
export const sectionUpdateSchema = sectionUpdateBody.extend({ name: text('Enter a section name', 20) });
