// SchoolSync product catalogue: builds brochure/index.html (animated, opens in any browser) from the screenshots in assets/.
//   node brochure/build.mjs          → index.html
//   node brochure/pdf.mjs            → SchoolSync-Product-Catalogue.pdf (A4 landscape, same pages)
// Screenshots: web → `pnpm --filter @school-sync/web exec node scripts/capture-brochure.mjs`, mobile → see SCHOOL-SYNC-MOBILE `BROCHURE=1 flutter test test/brochure_*`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PAGES, CHAPTERS } from './content.mjs';
import { CSS, JS, ICONS, MARK } from './theme.mjs';

const here = (p) => new URL(p, import.meta.url);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const missing = [];
const asset = (path) => {
  if (!existsSync(here(path))) missing.push(path);
  return path;
};

// ── building blocks ────────────────────────────────────────────────────────
const icon = (name) => `<svg viewBox="0 0 24 24" class="ico" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.check}</svg>`;

/** a browser-framed web screenshot */
const web = (name, cap, i = 0, crop) => {
  const img = `<img src="${asset(`assets/web/${name}.jpg`)}" alt="${esc(cap?.[0] ?? name)}" decoding="async"${crop ? ` style="transform-origin:${crop[0]};transform:scale(${crop[1]})"` : ''}>`;
  return `
  <figure class="shot web" data-r style="--i:${i}">
    <div class="frame"><div class="bar"><i></i><i></i><i></i></div>${crop ? `<div class="crop">${img}</div>` : img}</div>
    ${cap ? `<figcaption><b>${esc(cap[0])}</b><span>${esc(cap[1])}</span></figcaption>` : ''}
  </figure>`;
};

/** a phone-framed mobile screenshot */
const phone = (file, cap, i = 0) => `
  <figure class="shot phone" data-r="phone" style="--i:${i}">
    <div class="device"><img src="${asset(`assets/mobile/${file}`)}" alt="${esc(cap?.[0] ?? file)}" decoding="async"></div>
    ${cap ? `<figcaption><b>${esc(cap[0])}</b><span>${esc(cap[1])}</span></figcaption>` : ''}
  </figure>`;

const head = (p, wide = false) => `
  <header class="head${wide ? ' wide' : ''}">
    <div>
      <p class="kicker" data-r>${esc(p.kicker)}</p>
      <h2 class="title" data-r style="--i:1">${p.title}</h2>
    </div>
    ${p.lede ? `<p class="lede" data-r style="--i:2">${p.lede}</p>` : ''}
  </header>`;

const points = (list) => (list?.length ? `<ul class="points">${list.map((t, i) => `<li data-r style="--i:${i + 2}">${icon('check')}<span>${t}</span></li>`).join('')}</ul>` : '');

// ── page layouts ───────────────────────────────────────────────────────────
const LAYOUTS = {
  /** one large screen with text on the left */
  hero: (p) => `
    <div class="split">
      <div class="side">${head({ ...p })}${points(p.points)}</div>
      <div class="stage">${p.shots.map((s, i) => web(s[0], s[1], i + 1)).join('')}</div>
    </div>`,
  /** two screens side by side */
  duo: (p) => `${head(p, true)}${points(p.points).replace('class="points"', 'class="points row"')}<div class="row2">${p.shots.map((s, i) => web(s[0], s[1], i + 2)).join('')}</div>`,
  /** three small screens (simple auth screens) with step numbers */
  steps: (p) => `${head(p, true)}<div class="row3">${p.shots.map((s, i) => `<div class="step" data-r style="--i:${i + 2}"><span class="num">${i + 1}</span>${web(s[0], s[1], 0, s[2])}</div>`).join('')}</div>`,
  /** four phones */
  phones: (p) => `<div class="split phonesplit"><div class="side">${head(p)}${points(p.points)}</div><div class="phones">${p.shots.map((s, i) => phone(s[0], s[1], i + 2)).join('')}</div></div>`,
  /** web screen + two phones for a role */
  mix: (p) => `
    <div class="split mix">
      <div class="side">${head(p)}${points(p.points)}</div>
      <div class="stage">${p.shots.filter((s) => s[2] !== 'phone').map((s, i) => web(s[0], s[1], i + 1)).join('')}<div class="pair">${p.shots.filter((s) => s[2] === 'phone').map((s, i) => phone(s[0], s[1], i + 2)).join('')}</div></div>
    </div>`,
  /** free-form page whose body is provided as HTML */
  raw: (p) => p.html({ web, phone, icon, head, points, esc, MARK }),
};

