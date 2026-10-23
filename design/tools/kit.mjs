// SchoolSync "Soft Geometry" kit: the shared vocabulary every illustration and the logo are built from.
// Dependency-free. Emits plain <rect>/<circle>/<path>/<g> with literal fill/stroke hexes (no CSS, no <style>).
//
// Rules baked in:
//   * six colours only (T below); extra tints come from `opacity`
//   * radii: 16 (large), 8 (medium), pill (h/2) for slim shapes; tiny details may use 4
//   * detail lines: ink, 1.5px, round caps. Nothing else is stroked: every other mark is a filled shape
//   * 8px grid for positions and sizes

export const T = {
  B: '#0E5A63', // brand
  BS: '#CFE6E8', // brand-soft
  A: '#C9731A', // accent
  AS: '#FBEFD9', // accent-soft
  P: '#F4F1EC', // paper
  I: '#1C1A17', // ink
};
const { B, BS, A, AS, P, I } = T;

const f = (v) => String(Math.round(v * 100) / 100);
const op = (o) => (o != null && o !== 1 ? ` opacity="${o}"` : '');
const tf = (t) => (t ? ` transform="${t}"` : '');
export const rot = (a, cx, cy) => `rotate(${f(a)} ${f(cx)} ${f(cy)})`;

// ---- primitives -----------------------------------------------------------
export const rr = (x, y, w, h, r, fill, o, t) =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${r ? ` rx="${f(r)}"` : ''} fill="${fill}"${op(o)}${tf(t)}/>`;
export const circ = (cx, cy, r, fill, o) =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"${op(o)}/>`;
export const path = (d, fill, o, t) => `<path d="${d}" fill="${fill}"${op(o)}${tf(t)}/>`;
// the only stroked element in the whole set: a thin ink detail line
export const line = (d, o, dash) =>
  `<path d="${d}" fill="none" stroke="${I}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}${op(o)}/>`;
export const g = (inner, t) => `<g${tf(t)}>${inner}</g>`;

// rect with individual corner radii [tl, tr, br, bl]
export const rrc = (x, y, w, h, [a, b, c, d], fill, o, t) => {
  const arc = (r, ex, ey) => (r ? `A${f(r)} ${f(r)} 0 0 1 ${f(ex)} ${f(ey)}` : '');
  return path(
    `M${f(x + a)} ${f(y)}H${f(x + w - b)}${arc(b, x + w, y + b)}V${f(y + h - c)}${arc(c, x + w - c, y + h)}H${f(x + d)}${arc(d, x, y + h - d)}V${f(y + a)}${arc(a, x + a, y)}Z`,
    fill, o, t,
  );
};
// arch: half-circle top, square bottom (doors, windows, bell, plates)
export const arch = (x, y, w, h, fill, o, t) => rrc(x, y, w, h, [w / 2, w / 2, 0, 0], fill, o, t);
// quarter disc whose right angle sits at (cx, cy); q = which quadrant it fills
export const quarter = (cx, cy, r, q, fill, o) => {
  const d = {
    tr: `M${cx} ${cy}V${cy - r}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z`,
    br: `M${cx} ${cy}H${cx + r}A${r} ${r} 0 0 1 ${cx} ${cy + r}Z`,
    bl: `M${cx} ${cy}V${cy + r}A${r} ${r} 0 0 1 ${cx - r} ${cy}Z`,
    tl: `M${cx} ${cy}H${cx - r}A${r} ${r} 0 0 1 ${cx} ${cy - r}Z`,
  }[q];
  return path(d, fill, o);
};
// a thick line as a filled capsule (never a thick stroke)
export const capsule = (x1, y1, x2, y2, w, fill, o) => {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return rr(mx - len / 2 - w / 2, my - w / 2, len + w, w, w / 2, fill, o, Math.abs(ang) < 0.01 ? '' : rot(ang, mx, my));
};
// filled ring sector (thick arcs: cables, handles). angles in degrees, 0 = east, clockwise on screen
export const ringSector = (cx, cy, r, w, a0, a1, fill, o) => {
  const p = (rad, a) => [cx + rad * Math.cos((a * Math.PI) / 180), cy + rad * Math.sin((a * Math.PI) / 180)];
  const ro = r + w / 2, ri = r - w / 2;
  const [x0, y0] = p(ro, a0), [x1, y1] = p(ro, a1), [x2, y2] = p(ri, a1), [x3, y3] = p(ri, a0);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return path(`M${f(x0)} ${f(y0)}A${ro} ${ro} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${ri} ${ri} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`, fill, o);
};
// a bold check glyph built from two capsules
export const check = (cx, cy, s, fill) => {
  const w = s * 0.2;
  return (
    capsule(cx - s * 0.36, cy + s * 0.02, cx - s * 0.1, cy + s * 0.28, w, fill) +
    capsule(cx - s * 0.1, cy + s * 0.28, cx + s * 0.38, cy - s * 0.26, w, fill)
  );
};

