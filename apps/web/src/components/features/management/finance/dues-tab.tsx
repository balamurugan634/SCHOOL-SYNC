'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileStack, Info } from 'lucide-react';
import type { PlanOut, StructureOut } from '@school-sync/shared';
import { useGenerateDues, useStructures, type GenerateDuesBody, type GenerateDuesResult } from '@/lib/client/finance';
import { friendlyError, useGradeList, useSectionList, type Paged } from '@/lib/client/mgmt';
import { bff } from '@/lib/client/fetcher';
import { fmtDate, plural, todayIso } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { toast } from '@/components/ui/toaster';
import { GuardedButton } from '../common/guarded';
import { StudentPicker, type PickerOption } from '../common/picker';
import { useMgmt } from '../common/use-mgmt';

type Scope = 'school' | 'grade' | 'section' | 'student';
const ALL = 'all';

interface Preview {
  plansInScope: number;
  plansToBill: number;
  invoices: number;
  totalMinor: number;
  truncated: boolean;
  byDate: { date: string; invoices: number; amountMinor: number; labels: string[] }[];
}

/** Estimate what generation would create from the plans in scope (the API has no dry run). Exact numbers come back after generating. */
async function estimate(a: { structureId: string; scope: Scope; gradeName?: string; sectionId?: string; studentId?: string; cutoff: string }, structures: StructureOut[], signal: AbortSignal): Promise<Preview> {
  const byId = new Map(structures.map((s) => [s.id, s]));
  const plans: PlanOut[] = [];
  let truncated = false;
  for (let page = 1; page <= 10; page++) {
    const r = await bff<Paged<PlanOut>>('/fees/plans', { query: { page, pageSize: 100, structureId: a.structureId === ALL ? undefined : a.structureId, sectionId: a.scope === 'section' ? a.sectionId : undefined, studentId: a.scope === 'student' ? a.studentId : undefined }, signal });
    plans.push(...r.data);
    if (page >= r.meta.totalPages) break;
    if (page === 10) truncated = true;
  }
  const inScope = plans.filter((p) => (a.scope === 'grade' ? p.gradeName === a.gradeName : true));
  const live = inScope.filter((p) => byId.get(p.structureId)?.isActive);
  const dates = new Map<string, { invoices: number; amountMinor: number; labels: Set<string> }>();
  let invoices = 0;
  let total = 0;
  let toBill = 0;
  for (const p of live) {
    const s = byId.get(p.structureId)!;
    const allDates = [...new Set(s.items.map((i) => i.dueDate))].sort();
    const billed = new Set(allDates.slice(0, p.invoiceCount));
    const todo = allDates.filter((d) => (!a.cutoff || d <= a.cutoff) && !billed.has(d));
    if (todo.length) toBill++;
    for (const d of todo) {
      const items = s.items.filter((i) => i.dueDate === d);
      const amt = items.reduce((t, i) => t + i.amountMinor, 0);
      const e = dates.get(d) ?? { invoices: 0, amountMinor: 0, labels: new Set<string>() };
      e.invoices++;
      e.amountMinor += amt;
      items.forEach((i) => e.labels.add(i.categoryName));
      dates.set(d, e);
      invoices++;
      total += amt;
    }
  }
  return { plansInScope: live.length, plansToBill: toBill, invoices, totalMinor: total, truncated, byDate: [...dates.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([date, e]) => ({ date, invoices: e.invoices, amountMinor: e.amountMinor, labels: [...e.labels] })) };
}

