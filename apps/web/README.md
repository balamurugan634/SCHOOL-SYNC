# SchoolSync web (`apps/web`)

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS 4 · TanStack Query 5 · react-hook-form + zod 4 · `motion` · Radix primitives.
One deployment serves **many schools**; every school ("site") is resolved per request. The browser never sees a token.

## Run it

```bash
pnpm install                                   # repo root
cp apps/web/.env.example apps/web/.env.local   # defaults point at the local API and the "demo" school
pnpm dev:api                                   # API on :4000 (needs `pnpm dev:db` + a seeded demo site, see root README)
pnpm dev:web                                   # web on :3000
```

Open **http://demo.localhost:3000** (Chrome/Firefox resolve `*.localhost` to loopback — this exercises the real per-host
school resolution) or http://localhost:3000 (falls back to `NEXT_PUBLIC_DEFAULT_SITE=demo`).

Demo users (password `Demo@12345`): `admin@greenvalley.edu` (management / super admin), `principal`, `accounts`, `t001` (teacher),
`gv20260001` (student), `9000000001` (parent), `9099999999` (parent whose child link is unverified → "No linked children yet").

Scripts: `dev` · `build` · `start` · `typecheck` · `lint` · `smoke` (text-only route/API check) · `verify` (behaviour checks of the four reference screens; `--only=dashboard|rollcall|parent|invoices|a11y`, `--no-payment`) · `illustrations` (codegen). `NEXT_DIST_DIR=.next-verify pnpm build` builds without touching a running dev server's `.next`.
Memory-heavy commands (`typecheck`, `build`, Chrome) must go through `scripts/dev/heavy.sh` — see `docs/CONVENTIONS.md` §13.

### Environment (`.env.example`)

| Variable | Purpose |
|---|---|
| `API_URL` | Fastify API base (server-side only), default `http://localhost:4000` |
| `BASE_DOMAIN` | DNS base for school sub-domains, no port (`localhost`, `schoolsync.app`) |
| `NEXT_PUBLIC_BASE_DOMAIN` | `host[:port]` used to *build* school URLs (`localhost:3000`) |
| `NEXT_PUBLIC_DEFAULT_SITE` | fallback school code (`demo` in dev); unset → "Find your school" |
| `SITE_SELECT_MODE` | `cookie` (dev: remember the chosen school in a cookie) or `redirect` (prod: send to `<code>.<BASE_DOMAIN>`) |
| `COOKIE_SECURE` | default `true` in production (also enables the `__Host-` cookie prefix); set `false` only for an http smoke test |
| `ENABLE_DEV_PREVIEW` | dev-only: synthetic role-shell preview and the `ss_dev_brand` cookie (preview another school colour); ignored when `NODE_ENV=production` |
| `BUILD_STANDALONE=1` | at build time: emit `.next/standalone` for Docker |

When the API sits behind a proxy, set `TRUST_PROXY=true` on the API: the BFF forwards `X-Forwarded-For` / `User-Agent` on login so the sessions list shows the real device.

## How a school is resolved (`src/lib/server/site.ts`)

`<code>.<BASE_DOMAIN>` → registered custom domain (API `tenant_domains`, looked up with the Host header) → cookie from the *Find your school* page → `NEXT_PUBLIC_DEFAULT_SITE` → none (→ `/find-school`).
The API call always carries `X-Tenant: <code>`. Unknown code → find-school with an error; suspended school → `/unavailable`; `readOnly` / `402 SUBSCRIPTION_EXPIRED` → persistent banner.

## Auth / BFF (no tokens in the browser)

* `POST /api/auth/login` → API login → `ss_at` (access, short), `ss_rt` (refresh), `ss_ts` (school the session belongs to): **HttpOnly, SameSite=Lax, Secure + `__Host-` in production**, host-only (= per school).
* `src/proxy.ts` (Next 16 "middleware"): CSRF (state-changing `/api/*` must be same-origin), signed-out gate for the role areas, and **pre-emptive refresh** when the access cookie has lapsed — single-flight (`lib/server/refresh.ts`) so parallel requests never replay a rotated refresh token; the API's `409 REFRESH_RACE` is retried via `/api/auth/refresh`.
* `GET /api/auth/refresh?next=` — server components cannot set cookies, so a 401 there redirects here; loop-guarded.
* `/api/bff/<path>` → API `/api/v1/<path>`: attaches the bearer, refreshes once on 401 and retries, streams binary (files) through. Client code uses `bff()` (`lib/client/fetcher.ts`); server components use `api()` / `getMe()` (`lib/server/session.ts`).
* Errors are RFC 9457 problem+json → `ApiError` (`lib/problem.ts`) with `code`, `detail`, `errors[]`, `retryAfterSeconds`.

