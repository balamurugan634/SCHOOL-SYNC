#!/usr/bin/env node
// Generates design/illustrations/*.svg from the shared kit (kit.mjs). No dependencies.
//   node design/tools/build-illustrations.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  T, rr, circ, path, line, g, rrc, arch, quarter, capsule, ringSector, check, rot,
  ground, disc, badge, notebook, book, calendar, bell, bars, pencil, svg,
} from './kit.mjs';

const { B, BS, A, AS, P, I } = T;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(here, '..', 'illustrations');

// ---- shared composites -----------------------------------------------------
// a school building. cw/ch = centre block, ww/wh = each wing
const school = (cx, base, { cw = 112, ch = 96, ww = 56, wh = 56, flag = true, door = B } = {}) => {
  const L = cx - cw / 2, R = cx + cw / 2;
  const top = base - ch;
  let s = '';
  if (ww > 0) {
    s += rrc(L - ww, base - wh, ww + 16, wh, [8, 0, 0, 8], P);
    s += rrc(R - 16, base - wh, ww + 16, wh, [0, 8, 8, 0], P);
    const wc = Math.floor((ww - 8) / 24);
    const off = (ww - 8 - wc * 24) / 2 + 4;
    for (let i = 0; i < wc; i++) {
      s += arch(L - ww + off + i * 24 + 4, base - wh + 16, 16, 24, BS);
      s += arch(R + off + i * 24 - 4, base - wh + 16, 16, 24, BS);
    }
  }
  s += rr(L, top, cw, ch, 8, P);
  s += rr(L - 8, top - 8, cw + 16, 16, 8, B);
  s += arch(cx - 20, top - 36, 40, 32, B);
  s += circ(cx, top - 18, 7, P);
  s += line(`M${cx} ${top - 22.5}V${top - 18}H${cx + 3}`, 1);
  if (flag) {
    s += line(`M${cx} ${top - 36}V${top - 68}`);
    s += rrc(cx, top - 68, 24, 16, [0, 8, 8, 0], A);
  }
  if (cw >= 144) {
    for (const o of [40, 64]) s += arch(cx - o - 8, top + 32, 16, 24, BS) + arch(cx + o - 8, top + 32, 16, 24, BS);
  } else {
    s += circ(cx - 32, top + 32, 8, BS) + circ(cx + 32, top + 32, 8, BS);
  }
  s += arch(cx - 16, base - 48, 32, 48, door);
  s += rr(cx - 28, base - 8, 56, 8, 4, BS);
  return s;
};

// a small bell glyph made of three shapes
const miniBell = (cx, cy, fill) =>
  arch(cx - 9, cy - 12, 18, 16, fill) + rr(cx - 13, cy + 2, 26, 6, 3, fill) + circ(cx, cy + 12, 3, fill);

// list card: optional brand header, then rows (dot + two pills). The row `hi` is tinted (now / unread).
const listCard = (x, y, w, { rows = 3, header = false, hi = 1 } = {}) => {
  let s = '';
  const hh = header ? 40 : 0;
  const h = hh + 16 + rows * 32 + (rows - 1) * 8 + 16;
  s += rr(x, y, w, h, 8, P);
  if (header) s += rrc(x, y, w, hh, [8, 8, 0, 0], B) + miniBell(x + 28, y + 20, P) + rr(x + 52, y + 16, w - 80, 8, 4, P, 0.55);
  for (let i = 0; i < rows; i++) {
    const ry = y + hh + 16 + i * 40;
    if (i === hi) s += rr(x + 8, ry, w - 16, 32, 8, AS);
    s += circ(x + 28, ry + 16, 5, i === hi ? A : B);
    s += rr(x + 44, ry + 7, (w - 76) * (i === hi ? 0.72 : 0.58 + (i % 2) * 0.14), 8, 4, B, 0.85);
    s += rr(x + 44, ry + 20, (w - 76) * 0.4, 6, 3, B, 0.3);
  }
  return { svg: s, h };
};

// approval stamp (handle, neck, base, pad)
const stamp = (cx, base) =>
  rr(cx - 12, base - 72, 24, 40, 12, B) +
  rr(cx - 8, base - 40, 16, 16, 0, B) +
  rr(cx - 32, base - 28, 64, 16, 8, A) +
  rr(cx - 32, base - 12, 64, 12, 6, B);

