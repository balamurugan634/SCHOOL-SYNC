'use client';

import * as React from 'react';
import { examCreateBody, type ExamOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { FormInput, FormSection, FormSelect } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { bff } from '@/lib/client/fetcher';
import { examErrorMessage, useExamMutation, useExamTerms, useGradeScales } from '@/lib/client/exams-admin';
import { useYearList, yearOptions } from '@/lib/client/options';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { applyApiErrors, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useFriendlyForm } from './friendly-form';
import { EXAM_TYPE_OPTIONS } from './meta';
import { FormDateOptional, FormNumber, FormSelectNullable } from './fields';

/**
 * Create or edit an exam in a drawer. Editing is only possible until the exam is published; the academic year is fixed once created.
 * `onSaved` receives the saved exam (the list navigates to a new exam's page).
 */
export function ExamFormDrawer({ open, onClose, exam, onSaved }: { open: boolean; onClose: () => void; exam?: ExamOut | null; onSaved?: (e: ExamOut, created: boolean) => void }) {
  const edit = !!exam;
  const years = useYearList();
  const scales = useGradeScales();
  const form = useFriendlyForm(examCreateBody, { defaultValues: { name: '', examType: 'unit_test', passPercent: 35, termId: null, gradeScaleId: null, startDate: null, endDate: null } });
  const { guard, dialog } = useUnsavedGuard(hasDirtyFields(form.formState));
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset(
      exam
        ? { name: exam.name, examType: exam.examType, academicYearId: exam.academicYearId, termId: exam.termId, gradeScaleId: exam.gradeScaleId, startDate: exam.startDate, endDate: exam.endDate, passPercent: exam.passPercent }
        : { name: '', examType: 'unit_test', passPercent: 35, termId: null, gradeScaleId: null, startDate: null, endDate: null, academicYearId: years.data?.find((y) => y.isCurrent)?.id },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exam?.id]);
  // a new exam defaults to the current year once the years have loaded
  React.useEffect(() => {
    if (open && !edit && !form.getValues('academicYearId') && years.data) form.setValue('academicYearId', years.data.find((y) => y.isCurrent)?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years.data, open]);

  const yearId = form.watch('academicYearId') ?? exam?.academicYearId;
  const terms = useExamTerms(yearId);

  const save = useExamMutation(
    async (v: Record<string, unknown>) => {
      if (exam) {
        const patch = { ...v };
        delete patch.academicYearId;
        return bff<ExamOut>(`/exams/${exam.id}`, { method: 'PATCH', body: patch });
      }
      return bff<ExamOut>('/exams', { method: 'POST', body: v });
    },
    { success: (e) => (edit ? `Saved ${e.name}` : `Created ${e.name}`) },
  );

  const close = () => guard(onClose);
  const status = exam?.status;

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => !o && close()}>
        <DrawerContent
          title={edit ? 'Edit exam' : 'New exam'}
          description={edit ? 'Changes apply straight away.' : 'It starts as a draft. Add the schedule, then schedule it so students and teachers can see it.'}
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
                const saved = await save.mutateAsync(v);
                form.reset(v);
                onClose();
                onSaved?.(saved, !edit);
              } catch (e) {
                const msg = applyApiErrors(form, e);
                setFormError(msg ? examErrorMessage(e) : null);
                if (!msg) toast.error('Check the highlighted fields.');
              }
            })}
          >
            <SheetBody>
              {status === 'under_review' || status === 'marks_entry' ? <Banner tone="info">Marks are already being collected. Changing the pass percentage here does not recalculate sheets that were already submitted.</Banner> : null}
              <FormSection title="Exam">
                <FormInput control={form.control} name="name" label="Name" required placeholder="Mid-term examination" autoFocus />
                <FormSelect control={form.control} name="examType" label="Type" options={EXAM_TYPE_OPTIONS} required />
                <FormNumber control={form.control} name="passPercent" label="Pass percentage" min={0} max={100} hint="A student passes a paper at or above this percentage, unless the paper sets its own pass marks." />
              </FormSection>
              <FormSection title="Academic year and term">
                {edit ? <p className="text-sm text-ink-2">{exam?.academicYearName ?? 'Academic year'} (fixed once the exam is created)</p> : <FormSelect control={form.control} name="academicYearId" label="Academic year" options={yearOptions(years.data)} placeholder={years.isPending ? 'Loading…' : 'Current year'} hint="Leave as the current year for this term’s exams." />}
                <FormSelectNullable control={form.control} name="termId" label="Term" options={(terms.data ?? []).map((t) => ({ value: t.id, label: t.name }))} noneLabel="No term" hint={terms.isError ? 'Terms could not be loaded.' : undefined} />
              </FormSection>
              <FormSection title="Dates and grading">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormDateOptional control={form.control} name="startDate" label="First day" />
                  <FormDateOptional control={form.control} name="endDate" label="Last day" min={form.watch('startDate') ?? undefined} />
                </div>
                <FormSelectNullable control={form.control} name="gradeScaleId" label="Grade scale" options={(scales.data ?? []).map((s) => ({ value: s.id, label: s.isDefault ? `${s.name} (default)` : s.name }))} noneLabel="School default scale" hint="Letter grades on report cards come from this scale." />
              </FormSection>
              {formError && <Banner tone="danger">{formError}</Banner>}
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting}>
                {edit ? 'Save changes' : 'Create exam'}
              </Button>
            </SheetFooter>
          </form>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}
