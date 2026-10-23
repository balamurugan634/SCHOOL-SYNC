# SchoolSync — Design System (`design.md`)

Single source of truth for the look, feel and motion of **web (`apps/web`)** and **mobile (`SCHOOL-SYNC-MOBILE`)**.
Supersedes `docs/DESIGN.md` (removed). If code and this file disagree, fix the code — or change this file first.

---

## 1. Direction: "Paper & Ink"

A calm, editorial look for a school: **warm paper surfaces, ink-dark text, one deep teal brand colour, a warm amber accent,
a clean geometric sans (Manrope) for display type and a precise sans (Inter) for the interface.** It feels like a well-made school diary — trustworthy
for parents, quick for teachers, and information-rich for the office — and it does not look like a stock admin template.

**Directions considered** (from the brief) and what we took from each:

| Direction | Verdict |
|---|---|
| 1 Refined minimalism / whitespace / precise type | **Core.** Generous space, precise hierarchy. |
| 2 Soft surfaces, controlled shadows | **Core.** Layered paper surfaces, hairline borders, whisper-soft shadows. |
| 3 Editorial layouts / strong type hierarchy | **Core.** Serif display + sans UI; big, calm headings and figures. |
| 4 Data-dense, clearly grouped | **Used inside data screens** (tables, rosters) — density via grouping, not borders. |
| 5 Selective vibrant accent + illustrations | **Used sparingly:** one accent, illustrations only in onboarding/empty/success/auth. |
| 6 Depth via gradients / translucency | **Only where it helps:** a sticky top bar blur on scroll, a ≤4 % brand wash behind hero areas. No glow, no gradient text. |

**Banned (these made the first pass look "generated"):** gradient or glowing headlines/buttons, blurred colour blobs,
concentric-circle backdrops, floating fake-UI chips, coloured icon tiles on every list item, big saturated full-bleed panels,
purple/indigo anything, slogans as headlines, all-caps tracked eyebrows, weights above 600, shadows heavier than §5.

## 2. Colour

All colour is a **semantic token** (CSS variable on web; `ColorScheme`/theme extension on Flutter). Components never use
raw hex. Contrast targets WCAG 2.2 AA (4.5:1 text, 3:1 large text/UI/marks).

### 2.1 Neutrals ("paper & ink")
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` page | `#FAF8F5` | `#131211` | app background |
| `--surface` | `#FFFFFF` | `#1B1A18` | cards, sidebar, inputs |
| `--surface-raised` | `#FFFFFF` | `#222120` | popovers, menus, dialogs |
| `--surface-subtle` | `#F4F1EC` | `#1F1E1C` | table header, hover, inset areas |
| `--surface-sunken` | `#EEEAE3` | `#161513` | wells, progress tracks |
| `--border` | `#E7E2D9` | `#2E2C29` | hairlines |
| `--border-strong` | `#D3CCC0` | `#403D39` | inputs, dividers that must be seen |
| `--ink` text | `#1C1A17` | `#EDEAE4` | primary text (≥16:1) |
| `--ink-2` secondary | `#4F4A42` | `#B8B2A7` | secondary text (≥8:1) |
| `--ink-3` muted | `#6F695F` | `#8F897E` | captions, placeholders (≥5:1 on paper) |
| `--ink-disabled` | `#A39C90` | `#5F5A52` | disabled only |

### 2.2 Brand — derived from the school's colour
The school's `primaryColor` (from `/site/info`) is **normalised** so any choice looks dignified: convert to OKLCH, clamp
chroma ≤ 0.14, lightness 0.36–0.50 for the solid colour, and verify white text ≥ 4.5:1 (darken until it does). From it derive:
`--brand` (solid), `--brand-hover` (−6 % L), `--brand-press` (−10 % L), `--brand-soft` (8 % over surface — selected rows, active nav),
`--brand-ink` (text on soft, ≥ 4.5:1), `--ring` (35 % alpha focus ring, 2 px + 2 px offset). Dark mode lifts L to 0.62–0.72.
**Product default** (no school colour): deep teal `#0E5A63`. Demo school (Green Valley): `#1B6B4F`.
Test any new school colour against `#7C3AED`, `#FF0066`, `#00FF00`, `#FFEB3B`, `#000` — all must still look sober.