## Structure

```
src/
  proxy.ts                         CSRF · refresh · gate
  app/
    (auth)/            /  /login /forgot-password /reset-password   one centred card; `/` IS the sign-in page (signed-in visitors go home)
    find-school/ unavailable/      no-school and suspended states
    (app)/                         signed-in area (forces /change-password while mustChangePassword)
      student/ parent/ teacher/ admin/   one layout (shell) per experience; [...slug] = "coming online" pages
      admin/setup/                 "Get your school ready" wizard + licence card
      account/ (profile, sessions) change-password/
    api/auth/* api/bff/[...path] api/site/select   route handlers
    dev/preview/[experience]       DEV ONLY synthetic role shells (404 in production)
  components/
    ui/        design system (see "Building feature pages"): Button IconButton Input Select Checkbox Textarea DatePicker Tabs Accordion
               Dialog Sheet/Drawer Popover Tooltip DropdownMenu Toast Badge/StatusChip ProgressBar/Ring Skeleton EmptyState Avatar Timeline
               Card StatTile Banner Stepper DataTable ChartCard form.tsx (FormInput …) · charts/ series charts · illustrations/ generated
    shell/     AppShell (grouped sidebar, bottom nav, top bar), UserMenu, ⌘K, welcome tour, read-only banner
    dashboard/ role homes (real numbers only; one quiet "Coming online" card) · setup/ checklist + licence · auth/ account/
  lib/         nav.ts (the navigation + permission gating), permissions.ts, color.ts (brand → accessible palette), setup.ts
```

**Theming** (`/design.md`, "Paper & Ink"): tokens are CSS variables in `app/globals.css` exposed through Tailwind `@theme` (`bg-surface`, `text-ink-2`, `border-border-strong`, `bg-brand-soft`, `text-brand-ink`, `text-success`, …). The school's `primaryColor` is normalised in OKLCH by `lib/color.ts` (chroma ≤ 0.14, lightness 0.36–0.50, AA white text) and written per request as `--b-*` variables (`<style id="brand-vars">` in `app/layout.tsx`); dark mode via `next-themes` (`data-theme`). Fonts: Manrope (display, titles, figures via `.figure`/`.t-page`) + Inter (UI). Roles differ by navigation, not colour (small role tints only on the sidebar sub-label and avatar ring).

**Gating**: `lib/nav.ts` lists every screen with the permission(s) it needs; `Me.permissions` (permission → scope) hides what the user can't use. The API enforces for real.

## Phase 2 hooks

* A feature screen = add `app/(app)/<experience>/<path>/page.tsx` — a static segment beats the `[...slug]` placeholder, and `lib/nav.ts` already knows the permission.
* Setup wizard: done / count / hint per step come from `GET /setup/status` (`lib/client/use-setup.ts`); `lib/setup.ts` only adds the guidance and the deep link into the screen where each step is done.
* Dashboards: replace the `ComingSoonCard` in `components/dashboard/homes.tsx` with real cards and stat tiles.
* `DataTable`, `DatePicker`, `Select`, `Dialog` are ready for the list/form screens.

## Building feature pages

Everything below is what the rollout agents rely on. Design rules live in `/design.md`; if code and that file disagree, fix the code.

### 1. Add a page

* **Route file**: `src/app/(app)/<experience>/<path>/page.tsx` where `<experience>` is `student`, `parent`, `teacher` or `admin` (management). The role layout already requires the right experience and wraps the page in the shell (sidebar, top bar, ⌘K, welcome tour, read-only banner). A static page segment beats the `[...slug]` "Coming online" placeholder automatically.
  Example: `app/(app)/admin/finance/invoices/page.tsx` serves `/admin/finance/invoices`. Detail routes (`/admin/students/[id]`) work the same way. `/account/*` and `/change-password` are shared by all roles.
