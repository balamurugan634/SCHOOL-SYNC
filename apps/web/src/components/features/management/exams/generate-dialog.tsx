'use client';

import * as React from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FilePlus2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ExamOut } from '@school-sync/shared';
import { bff } from '@/lib/client/fetcher';
import { useExamMutation, type SheetGenerateOut } from '@/lib/client/exams-admin';
import { plural } from '@/lib/format';
import { useAccess } from '../shared/access';
import { paths } from '../shared/paths';

/** Outcome of "Generate mark sheets": created / already existed / skipped (with the reason per section and subject). */
export function GenerateResultDialog({ result, onClose, onFix }: { result: SheetGenerateOut | null; onClose: () => void; onFix?: () => void }) {
  return (
    <Dialog open={result !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Mark sheets generated" description="One sheet exists for every class and subject that has a subject teacher." size="lg">
        {result && (
          <div className="mt-4 space-y-4">
            <dl className="grid grid-cols-3 gap-3">
              {(
                [
                  ['Created', result.created],
                  ['Already existed', result.existing],
                  ['Skipped', result.skipped.length],
                ] as const
              ).map(([l, n]) => (
                <div key={l} className="rounded-lg border border-border p-3">
                  <dt className="t-caption text-ink-2">{l}</dt>
                  <dd className="figure text-[28px] leading-9">{n}</dd>
                </div>
              ))}
            </dl>
            {result.skipped.length > 0 ? (
              <>
                <Banner tone="warning" title={`${plural(result.skipped.length, 'class and subject')} got no sheet`}>
                  A sheet needs a subject teacher. Assign teachers under Academics › Teaching assignments, then generate again — sheets that already exist are not duplicated.
                </Banner>
                <div className="max-h-64 overflow-auto rounded-lg border border-border">
                  <table className="t-table w-full">
                    <caption className="sr-only">Skipped classes and subjects</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">Class</th>
                        <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">Subject</th>
                        <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-left text-ink-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.skipped.map((s) => (
                        <tr key={`${s.sectionId}-${s.subjectId}`} className="border-t border-border">
                          <td className="h-9 px-3">{s.sectionName}</td>
                          <td className="px-3">{s.subjectName}</td>
                          <td className="px-3 text-ink-2">{s.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Banner tone="success">Every class that has papers now has a mark sheet for each subject.</Banner>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {result && result.skipped.length > 0 && onFix && (
            <Button variant="secondary" onClick={onFix}>
              Open teaching assignments
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Generate mark sheets" for an exam: one sheet per class and subject that has a subject teacher (idempotent), then the outcome dialog.
 * Renders nothing unless the caller may edit exams and the exam is scheduled or later (and not yet published).
 */
export function GenerateSheetsButton({ exam, variant = 'secondary' }: { exam: ExamOut; variant?: 'primary' | 'secondary' }) {
  const access = useAccess();
  const router = useRouter();
  const [result, setResult] = React.useState<SheetGenerateOut | null>(null);
  const gen = useExamMutation(() => bff<SheetGenerateOut>(`/exams/${exam.id}/sheets/generate`, { method: 'POST', body: {} }), { onSuccess: setResult });
  if (!access.can('exams:edit') || exam.status === 'draft' || exam.status === 'published') return null;
  return (
    <>
      <Button variant={variant} loading={gen.isPending} disabled={!access.ok('exams:edit')} title={access.hint('exams:edit')} onClick={() => void gen.run()}>
        <FilePlus2 /> Generate mark sheets
      </Button>
      <GenerateResultDialog result={result} onClose={() => setResult(null)} onFix={() => router.push(paths.assignments())} />
    </>
  );
}
