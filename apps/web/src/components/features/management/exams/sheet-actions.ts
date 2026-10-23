'use client';

import type { SheetOut } from '@school-sync/shared';
import { bff } from '@/lib/client/fetcher';
import { useExamMutation } from '@/lib/client/exams-admin';

export type BulkKind = 'approve' | 'return' | 'publish';

/** Statuses a sheet must be in for each action (the API enforces the same rules). */
export const CAN_APPROVE = (s: Pick<SheetOut, 'status'>) => s.status === 'submitted';
export const CAN_RETURN = (s: Pick<SheetOut, 'status'>) => s.status === 'submitted' || s.status === 'approved';
export const CAN_PUBLISH = (s: Pick<SheetOut, 'status'>) => s.status === 'approved';

/** Single-sheet decisions (approve / return with a note / publish). Each call invalidates the exams cache and toasts the outcome. */
export function useSheetActions() {
  const label = (s: Pick<SheetOut, 'subjectName' | 'gradeName' | 'sectionName'>) => `${s.subjectName} · ${s.gradeName} ${s.sectionName}`;
  const approve = useExamMutation((s: SheetOut) => bff(`/marks/sheets/${s.id}/approve`, { method: 'POST', body: {} }), { success: (_r, s) => `Approved ${label(s)}` });
  const back = useExamMutation((v: { sheet: SheetOut; note: string }) => bff(`/marks/sheets/${v.sheet.id}/return`, { method: 'POST', body: { note: v.note } }), {
    success: (_r, v) => `Returned ${label(v.sheet)} to ${v.sheet.teacherName ?? 'the teacher'}`,
  });
  const publish = useExamMutation((s: SheetOut) => bff(`/marks/sheets/${s.id}/publish`, { method: 'POST', body: {} }), { success: (_r, s) => `Published ${label(s)}` });
  return { approve, back, publish, busy: approve.isPending || back.isPending || publish.isPending };
}

/** Run one decision over many sheets, one after another, and report how many went through. */
export function useBulkSheetAction() {
  return useExamMutation(
    async ({ kind, sheets, note }: { kind: BulkKind; sheets: SheetOut[]; note?: string }) => {
      const eligible = sheets.filter(kind === 'approve' ? CAN_APPROVE : kind === 'return' ? CAN_RETURN : CAN_PUBLISH);
      let done = 0;
      const failed: string[] = [];
      for (const s of eligible) {
        try {
          await bff(`/marks/sheets/${s.id}/${kind}`, { method: 'POST', body: kind === 'return' ? { note } : {} });
          done++;
        } catch {
          failed.push(`${s.subjectName} ${s.gradeName} ${s.sectionName}`);
        }
      }
      return { kind, done, failed, skipped: sheets.length - eligible.length };
    },
    {
      success: (r) => {
        const verb = r.kind === 'approve' ? 'Approved' : r.kind === 'return' ? 'Returned' : 'Published';
        return `${verb} ${r.done} sheet${r.done === 1 ? '' : 's'}${r.failed.length ? `; ${r.failed.length} could not be changed` : ''}${r.skipped ? `; ${r.skipped} skipped (wrong status)` : ''}`;
      },
    },
  );
}
