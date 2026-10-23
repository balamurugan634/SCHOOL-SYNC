#!/usr/bin/env node
// Generates design/brand/*.svg and the HTML wrappers used to render the PNGs (see render-brand.sh).
//   node design/tools/build-brand.mjs [brandDir] [wrapperDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { T, rrc } from './kit.mjs';

const { B, A, P } = T;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(here, '..', 'brand');
const WRAP = process.argv[3] || join(here, '.wrap');
mkdirSync(OUT, { recursive: true });
mkdirSync(WRAP, { recursive: true });

// The mark: two open pages that slide past each other (a book, and "sync"). 64 x 64 grid, content 6..58.
//   left page: two large corners on the outer side; right page: mirrored and dropped by 8.
const marks = (left, right) =>
  rrc(6, 8, 26, 40, [16, 4, 4, 16], left) + rrc(34, 16, 24, 40, [4, 16, 16, 4], right);
const svg = (inner, title, size = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 64 64" role="img"><title>${title}</title>${inner}</svg>\n`;

writeFileSync(join(OUT, 'mark.svg'), svg(marks(B, A), 'SchoolSync'));
writeFileSync(join(OUT, 'mark-inverse.svg'), svg(marks(P, A), 'SchoolSync'));
writeFileSync(join(OUT, 'mark-mono.svg'), svg(marks('#000000', '#000000'), 'SchoolSync'));
writeFileSync(join(OUT, 'favicon.svg'), svg(marks(B, A), 'SchoolSync'));

// HTML wrappers for headless Chrome: page size = PNG size, mark centred at `s` px
const page = (w, h, bg, s, inner) =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${bg}}svg{position:absolute;left:${(w - s) / 2}px;top:${(h - s) / 2}px;width:${s}px;height:${s}px}</style>${svg(inner, 'SchoolSync')}`;
const w = (name, html) => writeFileSync(join(WRAP, name), html);
w('app-icon-1024.html', page(1024, 1024, B, 640, marks(P, A)));
w('adaptive-foreground-432.html', page(432, 432, 'transparent', 240, marks(P, A)));
w('adaptive-background.html', page(432, 432, B, 1, ''));
w('adaptive-monochrome-432.html', page(432, 432, 'transparent', 240, marks('#000000', '#000000')));
w('favicon-32.html', page(32, 32, 'transparent', 32, marks(B, A)));
console.log('brand written to', OUT);