// ---- scene furniture ------------------------------------------------------
// the shared ground: a slim rounded slab every object stands on
export const ground = (cx = 160, w = 208, y = 192) => rr(cx - w / 2, y, w, 8, 4, B, 0.3);
export const disc = (cx, cy, r, fill = BS) => circ(cx, cy, r, fill);

// ---- objects (same proportions everywhere) --------------------------------
// check badge: accent disc, paper ring, bold paper check
export const badge = (cx, cy, r, fill = A) =>
  circ(cx, cy, r + 4, P) + circ(cx, cy, r, fill) + check(cx, cy, r * 1.5, P);

// notebook, upright: binding holes on the left, label card, optional accent bookmark
export const notebook = (x, y, w, h, { bookmark = false, cover = B } = {}) => {
  const holes = [];
  const step = h > 150 ? 24 : 16;
  for (let hy = y + 24; hy < y + h - 12; hy += step) holes.push(circ(x + 12, hy, 3, P));
  const lx = x + 28, lw = w - 56, ly = y + 24;
  return (
    (bookmark ? rrc(x + w - 28, y - 8, 12, 40, [0, 0, 6, 6], A) : '') +
    rr(x, y, w, h, 8, cover) +
    (bookmark ? rrc(x + w - 28, y - 8, 12, 40, [0, 0, 6, 6], A) : '') +
    holes.join('') +
    rr(lx, ly, lw, 40, 8, P) +
    line(`M${lx + 10} ${ly + 15}H${lx + lw - 10}`, 0.7) +
    line(`M${lx + 10} ${ly + 27}H${lx + lw - 22}`, 0.7)
  );
};

// flat book lying down (fore-edge view): colour covers, paper page block, thin page lines
export const book = (x, y, w, fill = B, h = 24) =>
  rr(x, y, w, h, 8, fill) +
  rr(x + 16, y + 5, w - 21, h - 10, 3, P) +
  line(`M${x + 24} ${y + h / 2}H${x + w - 12}`, 0.35);

// calendar: paper body, brand header, two binder rings, grid of soft dots, one highlighted day
export const calendar = (x, y, w, h, { cols = 4, rows = 3, hi = [2, 1], hiFill = A, headFill = B } = {}) => {
  const hh = 24;
  const rings = [x + w * 0.28, x + w * 0.72].map((rx) => rr(rx - 2, y - 6, 4, 16, 2, I)).join('');
  const gx0 = x + 12, gw = w - 24, gy0 = y + hh + 12, gh = h - hh - 24;
  const dots = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx = gx0 + (gw / cols) * (c + 0.5);
      const cy = gy0 + (gh / rows) * (r + 0.5);
      dots.push(c === hi[0] && r === hi[1] ? circ(cx, cy, 9, hiFill) : circ(cx, cy, 4.5, BS));
    }
  return rr(x, y, w, h, 8, P) + rrc(x, y, w, hh, [8, 8, 0, 0], headFill) + rings + dots.join('');
};

// bell: arch body, rim, knob, clapper
export const bell = (cx, y, w = 72, { body = B, clapper = A } = {}) => {
  const h = w * 0.78;
  return (
    circ(cx, y + 6, 6, body) +
    rrc(cx - w / 2, y + 8, w, h, [w / 2, w / 2, 8, 8], body) +
    rr(cx - w / 2 - 8, y + 8 + h - 8, w + 16, 16, 8, body) +
    circ(cx, y + 8 + h + 16, 8, clapper) +
    rr(cx - w / 2 + 12, y + 28, 8, h * 0.45, 4, P, 0.4)
  );
};

// bars on a baseline: heights[] left to right, last-but-index highlighted
export const bars = (x, baseY, heights, { w = 16, gap = 16, hi = -1, hiFill = A, fill = B } = {}) =>
  heights
    .map((h, i) => rrc(x + i * (w + gap), baseY - h, w, h, [8, 8, 0, 0], i === hi ? hiFill : i % 2 ? fill : BS))
    .join('');

// pencil lying along (x1,y1) -> tip (x2,y2)
export const pencil = (x1, y1, x2, y2, { body = A, w = 16 } = {}) => {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const t = rot(ang, x1, y1);
  const bl = len - 24;
  return g(
    rrc(x1, y1 - w / 2, bl, w, [8, 0, 0, 8], body) +
      rr(x1 + 24, y1 - w / 2, 8, w, 0, P) +
      path(`M${f(x1 + bl)} ${f(y1 - w / 2)}L${f(x1 + len)} ${f(y1)}L${f(x1 + bl)} ${f(y1 + w / 2)}Z`, AS) +
      path(`M${f(x1 + len - 7)} ${f(y1 - 2.5)}L${f(x1 + len)} ${f(y1)}L${f(x1 + len - 7)} ${f(y1 + 2.5)}Z`, I),
    t,
  );
};

// svg wrapper
export const svg = (w, h, title, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><title>${title}</title>${body}</svg>\n`;
