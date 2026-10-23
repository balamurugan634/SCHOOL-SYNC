# Backend conventions (apps/api)

Read `docs/ARCHITECTURE.md` and `docs/PRODUCT-BLUEPRINT.md` first. This file is the contract for anyone adding a module.

## 1. Module layout

```
apps/api/src/modules/<module>/
  routes.ts     Fastify plugin (HTTP only: schemas, guards, call service, shape response)
  service.ts    business logic + queries (+ more files if it grows)
packages/shared/src/<module>.ts    zod schemas + inferred types for requests/responses (add `export * from './<module>'` to shared/src/index.ts)
apps/api/src/cli/seed/<module>.ts  demo data (`export const seed: ModuleSeeder`)
apps/api/test/<module>.test.ts     tests
```
`modules/index.ts` already registers every module under `/api/v1` — a stub `routes.ts` exists for each; replace its body. Routes are `FastifyPluginAsyncZod`. Request/response schemas live in `packages/shared` so the web app imports the same types. **Every route must declare `schema`** (`tags`, `summary`, `params/querystring/body`, `response`) — the OpenAPI document is what the mobile app and web are built from.

## 2. Request context (set by plugins; see `plugins/context.ts`)

* `req.tenant` – the school (`TenantInfo`: id, code, timezone, currency, features, …)
* `req.db` – Drizzle handle on **that school's database** (there is no tenant_id column; isolation is physical)
* `req.auth` – `Principal` (after `requireAuth`/`requirePerm`): `userId`, `userType`, `studentId`, `guardianId`, `staffId`, `linkedStudentIds` (verified links only), `assignedSectionIds`, `classTeacherSectionIds`, `teaching[]`, `scope(perm)`, `can(perm, minScope)`, `teaches(sectionId, subjectId)`, `leadsSection(sectionId)`
* `actorOf(req)` – audit actor (user, ip, UA, request id)

## 3. Authorisation — Role + Scope + Action (the most important rule)

Permission keys are `resource:action` from `packages/shared/src/permissions.ts` (catalog + default role presets). A role grants a permission at a **scope**: `own < linked < assigned < school`. If you need a permission that's missing, add it to the catalog **and** to the right role presets, and tell the lead in your report.

