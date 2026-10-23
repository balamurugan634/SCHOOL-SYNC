'use client';

import * as React from 'react';
import Link from 'next/link';
import { Download, FileUp } from 'lucide-react';
import { IMPORT_MAX_ROWS, type SectionOut, type StudentImportOut } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Textarea } from '@/components/ui/input';
import { Stepper } from '@/components/ui/stepper';
import { StatTile } from '@/components/ui/stat-tile';
import { toast } from '@/components/ui/toaster';
import { useSectionList } from '@/lib/client/options';
import { useImportStudents } from '@/lib/client/people';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { ApiError } from '@/lib/problem';
import { useAccess } from '../shared/access';
import { paths } from '../shared/paths';
import { saveText, toCsv } from './csv';
import { ErrorBanner, explainError } from './errors';
import { asArray } from './ui';

const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'check', label: 'Check' },
  { id: 'done', label: 'Done' },
];
const MAX_CHARS = 900_000;
const HEADER = ['First Name', 'Last Name', 'Admission No', 'Date of Birth', 'Gender', 'Blood Group', 'Grade', 'Section', 'Roll No', 'Guardian Name', 'Guardian Phone', 'Guardian Email', 'Guardian Relationship', 'Address', 'City'];

const rowCount = (csv: string) => Math.max(0, csv.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1);

