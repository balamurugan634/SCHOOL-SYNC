// Prints brochure/index.html to SchoolSync-Product-Catalogue.pdf (A4 landscape, one sheet per page) and checks every page for content that spills past its edges.
//   flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 1500M -- node brochure/pdf.mjs
import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const dir = fileURLToPath(new URL('.', import.meta.url));

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`file://${dir}index.html`, { waitUntil: 'load', timeout: 120000 });
await page.emulateMediaType('print');
await page.evaluate(async () => {
  document.querySelectorAll('img[loading=lazy]').forEach((i) => (i.loading = 'eager'));
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = r; }))));
});

// every page: nothing may leave the page box or run into the footer band
const problems = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('.sheet').forEach((sheet, idx) => {
    const pg = sheet.querySelector('.page');
    const pr = pg.getBoundingClientRect();
    const limitBottom = pr.bottom - (pg.querySelector('.foot') ? 44 : 8);
    for (const el of pg.querySelectorAll('*')) {
      if (el.closest('.foot') || el.closest('svg') || el.matches('.dot,.panel,i')) continue;
      if (el.closest('.crop') && !el.matches('.crop')) continue; // zoomed images are clipped by their crop box on purpose
      if (pg.classList.contains('cover') && el.closest('.dash,.ph1,.ph2,.copy,.note')) { /* checked separately below */ }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > pr.right + 1 || r.left < pr.left - 1) out.push(`p${idx + 1}: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} sticks out sideways (${Math.round(r.left - pr.left)}..${Math.round(r.right - pr.left)} of ${Math.round(pr.width)})`);
      if (!pg.classList.contains('cover') && r.bottom > limitBottom + 1) out.push(`p${idx + 1}: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} runs into the footer (bottom ${Math.round(r.bottom - pr.top)} > ${Math.round(limitBottom - pr.top)})`);
    }
  });
  return [...new Set(out)];
});
console.log(problems.length ? `LAYOUT PROBLEMS (${problems.length}):\n  ${problems.slice(0, 40).join('\n  ')}` : 'layout check: every page fits');

const file = `${dir}SchoolSync-Product-Catalogue.pdf`;
await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true, timeout: 240000 });
await browser.close();
console.log(`PDF: ${(statSync(file).size / 1048576).toFixed(1)} MB → ${file}`);
process.exit(problems.length ? 2 : 0);