// award rosette: scalloped disc with two tails
const rosette = (cx, cy, r, tailLen = 56, tail = B) => {
  let s = rr(cx - 20, cy, 16, tailLen, 4, tail, 1, rot(14, cx - 12, cy)) + rr(cx + 4, cy, 16, tailLen, 4, tail, 1, rot(-14, cx + 12, cy));
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 * Math.PI) / 180;
    s += circ(cx + r * Math.cos(a), cy + r * Math.sin(a), 8, A);
  }
  return s + circ(cx, cy, r, A) + circ(cx, cy, r - 12, P) + circ(cx, cy, r - 20, A);
};

// small plus sparkle made of capsules
const plus = (cx, cy, s, fill) => capsule(cx - s, cy, cx + s, cy, 4, fill) + capsule(cx, cy - s, cx, cy + s, 4, fill);

const S = {};

// ---------------------------------------------------------------- small set
S['empty-generic'] = ['An empty box', 320, 240, () =>
  disc(160, 112, 80) + ground() +
  rrc(104, 96, 112, 40, [8, 8, 0, 0], B, 0.4) +
  rr(60, 130, 40, 12, 6, B, 0.7, rot(-20, 100, 136)) + rr(220, 130, 40, 12, 6, B, 0.7, rot(20, 220, 136)) +
  rr(96, 136, 128, 56, 8, B) +
  rr(144, 152, 32, 16, 8, P) +
  line('M152 160H168', 0.7) +
  plus(224, 72, 5, P)
];

S['empty-homework'] = ['A notebook with a check badge: all caught up', 320, 240, () =>
  arch(88, 32, 144, 160, BS) + ground() +
  notebook(112, 64, 96, 128) +
  badge(196, 160, 24) +
  plus(120, 56, 5, P)
];

S['empty-events'] = ['A calendar with one highlighted day', 320, 240, () =>
  rrc(64, 32, 192, 160, [96, 16, 16, 16], BS) + ground() +
  calendar(104, 80, 112, 112) +
  plus(232, 64, 5, P)
];

S['empty-notifications'] = ['A bell at rest', 320, 240, () =>
  disc(160, 112, 80) + ground() +
  bell(160, 56, 80) +
  line('M96 72h10l-10 12h10', 0.8) + line('M112 56h6l-6 8h6', 0.8)
];

S['no-results'] = ['A magnifier over an empty page', 320, 240, () =>
  rrc(64, 32, 192, 160, [16, 96, 16, 16], BS) + ground() +
  rr(96, 56, 96, 136, 8, P) +
  rr(112, 76, 48, 8, 4, A) + rr(112, 96, 40, 8, 4, BS) + rr(112, 116, 48, 8, 4, BS) +
  circ(192, 128, 44, B) + circ(192, 128, 34, P) +
  ringSector(192, 128, 26, 4, 200, 250, BS) +
  capsule(224, 160, 244, 180, 16, B)
];

S['success'] = ['A check badge in a soft burst of shapes', 320, 240, () => {
  const cx = 160, cy = 112;
  let s = disc(cx, cy, 56);
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 * Math.PI) / 180;
    const long = i % 2 === 0;
    const [x1, y1] = [cx + 72 * Math.cos(a), cy + 72 * Math.sin(a)];
    const e = long ? 92 : 84;
    const [x2, y2] = [cx + e * Math.cos(a), cy + e * Math.sin(a)];
    s += capsule(x1, y1, x2, y2, 8, long ? A : B);
  }
  s += badge(cx, cy, 36, B);
  return s;
}];

S['error-offline'] = ['A plug that has come loose from its socket', 320, 240, () =>
  rrc(48, 32, 224, 160, [16, 16, 16, 16], BS) + ground() +
  rr(120, 68, 80, 28, 14, P) + circ(144, 70, 16, P) + circ(172, 66, 20, P) +
  capsule(40, 144, 88, 144, 8, B) +
  rr(88, 120, 56, 48, 8, B) + rr(144, 128, 28, 8, 4, B) + rr(144, 152, 28, 8, 4, B) +
  circ(184, 144, 3, A) + circ(194, 144, 3, A) + circ(204, 144, 3, A) +
  rr(216, 112, 40, 64, 8, P) + rr(224, 129, 16, 6, 3, B) + rr(224, 153, 16, 6, 3, B)
];