* **Nav entry**: `src/lib/nav.ts`. `STUDENT_NAV` / `PARENT_NAV` / `TEACHER_NAV` are flat lists, `MANAGEMENT_NAV` is grouped (Overview · Academics · People · Finance · Communication · Operations · Reports · Settings & Access). An item is
  `{ id, label, short?, href (relative to the experience base, '' = home), icon (lucide), perm?: PermissionKey | PermissionKey[] (any-of), minScope?, feature?: 'fees'|'transport'|'library'|…, blurb?, includes? }`.
  Items whose route does not exist yet render the placeholder from `blurb`/`includes`; once you add the page, keep the item as is (just remove nothing). Bottom bar on phones shows max 5 items (`short` = its label there).
* **Permission gating**: the nav hides items by `Me.permissions` (UI only — the API enforces). In a server page:
  ```tsx
  const me = await requireMe();                                   // lib/server/session.ts
  if (!can(me.permissions, 'fees:view', 'school')) return <NoAccess />;   // lib/permissions.ts, components/dashboard/coming-online.tsx
  ```
  In client code: `const { can, canAny } = usePermissions();` (`components/me-context.tsx`) to hide buttons (`can('payments:create')`). Scopes: `own < linked < assigned < school`.
* **Page skeleton**: `<PageHeader title description actions crumbs? />` (one `h1`, Manrope 26/34) then content in cards. Every list/table/form/chart needs **loading (skeleton, same size), empty, error (inline retry) and populated** states.

### 2. Data fetching

* Browser → BFF → API. **Never** call the API directly. `bff<T>(path, { method?, body?, query?, headers?, signal? })` from `lib/client/fetcher.ts`; `path` is the API path below `/api/v1` (`bff('/fees/invoices', { query: { page: 1 } })`). It throws `ApiError` (`lib/problem.ts`: `status`, `code`, `detail`, `errors[]`, `fieldErrors`, `retryAfterSeconds`); `errorMessage(e)` gives a human sentence. A 401 for a dead session redirects to sign-in; a 402 `SUBSCRIPTION_EXPIRED` flips the app to read-only automatically (banner) — still catch it where a button needs to show feedback.
* Use TanStack Query. Put hooks in `lib/client/hooks.ts` (or a new `lib/client/<domain>.ts`) — see the existing ones. **Keys** are arrays, domain first: `['fees','invoices', filters]`, `['fees','invoice', id]`, `['attendance','roster', sectionId, date]`, `['dashboard','management']`. Invalidate by prefix after mutations (`qc.invalidateQueries({ queryKey: ['fees'] })`), use `placeholderData: keepPreviousData` for paged lists, `staleTime` 15–60 s.
* Types and request schemas come from `@school-sync/shared` (`ManagementDashboard`, `InvoiceOut`, `attendanceSubmitBody`, …). Money is integer minor units: format with `money()/moneyCompact()` in `lib/format.ts` (also dates, `percent`, `plural`). Paged responses are `{ data, meta: { page, pageSize, total, totalPages } }` (`Paged<T>` in hooks.ts).
* Non-idempotent creates that must not repeat (payments): send `headers: { 'idempotency-key': crypto.randomUUID() }` — generate the key once per attempt and reuse it on retry (the BFF forwards it).
* Server components may use `api<T>(path)` / `getMe()` from `lib/server/session.ts`, but prefer client queries so loading/error states are uniform.

### 3. Forms

`react-hook-form` + zod **schemas from `@school-sync/shared`** (the browser then validates exactly what the API will):

```tsx
const form = useZodForm(paymentCreateBody, { defaultValues: { invoiceId, method: 'cash' } });   // lib/client/use-zod-form.ts
<form onSubmit={form.handleSubmit(async (v) => { try { await save.mutateAsync(v); toast.success('Saved'); } catch (e) { setFormError(applyApiErrors(form, e)); } })}>
  <FormSection title="Payment">
    <FormInput control={form.control} name="reference" label="Reference" />          {/* components/ui/form.tsx */}
    <FormSelect control={form.control} name="method" label="Method" options={[…]} />
    <FormDate / FormTextarea / FormCheckbox … />
  </FormSection>
  {formError && <Banner tone="danger">{formError}</Banner>}
  <FormActions><Button variant="secondary">Cancel</Button><Button type="submit" loading={form.formState.isSubmitting}>Save</Button></FormActions>
</form>
```
Rules: sections of ≤ 7 fields; validation on blur, summary on submit; map server errors with `applyApiErrors` (returns a message for a form-level Banner when nothing attached); guard unsaved work with `useUnsavedGuard(form.formState.isDirty)` (`lib/client/use-unsaved-guard.tsx` → `{ guard(action), dialog }`, render `dialog` once; for a drawer also call `guard(() => close())` from `onInteractOutside`/`onOpenChange`); success = `toast.success(…)` (`components/ui/toaster.tsx`, errors `toast.error(msg, { duration: 8000 })`).