const sections = PAGES.map((p, idx) => {
  const num = idx + 1;
  const body = (LAYOUTS[p.layout] ?? LAYOUTS.raw)(p);
  const chapter = CHAPTERS.find((c) => c.id === p.chapter);
  return `
  <section class="sheet" id="p${num}" data-chapter="${esc(chapter?.id ?? '')}" data-title="${esc(p.nav ?? p.title.replace(/<[^>]+>/g, ''))}">
    <div class="page ${p.cls ?? ''} ${p.layout}">
      ${body}
      ${p.noFoot ? '' : `<footer class="foot"><span class="brand">${MARK(16)}<b>SchoolSync</b> · Product catalogue</span><span>${esc(chapter?.name ?? '')}<em>${String(num).padStart(2, '0')}</em></span></footer>`}
    </div>
  </section>`;
});

// ── table of contents data (page numbers come from the order of PAGES) ──────
const toc = CHAPTERS.map((c) => {
  const first = PAGES.findIndex((p) => p.chapter === c.id);
  const last = PAGES.length - 1 - [...PAGES].reverse().findIndex((p) => p.chapter === c.id);
  return { ...c, first: first + 1, last: last + 1 };
}).filter((c) => c.first > 0);
const tocHtml = toc.map((c) => `<a href="#p${c.first}" class="toc-row" data-r style="--i:${toc.indexOf(c)}"><span class="toc-name"><b>${esc(c.name)}</b><small>${esc(c.blurb)}</small></span><span class="toc-dots"></span><span class="toc-pg">${c.first === c.last ? c.first : `${c.first}–${c.last}`}</span></a>`).join('');
const rendered = sections.map((s) => s.replace('<!--TOC-->', tocHtml));

const navOptions = toc.map((c) => `<option value="#p${c.first}">${esc(c.name)}</option>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SchoolSync Product Catalogue</title>
<meta name="description" content="SchoolSync: one school ERP for management, teachers, students and parents, on the web and on mobile. Product catalogue with screens from start to finish.">
<link rel="icon" href="assets/art/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<nav class="nav" aria-label="Catalogue">
  <a class="nav-brand" href="#p1">${MARK(22)}<b>SchoolSync</b><span>Product catalogue</span></a>
  <label class="nav-jump"><span class="sr">Jump to a chapter</span><select id="jump" aria-label="Jump to a chapter"><option value="#p1">Jump to…</option>${navOptions}</select></label>
  <a class="nav-pdf" href="SchoolSync-Product-Catalogue.pdf" download>${icon('download')}<span>PDF</span></a>
  <i class="progress" id="progress" aria-hidden="true"></i>
</nav>
<main class="deck" id="deck">
${rendered.join('\n')}
</main>
<div class="lightbox" id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Screen preview"><button type="button" class="lb-close" aria-label="Close">×</button><img alt=""></div>
<script>${JS}</script>
</body>
</html>`;

writeFileSync(here('index.html'), html);
console.log(`index.html: ${PAGES.length} pages, ${(html.length / 1024).toFixed(0)} KB`);
if (missing.length) {
  console.log(`\nMISSING ASSETS (${missing.length}):\n  ${[...new Set(missing)].join('\n  ')}`);
  process.exitCode = 1;
}
