import { z } from 'zod';

export const uuid = z.uuid();
/** `YYYY-MM-DD` */
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
/** `HH:MM` 24h */
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
export const isoDateTime = z.iso.datetime({ offset: true });

export const MAX_PAGE_SIZE = 100;

/** Offset pagination for small/medium lists. */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  q: z.string().trim().max(100).optional(),
});
export type PageQuery = z.infer<typeof pageQuery>;

/** Keyset pagination for large, append-heavy lists (notifications, audit, attendance history). */
export const cursorQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(30),
});

export const pageMeta = z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() });
export const paged = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), meta: pageMeta });
export const cursored = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });

export const idParam = z.object({ id: uuid });

/** RFC 9457 problem details, as returned by every error response. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  code: z.string(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export const okSchema = z.object({ ok: z.literal(true) });
