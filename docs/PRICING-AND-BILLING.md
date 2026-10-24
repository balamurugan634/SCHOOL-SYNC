# Pricing model: per student, per academic year

The product is sold **per student for one academic year**. The system is built around that unit.

## The billable unit

> A **billable student** is a student who has an **enrollment in the subscription's academic year**, counted **once** per year.

* Source of truth is the school's own database: `enrollments` (one row per student per academic year).
* Transfers between sections, name changes, parent changes → no effect on the count.
* A student who joins mid-year is billed for that year (no proration by default — see "Decisions to confirm").
* Next year's promotion creates a *new* enrollment → a seat in **next year's** subscription.
* Staff, parents, and admin accounts are free and unlimited. Only students are metered.

## Data model (control plane — `schoolsync_control`)

| Table | Purpose |
|---|---|
| `subscriptions` | One per school per academic year: `academic_year` ("2026-27"), `starts_on`/`ends_on`, `price_per_student_minor`, `currency`, `licensed_students` (committed seats, NULL = unlimited), `overage_policy` (`allow_and_bill` \| `block`), `grace_days`, `status` (`trial`/`active`/`cancelled`) |
| `usage_snapshots` | Daily metering row per school: `billable_students`, `active_students`, staff, parents |
| `billing_invoices` | What *we* bill the school: `seats` (committed seats × price, issued at the start of the year) and `true_up` (students above what has been invoiced, at the peak of the year) |

## License states (`core/billing/license.ts`)

| State | When | Effect |
|---|---|---|
| `unlicensed` | no subscription on file (dev / onboarding) | unlimited, flagged in the platform listing |
| `trial` / `active` | inside the subscription period | normal |
| `grace` | period ended, within `grace_days` (default 30) | **full access** + warnings (renewal window) |
| `expired` / `cancelled` | past grace | **read-only**: all reads work, every write returns `402 SUBSCRIPTION_EXPIRED` (login/refresh/logout still work). Data is never locked away. Renewing restores write access immediately. |

## Seat enforcement

Any code that creates a *new* enrollment calls `assertSeatAvailable(tenant, db, n)` first (admission enroll, manual add, CSV import, year-end promotion):

* `overage_policy = block` → once `used + n > licensed_students` the call fails with `402 LICENSE_LIMIT_REACHED`.
* `overage_policy = allow_and_bill` (default) → always allowed; the extra students are billed as a **true-up**.
* `licensed_students = NULL` → unlimited; billed on actual peak.

School admins see seats used / committed, state and days left via `GET /api/v1/license` (and in the web "Get your school ready" wizard / settings). Near-limit (≥ 90 %) is flagged.

## Metering and invoicing

* The API worker takes a snapshot of every active school **every 6 hours** (idempotent per day); `pnpm billing snapshot` does it on demand.
* Start of year: `pnpm billing invoice --code <site> --year 2026-27 --kind seats` → committed seats × price.
* During/after the year: `--kind true_up` bills `peak billable students − students already invoiced`.
* Platform operators can do all of this over HTTP (`/api/v1/platform/*`, `X-Platform-Key`) — see the OpenAPI.

## Operating it

Day to day this is done in the **operator console** (`/platform`, see README): Schools (create, subscription, renew), Billing (seats against committed, true-up due, issue invoices, mark paid with date and reference, void with a reason) and the audit log. Invoice numbers are `BIL-<year>-<n>`, numbered from the highest number already issued for that year. The same operations remain available as CLI commands and over the key-protected HTTP API:


```bash
# new school with terms: 500 seats at ₹150 per student for 2026-27, blocking over-admission
pnpm site:create --code greenvalley --name "Green Valley School" --admin-email principal@gv.edu \
                 --price 150 --seats 500 --policy block
# renew for next year
pnpm billing subscribe --code greenvalley --year 2027-28 --start 2027-04-01 --end 2028-03-31 --price 160 --seats 520
pnpm billing usage                       # seats used vs licensed, for every school
```

## Decisions to confirm (assumptions I made — change in `core/billing/*` if your commercial terms differ)

1. **Count once per year, no proration** — a student admitted in February costs a full year's price.
2. **Withdrawn students still count** for the year they were enrolled (the seat was used). Switch to "active at snapshot date" if you bill on active students instead.
3. **Over the cap**: default is to keep admitting and bill the excess (never stop a school from admitting a child on the first day of term); use `block` for hard caps.
4. **Expiry** = read-only after a 30-day grace window, never data deletion.
5. Payments of *our* invoices are recorded outside the system for now (`billing_invoices.status` / `paid_at` set by an operator); no payment gateway for platform billing.
