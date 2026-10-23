'use client';

/** Operations hooks: transport (vehicles, routes, stops, allocations, manifests) and library (catalogue, loans, policy). */
import type { z } from 'zod';
import type {
  LibraryBook,
  LibraryIssue,
  LibraryPolicy,
  TransportAllocation,
  TransportManifest,
  TransportRoute,
  TransportStop,
  TransportVehicle,
  libraryBookCreateBody,
  libraryBookUpdateBody,
  libraryOverdueResponse,
  libraryPolicyUpdateBody,
  transportAllocationBody,
  transportRouteCreateBody,
  transportRouteDetail,
  transportRouteUpdateBody,
  transportStopCreateBody,
  transportStopUpdateBody,
  transportVehicleCreateBody,
  transportVehicleUpdateBody,
} from '@school-sync/shared';
import { useApiMutation, useGetQuery, usePagedQuery, type Query } from './mgmt';

export type RouteDetail = z.infer<typeof transportRouteDetail>;
export type OverdueResponse = z.infer<typeof libraryOverdueResponse>;
const T: string[][] = [['transport']];
const L: string[][] = [['library']];

// ── transport ───────────────────────────────────────────────────────────────────────────────
export const useVehicles = (query: Query, enabled = true) => usePagedQuery<TransportVehicle>(['transport', 'vehicles'], '/transport/vehicles', query, { enabled });
export const useCreateVehicle = () => useApiMutation<z.infer<typeof transportVehicleCreateBody>, TransportVehicle>({ path: () => '/transport/vehicles', body: (v) => v, invalidate: T });
export const useUpdateVehicle = () => useApiMutation<{ id: string; body: z.infer<typeof transportVehicleUpdateBody> }, TransportVehicle>({ method: 'PATCH', path: (v) => `/transport/vehicles/${v.id}`, body: (v) => v.body, invalidate: T });
export const useRetireVehicle = () => useApiMutation<{ id: string }, unknown>({ method: 'DELETE', path: (v) => `/transport/vehicles/${v.id}`, invalidate: T });

export const useRoutes = (query: Query, enabled = true) => usePagedQuery<TransportRoute>(['transport', 'routes'], '/transport/routes', query, { enabled });
export const useRoute = (id: string | null) => useGetQuery<RouteDetail>(['transport', 'route', id], id ? `/transport/routes/${id}` : null, undefined, { staleTime: 10_000 });
export const useCreateRoute = () => useApiMutation<z.infer<typeof transportRouteCreateBody>, TransportRoute>({ path: () => '/transport/routes', body: (v) => v, invalidate: T });
export const useUpdateRoute = () => useApiMutation<{ id: string; body: z.infer<typeof transportRouteUpdateBody> }, TransportRoute>({ method: 'PATCH', path: (v) => `/transport/routes/${v.id}`, body: (v) => v.body, invalidate: T });
export const useRetireRoute = () => useApiMutation<{ id: string }, unknown>({ method: 'DELETE', path: (v) => `/transport/routes/${v.id}`, invalidate: T });

export const useAddStop = () => useApiMutation<{ routeId: string; body: z.infer<typeof transportStopCreateBody> }, TransportStop>({ path: (v) => `/transport/routes/${v.routeId}/stops`, body: (v) => v.body, invalidate: T });
export const useUpdateStop = () => useApiMutation<{ id: string; body: z.infer<typeof transportStopUpdateBody> }, TransportStop>({ method: 'PATCH', path: (v) => `/transport/stops/${v.id}`, body: (v) => v.body, invalidate: T });
export const useDeleteStop = () => useApiMutation<{ id: string }, unknown>({ method: 'DELETE', path: (v) => `/transport/stops/${v.id}`, invalidate: T });
export const useReorderStops = () => useApiMutation<{ routeId: string; stopIds: string[] }, unknown>({ method: 'PUT', path: (v) => `/transport/routes/${v.routeId}/stops/order`, body: (v) => ({ stopIds: v.stopIds }), invalidate: T });

export const useManifest = (routeId: string | null) => useGetQuery<TransportManifest>(['transport', 'manifest', routeId], routeId ? `/transport/routes/${routeId}/manifest` : null, undefined, { staleTime: 15_000 });
export const useAllocations = (query: Query, enabled = true) => usePagedQuery<TransportAllocation>(['transport', 'allocations'], '/transport/allocations', query, { enabled });
export const useAllocate = () => useApiMutation<{ studentId: string; body: z.infer<typeof transportAllocationBody> }, unknown>({ method: 'PUT', path: (v) => `/transport/students/${v.studentId}`, body: (v) => v.body, invalidate: T });
export const useDeallocate = () => useApiMutation<{ studentId: string }, unknown>({ method: 'DELETE', path: (v) => `/transport/students/${v.studentId}`, invalidate: T });

// ── library ─────────────────────────────────────────────────────────────────────────────────
export const useBooks = (query: Query, enabled = true) => usePagedQuery<LibraryBook>(['library', 'books'], '/library/books', query, { enabled });
export const useBookCategories = (enabled = true) => useGetQuery<{ data: string[] }>(['library', 'categories'], '/library/categories', undefined, { enabled, staleTime: 60_000 });
export const useCreateBook = () => useApiMutation<z.infer<typeof libraryBookCreateBody>, LibraryBook>({ path: () => '/library/books', body: (v) => v, invalidate: L });
export const useUpdateBook = () => useApiMutation<{ id: string; body: z.infer<typeof libraryBookUpdateBody> }, LibraryBook>({ method: 'PATCH', path: (v) => `/library/books/${v.id}`, body: (v) => v.body, invalidate: L });
export const useArchiveBook = () => useApiMutation<{ id: string }, unknown>({ method: 'DELETE', path: (v) => `/library/books/${v.id}`, invalidate: L });

export const useLoans = (query: Query, enabled = true) => usePagedQuery<LibraryIssue>(['library', 'loans'], '/library/issues', query, { enabled });
export const useOverdue = (query: Query, enabled = true) => useGetQuery<OverdueResponse>(['library', 'overdue'], '/library/overdue', query, { enabled, staleTime: 15_000, keepPrevious: true });
export const useIssueBook = () => useApiMutation<{ bookId: string; studentId?: string; staffId?: string; dueOn?: string }, LibraryIssue>({ path: () => '/library/issues', body: (v) => v, invalidate: [...L, ['dashboard']] });
export const useReturnBook = () => useApiMutation<{ id: string; waiveFine: boolean }, LibraryIssue>({ path: (v) => `/library/issues/${v.id}/return`, body: (v) => ({ waiveFine: v.waiveFine }), invalidate: L });
export const useLibraryPolicy = (enabled = true) => useGetQuery<LibraryPolicy>(['library', 'policy'], '/library/policy', undefined, { enabled, staleTime: 60_000 });
export const useSavePolicy = () => useApiMutation<z.infer<typeof libraryPolicyUpdateBody>, LibraryPolicy>({ method: 'PUT', path: () => '/library/policy', body: (v) => v, invalidate: L });
