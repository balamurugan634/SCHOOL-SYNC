'use client';

import * as React from 'react';
import Link from 'next/link';
import { Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { acad, useGradeSubjects, useSaveOfferings, useWorkingDays, type GradeOut, type GradeSubjectOut, type SubjectOut } from '@/lib/client/academics';
import { gradeOptions, usePeriodList, useGradeList, useSubjectList } from '@/lib/client/options';
import { errorMessage } from '@/lib/problem';
import { cn } from '@/lib/cn';
import { useAccess } from '../shared/access';
import { ErrorPanel } from '../shared/detail';
import { paths } from '../shared/paths';
import { TYPE_LABEL } from './fields';
import { FormBanner } from './form-shell';

export function OfferingsPanel({ gradeId, onGrade, onDirty }: { gradeId: string; onGrade: (id: string) => void; onDirty: (dirty: boolean) => void }) {
  const grades = useGradeList();
  const gid = gradeId || grades.data?.find((g) => g.isActive)?.id || grades.data?.[0]?.id || '';
  if (grades.isPending) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (grades.isError) return <ErrorPanel error={grades.error} onRetry={() => void grades.refetch()} />;
  if (!grades.data?.length) return <Card><EmptyState illustration="first-use" title="Add a grade first" description="Grade offerings choose subjects per grade, so the school needs at least one grade." action={<Button asChild size="sm"><Link href={paths.classes}>Go to grades</Link></Button>} compact /></Card>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <label htmlFor="offer-grade" className="t-label mb-1.5 block">Grade</label>
          <Select id="offer-grade" value={gid} onValueChange={onGrade} options={gradeOptions(grades.data)} />
        </div>
        <p className="max-w-[56ch] text-sm text-ink-2">Choose the subjects this grade studies and the periods per week for each. Teachers are then assigned per section, and only offered subjects can go on the timetable.</p>
      </div>
      <OfferingsEditor key={gid} gradeId={gid} gradeName={grades.data.find((g) => g.id === gid)?.name ?? ''} otherGrades={grades.data.filter((g) => g.id !== gid)} onDirty={onDirty} />
    </div>
  );
}

