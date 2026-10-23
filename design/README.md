# SchoolSync brand and illustration assets

Hand-authored "Soft Geometry" set (design.md section 7) plus the logo and app icons. Everything here is plain SVG (or PNG
exported from it) so it renders the same in a browser, in `flutter_svg` and in a PNG export.

```
design/
  illustrations/   14 SVGs (320x240; the 4 onboarding heroes are 560x420)
  brand/           mark, mono mark, favicon, app-icon and Android adaptive PNGs
  tools/           generators (no dependencies): kit.mjs, build-illustrations.mjs, build-brand.mjs, render-brand.sh
```

## 1. The six colour tokens

Every fill and stroke in every SVG is one of these literal hex values (shades come only from `opacity`). Nothing else may
appear, so a runtime string replace of the six hexes fully re-themes an asset.

| Hex in file | Token | Maps to in the app | Used for |
|---|---|---|---|
| `#0E5A63` | brand | `--brand` (school colour, normalised, design.md 2.2) | main objects, plates' details, the ground slab at 30 % opacity |
| `#CFE6E8` | brand-soft | a **stronger tint of the school colour** than the UI `--brand-soft`: `oklch(0.92, min(C*0.45, 0.05), hue)` of the normalised brand | the backdrop plate behind each scene, calendar dots, windows |
| `#C9731A` | accent | `--accent` (amber). Onboarding heroes use the role tint instead, see below | one small highlight per scene: badge, flag, today, key |
| `#FBEFD9` | accent-soft | `--accent-soft` (or the soft tint of the role colour) | highlighted row, pencil wood |
| `#F4F1EC` | paper | `--surface-subtle` (card faces, book pages) | cards, notebook label, calendar face |
| `#1C1A17` | ink | `--ink` | only 1.5 px detail lines and tiny details (binder rings, clock hands) |

Dark mode: map the same six to the dark tokens, e.g. brand `#3FA6B1` (lifted), brand-soft about `#1F3C40`, accent `#E3A547`,
accent-soft `#2B2110`, paper `#2B2927`, ink `#EDEAE4`. These dark values are a suggestion and were not rendered or reviewed yet, so check them once in the app.

Role tints (design.md 2.3) for the four onboarding heroes: replace accent with the role colour and accent-soft with its soft tint
(Student keeps amber, Parent `#B04A6F`, Teacher `#3F63B5`, Management uses `--brand`).

## 2. Recolouring at runtime

Always replace all six in **one pass** (a regex with a lookup map), never one after another, or a new colour that equals another
token gets replaced twice.

```ts
const HEX = /#(?:0E5A63|CFE6E8|C9731A|FBEFD9|F4F1EC|1C1A17)/gi;
const NAMES: Record<string, keyof Theme> = {
  '#0E5A63': 'brand', '#CFE6E8': 'brandSoft', '#C9731A': 'accent',
  '#FBEFD9': 'accentSoft', '#F4F1EC': 'paper', '#1C1A17': 'ink',
};
export const themeSvg = (svg: string, t: Theme) => svg.replace(HEX, (m) => t[NAMES[m.toUpperCase()]]);
```

**Web.** Prefer a codegen script (e.g. `apps/web/scripts/gen-illustrations.mjs`) that reads `design/illustrations/*.svg`, maps the six hexes to
`var(--ill-brand)`, `var(--ill-brand-soft)`, `var(--ill-accent)`, `var(--ill-accent-soft)`, `var(--ill-paper)`, `var(--ill-ink)` (write them as
`style={{ fill: 'var(--ill-brand)' }}` / `stroke` so it works in every browser), converts attributes to JSX camelCase, and emits one
React component per file with `<title>` removed and `role="img"` + `aria-label` (or `aria-hidden` when decorative). The `--ill-*`
variables are set next to the other brand variables by `lib/color.ts`, so one change re-themes every illustration and dark mode.

**Flutter.** Copy the SVGs into `assets/illustrations/`, load the raw string once, replace the hexes with the active `ColorScheme` /
`SchoolSyncTheme` values (`themeSvg` above, in Dart), cache by (asset, theme) and render:

```dart
final raw = await rootBundle.loadString('assets/illustrations/empty-generic.svg');
SvgPicture(SvgStringLoader(themeSvg(raw, tokens)), width: 240, semanticsLabel: 'No items yet');
```

## 3. Which illustration goes where

| File | Use |
|---|---|
| `onboarding-student`, `-parent`, `-teacher`, `-management` | the role onboarding / first-run hero on web and mobile (accent re-tinted to the role colour) |
| `sign-in` | login screen (side panel on web, header on mobile) |
| `first-use` | first screen after the first login / empty dashboard of a brand new school, start of the setup wizard |
| `setup-complete` | end of the setup wizard |
| `success` | completion of a key flow (payment, submission, import), next to the toast |
| `empty-generic` | default empty state for any list or table with no data |
| `empty-homework` | homework / tasks: nothing due, all caught up |
| `empty-events` | calendar / events: nothing scheduled |
| `empty-notifications` | notification inbox is empty |
| `no-results` | search or filters returned nothing (show the active filters + "Clear filters") |
| `error-offline` | offline page / network error with a Retry button (calm, not an alarm) |

Default sizes: 160 to 320 px wide for the 320x240 set, 280 px and up for heroes. Do not go below 160 px wide. The `<title>` in each file is
the default alt text.

## 4. Do and don't

- Do use them only where design.md section 7 allows: onboarding, sign-in, empty, no-results, success, error, first-use.
- Do keep a short sentence and one primary action next to every illustration. Captions live in HTML or Flutter text, never in the SVG.
- Do give them alt text, or `aria-hidden` when purely decorative.
- Don't use them in data views (tables with rows, dashboards with data), on buttons, or as list-item decoration.
- Don't add gradients, shadows, blur, outlines on large shapes, text, filters, masks, clip-paths, CSS classes or a `<style>` block.
- Don't add a seventh colour. Extra tints are `opacity` on one of the six. Detail lines stay at 1.5 px in ink.
- Don't change the shared kit proportions (radii 16 / 8 / pill, 8 px grid, same ground slab) when adding a new one; build it from
  `tools/kit.mjs` and run `node design/tools/build-illustrations.mjs`.

## 5. Brand files (`design/brand/`)

| File | Use |
|---|---|
| `mark.svg` | the SchoolSync logo mark (brand + accent) on light surfaces. Two open pages that slide past each other: a book, and sync. 64x64 grid, readable at 16 px |
| `mark-inverse.svg` | same mark with paper + accent, for brand-coloured or dark backgrounds (the app icon uses this) |
| `mark-mono.svg` | single colour `#000000`, for Android 13 themed icons, favicons that must be monochrome, stamps. Recolour by replacing `#000000` |
| `favicon.svg`, `favicon-32.png` | `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` plus the 32 px PNG as fallback |
| `app-icon-1024.png` | store / iOS icon: inverse mark on solid brand, opaque, no transparency |
| `adaptive-foreground-432.png`, `adaptive-background.png`, `adaptive-monochrome-432.png` | Android adaptive icon (108 dp at xxxhdpi). The mark sits well inside the central 66 % safe zone |

The product mark and icons use the SchoolSync default teal and are not re-themed per school (a school's own logo is user content).
With `flutter_launcher_icons`:

```yaml
flutter_launcher_icons:
  android: true
  ios: true
  remove_alpha_ios: true
  image_path: design/brand/app-icon-1024.png
  adaptive_icon_background: design/brand/adaptive-background.png
  adaptive_icon_foreground: design/brand/adaptive-foreground-432.png
  adaptive_icon_monochrome: design/brand/adaptive-monochrome-432.png
```

## 6. Regenerating

```bash
node design/tools/build-illustrations.mjs     # rewrites design/illustrations/*.svg
design/tools/render-brand.sh                  # rewrites brand SVGs + PNGs (headless Chrome, via scripts/dev/heavy.sh)
```
