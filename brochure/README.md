# SchoolSync product catalogue

`index.html` (animated, opens in any browser, scales to the window, click a screen to enlarge it) and
`SchoolSync-Product-Catalogue.pdf` (A4 landscape, 41 pages, same pages and copy). Open `index.html` from this folder: it
loads `assets/` next to it, so keep them together when sharing.

Screens are from the demo school ("Green Valley Public School") with sample data.

## Rebuild

```bash
# 1. web screens (dev stack running with the demo school: `pnpm dev`, `pnpm site:reset-demo`)
cd apps/web && flock /tmp/schoolsync-smoke.lock ../../scripts/dev/heavy.sh -m 2G -- node scripts/capture-brochure.mjs
#    one or two screens only:  node scripts/capture-brochure.mjs --only=admin-dashboard,people-students

# 2. mobile screens (rendered from recorded API responses, no emulator needed)
cd ../../../SCHOOL-SYNC-MOBILE && BROCHURE=1 /home/bala/SCHOOL-SYNC/scripts/dev/heavy.sh -m 3G -- \
  flutter test --concurrency=2 test/brochure_learner_screens_test.dart test/brochure_staff_screens_test.dart

# 3. page
node brochure/build.mjs        # → index.html
flock /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 2G -- node brochure/pdf.mjs   # → PDF, and a check that no page overflows
```

## Files

| File | What it holds |
|---|---|
| `content.mjs` | every page: chapter, title, copy, which screens and their captions |
| `theme.mjs` | the look (Paper & Ink, see `design.md`), the scroll animations and the print rules |
| `build.mjs` | page layouts (hero, duo, steps, phones, free-form) and the table of contents |
| `pdf.mjs` | prints to PDF through Chrome and checks every page for overflow |
| `assets/web`, `assets/mobile` | captured screens · `assets/art` illustrations · `assets/fonts` Manrope + Inter (SIL OFL) |

Captions describe what the screen shows; the pricing and security pages follow `docs/PRICING-AND-BILLING.md` and
`docs/SECURITY.md`. There are no prices, contact details or customer names in the catalogue on purpose.