Two layers, both mandatory:
1. **Route guard** – `preHandler: [requirePerm('attendance:view')]` (or `requireAnyPerm(...)`) proves the caller may use the feature at all.
2. **Record scope in the query** – restrict *which rows* with the predicates in `core/rbac/scope.ts`: `studentScope(p, perm)` (over `students`), `studentIdScope(p, perm, col)` (any column holding a student id), `sectionScope(p, perm, col)`, `assertStudentAccess(db, p, perm, studentId)`, `assertSectionAccess(p, perm, sectionId)`. Put them in the SQL `WHERE`; never fetch-then-filter in JS. Out-of-scope single records answer **404**, not 403 (don't reveal existence). A missing permission answers 403.

Extra rules that scopes alone don't express — implement them in the service:
* **Subject-level rights**: a teacher enters marks/homework only for `(section, subject)` pairs in `p.teaches(...)` (or sections they lead, where the feature allows), unless they hold `school` scope.
* **Class-teacher-only actions** (leave approval, remarks, attendance-correction approval): require `p.leadsSection(sectionId)` or `school` scope.
* **Published-only visibility**: students/parents (scope `own`/`linked`) must only ever see published results/announcements/schedules; unpublished drafts are invisible to them even by id.
* **Students cannot see other students**; parents only verified-linked children; the unverified guardian in the demo data (`9099999999`) must see nothing.
* Sensitive fields (medical notes, documents, finance) are returned only to callers whose permission covers them.

## 4. Route example (follow this shape)

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParam, pageQuery, paged } from '@school-sync/shared';
import { actorOf, audit } from '../../core/audit';
import { notFound } from '../../core/errors';
import { pageArgs, paged as pagedResult } from '../../core/http';
import { studentIdScope } from '../../core/rbac/scope';
import { requirePerm } from '../../plugins/guards';

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/leave', {
    preHandler: [requirePerm('leave:view')],
    schema: { tags: ['Leave'], summary: 'Leave requests visible to me', querystring: pageQuery.extend({ status: z.enum(LEAVE_STATUSES).optional() }), response: { 200: paged(leaveItem) } },
  }, async (req) => {
    const q = req.query;
    const where = and(studentIdScope(req.auth, 'leave:view', leaveRequests.studentId), q.status ? eq(leaveRequests.status, q.status) : undefined);
    const [rows, [count]] = await Promise.all([
      req.db.select().from(leaveRequests).where(where).orderBy(desc(leaveRequests.createdAt)).limit(pageArgs(q).limit).offset(pageArgs(q).offset),
      req.db.select({ n: sql<number>`count(*)::int` }).from(leaveRequests).where(where),
    ]);
    // tsconfig has noUncheckedIndexedAccess: array elements are `T | undefined` — never destructure `[{ n }]`
    return pagedResult(rows.map(toItem), count?.n ?? 0, q);
  });

  app.post('/leave/:id/approve', { preHandler: [requirePerm('leave:approve')], schema: { /* … */ } }, async (req) => {
    const result = await req.db.transaction(async (tx) => {
      // 1. load WITH the scope predicate → 404 if out of scope  2. enforce state machine  3. write  4. audit in the same tx
      await audit(tx, actorOf(req), { action: 'leave.approve', entity: 'leave_request', entityId: id, before, after });
      return updated;
    });
    // 5. notify AFTER commit
    await notify(req.db, req.tenant, { userIds: [...], type: 'leave.approved', title: '…', data: { route: `/leave/${id}` } });
    return result;
  });
};
export default routes;
```

Conventions: paths are plural kebab-case nouns; `GET /x` list, `GET /x/:id`, `POST /x` → **201** + the created object, `PATCH /x/:id` partial update, `DELETE /x/:id` (archive/soft-delete where history matters), state transitions as `POST /x/:id/<verb>` (`submit`, `approve`, `publish`, `cancel`). Lists use `{ data, meta }` (offset; small/medium lists) or `{ data, nextCursor }` (keyset, for big append-only tables: notifications, audit, attendance history) — see `core/http.ts`. Dates are `YYYY-MM-DD` strings, times `HH:MM`, instants ISO-8601; money is **integer minor units** (paise); ids are UUIDs. Validation errors → 422 automatically; use `AppError` helpers from `core/errors.ts` (`notFound`, `forbidden`, `conflict`, `unprocessable`, `badRequest`) with a stable machine `code`. Never return password hashes, token hashes, or other users' contact data you weren't entitled to.

## 5. Transactions, audit, notifications

* Multi-row writes and state transitions run in `req.db.transaction(async (tx) => …)`; services take an `Executor` (db or tx).
* **Audit** (`core/audit.ts`) every sensitive write — attendance submit/correct, marks entry/approve/publish, fee invoice/payment/refund/concession, role/permission change, admissions decisions, account activation/deactivation, announcement publish — inside the same transaction. Log `before`/`after` (secrets are auto-redacted).
* **Notifications** (`core/notify`): `notify(db, tenant, { userIds, type, title, body, data, priority })` writes inbox rows and queues FCM push. Call it **after** the transaction commits. `type` is dotted, first segment = preference category (`attendance.absent`, `homework.assigned`, `marks.published`, `fees.due`, `announcement.new`, `event.new`, `meeting.requested`, `leave.decided`, `system.*`). `data.route` is a client deep link path: `/attendance`, `/homework/<id>`, `/results/<examId>`, `/fees/invoices/<id>`, `/announcements/<id>`, `/events/<id>`, `/meetings/<id>`, `/leave/<id>`. Never put private details in `data`/push text — the dispatcher already replaces bodies of `fees|marks|meeting|leave` categories with a generic line; still keep titles neutral. Recipients must be authorised (e.g. the verified guardians of that student: `student_guardians` where `verified_at is not null` → `guardians.user_id`).

## 6. Per-student pricing (seat) rule

The school is billed per student per academic year; the billable unit is a student with an `enrollments` row in the licensed year. **Before creating an enrollment for a student who has none in that year** (new admission, manual add, CSV import, promotion into a new year) call `await assertSeatAvailable(req.tenant, tx, <number of NEW students>)` from `core/billing/license`. (It throws 402 `LICENSE_LIMIT_REACHED` under the `block` policy and 402 `SUBSCRIPTION_EXPIRED` when read-only; under `allow_and_bill` it always passes and the excess is invoiced later.) When the subscription is read-only the tenant plugin already rejects all writes except routes marked `config: { allowWhenReadOnly: true }` (login/refresh/logout only — do not add others without reason).

## 7. Performance rules (this must handle many schools and lots of rows)

No N+1 queries (batch with `inArray`/joins/`Map.groupBy`); every list is paginated with a capped page size; add an index for any new hot filter (declare in the Drizzle schema); aggregate in SQL (`count(*) filter (where …)`) rather than in JS; avoid `select *` on wide tables in lists; bulk inserts in chunks of ≤500; use `todayIn(req.tenant.timezone)` for "today". Settings come from `getSetting(db, 'attendance' | …)` (`core/settings.ts`).

## 8. Schema changes

You may **add** tables/columns/indexes in the Drizzle schema files for your own domain (`src/db/tenant/schema/*.ts`). Don't rename/remove existing columns or touch other domains' tables beyond adding something you need (mention it in your report). **Do not run `drizzle-kit generate`** and don't edit `src/db/tenant/migrations/` — the lead regenerates the baseline migration at the end. Tests build the schema directly from the TypeScript (`TENANT_SCHEMA_MODE=push`), so they always reflect your changes.

## 9. Tests (required)

`pnpm --filter @school-sync/api test` (vitest, a throwaway real PostgreSQL is started automatically; each test file gets its own school). Use `createTestSchool()` from `test/helpers.ts`: `s.login('t001')` → token, `s.req('GET','/path',token,body)`, `s.ctx` (seeded sections/students/guardians/teachers; logins in `src/cli/seed/core.ts`; password `Demo@12345`; pass `{ modules: true }` to also run every module's demo seeder). For each module test: happy paths; **the permission matrix** (which roles get 200/403 on key routes); **scope isolation** (teacher of section A cannot read/write section B; parent cannot see another family's child; unverified guardian sees nothing; student sees only self); state-machine rules; validation errors; audit rows written; notifications created for the right (authorised) recipients. `pnpm --filter @school-sync/api typecheck` must pass. Run only your own test files while iterating (`pnpm --filter @school-sync/api exec vitest run test/<module>.test.ts`) — other agents are working in parallel and their files may be mid-edit.

## 10. Demo seed

Implement `src/cli/seed/<module>.ts` (`export const seed: ModuleSeeder`) producing realistic demo data using `ctx` (see `seed/context.ts`; deterministic `ctx.rng`/`ctx.pick`/`ctx.int`; people & structure already exist). Keep it fast (bulk inserts). The finished demo school powers the web/mobile screenshots, so make it look real (varied attendance, some overdue fees, a published and an unpublished exam, etc.). Verify with `pnpm --filter @school-sync/api site:reset-demo` is **not** allowed while others work — test seeding via `createTestSchool({ modules: true })` instead.

## 11. Working agreements

Other agents edit the same repo concurrently: only touch your module's folders, your shared schema file, your seed/test files, and append-only lines in `shared/src/index.ts`. Don't run `pnpm install` unless you must add a dependency (then add it to `apps/api/package.json` and tell the lead). Don't start servers on port 4000 or 54329 (reserved); for manual checks start your own `PORT=41xx` instance or just use `app.inject` in tests. Don't `git commit`. Finish with a concise report: endpoints (method, path, who can call, one line), permissions added, schema changes, seed contents, notification types emitted, known gaps.

## 12. Background jobs

Reminders, scans and scheduled publishing are `Job`s (`core/jobs.ts`): export them from `modules/<module>/jobs.ts` (`export const jobs: Job[] = [{ name: 'fees.reminders', everyMinutes: 60, run: async (tenant, db) => … }]` — a stub file already exists per module). `run` receives a transaction holding a per-school advisory lock; it **must be idempotent** (e.g. record "reminded on <date>" so the same reminder is not sent twice). Test jobs by calling `runJobOnce(tenant, job)` or the function directly. The scheduler is wired in `main.ts` — don't edit it.

## 13. Machine resource rules (MANDATORY — a memory freeze already cost us a restart)

The dev machine has 16 GB RAM and only 2 GB swap, shared by several agents, VS Code, a browser, Postgres, an API, a dev server and sometimes an emulator. Running too many heavy jobs at once froze it (hard power-off needed). Therefore:

* Run **every heavy command** through the limiter: `/home/bala/SCHOOL-SYNC/scripts/dev/heavy.sh [-m SIZE] -- <command>`. It allows at most 3 heavy jobs system-wide (others queue automatically — just wait) and puts each in a memory-capped cgroup so a runaway job is killed alone instead of freezing the machine. Heavy = `tsc`/`pnpm typecheck`, `vitest`/`pnpm test`, `pnpm install/add`, `next build`, `flutter`/`gradle`/`dart analyze`, headless Chrome, the Android emulator. Default cap 3 GB (`-m 3G`); Gradle/flutter builds `-m 5G`; emulator `-m 4G --no-slot` (long-lived; max ONE emulator on the machine).
  Examples: `scripts/dev/heavy.sh -- pnpm --filter @school-sync/api exec vitest run test/fees.test.ts` · `scripts/dev/heavy.sh -m 5G -- flutter build apk --debug`
* Run **one heavy command at a time yourself**. No watch modes (`vitest` watch, `tsc --watch`, `tsx watch`). One dev server per app at most (`--no-slot`, e.g. Next: `heavy.sh --no-slot -m 3G -- env NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter @school-sync/web dev`).
* If a command reports "KILLED for exceeding its memory cap", don't just raise the cap: reduce parallelism or scope (run one test file, not the suite).
* When you finish with Gradle run `./gradlew --stop`; kill the emulator when done; don't leave background servers running.
* **Never use `pkill -f`/`killall` with a pattern that also appears in your own command line** — it kills your own shell. Kill by PID.
* A background guard (`scripts/dev/guard.sh`, user service `schoolsync-guard`) kills the single largest dev-tool process if free memory drops under ~1.2 GB; if one of your processes vanishes unexpectedly, check `~/.local/state/schoolsync-guard.log`.

## 14. Known pitfalls (learned the hard way)

* **Zod 4 re-applies `.default()` inside `.partial()`.** Never build a PATCH body as `createBody.partial()` when the create body has defaults: an empty/partial patch would silently reset stored values. Define PATCH bodies from fields that carry no defaults (or `.extend` the defaulted keys back as plain `.optional()`), and apply defaults in the service on create. `test/patch-schemas.test.ts` fails if any exported schema named like `…UpdateBody` / `…PatchBody` injects a default for `{}`.
* **Drizzle 0.45 wraps driver errors** in `DrizzleQueryError`; the Postgres error (with `code`/`constraint`) is on `.cause`. `plugins/errors.ts` already maps unique/FK violations to 409 — still pre-check expected conflicts in services to return a precise `code`.
* **`noUncheckedIndexedAccess`**: array elements are `T | undefined`; use `const [row] = …; row?.n ?? 0`, never `const [{ n }] = …`.
* **Seat checks** (`assertSeatAvailable`) are measured against the academic year being enrolled into (default: the school's current year), see docs/PRICING-AND-BILLING.md.
