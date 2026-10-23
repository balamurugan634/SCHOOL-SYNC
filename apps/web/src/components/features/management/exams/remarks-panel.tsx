'use client';

import * as React from 'react';
import { FileDown, Pencil, Send } from 'lucide-react';
import { reportRemarkIn, type ExamOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormInput, FormSection, FormTextarea } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { Select, type SelectOption } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { bff } from '@/lib/client/fetcher';
import { examErrorMessage, useExamMutation, useExamSections, useRemarks, type ReportRemarkRow } from '@/lib/client/exams-admin';
import { sectionOptions } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { downloadFile } from '@/lib/client/transfer';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { applyApiErrors, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useFriendlyForm } from './friendly-form';
import { fmtDate, plural } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ErrorPanel, PersonCell } from '../shared/detail';

type RemarkState = 'published' | 'draft' | 'empty';
const stateOf = (r: ReportRemarkRow): RemarkState => (r.publishedAt ? 'published' : r.remark || r.areasToImprove || r.conduct ? 'draft' : 'empty');

function RemarkChip({ r }: { r: ReportRemarkRow }) {
  const s = stateOf(r);
  return s === 'published' ? <Badge variant="success">Published</Badge> : s === 'draft' ? <Badge variant="warning">Draft</Badge> : <Badge variant="neutral">Not written</Badge>;
}

/**
 * Class-teacher remarks for one exam and class: who has written, who is published, publish drafts so families see them on the report card,
 * and (for roles with report_cards:edit at school scope) write or fix a student's remarks. Used on the exam page and on the Report cards page.
 */
export function RemarksPanel({ exam }: { exam: ExamOut }) {
  const access = useAccess();
  const sections = useExamSections(exam.academicYearId);
  const [p, set] = useUrlState({ section: '' });
  const sectionId = p.section || sections.data?.[0]?.id || '';
  const q = useRemarks(exam.id, sectionId);
  const section = sections.data?.find((s) => s.id === sectionId);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [edit, setEdit] = React.useState<ReportRemarkRow | null>(null);
  const [publish, setPublish] = React.useState<{ ids?: string[]; count: number } | null>(null);

  const rows = q.data ?? [];
  const drafts = rows.filter((r) => stateOf(r) === 'draft');
  const canPublish = access.can('report_cards:publish');
  const canEdit = access.can('report_cards:edit', 'school');

  const pub = useExamMutation((v: { ids?: string[] }) => bff<{ published: number }>(`/report-cards/${exam.id}/publish`, { method: 'POST', body: v.ids ? { studentIds: v.ids } : { sectionId } }), {
    success: (r) => `Published remarks for ${plural(r.published, 'student')}`,
    onSuccess: () => setSel(new Set()),
  });

  const columns: Column<ReportRemarkRow>[] = [
    { id: 'student', header: 'Student', mobile: 'title', cell: (r) => <PersonCell name={r.name} sub={`${r.admissionNo}${r.rollNo ? ` · Roll ${r.rollNo}` : ''}`} /> },
    { id: 'remark', header: 'Remark', mobile: 'sub', className: 'max-w-[22rem]', cell: (r) => <span className="line-clamp-2 whitespace-normal text-ink-2">{r.remark ?? <span className="text-ink-3">—</span>}</span> },
    { id: 'improve', header: 'To improve', mobile: 'hide', defaultHidden: true, className: 'max-w-[16rem]', cell: (r) => <span className="line-clamp-2 whitespace-normal text-ink-2">{r.areasToImprove ?? '—'}</span> },
    { id: 'conduct', header: 'Conduct', mobile: 'detail', cell: (r) => r.conduct ?? '—' },
    { id: 'status', header: 'Status', mobile: 'status', cell: (r) => <RemarkChip r={r} /> },
    { id: 'updated', header: 'Updated', mobile: 'hide', defaultHidden: true, cell: (r) => (r.updatedAt ? fmtDate(r.updatedAt) : '—') },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      label: 'Actions',
      hideable: false,
      align: 'right',
      mobile: 'hide',
      cell: (r) => (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <IconButton label={`Edit remarks of ${r.name}`} size="icon-sm" onClick={() => setEdit(r)} disabled={!access.ok('report_cards:edit', 'school')}>
              <Pencil />
            </IconButton>
          )}
          {access.can('report_cards:view', 'assigned') && (
            <IconButton
              label={`Download report card of ${r.name}`}
              size="icon-sm"
              onClick={async () => {
                try {
                  await downloadFile(`/report-cards/${exam.id}/students/${r.studentId}/pdf`, undefined, `report-card-${r.admissionNo}.pdf`);
                } catch (e) {
                  toast.error(examErrorMessage(e), { duration: 8000 });
                }
              }}
            >
              <FileDown />
            </IconButton>
          )}
        </span>
      ),
    },
  ];

  const picker = <Select aria-label="Class" className="min-w-[10rem] sm:w-auto" value={sectionId} onValueChange={(v) => { set({ section: v }); setSel(new Set()); }} options={sectionOptions(sections.data) as SelectOption[]} placeholder="Choose a class" />;

  if (q.isError) {
    return (
      <div className="space-y-4">
        {picker}
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the remarks" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {exam.status === 'draft' && <Banner tone="info">Remarks can be written once the exam is scheduled.</Banner>}
      <DataTable
        id="exam-remarks"
        caption={`Report remarks for ${section ? `${section.gradeName} ${section.name}` : 'the class'}`}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.studentId}
        loading={sections.isPending || q.isPending}
        selectable={canPublish}
        selected={sel}
        onSelectedChange={setSel}
        bulkActions={(picked) => {
          const ids = picked.filter((r) => stateOf(r) === 'draft').map((r) => r.studentId);
          return (
            <Button size="sm" variant="secondary" disabled={ids.length === 0 || !access.ok('report_cards:publish')} onClick={() => setPublish({ ids, count: ids.length })}>
              <Send /> Publish {ids.length || ''} draft{ids.length === 1 ? '' : 's'}
            </Button>
          );
        }}
        filters={picker}
        toolbar={
          canPublish ? (
            <Button variant="secondary" disabled={drafts.length === 0 || !access.ok('report_cards:publish')} title={drafts.length === 0 ? 'No drafts to publish' : access.hint('report_cards:publish')} onClick={() => setPublish({ count: drafts.length })}>
              <Send /> Publish all drafts{drafts.length ? ` (${drafts.length})` : ''}
            </Button>
          ) : undefined
        }
        empty={<EmptyState illustration="empty-generic" title="No students in this class" description="Students appear once they are enrolled in the section." compact />}
      />
      <p className="t-caption text-ink-2">Class teachers write remarks from the teacher app. Remarks stay hidden from families until they are published here; any later edit takes that student’s remarks back to draft.</p>

      <RemarkDrawer exam={exam} row={edit} onClose={() => setEdit(null)} />
      <ConfirmDialog
        open={publish !== null}
        onOpenChange={(o) => !pub.isPending && !o && setPublish(null)}
        title={publish ? `Publish remarks for ${plural(publish.count, 'student')}?` : 'Publish remarks?'}
        description="Families see the class teacher’s remarks on the report card of this exam and are notified. Remarks you have not written are skipped."
        confirmLabel="Publish remarks"
        loading={pub.isPending}
        onConfirm={async () => {
          const r = await pub.run({ ids: publish?.ids });
          if (r.ok) setPublish(null);
        }}
      />
    </div>
  );
}

