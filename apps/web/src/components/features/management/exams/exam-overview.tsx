'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Trash2 } from 'lucide-react';
import type { ExamOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Stepper } from '@/components/ui/stepper';
import { bff } from '@/lib/client/fetcher';
import { useExamMutation, useGradeScales } from '@/lib/client/exams-admin';
import { fmtDate, plural } from '@/lib/format';
import { useAccess } from '../shared/access';
import { DefList, Panel } from '../shared/detail';
import { GenerateSheetsButton } from './generate-dialog';
import { paths } from '../shared/paths';
import { dateRange, EXAM_STEPS, EXAM_TYPE_LABEL } from './meta';

type Verb = 'schedule' | 'open-marks' | 'start-review' | 'publish';

interface NextStep {
  verb: Verb;
  title: string;
  label: string;
  description: string;
  consequence: React.ReactNode;
  blocked?: string;
  perm: 'exams:edit' | 'exams:publish';
}

function nextStep(e: ExamOut): NextStep | null {
  const s = e.sheets;
  const pending = s ? s.total - s.approved - s.published : 0;
  switch (e.status) {
    case 'draft':
      return {
        verb: 'schedule',
        title: 'Schedule the exam',
        label: 'Schedule exam',
        description: 'Share the timetable with students, parents and teachers.',
        consequence: (
          <>
            The schedule becomes visible to the students and parents of the graded papers, and to teachers. They get a notification. You can still add or change papers until the exam goes under review.
          </>
        ),
        blocked: e.paperCount === 0 ? 'Add at least one paper in the Schedule tab first.' : undefined,
        perm: 'exams:edit',
      };
    case 'scheduled':
      return {
        verb: 'open-marks',
        title: 'Open marks entry',
        label: 'Open marks entry',
        description: 'Let subject teachers enter marks on their mark sheets.',
        consequence: <>Subject teachers are notified and can start entering marks. Generate the mark sheets first (Mark sheets tab) so each teacher has a sheet to fill in.</>,
        perm: 'exams:edit',
      };
    case 'marks_entry':
      return {
        verb: 'start-review',
        title: 'Start review',
        label: 'Start review',
        description: 'Move the exam to review once teachers have submitted their marks.',
        consequence: <>The exam is marked as under review and its schedule is locked. Submitted sheets can then be approved or returned from the review queue.</>,
        perm: 'exams:edit',
      };
    case 'under_review':
    case 'published':
      return e.status === 'published'
        ? null
        : {
            verb: 'publish',
            title: 'Publish results',
            label: 'Publish exam',
            description: pending > 0 ? `${plural(pending, 'mark sheet')} still need approval before they can be published.` : 'Every sheet is approved and ready to publish.',
            consequence: PUBLISH_TEXT,
            perm: 'exams:publish',
          };
    default:
      return null;
  }
}