### 4. Component API (all in `src/components/ui/` unless noted)

| Component | File | Notes / main props |
|---|---|---|
| `Button` / `buttonVariants` | `button.tsx` | `variant`: `primary` `secondary` `ghost` `danger` `danger-solid` (confirm dialogs only) `link`; `size`: `sm` `md` `lg` `icon` `icon-sm`; `loading` (spinner replaces label, width fixed), `asChild` |
| `IconButton` | `icon-button.tsx` | `label` (required: tooltip + aria-label), same variants/sizes |
| `Input` `PasswordInput` `SearchField` `Textarea` `Field` | `input.tsx` | `Field{label,htmlFor,hint,error,required}`; `Input{leftIcon,rightSlot,invalid}`; `SearchField{value,onChange,placeholder,hint='/'}` |
| `Select` | `select.tsx` | `{value,onValueChange,options:[{value,label,disabled?}],placeholder,invalid,id}` |
| `Checkbox` | `checkbox.tsx` | Radix props (`checked` may be `'indeterminate'`) |
| `DatePicker` | `date-picker.tsx` | `{value:'YYYY-MM-DD'|null,onChange,min,max,weekStartsOn,presets:[{label,value}],invalid}` |
| `Form*` | `form.tsx` | `FormSection`, `FormActions`, `FormInput/FormTextarea/FormSelect/FormDate/FormCheckbox({control,name,label,hint,required})` |
| `Tabs` `TabsList` `TabsTrigger` `TabsContent` | `tabs.tsx` | underline tabs, animated indicator; controlled (`value`,`onValueChange`) or `defaultValue` |
| `Accordion*` | `accordion.tsx` | Radix (`type="single" collapsible`), 200 ms height animation |
| `Dialog*` | `dialog.tsx` | `<DialogContent title description size="md"|"lg" hideClose>`; centred ≥ 640 px, **bottom sheet on phones**; `ConfirmDialog` (`confirm-dialog.tsx`: `{open,onOpenChange,title,description,confirmLabel,destructive,loading,onConfirm}`, focus starts on Cancel) |
| `Sheet` / `Drawer*` | `dialog.tsx` | `<Drawer open onOpenChange><DrawerContent title description showTitle?><SheetBody>…</SheetBody><SheetFooter>actions</SheetFooter></DrawerContent></Drawer>`; right 480 px on desktop, bottom sheet with drag handle on phone; `side="left"` = nav drawer |
| `Popover*` `Tooltip` `DropdownMenu*` | `popover.tsx` `tooltip.tsx` `dropdown-menu.tsx` | `Tooltip{content,side}` wraps one child; menu has `Item`, `CheckboxItem`, `RadioItem`, `Label`, `Separator`, `danger` item |
| `toast` / `Toaster` | `toaster.tsx` | `toast.success/error/message(title,{description,duration,action})` (sonner) |
| `Badge` `StatusChip` | `badge.tsx` | `StatusChip status="present|late|absent|leave|half_day|paid|unpaid|partial|overdue|pending|approved|…"` (icon + label); `Badge variant` `neutral primary success warning danger info accent outline` |
| `ProgressBar` `ProgressRing` | `progress.tsx` | `{value,max,tone,label}` (label required for a11y) |
| `Skeleton` `SkeletonText` | `skeleton.tsx` | give it the final size so nothing shifts |
| `EmptyState` | `empty-state.tsx` | `{illustration?: IllustrationName|node, icon?, title, description?, action?, filters?, compact?}` — one sentence + one action; for "no results" pass the active `filters` chips + a Clear action |
| `Illustration` | `components/illustrations/illustration.tsx` | `<Illustration name="empty-generic" title? role? />`; names: `empty-generic` `empty-homework` `empty-events` `empty-notifications` `no-results` `error-offline` `first-use` `success` `setup-complete` `sign-in` `onboarding-student|parent|teacher|management`. Regenerate from `design/illustrations/*.svg` with `pnpm --filter @school-sync/web illustrations` (output `generated.tsx` is committed). Only for empty / no-results / success / error / onboarding — never inside data views |
| `Avatar` `AvatarStack` | `avatar.tsx` | initials on sunken circle; `ring role` only for the signed-in user |
| `Timeline` | `timeline.tsx` | `[{id,title,detail?,at,tone}]`, relative time with absolute on hover |
| `Card` `CardHeader{title,description,action}` `CardBody` `CardFooter` | `card.tsx` | `interactive` lifts on hover |
| `StatTile` | `stat-tile.tsx` | `{label,value,hint?,delta?:{value,direction,good?},spark?:number[],state?:'loading'}` — figure in Manrope, no icon tile |
| `Banner` | `banner.tsx` | `tone` `info success warning danger locked`, icon included |
| `PageHeader` | `components/shell/page-header.tsx` | `{title,description?,actions?,crumbs?}` |
| `DataTable<T>` | `data-table.tsx` | see below |
| `ChartCard`, `ChartContainer`, `ChartLegend`, `chartTooltip` | `chart.tsx` | see below |
| `LineSeries` `BarSeries` | `components/charts/series-charts.tsx` | `{data,xKey,yKey,label,height,xFormat?,tooltipLabel?,yFormat?,valueFormat?,horizontal?}` single series in `--brand` |
| `Reveal` `useFirstLoad` | `reveal.tsx` | stagger on a dashboard's first load only (≤ 6 × 40 ms) |