function RemarkDrawer({ exam, row, onClose }: { exam: ExamOut; row: ReportRemarkRow | null; onClose: () => void }) {
  const form = useFriendlyForm(reportRemarkIn, { defaultValues: { remark: '', areasToImprove: '', conduct: '' } });
  const { guard, dialog } = useUnsavedGuard(hasDirtyFields(form.formState));
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (row) {
      setErr(null);
      form.reset({ remark: row.remark ?? '', areasToImprove: row.areasToImprove ?? '', conduct: row.conduct ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.studentId]);
  const save = useExamMutation((v: Record<string, unknown>) => bff(`/report-cards/${exam.id}/students/${row!.studentId}/remarks`, { method: 'PUT', body: v }), { success: 'Remarks saved as a draft', toastError: false });
  const close = () => guard(onClose);
  return (
    <>
      <Drawer open={row !== null} onOpenChange={(o) => !o && close()}>
        <DrawerContent title={row ? `Remarks for ${row.name}` : 'Remarks'} description="Saving takes this student’s remarks back to draft until you publish them again." showTitle onInteractOutside={(e) => { if (hasDirtyFields(form.formState)) { e.preventDefault(); close(); } }}>
          <form
            noValidate
            onSubmit={form.handleSubmit(async (v) => {
              setErr(null);
              try {
                await save.mutateAsync(v);
                form.reset(v);
                onClose();
              } catch (e) {
                setErr(applyApiErrors(form, e) ? examErrorMessage(e) : null);
              }
            })}
          >
            <SheetBody>
              {err && <Banner tone="danger">{err}</Banner>}
              <FormSection title="Report card text">
                <FormTextarea control={form.control} name="remark" label="Remark" rows={4} maxLength={1000} />
                <FormTextarea control={form.control} name="areasToImprove" label="Areas to improve" rows={3} maxLength={1000} />
                <FormInput control={form.control} name="conduct" label="Conduct" maxLength={200} />
              </FormSection>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
              <Button type="submit" loading={form.formState.isSubmitting}>Save remarks</Button>
            </SheetFooter>
          </form>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}
