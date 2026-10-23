'use client';

import * as React from 'react';
import { ExternalLink, FileDown } from 'lucide-react';
import type { MaterialItem } from '@school-sync/shared';
import { useMaterials, useSubjects } from '@/lib/client/learner-learning';
import { fileHref } from '@/lib/client/learner-files';
import { fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchField } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ErrorState, SkeletonRows } from '../states';
import { useLearner } from '../use-learner';
import { useUrlParams } from '../url-state';
import { Pager } from '../comms/common';

const PAGE_SIZE = 12;

/** Study materials for the class: a file (downloaded through the BFF) or a link to open. */
export function MaterialsView() {
  const l = useLearner();
  const { get, set } = useUrlParams();
  const page = Math.max(1, Number(get('page')) || 1);
  const subjectId = get('subject') ?? undefined;
  const urlQ = get('q') ?? '';
  const [q, setQ] = React.useState(urlQ);
  React.useEffect(() => setQ(urlQ), [urlQ]);
  React.useEffect(() => {
    if (q === urlQ) return;
    const t = setTimeout(() => set({ q: q || null, page: null }), 300);
    return () => clearTimeout(t);
  }, [q, urlQ, set]);

  const subjects = useSubjects();
  const query = useMaterials(l.studentId, l.isParent, { page, pageSize: PAGE_SIZE, q: urlQ, subjectId });
  const filtered = !!urlQ || !!subjectId;
  const subjectName = subjects.data?.find((s) => s.id === subjectId)?.name;

  return (
    <section aria-label="Study materials" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Search materials" className="w-full sm:w-64" hint={null} />
        <Select
          aria-label="Filter by subject"
          className="w-52"
          value={subjectId ?? 'all'}
          onValueChange={(v) => set({ subject: v === 'all' ? null : v, page: null })}
          options={[{ value: 'all', label: 'All subjects' }, ...(subjects.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))]}
        />
      </div>
      <Card>
        {query.isPending ? (
          <SkeletonRows rows={5} />
        ) : query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} title="We couldn’t load the study materials" />
        ) : query.data && query.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              illustration="no-results"
              title="No materials match"
              filters={
                <>
                  {subjectName && <Badge variant="outline">{subjectName}</Badge>}
                  {urlQ && <Badge variant="outline">“{urlQ}”</Badge>}
                </>
              }
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setQ('');
                    set({ q: null, subject: null, page: null });
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState illustration="empty-generic" title="No study materials yet" description="Notes, worksheets and links your teachers share will appear here." />
          )
        ) : (
          <>
            <ul className="divide-y divide-border">{query.data?.data.map((m) => <MaterialRow key={m.id} m={m} />)}</ul>
            {query.data && <Pager page={page} totalPages={query.data.meta.totalPages} total={query.data.meta.total} onPage={(p) => set({ page: p <= 1 ? null : p })} noun="materials" />}
          </>
        )}
      </Card>
    </section>
  );
}

/** Links are typed in by teachers: only ever open web addresses (never javascript: or data: URLs). */
const safeWebUrl = (u: string | null): string | null => {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : null;
  } catch {
    return null;
  }
};

function MaterialRow({ m }: { m: MaterialItem }) {
  const isFile = !!m.fileId;
  const link = safeWebUrl(m.url);
  return (
    <li className="flex items-start gap-3 px-5 py-4 max-sm:px-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{m.title}</p>
        {m.description && <p className="t-caption mt-0.5 line-clamp-2 text-ink-2">{m.description}</p>}
        <p className="t-caption mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
          <Badge variant="neutral">{m.subjectName}</Badge>
          <span>{[m.createdByName, fmtDate(m.createdAt.slice(0, 10))].filter(Boolean).join(' · ')}</span>
        </p>
      </div>
      {isFile ? (
        <Button asChild variant="secondary" size="sm">
          <a href={fileHref(m.fileId!, true)} download aria-label={`Download ${m.title}`}>
            <FileDown /> Download
          </a>
        </Button>
      ) : link ? (
        <Button asChild variant="secondary" size="sm">
          <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`Open ${m.title} (opens in a new tab)`}>
            <ExternalLink /> Open link
          </a>
        </Button>
      ) : null}
    </li>
  );
}
