'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import type { GradeOut, PromotionApplyOut, PromotionPreviewOut, StudentListItem } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Stepper } from '@/components/ui/stepper';
import { Illustration } from '@/components/illustrations/illustration';
import { useAllSections } from '@/lib/client/academics';
import { sectionLabel, useCurrentYear, useGradeList, useYearList, yearOptions } from '@/lib/client/options';
import { useApplyPromotion, usePromotionPreview, useSectionStudents, type PromotionRequest } from '@/lib/client/promotions';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { errorMessage } from '@/lib/problem';
import { plural } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ErrorPanel } from '../shared/detail';
import { paths } from '../shared/paths';
import { PromotionReview } from './promotion-review';

const STEPS = [
  { id: 'years', label: 'Years and grades' },
  { id: 'students', label: 'Exceptions' },
  { id: 'review', label: 'Review' },
  { id: 'apply', label: 'Confirm' },
];
const GRADUATE = '__graduate__';
const AUTO = '__auto__';

type Choice = 'promote' | 'retain' | 'leave';
interface Exception {
  decision: Choice;
  toSectionId?: string;
}

/** The default ladder of the API: each grade moves to the next higher active grade; the highest graduates. */
function defaultLadder(grades: GradeOut[]): Record<string, string> {
  const active = grades.filter((g) => g.isActive).sort((a, b) => a.ordinal - b.ordinal);
  return Object.fromEntries(grades.map((g) => [g.id, active.find((x) => x.ordinal > g.ordinal)?.id ?? GRADUATE]));
}

