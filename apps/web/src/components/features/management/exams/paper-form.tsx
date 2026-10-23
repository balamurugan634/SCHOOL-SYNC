'use client';

import * as React from 'react';
import { paperCreateBody, type ExamOut, type PaperOut } from '@school-sync/shared';
import { ApiError } from '@/lib/problem';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { FormInput, FormSection, FormSelect } from '@/components/ui/form';
import { bff } from '@/lib/client/fetcher';
import { examErrorMessage, useExamMutation, useGradeSubjects } from '@/lib/client/exams-admin';
import { gradeOptions, useGradeList } from '@/lib/client/options';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { applyApiErrors, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useFriendlyForm } from './friendly-form';
import { FormDateOptional, FormNumber, FormTime } from './fields';

const paperFormValues = (p?: PaperOut | null) => ({
  gradeId: p?.gradeId ?? '',
  subjectId: p?.subjectId ?? '',
  examDate: p?.examDate ?? null,
  startTime: p?.startTime ?? null,
  endTime: p?.endTime ?? null,
  room: p?.room ?? null,
  maxMarks: p?.maxMarks ?? 100,
  passMarks: p?.passMarks ?? null,
});

/** Add or edit one paper (grade × subject) of the schedule. Clash and range errors from the API land on the field they concern. */
export function PaperFormDrawer({ exam, paper, open, onClose, defaultGradeId }: { exam: ExamOut; paper?: PaperOut | null; open: boolean; onClose: () => void; defaultGradeId?: string }) {
  const edit = !!paper;
  const grades = useGradeList();
  const form = useFriendlyForm(paperCreateBody, { defaultValues: paperFormValues(paper) });
  const { guard, dialog } = useUnsavedGuard(hasDirtyFields(form.formState));
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({ ...paperFormValues(paper), gradeId: paper?.gradeId ?? defaultGradeId ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paper?.id]);

  const gradeId = form.watch('gradeId');
  const subjects = useGradeSubjects(gradeId || undefined);

  // when the grade changes, a subject that the new grade does not teach must be re-chosen
  React.useEffect(() => {
    const sid = form.getValues('subjectId');
    if (gradeId && subjects.data && sid && !subjects.data.some((s) => s.subjectId === sid)) form.setValue('subjectId', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects.data, gradeId]);

  const save = useExamMutation(async (v: Record<string, unknown>) => (paper ? bff<PaperOut>(`/exams/${exam.id}/papers/${paper.id}`, { method: 'PATCH', body: v }) : bff<PaperOut>(`/exams/${exam.id}/papers`, { method: 'POST', body: v })), {
    success: edit ? 'Paper updated' : 'Paper added',
  });
  const close = () => guard(onClose);

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => !o && close()}>
        <DrawerContent
          title={edit ? 'Edit paper' : 'Add paper'}
          description={`${exam.name}. A grade cannot have two papers at the same time on one day.`}
          showTitle
          onInteractOutside={(e) => {
            if (hasDirtyFields(form.formState)) {
              e.preventDefault();
              close();
            }
          }}
        >
          <form
            noValidate
            onSubmit={form.handleSubmit(async (v) => {
              setFormError(null);
              try {
                await save.mutateAsync(v);
                form.reset(v);
                onClose();
              } catch (e) {
                const generic = applyApiErrors(form, e);
                if (e instanceof ApiError) {
                  const msg = examErrorMessage(e);
                  const field = ({ SCHEDULE_CONFLICT: 'examDate', DATE_OUTSIDE_EXAM: 'examDate', SUBJECT_NOT_IN_GRADE: 'subjectId', PAPER_EXISTS: 'subjectId', MARKS_EXCEED_MAX: 'maxMarks' } as const)[e.code as 'SCHEDULE_CONFLICT'];
                  if (field) {
                    form.setError(field, { type: 'server', message: msg });
                    setFormError(null);
                    return;
                  }
                  setFormError(generic ? msg : null);
                } else setFormError(generic);
              }
            })}
          >
            <SheetBody>
              {formError && <Banner tone="danger">{formError}</Banner>}
              <FormSection title="Paper">
                <FormSelect control={form.control} name="gradeId" label="Grade" options={gradeOptions(grades.data)} placeholder={grades.isPending ? 'Loading…' : 'Choose a grade'} required />
                <FormSelect
                  control={form.control}
                  name="subjectId"
                  label="Subject"
                  required
                  placeholder={!gradeId ? 'Choose a grade first' : subjects.isPending ? 'Loading…' : 'Choose a subject'}
                  options={(subjects.data ?? []).map((s) => ({ value: s.subjectId, label: s.subjectName }))}
                  hint={subjects.data && subjects.data.length === 0 ? 'This grade offers no subjects yet. Add them under Academics › Subjects.' : undefined}
                />
              </FormSection>
              <FormSection title="When and where">
                <FormDateOptional control={form.control} name="examDate" label="Date" min={exam.startDate ?? undefined} max={exam.endDate ?? undefined} hint={exam.startDate && exam.endDate ? 'Must fall within the exam dates.' : 'Leave empty to schedule later.'} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormTime control={form.control} name="startTime" label="Starts" />
                  <FormTime control={form.control} name="endTime" label="Ends" />
                </div>
                <FormInput control={form.control} name="room" label="Room" placeholder="Exam Hall A" maxLength={60} />
              </FormSection>
              <FormSection title="Marks">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormNumber control={form.control} name="maxMarks" label="Maximum marks" min={1} max={1000} required />
                  <FormNumber control={form.control} name="passMarks" label="Pass marks" min={0} max={1000} empty="null" hint="Empty = the exam’s pass percentage." />
                </div>
              </FormSection>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting}>
                {edit ? 'Save paper' : 'Add paper'}
              </Button>
            </SheetFooter>
          </form>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}