### 2.3 Accent and role tints
* **Accent (amber)** `#C9731A` (marks/fills), `--accent-ink` `#8A4B00` (text), `--accent-soft` `#FBEFD9`; dark `#E3A547` / `#2B2110`.
  Used for "today", achievements, highlights, one small thing per screen — never for buttons.
* **Role tints** (subtle, consistent; only on the role chip dot, avatar ring, onboarding illustration accent and the
  sidebar sub-label — never on buttons or large areas): Student `#C9731A` · Parent `#B04A6F` · Teacher `#3F63B5` · Management = `--brand`.

### 2.4 Semantic status (always icon + label, never colour alone)
| | text/icon | soft bg | dark text / bg |
|---|---|---|---|
| success | `#2A7448` | `#E6F3EA` | `#5CC48E` / `#12261C` |
| warning | `#9A6200` | `#FBF0D9` | `#E5B34D` / `#2B2110` |
| danger | `#B3412E` | `#FBEAE6` | `#F2877D` / `#2D1513` |
| info | `--brand-ink` | `--brand-soft` | |
Attendance mapping: present = success, late = warning, absent = danger, leave = info, half-day = warning (outlined).

### 2.5 Data visualisation (validated — see §10 for rules)
Categorical, **fixed order, never cycled**, max 6 series (fold the rest into "Other"). Validated with the dataviz script
(lightness band, chroma floor, CVD separation, normal-vision floor, ≥3:1 vs surface) on white, paper and dark surfaces:

| Slot | Hue | Light | Dark |
|---|---|---|---|
| `--chart-1` | teal | `#00909B` | `#00909B` |
| `--chart-2` | clay | `#B8472F` | `#D0583F` |
| `--chart-3` | blue | `#3F63B5` | `#5C80D6` |
| `--chart-4` | amber | `#C9731A` | `#C77B2C` |
| `--chart-5` | violet | `#6C5BB0` | `#8B7BDB` |
| `--chart-6` | sage | `#4F8A45` | `#5F9E52` |

