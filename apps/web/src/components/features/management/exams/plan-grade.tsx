'use client';

import * as React from 'react';
import { paperCreateBody, type ExamOut, type PaperOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { bff } from '@/lib/client/fetcher';
import { examErrorMessage, useExamMutation, useGradeSubjects } from '@/lib/client/exams-admin';
import { gradeOptions, useGradeList } from '@/lib/client/options';
import { cn } from '@/lib/cn';
import { LabelledSelect } from '../shared/controls';

interface Row {
  subjectId: string;
  name: string;
  include: boolean;
  examDate: string | null;
  startTime: string;
  endTime: string;
  room: string;
  maxMarks: string;
  passMarks: string;
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/**
 * Plan every subject of one grade in a single table and save it with the bulk endpoint (papers are matched by grade + subject,
 * so existing ones are updated). One clash anywhere rejects the whole set, and the message says which subject clashes.
 */
export function PlanGradeDrawer({ exam, papers, open, onClose }: { exam: ExamOut; papers: PaperOut[]; open: boolean; onClose: () => void }) {
  const grades = useGradeList();
  const [gradeId, setGradeId] = React.useState('');
  const subjects = useGradeSubjects(gradeId || undefined);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (open) {
      setGradeId('');
      setRows([]);
      setError(null);
      setRowErrors({});
    }
  }, [open]);

  React.useEffect(() => {
    if (!subjects.data) return;
    setRows(
      subjects.data.map((s) => {
        const p = papers.find((x) => x.gradeId === gradeId && x.subjectId === s.subjectId);
        return { subjectId: s.subjectId, name: s.subjectName, include: true, examDate: p?.examDate ?? null, startTime: p?.startTime ?? '', endTime: p?.endTime ?? '', room: p?.room ?? '', maxMarks: String(p?.maxMarks ?? 100), passMarks: p?.passMarks != null ? String(p.passMarks) : '' };
      }),
    );
    setRowErrors({});
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects.data, gradeId]);

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.subjectId === id ? { ...r, ...p } : r)));
  const included = rows.filter((r) => r.include);

  const save = useExamMutation((body: { papers: unknown[] }) => bff<PaperOut[]>(`/exams/${exam.id}/papers/bulk`, { method: 'POST', body }), { success: (r) => `Saved ${r.length} paper${r.length === 1 ? '' : 's'}`, onSuccess: onClose });

  const submit = async () => {
    setError(null);
    const errs: Record<string, string> = {};
    const out = included.map((r) => {
      const body = { gradeId, subjectId: r.subjectId, examDate: r.examDate, startTime: r.startTime || null, endTime: r.endTime || null, room: r.room.trim() || null, maxMarks: r.maxMarks.trim() === '' ? 100 : Number(r.maxMarks), passMarks: num(r.passMarks) };
      const v = paperCreateBody.safeParse(body);
      if (!v.success) errs[r.subjectId] = v.error.issues[0]?.message ?? 'Check this row';
      return body;
    });
    setRowErrors(errs);
    if (Object.keys(errs).length) return;
    if (out.length === 0) return setError('Tick at least one subject to save.');
    try {
      await save.mutateAsync({ papers: out });
    } catch (e) {
      setError(examErrorMessage(e));
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DrawerContent title="Plan a grade’s papers" description={`Set the date, time and marks for every subject of one grade in ${exam.name}.`} showTitle className="sm:w-[min(96vw,760px)]">
        <SheetBody>
          <LabelledSelect label="Grade" value={gradeId} onChange={setGradeId} options={gradeOptions(grades.data)} placeholder={grades.isPending ? 'Loading…' : 'Choose a grade'} />
          {error && <Banner tone="danger">{error}</Banner>}
          {!gradeId ? (
            <p className="text-sm text-ink-2">Choose a grade to list its subjects. Subjects that already have a paper are filled in and will be updated.</p>
          ) : subjects.isPending ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : subjects.isError ? (
            <EmptyState compact title="We couldn’t load this grade’s subjects" action={<Button variant="secondary" size="sm" onClick={() => void subjects.refetch()}>Try again</Button>} />
          ) : rows.length === 0 ? (
            <EmptyState compact title="This grade offers no subjects yet" description="Add subjects to the grade under Academics › Subjects, then plan its papers here." />
          ) : (
            <ul className="space-y-3" aria-label="Subjects of the grade">
              {rows.map((r) => (
                <li key={r.subjectId} className={cn('rounded-lg border border-border p-3', !r.include && 'bg-surface-subtle')}>
                  <div className="flex items-center gap-2.5">
                    <Checkbox checked={r.include} onCheckedChange={(v) => patch(r.subjectId, { include: v === true })} aria-label={`Include ${r.name}`} />
                    <span className="text-sm font-medium">{r.name}</span>
                  </div>
                  {r.include && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1.3fr_1fr_1fr_1fr_0.7fr_0.7fr]">
                      <label className="space-y-1">
                        <span className="t-caption text-ink-2">Date</span>
                        <DatePicker value={r.examDate} onChange={(v) => patch(r.subjectId, { examDate: v })} min={exam.startDate ?? undefined} max={exam.endDate ?? undefined} />
                      </label>
                      <label className="space-y-1">
                        <span className="t-caption text-ink-2">Starts</span>
                        <Input type="time" value={r.startTime} onChange={(e) => patch(r.subjectId, { startTime: e.target.value })} />
                      </label>
                      <label className="space-y-1">
                        <span className="t-caption text-ink-2">Ends</span>
                        <Input type="time" value={r.endTime} onChange={(e) => patch(r.subjectId, { endTime: e.target.value })} />
                      </label>
                      <label className="space-y-1">
                        <span className="t-caption text-ink-2">Room</span>
                        <Input value={r.room} onChange={(e) => patch(r.subjectId, { room: e.target.value })} maxLength={60} />
                      </label>
                      <label className="space-y-1">
                        <span className="t-caption text-ink-2">Max</span>
                        <Input type="number" min={1} max={1000} value={r.maxMarks} onChange={(e) => patch(r.subjectId, { maxMarks: e.target.value })} />
                      </label>
                      <label className="space-y-1">
                        <span className="t-caption text-ink-2">Pass</span>
                        <Input type="number" min={0} max={1000} value={r.passMarks} onChange={(e) => patch(r.subjectId, { passMarks: e.target.value })} />
                      </label>
                    </div>
                  )}
                  {rowErrors[r.subjectId] && <p role="alert" className="t-caption mt-2 text-danger">{rowErrors[r.subjectId]}</p>}
                </li>
              ))}
            </ul>
          )}
        </SheetBody>
        <SheetFooter>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={save.isPending} disabled={!gradeId || rows.length === 0}>
            Save {included.length > 0 ? `${included.length} paper${included.length === 1 ? '' : 's'}` : 'papers'}
          </Button>
        </SheetFooter>
      </DrawerContent>
    </Drawer>
  );
}