function OfferingsEditor({ gradeId, gradeName, otherGrades, onDirty }: { gradeId: string; gradeName: string; otherGrades: GradeOut[]; onDirty: (dirty: boolean) => void }) {
  const access = useAccess();
  const subjects = useSubjectList();
  const offered = useGradeSubjects(gradeId);
  const periods = usePeriodList();
  const days = useWorkingDays();
  const save = useSaveOfferings();
  const [draft, setDraft] = React.useState<Record<string, number> | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [copyFrom, setCopyFrom] = React.useState('');

  const base = React.useMemo(() => Object.fromEntries((offered.data ?? []).map((o: GradeSubjectOut) => [o.subjectId, o.periodsPerWeek])) as Record<string, number>, [offered.data]);
  const current = draft ?? base;
  const dirty = draft !== null && (Object.keys(draft).length !== Object.keys(base).length || Object.entries(draft).some(([k, v]) => base[k] !== v));
  React.useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const rows: SubjectOut[] = React.useMemo(() => {
    const list = subjects.data ?? [];
    // inactive subjects only show up when this grade still offers them (so they can be removed)
    return list.filter((s) => s.isActive || base[s.id] !== undefined);
  }, [subjects.data, base]);

  const total = Object.values(current).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const teachingPeriods = periods.data?.filter((p) => !p.isBreak).length ?? 0;
  const slots = days.data && teachingPeriods ? days.data.length * teachingPeriods : null;
  const canEdit = access.ok('academics:edit');

  const setOn = (id: string, on: boolean) => setDraft((d) => {
    const next = { ...(d ?? base) };
    if (on) next[id] = next[id] ?? 5;
    else delete next[id];
    return next;
  });
  const setPeriods = (id: string, n: number) => setDraft((d) => ({ ...(d ?? base), [id]: n }));

  if (subjects.isPending || offered.isPending) return <Skeleton className="h-80 w-full rounded-lg" />;
  if (subjects.isError) return <ErrorPanel error={subjects.error} onRetry={() => void subjects.refetch()} />;
  if (offered.isError) return <ErrorPanel error={offered.error} onRetry={() => void offered.refetch()} />;
  if (rows.length === 0) return <Card><EmptyState illustration="empty-homework" title="No subjects to offer" description="Add subjects to the catalogue first." action={<Button asChild size="sm" variant="secondary"><Link href="?tab=subjects">Go to subjects</Link></Button>} compact /></Card>;

  const invalid = Object.values(current).some((n) => !Number.isInteger(n) || n < 1 || n > 40);

  return (
    <Card>
      <CardBody className="space-y-4 p-0 sm:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 max-sm:px-4">
          <p className="text-sm" aria-live="polite">
            <span className="font-medium">{Object.keys(current).length}</span> of {rows.length} subjects offered, <span className="font-medium tnum">{total}</span> periods a week
            {slots !== null && <span className={cn('text-ink-2', total > slots && 'text-danger')}> · timetable has {slots} lesson slots a week</span>}
          </p>
          {canEdit && otherGrades.length > 0 && (
            <div className="flex items-center gap-2">
              <Select aria-label="Copy offerings from another grade" className="w-44" value={copyFrom} onValueChange={setCopyFrom} options={gradeOptions(otherGrades)} placeholder="Copy from…" />
              <Button
                variant="secondary"
                size="sm"
                disabled={!copyFrom}
                onClick={async () => {
                  try {
                    const r = await acad<{ data: GradeSubjectOut[] }>(`/academics/grades/${copyFrom}/subjects`);
                    setDraft(Object.fromEntries(r.data.filter((o) => rows.some((s) => s.id === o.subjectId)).map((o) => [o.subjectId, o.periodsPerWeek])));
                    toast.message('Copied into the form. Review it, then save.');
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                <Copy /> Copy
              </Button>
            </div>
          )}
        </div>
        {slots !== null && total > slots && <div className="px-5 max-sm:px-4"><Banner tone="warning">{gradeName} would need {total} lesson slots a week but a section’s timetable only has {slots}. Lower some periods per week.</Banner></div>}
        <ul className="divide-y divide-border border-y border-border" aria-label={`Subjects for ${gradeName}`}>
          {rows.map((s) => {
            const on = current[s.id] !== undefined;
            return (
              <li key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)_6.5rem] items-center gap-3 px-5 py-2.5 max-sm:px-4">
                <Checkbox id={`off-${s.id}`} checked={on} disabled={!canEdit} onCheckedChange={(v) => setOn(s.id, v === true)} aria-label={`${s.name} offered by ${gradeName}`} />
                <label htmlFor={`off-${s.id}`} className="min-w-0 cursor-pointer text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className="t-caption ml-2 text-ink-3">{s.code} · {TYPE_LABEL[s.type] ?? s.type}</span>
                  {!s.isActive && <Badge className="ml-2" variant="neutral">Inactive</Badge>}
                </label>
                <div className="flex items-center gap-1.5">
                  <Input aria-label={`Periods per week for ${s.name}`} type="number" min={1} max={40} inputMode="numeric" className="!h-9 text-right" disabled={!on || !canEdit} value={on ? String(current[s.id] ?? '') : ''} placeholder="—" onChange={(e) => setPeriods(s.id, e.target.value === '' ? Number.NaN : Number(e.target.value))} invalid={on && (!Number.isInteger(current[s.id]) || current[s.id]! < 1 || current[s.id]! > 40)} />
                  <span className="t-caption text-ink-3">/wk</span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="space-y-3 px-5 pb-5 max-sm:px-4">
          <FormBanner message={err} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty && <span className="t-caption mr-auto text-ink-2">You have unsaved changes.</span>}
            <Button variant="secondary" disabled={!dirty} onClick={() => { setDraft(null); setErr(null); }}>
              Discard changes
            </Button>
            <Button
              loading={save.isPending}
              disabled={!canEdit || !dirty || invalid}
              title={access.hint('academics:edit') ?? (invalid ? 'Periods per week must be a whole number from 1 to 40' : undefined)}
              onClick={async () => {
                setErr(null);
                try {
                  await save.mutateAsync({ gradeId, subjects: Object.entries(current).map(([subjectId, periodsPerWeek]) => ({ subjectId, periodsPerWeek })) });
                  setDraft(null);
                } catch (e) {
                  setErr(errorMessage(e));
                }
              }}
            >
              Save offerings
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
