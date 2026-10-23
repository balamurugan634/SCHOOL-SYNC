'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Send, UserRoundPen } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { reportRemarkIn } from '@school-sync/shared';
import { mk, remarkState, usePublishRemarks, useRemarks, useSaveRemark, useExams, type RemarkRow, type RemarkState } from '@/lib/client/teacher-marks';
import { secLabel, useMySections, useTeacherScope } from '@/lib/client/teacher';
import { isOutOfScope, teacherError } from '@/lib/client/teacher-errors';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { cn } from '@/lib/cn';
import { fmtDateTime, plural } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormInput, FormTextarea } from '@/components/ui/form';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { PageHeader } from '@/components/shell/page-header';
import { usePermissions } from '@/components/me-context';
import { ErrorCard, OutOfScope, useUrlState, useWriteGate } from '../common';
import { ExamSelect } from './marks-shared';

const CHIP: Record<RemarkState, { status: string; label: string }> = {
  none: { status: 'todo', label: 'Not written' },
  draft: { status: 'draft', label: 'Draft' },
  published: { status: 'published', label: 'Published' },
};

/** Report-card remarks, written by the class teacher for each student of the class they lead. */
export function RemarksScreen() {
  const url = useUrlState();
  const scope = useTeacherScope();
  const { can } = usePermissions();
  const gate = useWriteGate();
  const exams = useExams();
  const sections = useMySections();
  const allowed = scope.isClassTeacher && (can('report_cards:edit') || can('report_cards:create'));
  const canPublish = can('report_cards:publish');

  const led = React.useMemo(() => (sections.data ?? []).filter((s) => scope.isLead(s.id)), [sections.data, scope]);
  const examList = React.useMemo(() => exams.data ?? [], [exams.data]);
  const wantedExam = url.get('exam');
  const exam = examList.find((e) => e.id === wantedExam) ?? examList.find((e) => e.status === 'marks_entry' || e.status === 'under_review') ?? examList.find((e) => e.status === 'published') ?? examList[0] ?? null;
  const section = led.find((s) => s.id === url.get('section')) ?? led[0] ?? null;
  const remarks = useRemarks(allowed ? exam?.id : null, allowed ? section?.id : null);

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [publishAsk, setPublishAsk] = React.useState(false);
  const publish = usePublishRemarks(exam?.id ?? '', section?.id ?? '');

  if (!allowed) {
    return (
      <>
        <PageHeader title="Report-card remarks" description="Remarks for each student’s report card." />
        <Card>
          <EmptyState icon={<UserRoundPen />} title="Only class teachers write report-card remarks" description="Remarks are written by the teacher who leads the class. Your subject marks still appear on every report card." />
        </Card>
      </>
    );
  }

  const rows = remarks.data ?? [];
  const states = rows.map((r) => remarkState(r));
  const written = states.filter((s) => s !== 'none').length;
  const drafts = states.filter((s) => s === 'draft').length;
  const published = states.filter((s) => s === 'published').length;
  const idx = openId ? rows.findIndex((r) => r.studentId === openId) : -1;

  const doPublish = async () => {
    if (!section) return;
    try {
      const r = await publish.mutateAsync({ sectionId: section.id });
      setPublishAsk(false);
      toast.success(r.published > 0 ? `Published ${plural(r.published, 'remark')}` : 'Nothing new to publish', { description: r.published > 0 ? 'Families can now see them on the report card.' : undefined });
    } catch (e) {
      setPublishAsk(false);
      toast.error(teacherError(e), { duration: 8000 });
    }
  };

  return (
    <>
      <PageHeader
        title="Report-card remarks"
        description={section ? `Write a remark, areas to improve and a conduct note for each student of ${secLabel(section.gradeName, section.name)}.` : 'Write remarks for the class you lead.'}
        actions={
          <>
            {exam && <ExamSelect exams={examList} value={exam.id} onChange={(v) => url.set({ exam: v })} />}
            {led.length > 1 && <Select aria-label="Class" className="w-44" value={section?.id ?? ''} onValueChange={(v) => url.set({ section: v })} options={led.map((s) => ({ value: s.id, label: secLabel(s.gradeName, s.name) }))} />}
          </>
        }
      />

      {exams.isPending || sections.isPending ? (
        <Skeleton className="h-72 w-full" aria-busy />
      ) : exams.isError ? (
        <ErrorCard error={exams.error} onRetry={() => void exams.refetch()} title="We couldn’t load the exams" />
      ) : !exam || !section ? (
        <Card>
          <EmptyState illustration="empty-generic" title={!exam ? 'No exam to write remarks for yet' : 'You don’t lead a class yet'} description={!exam ? 'Remarks open once an exam has been scheduled.' : 'Ask the school office to assign you as a class teacher.'} />
        </Card>
      ) : remarks.isPending ? (
        <Skeleton className="h-72 w-full" aria-busy />
      ) : remarks.isError ? (
        isOutOfScope(remarks.error) ? <OutOfScope what="This class’s remarks" backHref="/teacher/marks" backLabel="Back to marks" /> : <ErrorCard error={remarks.error} onRetry={() => void remarks.refetch()} title="We couldn’t load the remarks" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState illustration="empty-generic" title="No students in this class" description="Students appear here once they are allocated to the section." />
        </Card>
      ) : (
        <div className="space-y-4">
          {gate.readOnly && <Banner tone="locked" title="Read-only school">{gate.reason}</Banner>}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-4 py-3 max-sm:px-3">
              <div className="min-w-0 flex-1 basis-60">
                <p className="text-sm font-medium">
                  {written} of {plural(rows.length, 'student')} written
                  <span className="t-caption ml-2 text-ink-2">
                    {published} published · {drafts} draft
                  </span>
                </p>
                <ProgressBar className="mt-2 max-w-sm" value={written} max={rows.length} label="Students with a remark" tone={written === rows.length ? 'success' : 'brand'} />
              </div>
              {canPublish ? (
                <Button onClick={() => setPublishAsk(true)} disabled={drafts === 0 || gate.readOnly} title={gate.reason}>
                  <Send /> Publish {drafts > 0 ? plural(drafts, 'draft') : 'remarks'}
                </Button>
              ) : (
                <p className="t-caption max-w-xs text-ink-2">The school office publishes remarks so families can see them on the report card.</p>
              )}
            </div>
            <ul aria-label="Students" className="divide-y divide-border">
              {rows.map((r, i) => {
                const st = remarkState(r);
                const chip = CHIP[st];
                return (
                  <li key={r.studentId}>
                    <button
                      type="button"
                      onClick={() => setOpenId(r.studentId)}
                      aria-label={`${st === 'none' ? 'Write remark' : 'Edit remark'} for ${r.name}, ${chip.label}`}
                      className="tr-colors flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-subtle max-sm:px-3"
                    >
                      <span className="tnum w-7 shrink-0 text-right text-[13px] text-ink-3">{r.rollNo ?? i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.name}</span>
                        <span className={cn('t-caption block truncate', r.remark ? 'text-ink-2' : 'text-ink-3')}>{r.remark ?? r.areasToImprove ?? r.conduct ?? 'No remark yet'}</span>
                      </span>
                      <StatusChip status={chip.status} label={chip.label} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          {written < rows.length && (
            <CardBody className="t-caption p-0 text-ink-2">Students without a remark simply have none on their report card; nothing blocks publishing.</CardBody>
          )}
        </div>
      )}

      {exam && section && idx >= 0 && (
        <RemarkEditor
          key={rows[idx]!.studentId}
          examId={exam.id}
          sectionId={section.id}
          row={rows[idx]!}
          index={idx}
          total={rows.length}
          editable={!gate.readOnly}
          onClose={() => setOpenId(null)}
          onGo={(i) => setOpenId(rows[i]!.studentId)}
        />
      )}

      <ConfirmDialog
        open={publishAsk}
        onOpenChange={setPublishAsk}
        title={`Publish ${plural(drafts, 'remark')}?`}
        description={`Parents and students of ${section ? secLabel(section.gradeName, section.name) : 'this class'} will see these remarks on the report card for ${exam?.name ?? 'this exam'}. Editing a remark afterwards takes it back to draft until you publish again.`}
        confirmLabel="Publish remarks"
        loading={publish.isPending}
        onConfirm={() => void doPublish()}
      />
    </>
  );
}

/* ───────────────────────── one student's remarks ───────────────────────── */

const LIMITS = { remark: 1000, areasToImprove: 1000, conduct: 200 } as const;

function RemarkEditor({ examId, sectionId, row, index, total, editable, onClose, onGo }: { examId: string; sectionId: string; row: RemarkRow; index: number; total: number; editable: boolean; onClose: () => void; onGo: (i: number) => void }) {
  const save = useSaveRemark(examId, sectionId);
  const qc = useQueryClient();
  const form = useZodForm(reportRemarkIn, { defaultValues: { remark: row.remark ?? '', areasToImprove: row.areasToImprove ?? '', conduct: row.conduct ?? '' } });
  const [formError, setFormError] = React.useState<string | null>(null);
  const dirty = form.formState.isDirty;
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Discard these remarks?', description: 'You have remarks that have not been saved. If you leave now they will be lost.', confirmLabel: 'Discard' });
  const w = form.watch();
  const state = remarkState(row);

  const submit = (then: 'stay' | 'next') =>
    form.handleSubmit(async (v) => {
      setFormError(null);
      const body = { remark: v.remark?.trim() || null, areasToImprove: v.areasToImprove?.trim() || null, conduct: v.conduct?.trim() || null };
      if (!body.remark && !body.areasToImprove && !body.conduct) {
        setFormError('Write at least a remark, an area to improve or a conduct note.');
        return;
      }
      try {
        await save.mutateAsync({ studentId: row.studentId, body });
        toast.success(`Saved remarks for ${row.name}`, { description: 'Saved as a draft until it is published.' });
        // the form is clean again; then either move on or stay
        form.reset({ remark: body.remark ?? '', areasToImprove: body.areasToImprove ?? '', conduct: body.conduct ?? '' });
        if (then === 'next' && index < total - 1) onGo(index + 1);
        else if (then === 'next') onClose();
      } catch (e) {
        setFormError(applyApiErrors(form, e) ?? teacherError(e));
        if (isOutOfScope(e)) void qc.invalidateQueries({ queryKey: mk.remarks(examId, sectionId) });
      }
    });

  const close = () => guard(onClose);
  const go = (i: number) => guard(() => onGo(i));

  return (
    <>
      <Drawer open onOpenChange={(o) => !o && close()}>
        <DrawerContent title={row.name} description={`Roll ${row.rollNo ?? '—'} · ${row.admissionNo}`} showTitle onInteractOutside={(e) => { if (dirty) { e.preventDefault(); close(); } }} onEscapeKeyDown={(e) => { if (dirty) { e.preventDefault(); close(); } }}>
          <form onSubmit={(e) => void submit('stay')(e)} noValidate>
            <SheetBody>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={CHIP[state].status} label={CHIP[state].label} />
                {row.updatedAt && state !== 'none' && <span className="t-caption text-ink-2">Last saved {fmtDateTime(row.updatedAt)}</span>}
              </div>
              {state === 'published' && editable && <Banner tone="info">Families can already see this remark. Saving a change takes it back to draft until you publish again.</Banner>}
              <FormTextarea control={form.control} name="remark" label="Remark" hint={`${(w.remark ?? '').length}/${LIMITS.remark}`} rows={5} maxLength={LIMITS.remark} disabled={!editable} placeholder="How the student did this term, in a few sentences" />
              <FormTextarea control={form.control} name="areasToImprove" label="Areas to improve" hint={`${(w.areasToImprove ?? '').length}/${LIMITS.areasToImprove}`} rows={3} maxLength={LIMITS.areasToImprove} disabled={!editable} placeholder="One or two things to work on" />
              <FormInput control={form.control} name="conduct" label="Conduct" hint={`${(w.conduct ?? '').length}/${LIMITS.conduct}`} maxLength={LIMITS.conduct} disabled={!editable} placeholder="For example: Excellent, Satisfactory" />
              {formError && <Banner tone="danger">{formError}</Banner>}
            </SheetBody>
            <SheetFooter className="justify-between">
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => go(index - 1)} disabled={index <= 0} aria-label="Previous student">
                  <ChevronLeft /> Previous
                </Button>
                <span className="t-caption tnum text-ink-2" aria-live="polite">
                  {index + 1} of {total}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => go(index + 1)} disabled={index >= total - 1} aria-label="Next student">
                  Next <ChevronRight />
                </Button>
              </div>
              {editable && (
                <div className="flex items-center gap-2">
                  <Button type="submit" variant="secondary" loading={form.formState.isSubmitting} disabled={!dirty}>
                    Save
                  </Button>
                  <Button type="button" onClick={() => void submit('next')()} disabled={!dirty || form.formState.isSubmitting}>
                    {index < total - 1 ? 'Save & next' : 'Save & close'}
                  </Button>
                </div>
              )}
            </SheetFooter>
          </form>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}