export function PromotionsScreen() {
  const access = useAccess();
  const years = useYearList();
  const cur = useCurrentYear();
  const grades = useGradeList();
  const previewM = usePromotionPreview();
  const applyM = useApplyPromotion();

  const [step, setStep] = React.useState(0);
  const [fromId, setFromId] = React.useState('');
  const [toId, setToId] = React.useState('');
  const [ladder, setLadder] = React.useState<Record<string, string> | null>(null);
  const [exceptions, setExceptions] = React.useState<Record<string, Exception>>({});
  const [preview, setPreview] = React.useState<PromotionPreviewOut | null>(null);
  const [previewErr, setPreviewErr] = React.useState<unknown>(null);
  const [result, setResult] = React.useState<PromotionApplyOut | null>(null);
  const [ack, setAck] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [applyErr, setApplyErr] = React.useState<unknown>(null);

  const dirty = !result && (step > 0 || Object.keys(exceptions).length > 0);
  const { dialog } = useUnsavedGuard(dirty, { title: 'Leave the promotion?', description: 'Nothing has been applied yet. If you leave now the choices you made here are lost.', confirmLabel: 'Leave' });

  // sensible defaults once the lookups arrive
  const from = years.data?.find((y) => y.id === fromId) ?? cur.current ?? years.data?.[0];
  const sortedYears = React.useMemo(() => [...(years.data ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate)), [years.data]);
  const toDefault = from ? sortedYears.find((y) => y.startDate > from.startDate) : undefined;
  const to = years.data?.find((y) => y.id === toId) ?? toDefault;
  const gradeLadder = React.useMemo(() => ladder ?? (grades.data ? defaultLadder(grades.data) : {}), [ladder, grades.data]);

  const invalidateResult = () => {
    setPreview(null);
    setPreviewErr(null);
    setAck(false);
  };

  const request = React.useMemo<PromotionRequest | null>(() => {
    if (!from || !to || !grades.data) return null;
    return {
      fromYearId: from.id,
      toYearId: to.id,
      gradeMapping: grades.data.map((g) => ({ fromGradeId: g.id, toGradeId: gradeLadder[g.id] === GRADUATE || !gradeLadder[g.id] ? null : gradeLadder[g.id]! })),
      decisions: Object.entries(exceptions)
        .filter(([, e]) => e.decision !== 'promote' || e.toSectionId)
        .map(([studentId, e]) => ({ studentId, decision: e.decision, ...(e.decision !== 'leave' && e.toSectionId ? { toSectionId: e.toSectionId } : {}) })),
    };
  }, [from, to, grades.data, gradeLadder, exceptions]);

  const runPreview = React.useCallback(async () => {
    if (!request) return;
    setPreviewErr(null);
    const r = await previewM.run(request);
    if (r.ok) setPreview(r.data);
    else {
      setPreview(null);
      setPreviewErr(r.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // entering the review step runs the dry run
  React.useEffect(() => {
    if (step === 2 && !preview && !previewErr && !previewM.isPending) void runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, preview, previewErr]);

  const apply = async () => {
    if (!request) return;
    setApplyErr(null);
    const r = await applyM.run(request);
    setConfirm(false);
    if (r.ok) setResult(r.data);
    else setApplyErr(r.error);
  };

  const loading = years.isPending || grades.isPending || cur.isPending;
  const canApply = access.ok('promotions:approve');
  const fromIsCurrent = !!from && from.id === cur.current?.id;
  const yearsOk = !!from && !!to && from.id !== to.id && to.startDate > from.startDate;

  return (
    <>
      <PageHeader
        title="Year-end promotion"
        description="Move students into the next academic year: up a grade, repeating, or leaving. You preview everything first; nothing changes until you confirm."
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Academics' }, { label: 'Year-end promotion' }]}
      />
      {years.isError || grades.isError ? (
        <ErrorPanel error={years.error ?? grades.error} onRetry={() => { void years.refetch(); void grades.refetch(); }} />
      ) : loading ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : result ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
            <Illustration name="success" className="w-48" title="Promotion applied" />
            <div>
              <h2 className="t-section">Promotion applied</h2>
              <p className="mt-1 max-w-[56ch] text-sm text-ink-2">
                {result.fromYear.name} → {result.toYear.name}: {plural(result.enrolled, 'student')} enrolled in the new year, {result.alumni} became alumni and {result.withdrawn} {result.withdrawn === 1 ? 'was' : 'were'} withdrawn.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild><Link href={paths.students()}>View students</Link></Button>
              <Button asChild variant="secondary"><Link href={paths.classes}>View classes and sections</Link></Button>
              <Button asChild variant="secondary"><Link href={paths.years}>Make {result.toYear.name} the current year</Link></Button>
            </div>
            <p className="t-caption max-w-[56ch] text-ink-3">The promotion does not switch the current academic year. Do that from Academic years when the new year begins.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          <Stepper steps={STEPS} current={step} />

          {step === 0 && (
            <StepYears
              years={yearOptions(sortedYears)}
              fromId={from?.id ?? ''}
              toId={to?.id ?? ''}
              onFrom={(v) => { setFromId(v); setToId(''); setExceptions({}); invalidateResult(); }}
              onTo={(v) => { setToId(v); invalidateResult(); }}
              yearsOk={yearsOk}
              hasOtherYear={sortedYears.length >= 2}
              grades={grades.data ?? []}
              ladder={gradeLadder}
              onLadder={(g, v) => { setLadder({ ...gradeLadder, [g]: v }); invalidateResult(); }}
              onResetLadder={() => { setLadder(null); invalidateResult(); }}
            />
          )}
          {step === 1 && from && to && (
            <StepStudents
              fromYearId={from.id}
              toYearId={to.id}
              toYearName={to.name}
              fromIsCurrent={fromIsCurrent}
              grades={grades.data ?? []}
              ladder={gradeLadder}
              exceptions={exceptions}
              onChange={(next) => { setExceptions(next); invalidateResult(); }}
            />
          )}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-2">A dry run: it shows who goes where and what would block the promotion. It changes nothing.</p>
                <Button variant="secondary" size="sm" onClick={() => { invalidateResult(); void runPreview(); }} loading={previewM.isPending}>
                  <RefreshCw /> Refresh preview
                </Button>
              </div>
              {previewM.isPending && !preview ? (
                <div className="space-y-4" aria-busy>
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <StatSkeleton key={i} />)}</div>
                  <Skeleton className="h-64 w-full rounded-lg" />
                </div>
              ) : previewErr ? (
                <ErrorPanel error={previewErr} onRetry={() => void runPreview()} title="We couldn’t build the preview" />
              ) : preview ? (
                <PromotionReview preview={preview} />
              ) : null}
            </div>
          )}
          {step === 3 && preview && (
            <StepConfirm preview={preview} canApply={canApply} hint={access.hint('promotions:approve')} ack={ack} onAck={setAck} error={applyErr} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || applyM.isPending}>
              <ArrowLeft /> Back
            </Button>
            {step < 3 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={(step === 0 && !yearsOk) || (step === 2 && (!preview || !preview.canApply))}
                title={step === 0 && !yearsOk ? 'Pick two different years, the second starting after the first' : step === 2 && preview && !preview.canApply ? 'Fix the problems in the preview first' : undefined}
              >
                {step === 0 ? 'Next: exceptions' : step === 1 ? 'Next: review the preview' : 'Next: confirm'} <ArrowRight />
              </Button>
            ) : (
              <Button variant="primary" disabled={!canApply || !ack || !preview?.canApply || access.readOnly} onClick={() => setConfirm(true)} title={!canApply ? access.hint('promotions:approve') : !ack ? 'Tick the box to confirm you have reviewed it' : undefined}>
                Apply promotion
              </Button>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => !applyM.isPending && setConfirm(o)}
        title={preview ? `Promote ${preview.fromYear.name} into ${preview.toYear.name}?` : 'Apply the promotion?'}
        description={
          preview && (
            <div className="space-y-2">
              <p>
                {plural(preview.totals.newSeats, 'student')} get a new enrolment, {plural(preview.totals.graduate, 'student')} become alumni and {plural(preview.totals.leave, 'student')} are withdrawn, with their logins switched off.
              </p>
              <p className="font-medium text-ink">There is no undo button for this. Corrections afterwards are done student by student.</p>
            </div>
          )
        }
        confirmLabel="Apply promotion"
        destructive
        loading={applyM.isPending}
        onConfirm={() => void apply()}
      />
      {dialog}
    </>
  );
}

function StatSkeleton() {
  return <Skeleton className="h-[108px] w-full rounded-lg" />;
}

// ── step 1 ───────────────────────────────────────────────────────────────────────────────────────
function StepYears({ years, fromId, toId, onFrom, onTo, yearsOk, hasOtherYear, grades, ladder, onLadder, onResetLadder }: { years: SelectOption[]; fromId: string; toId: string; onFrom: (v: string) => void; onTo: (v: string) => void; yearsOk: boolean; hasOtherYear: boolean; grades: GradeOut[]; ladder: Record<string, string>; onLadder: (g: string, v: string) => void; onResetLadder: () => void }) {
  const active = grades.filter((g) => g.isActive);
  if (!hasOtherYear) {
    return (
      <Card>
        <EmptyState illustration="empty-events" title="Create next year first" description="A promotion needs two academic years: the one students leave and the one they join. Add the next year, then copy last year’s sections into it." action={<Button asChild size="sm"><Link href={paths.years}>Open academic years</Link></Button>} compact />
      </Card>
    );
  }
  const toGradeOptions: SelectOption[] = [...active.map((g) => ({ value: g.id, label: g.name })), { value: GRADUATE, label: 'Graduates (becomes alumni)' }];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card>
        <CardHeader title="Which years?" description="Students move from the first year into the second." />
        <CardBody className="space-y-4 pt-4">
          <div className="space-y-1.5">
            <label htmlFor="promo-from" className="t-label block">Promote from</label>
            <Select id="promo-from" value={fromId} onValueChange={onFrom} options={years} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="promo-to" className="t-label block">Into</label>
            <Select id="promo-to" value={toId} onValueChange={onTo} options={years} placeholder="Choose the new year" />
          </div>
          {!yearsOk && <Banner tone="warning">Pick two different years, with the second starting after the first.</Banner>}
          <p className="t-caption text-ink-2">The new year needs sections for each grade students move into. Copy last year’s sections from Academic years if it has none yet; the preview tells you.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Grade ladder" description="Where each grade’s students go. Change a row to skip a grade or graduate earlier." action={<Button variant="ghost" size="sm" onClick={onResetLadder}>Reset</Button>} />
        <CardBody className="pt-4">
          {active.length === 0 ? (
            <p className="text-sm text-ink-2">No active grades.</p>
          ) : (
            <ul className="divide-y divide-border" aria-label="Grade ladder">
              {active.map((g) => (
                <li key={g.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 sm:grid-cols-[8rem_auto_minmax(0,1fr)]">
                  <span className="text-sm font-medium">{g.name}</span>
                  <ArrowRight className="hidden size-4 text-ink-3 sm:block" aria-hidden />
                  <Select aria-label={`Where ${g.name} students go`} className="col-span-2 sm:col-span-1" value={ladder[g.id] ?? GRADUATE} onValueChange={(v) => onLadder(g.id, v)} options={toGradeOptions} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ── step 2 ───────────────────────────────────────────────────────────────────────────────────────
function StepStudents({ fromYearId, toYearId, toYearName, fromIsCurrent, grades, ladder, exceptions, onChange }: { fromYearId: string; toYearId: string; toYearName: string; fromIsCurrent: boolean; grades: GradeOut[]; ladder: Record<string, string>; exceptions: Record<string, Exception>; onChange: (e: Record<string, Exception>) => void }) {
  const fromSections = useAllSections({ yearId: fromYearId });
  const toSections = useAllSections({ yearId: toYearId });
  const [sectionId, setSectionId] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(50);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const sid = sectionId || fromSections.data?.[0]?.id || '';
  const students = useSectionStudents(sid || null, page, size, fromIsCurrent);
  const count = Object.keys(exceptions).length;
  const gradeName = (id: string) => grades.find((g) => g.id === id)?.name ?? '';

  const set = (ids: string[], e: Exception | null) => {
    const next = { ...exceptions };
    for (const id of ids) {
      if (!e || (e.decision === 'promote' && !e.toSectionId)) delete next[id];
      else next[id] = e;
    }
    onChange(next);
  };

  const targetGradeOf = (s: StudentListItem, d: Choice): string | null => {
    if (d === 'leave' || !s.gradeId) return null;
    if (d === 'retain') return s.gradeId;
    const t = ladder[s.gradeId];
    return !t || t === GRADUATE ? null : t;
  };

  const sectionOptionsFor = (gradeId: string | null): SelectOption[] => [{ value: AUTO, label: 'Automatic' }, ...(toSections.data ?? []).filter((x) => x.gradeId === gradeId).map((x) => ({ value: x.id, label: `${sectionLabel(x)}${x.capacity ? ` · ${x.studentCount}/${x.capacity}` : ''}` }))];

  return (
    <div className="space-y-4">
      <Banner tone="info" title="Everyone is promoted unless you say otherwise">
        Use this step only for exceptions: students who repeat the year, or who are leaving. You can also place a student in a particular {toYearName} section; everyone else is placed automatically, keeping their section name where one exists.
      </Banner>
      {!fromIsCurrent ? (
        <Card>
          <EmptyState title="Exceptions are set from the current year" description="The student list shows each student’s current enrolment, so per-student choices are only available when promoting from the current academic year. The grade ladder still applies to everyone." compact />
        </Card>
      ) : fromSections.isError ? (
        <ErrorPanel error={fromSections.error} onRetry={() => void fromSections.refetch()} />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full sm:w-60">
              <label htmlFor="promo-section" className="t-label mb-1.5 block">Section</label>
              <Select id="promo-section" value={sid} onValueChange={(v) => { setSectionId(v); setPage(1); setSel(new Set()); }} options={(fromSections.data ?? []).map((s) => ({ value: s.id, label: `${sectionLabel(s)} · ${s.studentCount}` }))} placeholder={fromSections.isPending ? 'Loading sections…' : 'No sections'} disabled={fromSections.isPending} />
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm" aria-live="polite">{count === 0 ? 'No exceptions yet' : <><span className="font-medium">{plural(count, 'exception')}</span> in total</>}</p>
              {count > 0 && <Button variant="ghost" size="sm" onClick={() => onChange({})}>Clear all</Button>}
            </div>
          </div>
          {toSections.data && toSections.data.length === 0 && <Banner tone="warning">{toYearName} has no sections yet, so students cannot be placed. Copy last year’s sections from Academic years before you apply.</Banner>}
          <DataTable
            id="promotion-students"
            caption="Students of the selected section"
            rows={students.data?.data}
            rowKey={(s) => s.id}
            loading={students.isPending && !!sid}
            error={students.error}
            onRetry={() => void students.refetch()}
            page={page}
            pageSize={size}
            total={students.data?.meta.total}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setSize(n); setPage(1); }}
            selectable
            selected={sel}
            onSelectedChange={setSel}
            bulkActions={(rows, clear) => (
              <>
                <Button size="sm" variant="secondary" onClick={() => { set(rows.map((r) => r.id), { decision: 'retain' }); clear(); }}>Stay in grade</Button>
                <Button size="sm" variant="secondary" onClick={() => { set(rows.map((r) => r.id), { decision: 'leave' }); clear(); }}>Leaving the school</Button>
                <Button size="sm" variant="ghost" onClick={() => { set(rows.map((r) => r.id), null); clear(); }}>Reset to promote</Button>
              </>
            )}
            empty={<EmptyState title="No students in this section" description="Choose another section." compact />}
            columns={[
              { id: 'name', header: 'Student', hideable: false, cell: (s) => <span className="font-medium">{s.name}</span>, mobile: 'title' },
              { id: 'adm', header: 'Admission no.', cell: (s) => <span className="font-mono text-[13px]">{s.admissionNo}</span>, mobile: 'sub' },
              { id: 'roll', header: 'Roll', cell: (s) => s.rollNo ?? '—', className: 'w-16', mobile: 'hide' },
              {
                id: 'decision',
                header: 'Decision',
                mobile: 'detail',
                label: 'Decision',
                cell: (s) => (
                  <Select
                    aria-label={`Decision for ${s.name}`}
                    className="min-w-36"
                    value={exceptions[s.id]?.decision ?? 'promote'}
                    onValueChange={(v) => set([s.id], { decision: v as Choice, toSectionId: v === 'leave' ? undefined : exceptions[s.id]?.toSectionId })}
                    options={[
                      { value: 'promote', label: 'Promote' },
                      { value: 'retain', label: `Stay in ${s.gradeName ?? gradeName(s.gradeId ?? '') ?? 'grade'}` },
                      { value: 'leave', label: 'Leaves the school' },
                    ]}
                  />
                ),
              },
              {
                id: 'section',
                header: `Section in ${toYearName}`,
                label: 'New section',
                mobile: 'detail',
                cell: (s) => {
                  const d = exceptions[s.id]?.decision ?? 'promote';
                  const target = targetGradeOf(s, d);
                  if (d === 'leave') return <span className="text-ink-3">Withdrawn</span>;
                  if (!target) return <span className="text-ink-2">Graduates</span>;
                  return (
                    <Select
                      aria-label={`${toYearName} section for ${s.name}`}
                      className="min-w-44"
                      value={exceptions[s.id]?.toSectionId ?? AUTO}
                      onValueChange={(v) => set([s.id], { decision: d, toSectionId: v === AUTO ? undefined : v })}
                      options={sectionOptionsFor(target)}
                    />
                  );
                },
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

// ── step 4 ───────────────────────────────────────────────────────────────────────────────────────
function StepConfirm({ preview, canApply, hint, ack, onAck, error }: { preview: PromotionPreviewOut; canApply: boolean; hint?: string; ack: boolean; onAck: (v: boolean) => void; error: unknown }) {
  const t = preview.totals;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader title="What applying does" description={`${preview.fromYear.name} → ${preview.toYear.name}`} />
        <CardBody className="pt-4">
          <ul className="space-y-3 text-sm">
            <li><span className="font-medium">{plural(t.newSeats, 'student')}</span> get a new enrolment in {preview.toYear.name} ({t.promote} promoted, {t.retain} staying in their grade). Roll numbers continue after the students already in each section, and each one uses a subscription seat for {preview.toYear.name}.</li>
            <li>Their {preview.fromYear.name} enrolments are closed as promoted or retained. History stays on each student’s record.</li>
            <li><span className="font-medium">{plural(t.graduate, 'student')}</span> in the highest grade become alumni: archived, removed from sections, login switched off and devices signed out.</li>
            <li><span className="font-medium">{plural(t.leave, 'student')}</span> marked as leaving are withdrawn in the same way.</li>
            {t.alreadyEnrolled > 0 && <li>{plural(t.alreadyEnrolled, 'student')} already enrolled in {preview.toYear.name} are skipped.</li>}
            <li>The current academic year is <span className="font-medium">not</span> changed. Do that from Academic years when the new year starts.</li>
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Confirm" />
        <CardBody className="space-y-4 pt-4">
          <Banner tone="warning" title="This is hard to undo">
            Enrolments, section numbers and logins change for many students at once. There is no undo button; mistakes are fixed one student at a time.
          </Banner>
          {!canApply && <Banner tone="info" title="You can preview, not apply">{hint ?? 'Applying a promotion needs the Promotions: approve permission, which the principal and school administrators hold.'}</Banner>}
          <div className="flex items-start gap-2.5">
            <Checkbox id="promo-ack" checked={ack} onCheckedChange={(v) => onAck(v === true)} disabled={!canApply} className="mt-0.5" />
            <label htmlFor="promo-ack" className="text-sm">I have reviewed the preview and understand that this changes enrolments and switches off logins.</label>
          </div>
          {error != null && <Banner tone="danger" title="The promotion was not applied" role="alert">{errorMessage(error)}</Banner>}
        </CardBody>
      </Card>
    </div>
  );
}
