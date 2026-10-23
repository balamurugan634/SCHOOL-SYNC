// Captures the product walkthrough screenshots used by the brochure (brochure/assets/web/*.jpg + manifest.json).
//   flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 2G -- node scripts/capture-brochure.mjs [--only=name,name]
// Needs the dev stack running with the demo school (pnpm dev, pnpm site:reset-demo). Read-only: it never submits a form.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://demo.localhost:3000';
const OUT = process.env.OUT_DIR ?? '/home/bala/SCHOOL-SYNC/brochure/assets/web';
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1]?.split(',').filter(Boolean);
const W = 1440;
const H = 900;
mkdirSync(OUT, { recursive: true });

const LOGINS = { admin: 'admin@greenvalley.edu', principal: 'principal', accounts: 'accounts', office: 'office', teacher: 't001', student: 'gv20260001', parent: '9000000001' };

/**
 * name, role, title (brochure caption), path | open: { from, selector } (first link in a list), then optional actions.
 * `click` = text of a button to click first (opens a drawer/dialog), `rowClick` = open the first table row, `dark` = dark theme.
 */
const SHOTS = [
  // ── getting started
  { name: 'auth-find-school', role: null, title: 'Find your school', path: '/find-school' },
  { name: 'auth-sign-in', role: null, title: 'Sign in', path: '/login' },
  { name: 'auth-welcome-tour', role: 'admin', title: 'A short welcome tour', path: '/admin', keepTour: true },
  // ── management
  { name: 'admin-dashboard', role: 'admin', title: 'Management dashboard', path: '/admin' },
  { name: 'admin-dashboard-dark', role: 'admin', title: 'Dark mode', path: '/admin', dark: true },
  { name: 'admin-setup', role: 'admin', title: 'Get your school ready', path: '/admin/setup' },
  { name: 'academics-years', role: 'admin', title: 'Academic years and terms', path: '/admin/academics/years' },
  { name: 'academics-classes', role: 'admin', title: 'Classes and sections', path: '/admin/academics/classes' },
  { name: 'academics-assignments', role: 'admin', title: 'Teaching assignments', path: '/admin/academics/assignments' },
  { name: 'academics-timetable', role: 'admin', title: 'Timetable editor', path: '/admin/academics/timetable' },
  { name: 'academics-promotions', role: 'admin', title: 'Year-end promotion', path: '/admin/academics/promotions' },
  { name: 'people-students', role: 'admin', title: 'Student records', path: '/admin/people/students' },
  { name: 'people-student-detail', role: 'admin', title: 'Student profile', open: { from: '/admin/people/students', selector: 'tbody a[href*="/admin/people/students/"]' } },
  { name: 'people-student-edit', role: 'admin', title: 'Edit a student', open: { from: '/admin/people/students', selector: 'tbody a[href*="/admin/people/students/"]' }, click: /^edit/i },
  { name: 'people-import', role: 'admin', title: 'Bulk import', path: '/admin/people/students/import' },
  { name: 'people-staff', role: 'admin', title: 'Staff directory', path: '/admin/people/staff' },
  { name: 'people-admissions', role: 'admin', title: 'Admissions', path: '/admin/people/admissions' },
  { name: 'attendance-summary', role: 'admin', title: 'School attendance', path: '/admin/attendance' },
  { name: 'attendance-leave', role: 'admin', title: 'Leave approvals', path: '/admin/attendance/leave' },
  { name: 'exams-list', role: 'admin', title: 'Examinations', path: '/admin/exams' },
  { name: 'exams-review', role: 'principal', title: 'Mark sheet review', path: '/admin/exams/review' },
  { name: 'exams-report-cards', role: 'admin', title: 'Report cards', path: '/admin/exams/report-cards' },
  { name: 'finance-overview', role: 'accounts', title: 'Finance overview', path: '/admin/finance' },
  { name: 'finance-invoices', role: 'accounts', title: 'Invoices', path: '/admin/finance/invoices' },
  { name: 'finance-invoice-drawer', role: 'accounts', title: 'Invoice detail and payments', path: '/admin/finance/invoices', rowClick: true },
  { name: 'finance-structures', role: 'accounts', title: 'Fee structures', path: '/admin/finance/structures' },
  { name: 'finance-payments', role: 'accounts', title: 'Payments and receipts', path: '/admin/finance/payments' },
  { name: 'finance-reports', role: 'accounts', title: 'Outstanding and defaulters', path: '/admin/reports/fees' },
  { name: 'finance-expenses', role: 'accounts', title: 'Expenses', path: '/admin/finance/expenses' },
  { name: 'comms-announcements', role: 'office', title: 'Announcements', path: '/admin/communication/announcements' },
  { name: 'comms-compose', role: 'office', title: 'Compose with audience targeting', path: '/admin/communication/announcements/new' },
  { name: 'comms-events', role: 'office', title: 'Events and calendar', path: '/admin/communication/events' },
  { name: 'ops-transport', role: 'admin', title: 'Transport', path: '/admin/operations/transport' },
  { name: 'ops-library', role: 'admin', title: 'Library', path: '/admin/operations/library' },
  { name: 'reports-hub', role: 'admin', title: 'Reports hub', path: '/admin/reports' },
  { name: 'settings-roles', role: 'admin', title: 'Roles and permissions', open: { from: '/admin/settings/roles', selector: 'a[href*="/admin/settings/roles/"]' } },
  { name: 'settings-users', role: 'admin', title: 'User accounts', path: '/admin/settings/users' },
  { name: 'settings-school', role: 'admin', title: 'School branding and settings', path: '/admin/settings/school' },
  { name: 'settings-audit', role: 'admin', title: 'Audit trail', path: '/admin/settings/audit' },
  { name: 'settings-license', role: 'admin', title: 'Subscription and seats', path: '/admin/settings/license' },
  // ── teacher
  { name: 'teacher-home', role: 'teacher', title: 'Teacher home', path: '/teacher' },
  { name: 'teacher-rollcall', role: 'teacher', title: 'Roll call', path: '/teacher/attendance' },
  { name: 'teacher-homework', role: 'teacher', title: 'Homework', path: '/teacher/homework' },
  { name: 'teacher-marks', role: 'teacher', title: 'Marks entry', open: { from: '/teacher/marks', selector: 'a[href*="/teacher/marks/sheets/"]' } },
  { name: 'teacher-timetable', role: 'teacher', title: 'My timetable', path: '/teacher/timetable' },
  { name: 'teacher-class', role: 'teacher', title: 'My classes', open: { from: '/teacher/classes', selector: 'a[href*="/teacher/classes/"]' } },
  // ── student
  { name: 'student-home', role: 'student', title: 'Student home', path: '/student' },
  { name: 'student-tasks', role: 'student', title: 'My tasks', path: '/student/tasks' },
  { name: 'student-learning', role: 'student', title: 'Homework and learning', path: '/student/learning' },
  { name: 'student-results', role: 'student', title: 'Results', path: '/student/learning?tab=results' },
  { name: 'student-calendar', role: 'student', title: 'Calendar', path: '/student/calendar' },
  { name: 'student-home-dark', role: 'student', title: 'Student home, dark', path: '/student', dark: true },
  // ── parent
  { name: 'parent-home', role: 'parent', title: 'Parent home', path: '/parent' },
  { name: 'parent-attendance', role: 'parent', title: 'Attendance', path: '/parent/attendance' },
  { name: 'parent-fees', role: 'parent', title: 'Fees and receipts', path: '/parent/fees' },
  { name: 'parent-communication', role: 'parent', title: 'Announcements and events', path: '/parent/communication' },
];

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = [];
const sessions = new Map(); // role → incognito context + page (signed in once)

