'use client';

import * as React from 'react';
import { BookDown, BookUp } from 'lucide-react';
import type { LibraryBook, LibraryIssue } from '@school-sync/shared';
import { useBooks, useIssueBook, useLibraryPolicy, useLoans, useReturnBook } from '@/lib/client/operations';
import { friendlyError, useDebounced } from '@/lib/client/mgmt';
import { fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { ChoicePills, ClearFilters, FilterBar, FilterChips, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { EntityPicker, StaffPicker, StudentPicker, type PickerOption } from '../common/picker';
import { ErrorPanel } from '../common/states';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

const STATUS = [
  { value: '' as const, label: 'Out now' },
  { value: 'overdue' as const, label: 'Overdue' },
  { value: 'returned' as const, label: 'Returned' },
  { value: 'all' as const, label: 'Everything' },
];

export function LoanStatus({ l }: { l: LibraryIssue }) {
  if (l.status === 'returned') return <Badge variant="neutral">Returned {l.returnedOn ? fmtDate(l.returnedOn) : ''}</Badge>;
  if (l.status === 'overdue') return <Badge variant="danger">{l.daysOverdue} day{l.daysOverdue === 1 ? '' : 's'} late</Badge>;
  return <Badge variant="info">Out</Badge>;
}

export function LoansTab({ issueBook, onIssueClose }: { issueBook: LibraryBook | null; onIssueClose: () => void }) {
  const { writeBlock, money } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const status = (ls.get('lstatus') || '') as '' | 'overdue' | 'returned' | 'all';
  const q = useLoans({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, status: status === '' ? 'active' : status });
  const [ret, setRet] = React.useState<LibraryIssue | null>(null);
  const [who, setWho] = React.useState<LibraryIssue['borrower'] | null>(null);
  const [issuing, setIssuing] = React.useState(false);
  const filtered = !!ls.q || !!status;
  const open = issueBook !== null || issuing;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <GuardedButton blocked={writeBlock('library:create', 'school')} onClick={() => setIssuing(true)}>
          <BookUp /> Issue a book
        </GuardedButton>
      </div>
      <DataTable<LibraryIssue>
        id="ops-loans"
        caption="Library loans"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        filters={
          <div className="flex w-full flex-col gap-3">
            <ChoicePills label="Loan status" value={status} onChange={(v) => ls.set({ lstatus: v })} options={STATUS} />
            <FilterBar>
              <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Book or borrower" />
            </FilterBar>
          </div>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No loans match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(status ? [{ label: 'Status', value: status }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="success" title="No books are out" description="Issued books appear here until they come back." />
          )
        }
        columns={[
          { id: 'book', header: 'Book', cell: (r) => (<><span className="block max-w-[34ch] truncate font-medium">{r.book.title}</span><span className="t-caption block text-ink-3">{r.book.accessionNo}</span></>), mobile: 'title' },
          { id: 'who', header: 'Borrower', cell: (r) => (<button type="button" onClick={() => setWho(r.borrower)} className="text-left"><span className="block font-medium text-brand-ink underline-offset-4 hover:underline">{r.borrower.name}</span><span className="t-caption block text-ink-3">{r.borrower.type === 'staff' ? 'Staff' : [r.borrower.grade, r.borrower.section].filter(Boolean).join(' ')} · {r.borrower.code}</span></button>), mobile: 'sub' },
          { id: 'issued', header: 'Issued', cell: (r) => fmtDate(r.issuedOn), sortable: true, sortValue: (r) => r.issuedOn, mobile: 'detail', label: 'Issued' },
          { id: 'due', header: 'Due', cell: (r) => fmtDate(r.dueOn), sortable: true, sortValue: (r) => r.dueOn, mobile: 'detail', label: 'Due' },
          { id: 'fine', header: 'Fine', cell: (r) => (r.fineMinor > 0 ? <span className={r.status === 'overdue' ? 'text-danger' : ''}>{money(r.fineMinor)}</span> : '—'), align: 'right', mobile: 'value' },
          { id: 'status', header: 'Status', cell: (r) => <LoanStatus l={r} />, mobile: 'status' },
          {
            id: 'actions',
            header: <span className="sr-only">Return</span>,
            label: 'Return',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) =>
              r.status !== 'returned' ? (
                <GuardedButton blocked={writeBlock('library:edit', 'school')} size="sm" variant="secondary" onClick={() => setRet(r)}>
                  <BookDown /> Return
                </GuardedButton>
              ) : null,
          },
        ]}
      />
      {open && <IssueDialog book={issueBook} onClose={() => { setIssuing(false); onIssueClose(); }} />}
      <ReturnDialog loan={ret} onClose={() => setRet(null)} />
      <BorrowerDrawer borrower={who} onClose={() => setWho(null)} />
    </div>
  );
}

// ── issue ───────────────────────────────────────────────────────────────────────────────────

function IssueDialog({ book: initial, onClose }: { book: LibraryBook | null; onClose: () => void }) {
  const { can } = useMgmt();
  const policy = useLibraryPolicy();
  const issue = useIssueBook();
  const [bookQ, setBookQ] = React.useState('');
  const dq = useDebounced(bookQ.trim(), 250);
  const books = useBooks({ q: dq || undefined, available: 'true', pageSize: 15 }, dq.length >= 2);
  const [book, setBook] = React.useState<PickerOption | null>(initial ? { value: initial.id, label: initial.title, sub: initial.accessionNo } : null);
  const [kind, setKind] = React.useState<'student' | 'staff'>('student');
  const [borrower, setBorrower] = React.useState<PickerOption | null>(null);
  const [due, setDue] = React.useState('');
  const [tried, setTried] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const canStaff = can('staff:view');
  const days = policy.data ? (kind === 'staff' ? policy.data.staffLoanDays : policy.data.loanDays) : null;

  const submit = async () => {
    setTried(true);
    if (!book || !borrower) return;
    setErr(null);
    try {
      const l = await issue.mutateAsync({ bookId: book.value, ...(kind === 'student' ? { studentId: borrower.value } : { staffId: borrower.value }), dueOn: due || undefined });
      toast.success('Book issued', { description: `${l.book.title} to ${l.borrower.name}, due ${fmtDate(l.dueOn)}` });
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Issue a book" description="Choose the book and who is borrowing it." size="lg">
        <div className="mt-4 space-y-4">
          <Field label="Book" required error={tried && !book ? 'Choose a book' : null}>
            <EntityPicker selected={book} onSelect={setBook} query={bookQ} onQueryChange={setBookQ} results={books.data?.data.map((b) => ({ value: b.id, label: b.title, sub: `${b.accessionNo} · ${b.availableCopies} on shelf` }))} loading={books.isFetching} error={books.error} placeholder="Search title, author or accession no." hint="Only books with a copy on the shelf are listed." invalid={tried && !book} />
          </Field>
          <Field label="Borrower">
            <div className="inline-flex rounded-md border border-border bg-surface-subtle p-0.5" role="group" aria-label="Borrower type">
              {(['student', 'staff'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} disabled={k === 'staff' && !canStaff} title={k === 'staff' && !canStaff ? 'Your role cannot look up staff' : undefined} onClick={() => { setKind(k); setBorrower(null); }} className={`tr-colors h-8 rounded-[6px] px-4 text-[13px] font-medium disabled:opacity-50 ${kind === k ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]' : 'text-ink-3 hover:text-ink'}`}>
                  {k === 'student' ? 'Student' : 'Staff member'}
                </button>
              ))}
            </div>
          </Field>
          <Field label={kind === 'student' ? 'Student' : 'Staff member'} required error={tried && !borrower ? 'Choose who is borrowing' : null}>
            {kind === 'student' ? <StudentPicker selected={borrower} onSelect={setBorrower} invalid={tried && !borrower} /> : <StaffPicker selected={borrower} onSelect={setBorrower} invalid={tried && !borrower} />}
          </Field>
          <Field label="Due on" hint={days ? `Leave empty for the usual ${days} days.` : 'Optional.'}>
            <DatePicker value={due || null} onChange={setDue} className="w-44" placeholder={days ? `In ${days} days` : 'Default'} />
          </Field>
          {err && <Banner tone="danger">{err}</Banner>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={issue.isPending} onClick={() => void submit()}>
              Issue book
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── return ──────────────────────────────────────────────────────────────────────────────────

export function ReturnDialog({ loan, onClose }: { loan: LibraryIssue | null; onClose: () => void }) {
  const { money } = useMgmt();
  const ret = useReturnBook();
  const [waive, setWaive] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (loan) {
      setWaive(false);
      setErr(null);
    }
  }, [loan]);
  if (!loan) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && !ret.isPending && onClose()}>
      <DialogContent title="Return this book" description={`${loan.book.title} · ${loan.borrower.name}`}>
        <div className="mt-4 space-y-4">
          <p className="rounded-md bg-surface-subtle p-3 text-sm text-ink-2">
            Issued {fmtDate(loan.issuedOn)}, due {fmtDate(loan.dueOn)}.{' '}
            {loan.daysOverdue > 0 ? (
              <>
                It is <strong className="text-ink">{loan.daysOverdue} day{loan.daysOverdue === 1 ? '' : 's'} late</strong>, a fine of <strong className="text-ink">{money(loan.fineMinor)}</strong>.
              </>
            ) : (
              'It is being returned on time, so there is no fine.'
            )}{' '}
            The copy goes back on the shelf.
          </p>
          {loan.fineMinor > 0 && (
            <div className="flex items-start gap-2.5">
              <Checkbox id="waive" checked={waive} onCheckedChange={(v) => setWaive(v === true)} className="mt-0.5" />
              <label htmlFor="waive" className="text-sm">
                Waive the fine
                <span className="t-caption block text-ink-3">The {money(loan.fineMinor)} is cleared instead of being recorded against {loan.borrower.name}.</span>
              </label>
            </div>
          )}
          {err && <Banner tone="danger">{err}</Banner>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={ret.isPending}>
              Cancel
            </Button>
            <Button
              loading={ret.isPending}
              onClick={async () => {
                setErr(null);
                try {
                  const r = await ret.mutateAsync({ id: loan.id, waiveFine: waive });
                  toast.success('Book returned', { description: r.fineMinor > 0 ? `Fine recorded: ${money(r.fineMinor)}` : undefined });
                  onClose();
                } catch (e) {
                  setErr(friendlyError(e));
                }
              }}
            >
              Return book
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── per-borrower loans ──────────────────────────────────────────────────────────────────────

function BorrowerDrawer({ borrower, onClose }: { borrower: LibraryIssue['borrower'] | null; onClose: () => void }) {
  const { money } = useMgmt();
  const q = useLoans({ page: 1, pageSize: 100, status: 'all', ...(borrower ? (borrower.type === 'student' ? { studentId: borrower.id } : { staffId: borrower.id }) : {}) }, !!borrower);
  const list = q.data?.data ?? [];
  const out = list.filter((l) => l.status !== 'returned');
  const fines = list.reduce((t, l) => t + l.fineMinor, 0);
  return (
    <Drawer open={!!borrower} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent title={borrower?.name ?? 'Borrower'} description={borrower ? `${borrower.type === 'staff' ? 'Staff' : [borrower.grade, borrower.section].filter(Boolean).join(' ')} · ${borrower.code}` : undefined} showTitle>
        {q.isPending ? (
          <SheetBody aria-busy>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </SheetBody>
        ) : q.isError ? (
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load their loans" />
        ) : (
          <>
            <SheetBody>
              <dl className="grid grid-cols-3 gap-4 rounded-lg border border-border p-4">
                <div>
                  <dt className="t-caption text-ink-2">Out now</dt>
                  <dd className="figure text-[22px] leading-7">{out.length}</dd>
                </div>
                <div>
                  <dt className="t-caption text-ink-2">Overdue</dt>
                  <dd className="figure text-[22px] leading-7">{list.filter((l) => l.status === 'overdue').length}</dd>
                </div>
                <div>
                  <dt className="t-caption text-ink-2">Fines</dt>
                  <dd className="figure text-[22px] leading-7">{money(fines)}</dd>
                </div>
              </dl>
              {list.length === 0 ? (
                <p className="text-sm text-ink-2">No loans recorded.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {list.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.book.title}</p>
                        <p className="t-caption text-ink-3">
                          Issued {fmtDate(l.issuedOn)} · due {fmtDate(l.dueOn)}
                          {l.fineMinor > 0 ? ` · fine ${money(l.fineMinor)}` : ''}
                        </p>
                      </div>
                      <LoanStatus l={l} />
                    </li>
                  ))}
                </ul>
              )}
            </SheetBody>
            <SheetFooter>
              <Button onClick={onClose}>Close</Button>
            </SheetFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
