'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { PromotionApplyOut, PromotionPreviewOut, StudentListItem, promotionBody } from '@school-sync/shared';
import { acad, type Paged } from './academics';
import { useApiMutation } from './mutations';

export type PromotionRequest = z.input<typeof promotionBody>;

/** Dry run (safe, writes nothing). */
export const usePromotionPreview = () => useApiMutation((b: PromotionRequest) => acad<PromotionPreviewOut>('/promotions/preview', { method: 'POST', body: b }), { toastError: false });

/** Applies the promotion. Needs `promotions:approve`. Touches enrolments, students, logins, seats — invalidate widely. */
export const useApplyPromotion = () =>
  useApiMutation((b: PromotionRequest) => acad<PromotionApplyOut>('/promotions/apply', { method: 'POST', body: b }), {
    invalidate: [['academics'], ['people'], ['dashboard'], ['attendance'], ['timetable'], ['setup'], ['license'], ['sessions']],
    toastError: false,
  });

// ── per-student exceptions: the students of one section (current-year enrolments) ───────────────

export const useSectionStudents = (sectionId: string | null, page: number, pageSize: number, enabled = true) =>
  useQuery<Paged<StudentListItem>>({
    queryKey: ['people', 'students', 'promotion-picker', sectionId, page, pageSize],
    queryFn: ({ signal }) => acad<Paged<StudentListItem>>('/students', { query: { sectionId: sectionId ?? undefined, page, pageSize }, signal }),
    enabled: !!sectionId && enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