**DataTable** (`id` is the persistence key for column visibility):
```tsx
<DataTable id="fees-invoices" rows={data?.data} rowKey={(r) => r.id} loading={q.isPending} error={q.error} onRetry={q.refetch}
  columns={[{ id:'no', header:'Invoice', cell:(r)=>r.invoiceNo, sortable:true, sortValue:(r)=>r.invoiceNo, mobile:'title' },
            { id:'status', header:'Status', cell:(r)=><StatusChip status={r.status}/>, mobile:'status' }, …]}
  sort={sort} onSortChange={setSort}                          // controlled = server-side; omit for client sort of the page
  page={page} pageSize={size} total={data?.meta.total} onPageChange={setPage} onPageSizeChange={setSize}
  selectable selected={sel} onSelectedChange={setSel} bulkActions={(rows, clear) => <Button …/>}
  onRowClick={(r) => open(r.id)} filters={<FilterChips/>} toolbar={<ExportButton/>}
  empty={<EmptyState illustration="no-results" title="No invoices match" filters={…} action={<Button>Clear filters</Button>} />} />
```
Column `mobile`: `'title' | 'sub' | 'status' | 'value' | 'detail' | 'hide'` decides the stacked card on phones. Keep URL state (filters, page, sort) in the query string so deep links work.

**Charts** (design.md §10): wrap every chart in `ChartCard` (title, summary sentence, Chart/Table toggle with `table={{columns,rows}}`, `loading`, `error`, `empty`, fixed `height`, `legend` config for ≥ 2 series). Colours only from `--chart-1…6` in fixed order (single series = `--brand`), set via the `ChartConfig` (`{ key: { label, color:'var(--chart-1)' } }`); use `chartTooltip(config)`, `chartTick`, `chartGrid`, `useDrawOnce()` for the one-time 400 ms draw. No dual axes, no per-point labels, thin lines. Direct Recharts primitives go inside `ChartContainer`.

### 5. Motion, a11y, resources

* CSS transitions for hover/focus/press (`tr-colors`, `press` utilities, durations from `--dur-*`); `motion` only via `m.*` components (LazyMotion + `domAnimation` at the root, `MotionConfig reducedMotion="user"`). Page change = 200 ms fade + 4 px rise (`.page-in`). Never delay an action for an animation.
* Targets ≥ 44 px on phones, visible focus (never remove), `aria-label`s on icon buttons, status = icon + label, one `h1` per page.
* Heavy commands go through `scripts/dev/heavy.sh` (`typecheck`, `lint`, `build` with `-m 3G`; one Next dev server with `--no-slot`). Text-only verification: `pnpm --filter @school-sync/web smoke` (logs in, visits routes, prints status codes, h1s, horizontal-scroll and console errors) and `verify` (roll call, invoices, charts, reduced motion, 360 px reflow, layout shift). Add your routes to `USERS` in `scripts/smoke.mjs`.
