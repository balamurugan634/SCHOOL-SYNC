/**
 * School colour handling (design.md §2.2).
 *
 * The school's `primaryColor` arrives at runtime. Whatever the school picked must come out dignified, so it is
 * *normalised in OKLCH*: chroma ≤ 0.14, lightness 0.36–0.50 for the solid colour, darkened further until white text on
 * it reaches WCAG AA (4.5:1). Dark mode lifts lightness to 0.62–0.72 (and uses dark ink on it when that reads better).
 * Everything else (hover, press, soft, ink, ring) is derived from that single solid colour.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Product default (a school with no colour of its own). */
export const DEFAULT_BRAND = '#0E5A63';

export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = HEX.exec(input.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return `#${h}`;
}

type RGB = [number, number, number];
type LCH = [number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const toLinear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** sRGB → OKLCH (Björn Ottosson's OKLab). */
function rgbToOklch([r8, g8, b8]: RGB): LCH {
  const r = toLinear(r8), g = toLinear(g8), b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

function oklchToLinear(L: number, C: number, h: number): RGB {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (rgb: RGB) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH → hex, reducing chroma until the colour fits the sRGB gamut. */
function oklchToHex(L: number, C: number, h: number): string {
  let c = C;
  let lin = oklchToLinear(L, c, h);
  for (let i = 0; i < 40 && !inGamut(lin); i++) {
    c *= 0.93;
    lin = oklchToLinear(L, c, h);
  }
  return rgbToHex(lin.map((v) => fromLinear(clamp01(v))) as RGB);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mix `fg` over `bg` at `alpha` (0–1), in sRGB. */
function over(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg), g = hexToRgb(bg);
  return rgbToHex(f.map((v, i) => v * alpha + g[i]! * (1 - alpha)) as RGB);
}

const WHITE = '#ffffff';
export const PAPER_SURFACE = '#ffffff';
export const DARK_SURFACE = '#1b1a18';
const DARK_INK = '#131211';

const MAX_CHROMA = 0.14;

export interface BrandVars {
  /** solid brand (white text on it ≥ 4.5:1) */
  solid: string;
  hover: string;
  press: string;
  /** brand-coloured text on `soft` / surfaces, ≥ 4.5:1 */
  ink: string;
  on: string;
  /** dark-mode set */
  solidDark: string;
  hoverDark: string;
  pressDark: string;
  inkDark: string;
  onDark: string;
  /** illustration backdrop: a stronger tint of the school colour, oklch(0.92, min(C×0.45, 0.05), hue) — and its dark counterpart */
  illSoft: string;
  illSoftDark: string;
}

export function brandVars(input: string | null | undefined): BrandVars {
  const hex = normalizeHex(input) ?? DEFAULT_BRAND;
  const [L0, C0, h] = rgbToOklch(hexToRgb(hex));
  const C = Math.min(C0, MAX_CHROMA);

  // light: lightness 0.36–0.50, darken until white text reaches AA
  let L = Math.min(0.5, Math.max(0.36, L0));
  let solid = oklchToHex(L, C, h);
  while (contrast(WHITE, solid) < 4.5 && L > 0.2) {
    L -= 0.01;
    solid = oklchToHex(L, C, h);
  }
  const hover = oklchToHex(L * 0.94, C, h);
  const press = oklchToHex(L * 0.9, C, h);
  // ink: brand-coloured text on the 8 % brand tint over a white surface
  let Li = L;
  let ink = solid;
  while (contrast(ink, over(solid, PAPER_SURFACE, 0.08)) < 4.5 && Li > 0.2) {
    Li -= 0.01;
    ink = oklchToHex(Li, C, h);
  }

  // dark: lightness 0.62–0.72
  const Ld = 0.68;
  const solidDark = oklchToHex(Ld, C, h);
  const onDark = contrast(DARK_INK, solidDark) >= 4.5 ? DARK_INK : WHITE;
  const hoverDark = oklchToHex(Ld + 0.03, C, h);
  const pressDark = oklchToHex(Ld - 0.03, C, h);
  let Lid = Ld;
  let inkDark = solidDark;
  while (contrast(inkDark, over(solidDark, DARK_SURFACE, 0.14)) < 4.5 && Lid < 0.95) {
    Lid += 0.01;
    inkDark = oklchToHex(Lid, C, h);
  }
  const illSoft = oklchToHex(0.92, Math.min(C * 0.45, 0.05), h);
  const illSoftDark = oklchToHex(0.3, Math.min(C * 0.35, 0.04), h);
  return { solid, hover, press, ink, on: WHITE, solidDark, hoverDark, pressDark, inkDark, onDark, illSoft, illSoftDark };
}

/** The normalised solid colour (light mode) — for previews and the favicon. */
export const normalizeBrand = (input: string | null | undefined): string => brandVars(input).solid;

/** CSS custom properties written on `:root` at request time; globals.css maps them to `--brand*` per theme. */
export function brandCss(input: string | null | undefined): string {
  const v = brandVars(input);
  return (
    `--b-solid-l:${v.solid};--b-hover-l:${v.hover};--b-press-l:${v.press};--b-ink-l:${v.ink};--b-on-l:${v.on};` +
    `--b-solid-d:${v.solidDark};--b-hover-d:${v.hoverDark};--b-press-d:${v.pressDark};--b-ink-d:${v.inkDark};--b-on-d:${v.onDark};` +
    `--b-ill-soft-l:${v.illSoft};--b-ill-soft-d:${v.illSoftDark};`
  );
}

/** Subtle role tints (design.md §2.3). Management uses the brand. The `*_SOFT` values are their illustration companions (see globals.css --role-*-soft). */
export const ROLE_TINT = { student: '#C9731A', parent: '#B04A6F', teacher: '#3F63B5', management: 'var(--brand)' } as const;

/** Initials for the school mark / avatars. */
export function initials(name: string, max = 2): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, max).toUpperCase();
  return parts
    .slice(0, max)
    .map((p) => p[0]!)
    .join('')
    .toUpperCase();
}