S['sign-in'] = ['A door with a key', 320, 240, () =>
  disc(160, 112, 80) + ground() +
  arch(96, 56, 96, 136, B) +
  arch(112, 72, 64, 32, P, 0.22) +
  rr(112, 116, 28, 64, 8, P, 0.22) + rr(148, 116, 28, 64, 8, P, 0.22) +
  circ(184, 148, 5, A) +
  circ(232, 96, 16, A) + circ(232, 96, 7, BS) + rr(228, 112, 8, 48, 4, A) + rr(236, 140, 12, 8, 4, A) + rr(236, 152, 8, 8, 4, A)
];

S['first-use'] = ['A small school with a flag', 320, 240, () =>
  rrc(48, 40, 224, 152, [112, 112, 16, 16], BS) + ground() + school(160, 192, { ch: 88 })
];

S['setup-complete'] = ['Stacked books with an award ribbon', 320, 240, () =>
  rrc(40, 32, 240, 160, [16, 96, 16, 16], BS) + ground(160, 240) +
  book(60, 168, 120, B) + book(72, 144, 104, B) + book(64, 120, 112, B) + book(72, 96, 96, B) +
  rosette(232, 120, 24, 56)
];

// ---------------------------------------------------------------- heroes (560 x 420, ground at y=336)
const HG = () => ground(280, 432, 336);

S['onboarding-student'] = ['A notebook, a pencil and a daily schedule card', 560, 420, () =>
  rrc(88, 48, 384, 288, [144, 16, 16, 16], BS) + HG() +
  notebook(104, 144, 128, 192, { bookmark: true }) +
  listCard(256, 192, 176, { rows: 3, hi: 1 }).svg +
  pencil(456, 336, 440, 168) +
  plus(432, 96, 6, P)
];

S['onboarding-parent'] = ['An updates card, a calendar and a check badge', 560, 420, () => {
  const lc = listCard(256, 152, 176, { rows: 3, header: true, hi: 0 });
  return (
    arch(104, 48, 352, 288, BS) + HG() +
    calendar(112, 208, 128, 128, { cols: 4, rows: 3, hi: [1, 1] }) +
    lc.svg + badge(432, 152, 28) +
    plus(176, 120, 6, P)
  );
}];

S['onboarding-teacher'] = ['A class board with a checklist and a chart', 560, 420, () => {
  let s = rrc(72, 48, 416, 288, [16, 144, 16, 16], BS) + HG();
  s += rr(128, 256, 12, 80, 0, B) + rr(292, 256, 12, 80, 0, B);
  s += rr(96, 96, 240, 160, 16, B);
  const widths = [136, 104, 80];
  for (let i = 0; i < 3; i++) {
    const cy = 132 + i * 44;
    if (i < 2) s += circ(132, cy, 14, A) + check(132, cy, 24, P);
    else s += circ(132, cy, 14, P) + circ(132, cy, 10, B);
    s += rr(160, cy - 5, widths[i], 10, 5, P, 0.9);
  }
  s += rr(360, 224, 112, 112, 8, P);
  s += bars(380, 316, [24, 48, 64], { w: 16, gap: 16, hi: 2 }) + line('M372 316H460', 0.8);
  s += plus(400, 96, 6, P);
  return s;
}];

S['onboarding-management'] = ['A school building, a bar chart and an approval stamp', 560, 420, () => {
  let s = rrc(72, 48, 416, 288, [144, 144, 16, 16], BS) + HG();
  s += school(280, 336, { cw: 160, ch: 136, ww: 0 });
  s += rr(88, 232, 96, 104, 8, P);
  s += bars(104, 316, [24, 48, 64], { w: 16, gap: 8, hi: 2 }) + line('M96 316H176', 0.8);
  s += rr(376, 216, 96, 120, 8, P);
  s += circ(424, 288, 28, A) + circ(424, 288, 22, P) + check(424, 288, 36, A);
  s += stamp(424, 216);
  return s;
}];

mkdirSync(OUT, { recursive: true });
for (const [name, [title, w, h, draw]] of Object.entries(S)) {
  const body = draw();
  if (!body) continue;
  writeFileSync(join(OUT, `${name}.svg`), svg(w, h, title, body));
}
console.log('wrote', OUT);