export function ExamOverview({ exam, onEdit, goTab }: { exam: ExamOut; onEdit: () => void; goTab: (tab: string) => void }) {
  const router = useRouter();
  const access = useAccess();
  const scales = useGradeScales();
  const step = nextStep(exam);
  // marks_entry can be published directly too (the API allows marks_entry or under_review)
  const canPublishFromEntry = exam.status === 'marks_entry';
  const [confirm, setConfirm] = React.useState<Verb | null>(null);
  const [force, setForce] = React.useState(false);
  const [forceMissing, setForceMissing] = React.useState(false);
  const [del, setDel] = React.useState(false);
  const s = exam.sheets;
  const pending = s ? s.total - s.approved - s.published : 0;
  const scale = scales.data?.find((g) => g.id === exam.gradeScaleId);

  const transition = useExamMutation((v: { verb: Verb; force?: boolean }) => bff<ExamOut>(`/exams/${exam.id}/${v.verb}`, { method: 'POST', body: v.verb === 'publish' ? { force: v.force ?? false } : undefined }), {
    success: (_r, v) => ({ schedule: 'Exam scheduled', 'open-marks': 'Marks entry is open', 'start-review': 'Exam is under review', publish: 'Exam published' })[v.verb],
  });
  const remove = useExamMutation(() => bff(`/exams/${exam.id}`, { method: 'DELETE' }), { success: `Deleted ${exam.name}`, invalidate: [['exams', 'list'], ['exams', 'picker'], ['dashboard']] });

  const stepIndex = EXAM_STEPS.findIndex((x) => x.id === exam.status);
  const act = (verb: Verb) => {
    setForce(false);
    setForceMissing(false);
    setConfirm(verb);
  };
  const canDelete = access.can('exams:delete') && (exam.status === 'draft' || exam.status === 'scheduled') && (s?.total ?? 0) === 0;
  const publishNeedsForce = confirm === 'publish' && pending > 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        <Panel title="Where this exam is" description="Each step is done by an administrator; marks are entered by subject teachers.">
          <div className="overflow-x-auto pb-1">
            <Stepper steps={EXAM_STEPS} current={stepIndex} className="min-w-[30rem]" />
          </div>
        </Panel>

        {exam.status === 'published' ? (
          <Banner tone="success" title="Results are published">
            {exam.publishedAt ? `Published ${fmtDate(exam.publishedAt)}. ` : ''}Marks are visible to students and verified guardians. Corrections go through the mark sheet with a reason, and families are notified.
          </Banner>
        ) : (
          step && (
            <Panel title={step.title} description={step.description}>
              <p className="text-sm text-ink-2">{step.consequence}</p>
              {step.blocked && <Banner tone="warning" className="mt-3">{step.blocked}</Banner>}
              {exam.status === 'scheduled' && (s?.total ?? 0) === 0 && (
                <Banner tone="info" className="mt-3">
                  No mark sheets exist yet. Generate them (Mark sheets panel) so teachers have something to fill in.
                </Banner>
              )}
              {pending > 0 && step.verb === 'publish' && (
                <Banner tone="warning" className="mt-3" action={<Button size="sm" variant="secondary" onClick={() => router.push(paths.exam(exam.id, 'sheets'))}>Review sheets</Button>}>
                  {plural(pending, 'sheet')} not approved yet (draft, submitted or returned). They stay hidden from students if you publish now.
                </Banner>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {access.can(step.perm) || (step.verb === 'publish' && access.can('marks:publish', 'school')) ? (
                  <Button onClick={() => act(step.verb)} disabled={!access.ok(step.perm) || !!step.blocked || (step.verb === 'publish' && !access.can('marks:publish', 'school'))} title={step.blocked ?? access.hint(step.perm)}>
                    {step.label} <ArrowRight />
                  </Button>
                ) : (
                  <p className="t-caption text-ink-2">Your role cannot {step.label.toLowerCase()}. Ask an administrator or the principal.</p>
                )}
                {canPublishFromEntry && access.can('exams:publish') && access.can('marks:publish', 'school') && (
                  <Button variant="secondary" onClick={() => act('publish')} disabled={!access.ok('exams:publish')} title={access.hint('exams:publish')}>
                    Publish now, skip review
                  </Button>
                )}
              </div>
            </Panel>
          )
        )}

        {exam.status !== 'draft' && (
          <Panel
            title="Mark sheets"
            description={s && s.total > 0 ? `${plural(s.total, 'sheet')} across all classes and subjects` : 'One sheet per class and subject, filled in by the subject teacher.'}
            actions={
              <div className="flex flex-wrap justify-end gap-2">
                <GenerateSheetsButton exam={exam} />
                {access.can('marks:view', 'assigned') && s && s.total > 0 && (
                  <Button variant="secondary" size="sm" onClick={() => goTab('sheets')}>
                    Open sheets
                  </Button>
                )}
              </div>
            }
          >
            {s && s.total > 0 ? (
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {(
                  [
                    ['Draft', s.draft],
                    ['Submitted', s.submitted],
                    ['Approved', s.approved],
                    ['Returned', s.returned],
                    ['Published', s.published],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label}>
                    <dt className="t-caption text-ink-2">{label}</dt>
                    <dd className="figure text-[28px] leading-9">{n}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-ink-2">No mark sheets exist yet.{exam.status === 'published' ? '' : ' Generate them so teachers have something to fill in.'}</p>
            )}
          </Panel>
        )}
      </div>

      <div className="min-w-0 space-y-6">
        <Panel title="Details" actions={exam.status !== 'published' && access.can('exams:edit') ? <Button variant="secondary" size="sm" onClick={onEdit} disabled={!access.ok('exams:edit')} title={access.hint('exams:edit')}>Edit</Button> : undefined}>
          <DefList
            items={[
              { label: 'Type', value: EXAM_TYPE_LABEL[exam.examType] },
              { label: 'Academic year', value: exam.academicYearName },
              { label: 'Term', value: exam.termName },
              { label: 'Dates', value: dateRange(exam.startDate, exam.endDate, (x) => fmtDate(x)) },
              { label: 'Pass percentage', value: `${exam.passPercent}%` },
              { label: 'Grade scale', value: scale ? (scale.isDefault ? `${scale.name}, default` : scale.name) : exam.gradeScaleId ? '…' : 'School default' },
              { label: 'Papers', value: exam.paperCount },
              { label: 'Published', value: exam.publishedAt ? fmtDate(exam.publishedAt) : null },
            ]}
          />
        </Panel>
        {canDelete && (
          <Panel title="Delete exam" description="Only possible before any mark sheets exist.">
            <Button variant="danger" onClick={() => setDel(true)} disabled={!access.ok('exams:delete')} title={access.hint('exams:delete')}>
              <Trash2 /> Delete exam
            </Button>
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !transition.isPending && setConfirm(null)}
        title={confirm ? `${TITLES[confirm]}?` : ''}
        description={
          <div className="space-y-3">
            <p>{confirm === 'publish' ? PUBLISH_TEXT : confirm === step?.verb ? step.consequence : null}</p>
            {publishNeedsForce && (
              <label className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-ink">
                <Checkbox checked={force} onCheckedChange={(v) => { setForce(v === true); setForceMissing(false); }} className="mt-0.5" aria-label="Publish even though some sheets are not approved" />
                <span>
                  Publish anyway. {plural(pending, 'mark sheet')} {pending === 1 ? 'is' : 'are'} not approved and will stay hidden from students and parents.
                </span>
              </label>
            )}
            {publishNeedsForce && forceMissing && !force && (
              <p role="alert" className="t-caption text-danger">
                Tick the box to publish anyway, or cancel and review the remaining sheets first.
              </p>
            )}
          </div>
        }
        confirmLabel={confirm === 'publish' ? 'Publish' : confirm ? TITLES[confirm] : 'Continue'}
        destructive={confirm === 'publish'}
        loading={transition.isPending}
        onConfirm={async () => {
          if (!confirm) return;
          if (publishNeedsForce && !force) return setForceMissing(true);
          const r = await transition.run({ verb: confirm, force });
          if (r.ok) setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={del}
        onOpenChange={(o) => !remove.isPending && setDel(o)}
        title={`Delete ${exam.name}?`}
        description={`This removes the exam and its ${plural(exam.paperCount, 'paper')}. It cannot be undone. Students and teachers lose the schedule they may already have seen.`}
        confirmLabel="Delete exam"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          const r = await remove.run();
          if (r.ok) router.replace('/admin/exams');
        }}
      />
    </div>
  );
}

const TITLES: Record<Verb, string> = { schedule: 'Schedule exam', 'open-marks': 'Open marks entry', 'start-review': 'Start review', publish: 'Publish results' };
const PUBLISH_TEXT = 'Every approved mark sheet is published. Students and their verified guardians can see the marks and are notified. The exam can no longer be edited afterwards; later changes need a correction with a reason.';