* **Single series** may use `--brand`. Multi-series always uses the fixed slots above (so a school colour can't break CVD safety).
* **Sequential** (magnitude/heatmaps): one teal hue, light→dark: `#E4F1F2 #BFDDE0 #8FC3C9 #5AA5AE #2C8791 #11666F #0A4A52` (`--seq-1…7`; reversed anchor in dark).
* **Diverging** (above/below baseline): clay `#B8472F` ⟷ neutral `#E7E2D9` ⟷ teal `#00909B`, equal steps per arm.
* Chart text uses text tokens (`--ink`, `--ink-2`), never the series colour. Gridlines `--border`, axes `--ink-3`.

## 3. Typography
| Role | Family | Size / line | Weight | Notes |
|---|---|---|---|---|
| Display (hero, onboarding, big figures) | **Manrope** (variable) | 40/46 → 32/38 mobile | 700 | lining + tabular numerals for figures |
| Page title | Manrope | 26/34 → 24/30 mobile | 600 | one per screen |
| Section title | **Inter** | 16/24 | 600 | |
| Body | Inter | 14/22 (web), 15/22 (mobile) | 400 | |
| Table cell / dense | Inter | 13/20 | 400/500 | tabular numerals |
| Label / button | Inter | 13/16 | 500 | sentence case |
| Caption / metadata | Inter | 12/16 | 400 | ≥ 12 px always |
| Figures (stat values) | Manrope | 28–36 | 600 | `font-variant-numeric: lining-nums tabular-nums` |
Fallbacks: `Manrope, Inter, system-ui, sans-serif` / `Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
Letter-spacing 0 (−0.02em on Manrope display/titles and figures). No ALL CAPS except ≤ 11 px table column headers (+0.04em). Interface weights 400/500/600; Manrope display uses 600/700.
Both families are bundled (web via `next/font`, mobile as assets) — never fetched at runtime on mobile.

## 4. Spacing, layout, breakpoints
* **4 px grid.** Scale: 4, 8, 12, 16, 20, 24, 32, 40, 56, 80. Card padding 20 (16 on phones); gaps 16/24; section spacing 32.
* **Radius**: 8 (buttons, inputs, badges), 12 (cards, tables, menus), 16 (dialogs, sheets), 999 (pills, avatars).
* **Shell**: sidebar 248 px (collapses to 72 px icon rail; drawer < 1024), top bar 60 px (sticky; blur + border appears after scroll),
  page container max 1280 px (reading text 68 ch), page padding 32 desktop / 24 tablet / 16 phone.
* **Breakpoints**: sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536. Phone (< 640): single column, bottom nav, sheets instead of dialogs.
* **Dashboard grid**: 12 columns; stat row 4-up (2-up tablet, 2×2 phone); main column 8 + side column 4.
* Information density: ≤ 6 stat tiles above the fold; lists show 5 items + "View all"; never more than 2 competing primary actions.

## 5. Surfaces, elevation, borders
Layered paper, not boxes-in-boxes. **Cards** = `--surface` + 1 px `--border` + radius 12 + shadow `0 1px 2px rgba(28,26,23,.04)`.
Interactive cards on hover: border `--border-strong` + `0 4px 14px rgba(28,26,23,.07)` (150 ms). **Popovers/menus**
`0 6px 20px rgba(28,26,23,.10)`; **dialogs/sheets** `0 16px 40px rgba(28,26,23,.14)` over a `rgba(28,26,23,.40)` scrim.
Group with whitespace and subtle fills before adding a border; no table cell borders — row hairlines only.
Dark mode: no shadows on cards (border only); elevation = lighter surface.

## 6. Iconography & imagery
**Lucide**, 16/18/20 px, stroke 1.75, monochrome (`--ink-2`; `--brand` when active). Icons never sit in coloured tiles in lists. Status icons use
semantic colours. No emoji in UI. **No stock photos.** Photos exist only as real user content (avatars, school logo, uploaded files).
Avatars: initials on `--surface-sunken`, ring in the role tint for the signed-in user only.

## 7. Illustrations — "Soft Geometry"
One consistent set (`design/illustrations/*.svg`, shared by web and mobile), used **only** for: onboarding (4 role heroes), sign-in,
empty states, no-results, success, error/offline, first-use. Never in operational data views.
* Style: flat shapes built from rounded rectangles, circles and quarter-arcs on an 8-px grid; **3 tones + paper + ink**: `--ill-brand`,
  `--ill-brand-soft`, `--ill-accent`, `--ill-paper`, `--ill-ink` (used for ≤ 1.5 px detail lines). No gradients, no shadows, no outlines on large shapes, no human figures.
* **Re-themable:** SVGs reference those five CSS variables (web) / are string-substituted with the active `ColorScheme` (Flutter via `flutter_svg`), so every school's illustrations use its colours automatically.
* Canvas 320×240 (hero 560×420). Subjects: stacked books, notebook + pencil, calendar, bell, check badge, bar chart, school building, bus, award, magnifier, empty tray.
* Each illustration has meaningful `alt` text or is `aria-hidden` when purely decorative.

## 8. Components (all states specified)
States for every interactive component: **default · hover · focus-visible · active/pressed · selected · disabled · loading · error**.
Focus = 2 px `--ring` + 2 px offset (never removed). Disabled = `--ink-disabled` on `--surface-subtle`, no hover.

* **Button** 36 px (32 sm, 44 touch/mobile 48). *Primary* solid `--brand` / white text; *Secondary* `--surface` + `--border-strong`; *Ghost*; *Danger* = danger text on soft, solid only inside confirm dialogs. Loading = spinner replaces label, width fixed. Press: scale .98 / 80 ms. Icon button 36×36 (44 touch) with tooltip + `aria-label`.
* **Input / Select / Textarea** 36 px (44 mobile), `--border-strong`, radius 8, label above (13/500), helper below (12), error = danger border + icon + message (never colour alone). Search field has leading icon + clear button + `⌘K`/`/` hint on desktop.
* **Date picker** popover calendar (week starts per school setting), keyboard navigable, presets (Today, This week, This term).
* **Sidebar** grouped, collapsible; item 36 px, 16 px icon, active = `--brand-soft` bg + `--brand-ink` text + 2 px brand marker; group labels 11/500 sentence-case-ish `--ink-3`; footer: school + user. Collapse animates width 220 ms.
* **Top bar**: breadcrumb/page context left, global search `⌘K`, notifications, theme, user menu right. **Tabs**: underline style, animated indicator (layout animation). **Breadcrumbs** truncate in the middle.
* **Card / Panel / Accordion** per §5; accordion height animates 200 ms, chevron rotates.
* **Stat tile**: label (12/ink-2) → value (Manrope 32) → delta/sub (12, status colour + icon). No icon tile. Optional sparkline in `--brand`.
* **Data table**: 44 px rows (36 compact), hairlines, sticky subtle header, sortable columns (aria-sort), row hover `--surface-subtle`, selection checkbox + sticky bulk-action bar, column menu, saved filters row (chips) above; server-side pagination `{page,pageSize,total}` with page-size select; virtualised beyond 200 rows; empty/loading (skeleton rows, fixed height) /error (inline retry) states; mobile: rows become stacked cards with the 2 key fields + a status chip.
* **Badges / status chips** 20 px, 12/500, soft bg + status text + 12 px icon. **Progress**: linear 6 px (`--surface-sunken` track, brand fill, animates 400 ms ease-out once), ring for single KPIs (setup wizard, attendance %).
* **Dialog** (max 480/640), **Drawer/Sheet** for forms and detail (right 480 px desktop; bottom sheet on phone, drag handle), **Popover/Tooltip** (delay 400 ms, `Esc` closes), **Dropdown/context menu** with keyboard type-ahead. Destructive confirm: states the object and consequence, default focus on Cancel.
* **Toast** bottom-right (top on phone), 4 s (8 s with action), max 3 stacked, `role="status"` (`alert` for errors).
* **Empty state**: illustration (soft geometry) + one-sentence reason + one primary action; **No results**: shows the active filters + "Clear filters". **Skeletons** match final layout (no layout shift) and shimmer 1.4 s (static under reduced motion). **Error state**: what happened, what to do, Retry; offline banner on mobile.
* **Timeline / activity feed**: 1 px rail, 8 px nodes (status colours), relative times with absolute on hover. **Avatars** 24/32/40; stacks overlap 8 px.
* **Forms**: group in sections with section titles; ≤ 7 visible fields per group, "Advanced" disclosure for the rest; inline validation on blur, summary on submit; unsaved-changes guard; success = toast + (for key flows) success illustration.

## 9. Motion
Purposeful, short, consistent. Durations: **80 ms** press · **150 ms** hover/focus/tooltips · **200 ms** menus, tabs, accordions, sidebar · **300 ms** dialogs, drawers, page-level.
Easing: standard `cubic-bezier(.2,0,0,1)`; enter `cubic-bezier(0,0,.2,1)`; exit `cubic-bezier(.4,0,1,1)`. Distances ≤ 8 px (dialogs 12 px, drawers full-width slide).
* Page change: 200 ms opacity + 4 px rise (CSS). **Do not use the experimental Next.js `viewTransition` flag** (docs mark it not production-ready) — revisit later.
* Use **CSS transitions** for hover/focus/press/colour; **Motion for React** (`motion`) only for layout/height/presence (tab indicator, accordion, drawers, toasts, list reorder) via **`LazyMotion` + `m` components with `domAnimation`** (≈5 kB initial) and `<MotionConfig reducedMotion="user">` at the app root.
* Staggered reveal: dashboard first load only, ≤ 6 items × 40 ms; numbers don't count up. Charts draw once (400 ms, no replay on tab refocus). No parallax, scroll-jacking, bouncing, spinning, looping decoration in operational screens.
* `prefers-reduced-motion`: replace movement with instant or opacity-only changes; skeleton shimmer off. Never delay an action for an animation.
* Mobile (Flutter): the same durations/curves via `Duration`/`Curves.easeOutCubic`; page transitions `FadeThroughTransition` from the `animations` package (≤ 250 ms); respect `MediaQuery.disableAnimations`.

## 10. Charts (web: Recharts v3 in the shadcn `ChartContainer` pattern · mobile: `fl_chart`)
Procedure and rules come from the dataviz method; summary:
1. **Pick the form by the data's job**; often the right answer is a stat tile or a ranked list, not a chart. Attendance trend = line (one series) or 100 %-stacked bars of statuses; fee collection = bars by month + outstanding as a number; performance distribution = histogram; subject comparison = horizontal bars sorted; progress = ring/linear bar.
2. Colours **only** from §2.5 in fixed order; status charts use §2.4 with icon + label; never dual-axis; colour follows the entity (a filter must not repaint survivors).
3. Marks: bars 4 px rounded data-end anchored to baseline, 2 px gap between stacked fills, lines 2 px, markers ≥ 8 px, thin gridlines, recessive axes, no per-point value labels (selective direct labels for ≤ 4 series), always a legend for ≥ 2 series.
4. **Hover layer by default** (crosshair + tooltip on lines, per-mark tooltip on bars) with hit targets larger than marks; Recharts `accessibilityLayer` on; every chart has a **table view** toggle and a text summary (`aria-describedby`).
5. Containers always have an explicit height/aspect (no layout shift); skeleton while loading; plain empty state when no data. Dark mode uses its own validated steps, not an inversion.

## 11. Role-appropriate hierarchy
Navigation shows only what a role can use (driven by `Me.permissions`), **but authorisation is enforced by the API** — hiding is not security.
* **Management/Admin** — sidebar groups: Overview · Academics · People · Finance · Communication · Operations · Reports · Settings & Access. Home = KPI stat row, today's attendance + 7-day trend, "Needs your approval" queue, finance summary, alerts, enrolment by grade.
* **Teacher** — home = today's timetable (current period highlighted), attendance "not yet marked" shortcuts, homework to review, marks to enter, meetings. Primary workflows are one tap from home: roll call, homework, marks entry.
* **Student** — Home · My Tasks · Calendar · Learning · Profile. Today's classes, homework due, exams, announcements. Friendly, larger type, illustrations welcome.
* **Parent** — child switcher always visible; attendance, homework, results, fees (balance + pay), announcements/events, meeting requests.
* **Finance & operations** — fees as a work queue: outstanding, defaulters, collection today, approvals (concessions/refunds/expenses), receipts, reconciliation; tables with bulk actions and CSV export.

## 12. Responsive behaviour
Desktop: persistent sidebar, tables with column menus, side-by-side master/detail. Tablet: collapsed rail, drawers for filters/forms, 2-column grids, ≥ 44 px targets. Phone: bottom navigation (max 5), sheets, stacked-card tables, sticky primary action, no horizontal page scroll, forms single-column with 48 px fields, numeric/date keyboards.

## 13. Accessibility (WCAG 2.2 AA)
Semantic landmarks and headings, one `h1`, skip link; full keyboard operation with visible focus (never removed) and logical order; roving tabindex in menus/tabs/tables; targets ≥ 24×24 CSS px (44 on touch); contrast per §2; colour never the only signal; labels/names on every control; `aria-live` for toasts and async results; dialogs trap focus and restore it; error text linked via `aria-describedby`; reduced-motion respected; zoom to 200 % and 320 px reflow without loss; text resizes on mobile (no fixed-height text containers).

## 14. Tokens (implementation)
**Web:** CSS variables on `:root` / `[data-theme=dark]` in `apps/web/src/app/globals.css`, exposed to Tailwind v4 through `@theme`; brand variables are written at runtime from `/site/info` by `lib/color.ts`. No raw hex in components. Fonts via `next/font`.
**Mobile:** `lib/core/design/tokens.dart` (colours, radii, spacing, durations) → explicit `ColorScheme` + `ThemeData` + a `SchoolSyncTheme` extension for tokens Material lacks (surface-subtle, ink-2/3, accent, status, chart palette). Do **not** use `ColorScheme.fromSeed` output directly (muddy). Material 3 Expressive is not in core Flutter — don't adopt community packages for it.

## 15. Quality checklist (review your own screenshots before reporting)
- [ ] Looks like a designed product, not a template: Manrope display + Inter UI, warm paper surfaces, one accent.
- [ ] No gradient text/buttons, glow, blobs, concentric circles, fake-UI chips, coloured icon tiles, purple/indigo.
- [ ] Brand colour < ~10 % of any screen; amber ≤ 1 small element per screen.
- [ ] Illustrations only where §7 allows, all from the shared set, all re-themed by the school colour.
- [ ] Every table/list/form/chart has loading, empty, error and populated states that work with real API data.
- [ ] Charts use §2.5 colours in order, have legend + table view + tooltip, and no layout shift.
- [ ] Light and dark both reviewed; try school colours `#7C3AED`, `#FF0066`, `#FFEB3B` — still sober.
- [ ] Keyboard-only pass, visible focus, reduced-motion pass, 200 % zoom, 360 px width without horizontal scroll.
- [ ] Console clean; no layout shift on load; animations ≤ 300 ms.