export function DuesTab() {
  const { writeBlock, money, base } = useMgmt();
  const structures = useStructures({ pageSize: 100 });
  const grades = useGradeList();
  const sections = useSectionList();
  const gen = useGenerateDues();
  const [structureId, setStructureId] = React.useState(ALL);
  const [scope, setScope] = React.useState<Scope>('school');
  const [gradeId, setGradeId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [student, setStudent] = React.useState<PickerOption | null>(null);
  const [cutoff, setCutoff] = React.useState('');
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewErr, setPreviewErr] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [result, setResult] = React.useState<GenerateDuesResult | null>(null);
  const [genErr, setGenErr] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const createBlock = writeBlock('fees:create', 'school');

  const target = scope === 'grade' ? gradeId : scope === 'section' ? sectionId : scope === 'student' ? (student?.value ?? '') : 'x';
  const sig = `${structureId}|${scope}|${target}|${cutoff}`;
  React.useEffect(() => {
    setPreview(null);
    setPreviewErr(null);
  }, [sig]);

  const body: GenerateDuesBody = {
    structureId: structureId === ALL ? undefined : structureId,
    gradeId: scope === 'grade' ? gradeId : undefined,
    sectionId: scope === 'section' ? sectionId : undefined,
    studentId: scope === 'student' ? student?.value : undefined,
    dueOnOrBefore: cutoff || undefined,
  };
  const scopeLabel =
    scope === 'school' ? 'the whole school' : scope === 'grade' ? (grades.data?.find((g) => g.id === gradeId)?.name ?? 'the grade') : scope === 'section' ? ((s) => (s ? `${s.gradeName} ${s.name}` : 'the class'))(sections.data?.find((x) => x.id === sectionId)) : (student?.label ?? 'the student');
  const structureLabel = structureId === ALL ? 'all active fee structures' : (structures.data?.data.find((s) => s.id === structureId)?.name ?? 'the structure');

  const runPreview = async () => {
    if (!target) {
      setPreviewErr('Choose who to bill first.');
      return;
    }
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setPreviewing(true);
    setPreviewErr(null);
    setResult(null);
    try {
      const p = await estimate({ structureId, scope, gradeName: grades.data?.find((g) => g.id === gradeId)?.name, sectionId, studentId: student?.value, cutoff }, structures.data?.data ?? [], ac.signal);
      setPreview(p);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setPreviewErr(friendlyError(e));
    } finally {
      setPreviewing(false);
    }
  };

  const generate = async () => {
    setGenErr(null);
    try {
      const r = await gen.mutateAsync(body);
      setResult(r);
      setPreview(null);
      setConfirm(false);
      toast.success(`${plural(r.invoicesCreated, 'invoice')} created`, { description: r.invoicesExisting ? `${r.invoicesExisting} already existed and were skipped.` : undefined });
    } catch (e) {
      setGenErr(friendlyError(e));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader title="What to bill" description="Dues are created from student fee plans, one invoice per student per due date." />
        <CardBody className="space-y-4 pt-4">
          <Field label="Fee structure">
            <Select value={structureId} onValueChange={setStructureId} options={[{ value: ALL, label: 'All active structures' }, ...(structures.data?.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))]} />
          </Field>
          <Field label="Who">
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as Scope)}
              options={[
                { value: 'school', label: 'Whole school' },
                { value: 'grade', label: 'A grade' },
                { value: 'section', label: 'A class (section)' },
                { value: 'student', label: 'One student' },
              ]}
            />
          </Field>
          {scope === 'grade' && (
            <Field label="Grade" required>
              <Select value={gradeId} onValueChange={setGradeId} placeholder="Choose a grade" options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))} />
            </Field>
          )}
          {scope === 'section' && (
            <Field label="Class" required>
              <Select value={sectionId} onValueChange={setSectionId} placeholder="Choose a class" options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.gradeName} ${s.name}` }))} />
            </Field>
          )}
          {scope === 'student' && (
            <Field label="Student" required>
              <StudentPicker selected={student} onSelect={setStudent} />
            </Field>
          )}
          <Field label="Instalments due on or before" hint="Leave empty to bill every instalment on the plans, including ones due later.">
            <div className="flex items-center gap-2">
              <DatePicker value={cutoff || null} onChange={setCutoff} placeholder="Any due date" className="w-44" presets={[{ label: 'Today', value: todayIso() }]} />
              {cutoff && (
                <Button variant="ghost" size="sm" onClick={() => setCutoff('')}>
                  Clear
                </Button>
              )}
            </div>
          </Field>
          <Button variant="secondary" className="w-full" loading={previewing} disabled={!target} onClick={() => void runPreview()}>
            <FileStack /> Preview what will be created
          </Button>
          {previewErr && <Banner tone="danger">{previewErr}</Banner>}
        </CardBody>
      </Card>

      <div className="space-y-4">
        {result && (
          <Banner tone="success" title="Dues generated">
            <p>
              {plural(result.invoicesCreated, 'invoice')} created for {plural(result.plans, 'plan')}, totalling {money(result.totalMinor)}
              {result.discountMinor > 0 ? ` (${money(result.discountMinor)} of approved concessions applied)` : ''}. {result.invoicesExisting > 0 ? `${plural(result.invoicesExisting, 'invoice')} already existed and were left as they are.` : 'Nothing was duplicated.'}
            </p>
            <p className="mt-1">
              <Link href={`${base}/finance/invoices`} className="font-medium text-brand-ink underline-offset-4 hover:underline">
                Open the invoices
              </Link>
            </p>
          </Banner>
        )}
        {previewing ? (
          <Card>
            <CardBody className="space-y-3" aria-busy>
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-28 w-full" />
            </CardBody>
          </Card>
        ) : preview ? (
          <Card>
            <CardHeader title="What will be created" description={`${structureLabel} for ${scopeLabel}${cutoff ? `, instalments due up to ${fmtDate(cutoff)}` : ''}`} />
            <CardBody className="space-y-5 pt-4">
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Plans in scope" value={preview.plansInScope} />
                <StatTile label="New invoices (est.)" value={preview.invoices} />
                <StatTile label="Billed before discounts" value={money(preview.totalMinor)} />
              </div>
              {preview.invoices === 0 ? (
                <EmptyState compact icon={<Info />} title="Nothing new to bill" description={preview.plansInScope === 0 ? 'No active plans match. Assign a fee structure to students first.' : 'Every instalment in scope already has an invoice, so generating again would change nothing.'} />
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="t-table w-full">
                      <caption className="sr-only">Invoices that would be created, by due date</caption>
                      <thead>
                        <tr>
                          <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">Due date</th>
                          <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">Fees</th>
                          <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-right text-ink-2">Invoices</th>
                          <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-right text-ink-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.byDate.map((d) => (
                          <tr key={d.date} className="border-t border-border">
                            <td className="h-10 px-3">{fmtDate(d.date)}</td>
                            <td className="px-3 text-ink-2">{d.labels.join(', ')}</td>
                            <td className="tnum px-3 text-right">{d.invoices.toLocaleString()}</td>
                            <td className="tnum px-3 text-right">{money(d.amountMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Banner tone="info">
                    This is an estimate from each plan’s structure and how many invoices it already has. Approved concessions are applied automatically while generating; the exact figures are shown afterwards. Instalments that already have an invoice are always skipped, so running this twice never bills anyone twice.
                    {preview.truncated && ' Only the first 1,000 plans were counted here; generation covers all of them.'}
                  </Banner>
                  <div className="flex justify-end">
                    <GuardedButton blocked={createBlock} onClick={() => setConfirm(true)}>
                      Generate {plural(preview.invoices, 'invoice')}
                    </GuardedButton>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        ) : !result ? (
          <Card>
            <EmptyState illustration="empty-generic" title="Preview before you bill" description="Choose what to bill and press Preview. Nothing is created until you confirm." />
          </Card>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => {
          setConfirm(o);
          if (!o) setGenErr(null);
        }}
        title="Generate these dues?"
        description={
          <div className="space-y-2">
            <p>
              This creates about <strong>{preview?.invoices.toLocaleString()}</strong> invoices ({preview ? money(preview.totalMinor) : ''} before discounts) from {structureLabel} for {scopeLabel}. Parents and students see them straight away.
            </p>
            <p>Generated invoices can be voided one by one but not deleted. It is safe to run again: instalments that already have an invoice are skipped.</p>
            {genErr && <Banner tone="danger">{genErr}</Banner>}
          </div>
        }
        confirmLabel="Generate invoices"
        loading={gen.isPending}
        onConfirm={() => void generate()}
      />
    </div>
  );
}