async function sessionFor(role, keepTour) {
  const key = `${role}${keepTour ? ':tour' : ''}`;
  if (sessions.has(key)) return sessions.get(key);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1.5 });
  if (role) {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.type('#identifier', LOGINS[role]);
    await page.type('#password', 'Demo@12345');
    await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 }), page.keyboard.press('Enter')]);
    await sleep(1500);
    if (!keepTour) {
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /skip tour/i.test(b.textContent ?? ''))?.click());
      await sleep(700);
    }
  }
  sessions.set(key, page);
  return page;
}

async function settle(page) {
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 20000 }).catch(() => {});
  // wait until skeleton placeholders are gone
  await page.waitForFunction(() => !document.querySelector('.skeleton, [class*="skeleton"], [aria-busy="true"]'), { timeout: 12000 }).catch(() => {});
  await sleep(500);
}

async function setTheme(page, dark) {
  await page.evaluate((dark) => {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, dark);
}

for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  try {
    const page = await sessionFor(shot.role, shot.keepTour);
    await setTheme(page, !!shot.dark);
    let url = shot.path;
    if (shot.open) {
      await page.goto(`${BASE}${shot.open.from}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await settle(page);
      url = await page.evaluate((sel) => document.querySelector(sel)?.getAttribute('href') ?? null, shot.open.selector);
      if (!url) throw new Error(`no link for ${shot.open.selector}`);
    }
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await setTheme(page, !!shot.dark);
    await settle(page);
    if (shot.rowClick) {
      await page.evaluate(() => document.querySelector('tbody tr')?.click());
      await sleep(900);
    }
    if (shot.click) {
      const ok = await page.evaluate((src) => {
        const re = new RegExp(src, 'i');
        const b = [...document.querySelectorAll('button')].find((x) => re.test((x.textContent ?? '').trim()) && !x.disabled);
        b?.click();
        return !!b;
      }, shot.click.source);
      if (!ok) throw new Error(`no button ${shot.click}`);
      await sleep(900);
    }
    await sleep(shot.keepTour ? 1200 : 200);
    await page.screenshot({ path: `${OUT}/${shot.name}.jpg`, type: 'jpeg', quality: 90 });
    manifest.push({ name: shot.name, title: shot.title, role: shot.role ?? 'public', url });
    console.log(`✓ ${shot.name}`);
  } catch (e) {
    console.log(`✗ ${shot.name}: ${String(e).slice(0, 120)}`);
  }
}

if (!only) writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`\n${manifest.length} screenshots → ${OUT}`);