export function StudentImport() {
  const acc = useAccess();
  const imp = useImportStudents();
  const secQ = useSectionList();
  const sections = asArray<SectionOut>(secQ.data);
  const [step, setStep] = React.useState(0);
  const [csv, setCsv] = React.useState('');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [skipInvalid, setSkipInvalid] = React.useState(false);
  const [createLogins, setCreateLogins] = React.useState(true);
  const [report, setReport] = React.useState<StudentImportOut | null>(null);
  const [result, setResult] = React.useState<StudentImportOut | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [problemsOnly, setProblemsOnly] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [confirm, setConfirm] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(step === 2 && !!result && result.credentials.length > 0 && !saved, {
    title: 'Leave without saving the passwords?',
    description: 'The temporary passwords on this page are shown only once. If you leave now you cannot get them back; you would have to reset each password from Settings → Users.',
    confirmLabel: 'Leave anyway',
  });

  const n = rowCount(csv);

  async function check(opts = { skipInvalid, createLogins }) {
    setError(null);
    setInputError(null);
    if (!csv.trim()) return setInputError('Choose a CSV file or paste its contents first.');
    if (csv.length > MAX_CHARS) return setInputError('That file is too large. Split it into smaller files of up to 500 students.');
    if (n > IMPORT_MAX_ROWS) return setInputError(`That file has ${n} students. Import at most ${IMPORT_MAX_ROWS} at a time; split it into parts.`);
    try {
      const r = await imp.mutateAsync({ dryRun: true, csv, ...opts });
      setReport(r);
      setPage(1);
      setStep(1);
    } catch (e) {
      setError(e);
    }
  }

  async function commit() {
    setError(null);
    try {
      const r = await imp.mutateAsync({ dryRun: false, csv, skipInvalid, createLogins });
      setResult(r);
      setConfirm(false);
      setStep(2);
      toast.success(`${r.created} ${r.created === 1 ? 'student' : 'students'} imported`);
    } catch (e) {
      setConfirm(false);
      setError(e);
      // the data may have changed since the check (full section, taken admission numbers): show a fresh report
      if (e instanceof ApiError && (e.code === 'IMPORT_HAS_ERRORS' || e.code === 'SECTION_FULL')) void check();
    }
  }

  const template = () => {
    const s = sections?.[0];
    saveText('student-import-template.csv', toCsv(HEADER, [['Aarav', 'Sharma', '', '2015-04-12', 'male', 'O+', s?.gradeName ?? 'Grade 6', s?.name ?? 'A', '', 'Priya Sharma', '9876543210', 'priya@example.com', 'mother', '12 Park Street', 'Pune']]));
  };

  const seatsProblem = report && !report.seats.ok ? explainError(new ApiError({ status: 402, code: report.seats.code ?? 'LICENSE_LIMIT_REACHED', detail: report.seats.message })) : null;
  const canCommit = !!report && report.valid > 0 && (report.invalid === 0 || skipInvalid) && report.seats.ok && !acc.readOnly && acc.can('students:create', 'school');

  const rows = React.useMemo(() => (report?.rows ?? []).filter((r) => !problemsOnly || !r.ok || r.warnings.length > 0), [report, problemsOnly]);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const columns: Column<StudentImportOut['rows'][number]>[] = [
    { id: 'row', header: 'Row', mobile: 'sub', align: 'right', className: 'w-16', cell: (r) => r.row },
    { id: 'name', header: 'Student', mobile: 'title', cell: (r) => r.name ?? <span className="text-ink-3">No name</span> },
    { id: 'adm', header: 'Admission no.', mobile: 'hide', cell: (r) => r.admissionNo ?? <span className="text-ink-3">Generated</span> },
    { id: 'ok', header: 'Result', mobile: 'status', cell: (r) => (r.ok ? <Badge variant="success">Ready</Badge> : <Badge variant="danger">Has errors</Badge>) },
    {
      id: 'details',
      header: 'Details',
      mobile: 'detail',
      label: 'Details',
      cell: (r) =>
        r.errors.length + r.warnings.length === 0 ? (
          <span className="text-ink-3">—</span>
        ) : (
          <ul className="space-y-0.5 text-[13px]">
            {r.errors.map((e) => (
              <li key={e} className="text-danger">{e}</li>
            ))}
            {r.warnings.map((w) => (
              <li key={w} className="text-warning">{w}</li>
            ))}
          </ul>
        ),
    },
  ];

  function downloadCredentials() {
    if (!result) return;
    saveText('new-student-logins.csv', toCsv(['Row', 'Admission no', 'Student username', 'Student temporary password', 'Parent username', 'Parent temporary password'], result.credentials.map((c) => [c.row, c.admissionNo, c.student?.username, c.student?.temporaryPassword, c.guardian?.username, c.guardian?.temporaryPassword])));
    setSaved(true);
  }

  return (
    <>
      <PageHeader title="Import students" description="Upload a CSV of students. We check every row first and tell you what is wrong before anything is saved." crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Students', href: paths.students() }, { label: 'Import' }]} />
      <div className="max-w-4xl space-y-6">
        <Stepper steps={STEPS} current={step} />

        {step === 0 && (
          <>
            <Card>
              <CardHeader title="1. Choose your file" description={`CSV with a header row, up to ${IMPORT_MAX_ROWS} students. Column names are matched loosely (“First Name”, first_name, firstname).`} action={<Button variant="secondary" size="sm" onClick={template}><Download /> Template</Button>} />
              <CardBody className="space-y-4">
                <Field label="CSV file" htmlFor="import-file" error={inputError}>
                  <input
                    id="import-file"
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setInputError(null);
                      if (f.size > MAX_CHARS) return setInputError('That file is too large (over about 900 KB). Split it into smaller files.');
                      setCsv(await f.text());
                      setFileName(f.name);
                    }}
                    className="block w-full rounded-md border border-border-strong bg-surface p-1.5 text-sm file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-sunken file:px-3 file:text-[13px] file:font-medium file:text-ink hover:file:bg-border"
                  />
                </Field>
                <Field label="Or paste the CSV text" htmlFor="import-text" hint={fileName ? `Loaded ${fileName}.` : undefined}>
                  <Textarea id="import-text" value={csv} onChange={(e) => { setCsv(e.target.value); setFileName(null); }} rows={6} className="font-mono text-[12px]" placeholder={`${HEADER.join(',')}\nAarav,Sharma,,2015-04-12,male,O+,Grade 6,A,,Priya Sharma,9876543210,priya@example.com,mother,12 Park Street,Pune`} spellCheck={false} />
                </Field>
                {csv.trim() && <p className="t-caption text-ink-2">{n.toLocaleString()} {n === 1 ? 'student' : 'students'} found in the file.</p>}
                <ErrorBanner error={error} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="What each column does" />
              <CardBody className="pt-3">
                <ul className="grid gap-x-8 gap-y-1.5 text-sm text-ink-2 sm:grid-cols-2">
                  <li><strong className="font-medium text-ink">First Name</strong> is required.</li>
                  <li><strong className="font-medium text-ink">Grade and Section</strong> name an existing section of the current year.</li>
                  <li><strong className="font-medium text-ink">Admission No</strong> is generated when empty.</li>
                  <li><strong className="font-medium text-ink">Date of Birth</strong> as 2015-04-12 or 12/04/2015.</li>
                  <li><strong className="font-medium text-ink">Guardian Phone</strong> links an existing parent or creates one.</li>
                  <li><strong className="font-medium text-ink">Gender</strong> male, female or other.</li>
                </ul>
              </CardBody>
            </Card>
            <div className="flex justify-end">
              <Button onClick={() => void check()} loading={imp.isPending} disabled={!acc.can('students:create', 'school') || acc.readOnly} title={acc.hint('students:create', 'school')}>
                <FileUp /> Check the file
              </Button>
            </div>
          </>
        )}

        {step === 1 && report && (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile label="Rows in the file" value={report.total} />
              <StatTile label="Ready to import" value={report.valid} />
              <StatTile label="With errors" value={report.invalid} />
              <StatTile label="Seats needed" value={report.seats.adding} hint={report.seats.ok ? 'The licence has room' : 'Not enough seats'} />
            </div>
            {!report.seats.ok && seatsProblem && (
              <Banner tone={report.seats.code === 'SUBSCRIPTION_EXPIRED' ? 'locked' : 'danger'} title={seatsProblem.title}>
                <p>{seatsProblem.message}</p>
                {seatsProblem.steps && <ul className="mt-1.5 list-disc space-y-0.5 pl-4">{seatsProblem.steps.map((s) => <li key={s}>{s}</li>)}</ul>}
              </Banner>
            )}
            {report.invalid === 0 && report.seats.ok ? (
              <Banner tone="success" title="Every row passed the checks">Nothing has been saved yet. Review the list, then import.</Banner>
            ) : report.invalid > 0 ? (
              <Banner tone="warning" title={`${report.invalid} ${report.invalid === 1 ? 'row has' : 'rows have'} errors`}>
                Fix them in your file and check again, or tick “Import only the valid rows” below to skip the bad ones. By default one bad row stops the whole import.
              </Banner>
            ) : null}

            <DataTable
              id="people-import-report"
              caption="Import check"
              rows={pageRows}
              rowKey={(r) => String(r.row)}
              columns={columns}
              page={page}
              pageSize={pageSize}
              total={rows.length}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
              filters={
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={problemsOnly} onChange={(e) => { setProblemsOnly(e.target.checked); setPage(1); }} className="size-[18px] accent-[var(--brand)]" />
                  Show only rows with errors or warnings
                </label>
              }
              empty={<EmptyState illustration="success" compact title="No problems found" description="Untick the filter above to see every row." />}
            />

            <Card>
              <CardBody className="space-y-3">
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={skipInvalid}
                    onChange={(e) => {
                      setSkipInvalid(e.target.checked);
                      void check({ skipInvalid: e.target.checked, createLogins });
                    }}
                    className="mt-0.5 size-[18px] accent-[var(--brand)]"
                  />
                  <span>
                    Import only the valid rows
                    <span className="t-caption block text-ink-3">Rows with errors are skipped and listed again afterwards.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={createLogins}
                    onChange={(e) => {
                      setCreateLogins(e.target.checked);
                      void check({ skipInvalid, createLogins: e.target.checked });
                    }}
                    className="mt-0.5 size-[18px] accent-[var(--brand)]"
                  />
                  <span>
                    Create student and parent logins
                    <span className="t-caption block text-ink-3">Temporary passwords are shown once, on the next screen.</span>
                  </span>
                </label>
              </CardBody>
            </Card>
            <ErrorBanner error={error} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={() => setStep(0)}>Back to the file</Button>
              <Button onClick={() => setConfirm(true)} disabled={!canCommit} loading={imp.isPending} title={!canCommit ? 'Fix the problems above first' : undefined}>
                Import {skipInvalid ? report.valid : report.total} {(skipInvalid ? report.valid : report.total) === 1 ? 'student' : 'students'}
              </Button>
            </div>
            <ConfirmDialog
              open={confirm}
              onOpenChange={setConfirm}
              title={`Import ${report.valid} ${report.valid === 1 ? 'student' : 'students'}?`}
              description={
                <>
                  <p>This creates {report.valid} student records, each using one licence seat{createLogins ? ' and with a login (and a parent login where a guardian phone is given)' : ''}. Everything is saved together, or nothing is saved if something goes wrong.</p>
                  {report.invalid > 0 && <p className="mt-2">{report.invalid} {report.invalid === 1 ? 'row' : 'rows'} with errors will be skipped.</p>}
                  <p className="mt-2">Imported students cannot be deleted afterwards, only archived.</p>
                </>
              }
              confirmLabel={`Import ${report.valid}`}
              loading={imp.isPending}
              onConfirm={() => void commit()}
            />
          </>
        )}

        {step === 2 && result && (
          <>
            <Card>
              <CardBody className="flex flex-col items-center gap-2 py-8 text-center">
                <h2 className="t-page">{result.created} {result.created === 1 ? 'student' : 'students'} imported</h2>
                <p className="max-w-[52ch] text-sm text-ink-2">They are on the roll now and each one uses a licence seat.{result.invalid > 0 ? ` ${result.invalid} ${result.invalid === 1 ? 'row was' : 'rows were'} skipped because of errors.` : ''}</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button asChild><Link href={paths.students()}>View students</Link></Button>
                  <Button variant="secondary" onClick={() => guard(() => { setStep(0); setCsv(''); setFileName(null); setReport(null); setResult(null); setSaved(false); })}>Import another file</Button>
                </div>
              </CardBody>
            </Card>
            {result.credentials.length > 0 && (
              <Card>
                <CardHeader title="Sign-in details" description="Temporary passwords, shown only on this screen." action={<Button size="sm" onClick={downloadCredentials}><Download /> Download CSV</Button>} />
                <CardBody className="space-y-3">
                  <Banner tone="warning" title="Save these now">They are not stored in a readable form and cannot be shown again. Download the CSV and hand each family their details. Everyone must choose a new password at first sign-in.</Banner>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="t-table w-full">
                      <thead>
                        <tr>
                          {['Admission no.', 'Student login', 'Student password', 'Parent login', 'Parent password'].map((h) => (
                            <th key={h} scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.credentials.map((c) => (
                          <tr key={c.row} className="border-t border-border">
                            <td className="h-9 px-3">{c.admissionNo}</td>
                            <td className="px-3 font-mono text-[12px]">{c.student?.username ?? '—'}</td>
                            <td className="px-3 font-mono text-[12px]">{c.student?.temporaryPassword ?? '—'}</td>
                            <td className="px-3 font-mono text-[12px]">{c.guardian?.username ?? '—'}</td>
                            <td className="px-3 font-mono text-[12px]">{c.guardian?.temporaryPassword ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            )}
            {result.rows.some((r) => !r.ok) && (
              <Card>
                <CardHeader title="Skipped rows" description="These rows had errors and were not imported." />
                <CardBody className="pt-3">
                  <ul className="space-y-1.5 text-sm">
                    {result.rows.filter((r) => !r.ok).map((r) => (
                      <li key={r.row}><span className="font-medium">Row {r.row}{r.name ? ` · ${r.name}` : ''}</span> <span className="text-danger">{r.errors.join('; ')}</span></li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}
          </>
        )}
      </div>
      {dialog}
    </>
  );
}
