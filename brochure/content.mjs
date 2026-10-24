// Catalogue content. Every caption describes what the screen shows; facts about pricing and security come from docs/PRICING-AND-BILLING.md and docs/SECURITY.md.
// Screens come from the demo school ("Green Valley Public School") with sample data.

export const CHAPTERS = [
  { id: 'overview', name: 'Overview', blurb: 'What SchoolSync is and how it is built' },
  { id: 'start', name: 'Getting started', blurb: 'Find your school, sign in, take the tour' },
  { id: 'dash', name: 'Management home', blurb: 'The dashboard, on the web and on the phone' },
  { id: 'setup', name: 'School setup', blurb: 'Years, classes, teachers, timetable, promotion' },
  { id: 'people', name: 'People & admissions', blurb: 'Students, staff, imports, applications' },
  { id: 'attendance', name: 'Attendance & leave', blurb: 'Daily attendance, trends, leave decisions' },
  { id: 'exams', name: 'Exams & results', blurb: 'Schedules, mark review, report cards' },
  { id: 'fees', name: 'Fees & finance', blurb: 'Invoices, payments, defaulters, expenses' },
  { id: 'comms', name: 'Communication & events', blurb: 'Announcements and the school calendar' },
  { id: 'ops', name: 'Operations & reports', blurb: 'Transport, library and the reports hub' },
  { id: 'admin', name: 'Settings & access', blurb: 'Roles, users, branding and the audit log' },
  { id: 'teacher', name: 'For teachers', blurb: 'Roll call, homework and marks' },
  { id: 'student', name: 'For students', blurb: 'Home, tasks, learning, results' },
  { id: 'parent', name: 'For parents', blurb: 'Attendance, fees and school news' },
  { id: 'security', name: 'Security & privacy', blurb: 'How each school’s data is protected' },
  { id: 'pricing', name: 'Pricing & licence', blurb: 'Per student, per academic year' },
  { id: 'rollout', name: 'Going live', blurb: 'From an empty site to a school in use' },
];

const duo = (chapter, kicker, title, lede, points, shots) => ({ layout: 'duo', chapter, kicker, title, lede, points, shots });
const hero = (chapter, kicker, title, lede, points, shots) => ({ layout: 'hero', chapter, kicker, title, lede, points, shots });
const phones = (chapter, kicker, title, lede, points, shots) => ({ layout: 'phones', chapter, kicker, title, lede, points, shots });

export const PAGES = [
  // 1 ── cover
  {
    layout: 'raw', chapter: 'overview', cls: 'cover', noFoot: true, title: 'SchoolSync', nav: 'Cover',
    html: ({ web, phone, MARK }) => `
      <div class="panel"></div>
      <div class="copy">
        <div class="wordmark" data-r>${MARK(38)}<span>SchoolSync</span></div>
        <h1 data-r style="--i:1">One platform for the <em>whole school day</em>.</h1>
        <p class="sub" data-r style="--i:2">Management, teachers, students and parents, on the web and on the phone. A tour of the product, screen by screen.</p>
        <div class="chips" data-r style="--i:3"><span class="chip"><b>12</b> modules</span><span class="chip"><b>4</b> role homes</span><span class="chip">Web + mobile</span><span class="chip">Own database per school</span></div>
      </div>
      <div class="dash">${web('admin-dashboard')}</div>
      <div class="ph1">${phone('05-student-home.png')}</div>
      <div class="ph2">${phone('07-parent-home.png')}</div>
      <i class="dot a"></i><i class="dot b"></i>
      <p class="note">Product catalogue · Screens are from a demo school with sample data.</p>`,
  },

  // 2 ── contents
  {
    layout: 'raw', chapter: 'overview', title: 'What is inside', nav: 'Contents',
    html: ({ head }) => `${head({ kicker: 'Contents', title: 'What is <em>inside</em>', lede: 'Chapters follow the way a school is run: set it up, run the day, then see it through each person’s eyes. Click a chapter to jump to it.' }, true)}<div class="toc-list"><!--TOC--></div>`,
  },

  // 3 ── at a glance
  {
    layout: 'raw', chapter: 'overview', title: 'One product. Four ways to use it.', nav: 'At a glance',
    html: ({ head }) => `
      ${head({ kicker: 'At a glance', title: 'One product. <em>Four ways</em> to use it.', lede: 'SchoolSync gives each person a home built for their job, not one dashboard with buttons hidden. Everyone works from the same records and sees only what they are allowed to.' }, true)}
      <div class="stats">
        <div class="stat" data-r style="--i:2"><div class="n"><span data-count="12">12</span></div><div class="l">Modules</div><div class="d">From admissions and attendance to fees, exams and the library.</div></div>
        <div class="stat" data-r style="--i:3"><div class="n"><span data-count="4">4</span></div><div class="l">Role homes</div><div class="d">Management, teacher, student and parent.</div></div>
        <div class="stat" data-r style="--i:4"><div class="n"><span data-count="1">1</span><small>per school</small></div><div class="l">Database</div><div class="d">Every school’s data is kept apart from every other’s.</div></div>
        <div class="stat" data-r style="--i:5"><div class="n"><span data-count="2">2</span></div><div class="l">Ways in</div><div class="d">A web app and a mobile app, from the same records.</div></div>
      </div>
      <div class="roles">
        <div class="role" data-r style="--i:4"><div class="art"><img src="assets/art/onboarding-management.svg" alt=""></div><div class="tx"><h3>Management</h3><p>Principal, administrator, accountant and office roles. See the whole school, approve, publish and report.</p><p class="on">Web + mobile</p></div></div>
        <div class="role" data-r style="--i:5"><div class="art"><img src="assets/art/onboarding-teacher.svg" alt=""></div><div class="tx"><h3>Teachers</h3><p>Today’s lessons, roll call, homework and marks for the classes they teach, and nothing else.</p><p class="on">Web + mobile</p></div></div>
        <div class="role" data-r style="--i:6"><div class="art"><img src="assets/art/onboarding-student.svg" alt=""></div><div class="tx"><h3>Students</h3><p>Timetable, homework, tasks, results and the school calendar in five simple tabs.</p><p class="on">Web + mobile</p></div></div>
        <div class="role" data-r style="--i:7"><div class="art"><img src="assets/art/onboarding-parent.svg" alt=""></div><div class="tx"><h3>Parents</h3><p>Attendance, homework, results and fees for each linked child, with school news in one place.</p><p class="on">Web + mobile</p></div></div>
      </div>`,
  },

  // 4 ── how it is built
  {
    layout: 'raw', chapter: 'overview', title: 'One codebase, one database per school', nav: 'How it is built',
    html: ({ head, icon }) => `
      ${head({ kicker: 'How it is built', title: 'One codebase, <em>one database</em> per school', lede: 'Every school is a site with its own database, its own sign-in key and its own colours. A sign-in from one school can never open another.' }, true)}
      <div class="arch">
        <div data-r style="--i:2"><p class="col-h">People</p>
          <div class="box">${icon('phone')}<div><b>Mobile app</b><small>Asks for the school once, on first launch</small></div></div>
          <div class="box">${icon('layers')}<div><b>Web app</b><small>Each school has its own address</small></div></div>
          <div class="box">${icon('users')}<div><b>Four role homes</b><small>Management, teachers, students, parents</small></div></div>
        </div>
        <svg class="flow" viewBox="0 0 56 30" data-r style="--i:3"><line x1="4" y1="15" x2="52" y2="15"/></svg>
        <div class="core" data-r style="--i:3"><h3>SchoolSync service</h3><p>One application serves every school.</p>
          <ul>
            <li>${icon('check')}<span>Works out which school and which person is asking</span></li>
            <li>${icon('check')}<span>Applies role, scope and action rules to every record</span></li>
            <li>${icon('check')}<span>Sends push and e-mail notifications, with quiet hours</span></li>
            <li>${icon('check')}<span>Runs reminders and usage metering in the background</span></li>
          </ul>
        </div>
        <svg class="flow" viewBox="0 0 56 30" data-r style="--i:4"><line x1="4" y1="15" x2="52" y2="15"/></svg>
        <div data-r style="--i:4"><p class="col-h">Data</p>
          <div class="db">${icon('db')}<b>Your school</b><small>Own database, own key, own branding</small></div>
          <div class="db">${icon('db')}<b>Another school</b><small>Completely separate database</small></div>
          <div class="db">${icon('db')}<b>Another school</b><small>Completely separate database</small></div>
          <div class="db ctl">${icon('layers')}<b>Control plane</b><small>List of schools, subscriptions, usage</small></div>
        </div>
      </div>`,
  },

  // 5 ── getting started (web)
  {
    layout: 'steps', chapter: 'start', kicker: 'Getting started · Web',
    title: 'From the school’s address to the first screen',
    lede: 'Each school has its own address. People enter it once, sign in with the details the school gave them, and a short tour introduces the screens for their role.',
    shots: [
      ['auth-find-school', ['Find your school', 'Enter the school code or web address once. A school’s own address goes straight to its sign-in.'], ['50% 52%', 2.1]],
      ['auth-sign-in', ['Sign in', 'Choose Student, Parent, Teacher or Staff, then use a username, e-mail or phone number.'], ['98% 41%', 2.2]],
      ['auth-welcome-tour', ['A short welcome tour', 'The first sign-in opens a four-step tour of the screens that role uses. It can be skipped or replayed.'], ['50% 36%', 1.9]],
    ],
  },

  // 6 ── getting started (mobile)
  phones('start', 'Getting started · Mobile app', 'The same start on the phone',
    'The app asks for the school once, on first launch, and remembers it. After that it opens straight to the sign-in, in the school’s own colours.',
    ['Short introductions for students and for parents', 'Confirm the school by name before continuing', 'Sign in with username, e-mail, phone, admission number or employee ID'],
    [
      ['01-intro-students.png', ['Welcome, students', 'Timetable, homework and exams in one place.']],
      ['02-intro-parents.png', ['Welcome, parents', 'Follow each child: attendance, results, fees and notices.']],
      ['03-connect-school.png', ['Connect your school', 'Check the school’s name, then continue. Wrong school? Choose another.']],
      ['04-login.png', ['Sign in', 'The school’s logo and colours appear once it is connected.']],
    ]),

  // 7 ── management home (web)
  duo('dash', 'Management · Home', 'The whole school <em>at a glance</em>',
    'Principals and administrators land on today’s numbers: who is in, what needs a decision and how fees are going. Every tile opens the screen where you act on it.',
    ['Students, staff, parents and classes in one row', 'Today’s attendance, with classes still to mark', 'A queue of approvals: leave, corrections, mark sheets, admissions', 'Seven-day attendance trend, with a table view'],
    [
      ['admin-dashboard', ['Management dashboard', 'Headline numbers, today’s attendance and the approval queue on one screen.']],
      ['admin-dashboard-dark', ['Dark mode', 'Anyone can switch to a dark theme from the top bar.']],
    ]),

  // 8 ── management home (mobile)
  phones('dash', 'Management · Mobile', 'Decisions from the phone',
    'The principal’s app opens on the same numbers and the same approval queue, so a leave request can be decided between meetings.',
    ['Headline numbers and the approval queue on Home', 'Approve or reject a request with a note', 'Finance summary: collected, outstanding, overdue'],
    [
      ['14-management-home.png', ['Home', 'Students, classes, staff and parents, then everything waiting for a decision.']],
      ['14b-management-attendance-trend.png', ['Attendance trend', 'Today’s attendance, classes still to mark and a seven-day trend with a table view.']],
      ['15-management-approvals.png', ['Decide a request', 'Open a leave request, add a note, approve or reject.']],
      ['16-management-finance.png', ['Finance', 'Collected, outstanding, overdue and expenses at a glance.']],
    ]),

  // 9 ── set up
  duo('setup', 'School setup · Getting ready', 'A guided start for a <em>new school</em>',
    'The setup page checks the school’s real data and shows what is left: profile and branding, terms, grades, sections and subjects. Each step links to the screen where it is done.',
    ['A checklist that ticks itself off', 'Subscription and seats shown alongside', 'One current academic year at a time', 'Terms and school-day periods feed the timetable'],
    [
      ['admin-setup', ['School setup', 'A checklist driven by the school’s own data, with the subscription and seat count beside it.']],
      ['academics-years', ['Academic years and terms', 'The calendar everything else hangs from. School-day periods are set up here too.']],
    ]),

  // 10 ── classes + assignments
  duo('setup', 'School setup · Classes', 'Classes, sections and <em>who teaches what</em>',
    'Build grades and sections for the year, then put a teacher against each subject in each section.',
    ['Class teacher, room and how full each section is', 'Pick a teacher in a cell and it saves straight away', 'A progress bar shows subject slots still without a teacher'],
    [
      ['academics-classes', ['Classes and sections', 'Sections with class teacher, room and capacity.']],
      ['academics-assignments', ['Teaching assignments', 'Sections by subject. Each teacher’s current load is shown next to their name.']],
    ]),

  // 11 ── timetable + promotions
  duo('setup', 'School setup · Timetable', 'Timetable, covers and <em>year-end promotion</em>',
    'Build each section’s weekly timetable, cover for absent teachers, and move a whole year of students up when the year ends.',
    ['Clashes are checked as you save', 'Covers for a teacher’s absence on a given day', 'Promotion is previewed in full before anything changes'],
    [
      ['academics-timetable', ['Timetable editor', 'Periods by weekday for one section. Covers are marked on the lessons they replace.']],
      ['academics-promotions', ['Year-end promotion', 'A four-step guided flow: years and grades, exceptions, review, confirm.']],
    ]),

  // 12 ── students
  duo('people', 'People · Students', 'Student records, <em>found in seconds</em>',
    'Search by name or admission number, filter by grade, section and status, and choose which columns to show. Open a student for the full profile.',
    ['Add one student, or import many from a CSV', 'Export the filtered list to CSV', 'Profile with parents, documents, attendance, results and fees'],
    [
      ['people-students', ['Students', 'Search, filters, CSV export and a column picker.']],
      ['people-student-detail', ['Student profile', 'Details, emergency contacts, authorised pickup, sign-in and enrolment history in one place.']],
    ]),

  // 13 ── edit + import
  duo('people', 'People · Editing and import', 'Edit in a side sheet, <em>import in bulk</em>',
    'Changes open in a sheet beside the record, so you never lose your place. A CSV import checks every row first and says what is wrong before anything is saved.',
    ['A warning before unsaved changes are lost', 'A CSV template, with what each column means', 'Seat limits are checked before students are added'],
    [
      ['people-student-edit', ['Edit student details', 'Name, dates, address and emergency contacts, with Save and Cancel always in reach.']],
      ['people-import', ['Bulk import', 'Upload or paste a CSV. Rows are validated first, then imported.']],
    ]),

  // 14 ── staff + admissions
  duo('people', 'People · Staff and admissions', 'Staff, and applications <em>from enquiry to enrolment</em>',
    'Staff profiles carry roles and sign-in status. Admissions follow an application from first enquiry to enrolment.',
    ['Teaching and non-teaching staff in one directory', 'Roles shown against each person', 'Stages: submitted, in review, waitlisted, accepted, enrolled'],
    [
      ['people-staff', ['Staff', 'Designation, type, roles and whether each person has a login.']],
      ['people-admissions', ['Admissions', 'Applications by stage, with the parent’s contact and the grade applied for.']],
    ]),

  // 15 ── attendance
  duo('attendance', 'Attendance & leave', 'Attendance the <em>whole school can see</em>',
    'Teachers mark attendance in class. Management sees the school’s day at a glance, chases classes that have not marked, and decides leave requests.',
    ['Present, absent, late, half-day and on-leave counts', 'Seven-day trend and a shortage scan', 'Student leave with dates, type and reason', 'Corrections and staff attendance in their own tabs'],
    [
      ['attendance-summary', ['School attendance', 'Today’s numbers, classes still to mark and a trend. The shortage scan and CSV export sit on the same page.']],
      ['attendance-leave', ['Student leave', 'Pending requests with dates, type and reason. Approve or reject in a click.']],
    ]),

  // 16 ── exams
  duo('exams', 'Exams & results', 'From exam schedule to <em>published result</em>',
    'Plan exams and papers, let teachers enter marks, review the sheets before anything is published, and set the grade scales the school uses.',
    ['Exam status from not started to published', 'Teachers submit mark sheets; the principal approves or returns them', 'Grade scales and pass marks set by the school'],
    [
      ['exams-list', ['Examinations', 'Each exam with its dates, papers and how many mark sheets are approved.']],
      ['exams-review', ['Mark sheet review', 'Submitted sheets from every class in one queue, with Approve and Open.']],
    ]),

  // 17 ── report cards
  hero('exams', 'Exams & results · Report cards', 'Report cards <em>families can open</em>',
    'Class teachers add a remark and a conduct grade for each student. Publish them for the class and families see the result in the app.',
    ['Remarks and conduct per student', 'Publish all drafts in one action', 'A report card PDF from the student’s results'],
    [['exams-report-cards', ['Report cards', 'Class-teacher remarks and conduct, with Draft or Published status for each student.']]]),

  // 18 ── fees 1
  duo('fees', 'Fees & finance', 'Money in, money out, <em>at a glance</em>',
    'The finance overview sets what was collected against what was spent, and shows what is outstanding and overdue. Invoices are raised per student and tracked until paid.',
    ['Collection rate and net position', 'Filter invoices by status, grade and due date', 'Generate dues from fee structures in one go', 'Export to CSV'],
    [
      ['finance-overview', ['Finance overview', 'Collected, outstanding, overdue, collection rate, expenses and refunds, with a monthly chart.']],
      ['finance-invoices', ['Invoices', 'Every invoice with amount, paid, balance and status. Generate dues or raise a new invoice.']],
    ]),

  // 19 ── fees 2
  duo('fees', 'Fees & finance · Invoices and setup', 'Open an invoice, <em>see everything</em>',
    'An invoice opens in a side panel with its items, concessions and payments, and the actions that matter: record a payment, print, or void.',
    ['Fee structures per grade, with instalments and due dates', 'Student plans and concessions, with approval', 'Receipts on request'],
    [
      ['finance-invoice-drawer', ['Invoice detail', 'Items, discounts, payments and balance, with Record payment and Print.']],
      ['finance-structures', ['Fee setup', 'Structures by grade with instalments. Plans, dues, concessions and categories are in neighbouring tabs.']],
    ]),

  // 20 ── fees 3
  duo('fees', 'Fees & finance · Payments and dues', 'Payments, receipts and <em>defaulters</em>',
    'Every payment carries a receipt number and a method. Fee reports show who owes what, how old the dues are and how collection is going.',
    ['Cash, card, UPI and online payments', 'Refunds and online payments in their own tabs', 'Ageing buckets and a defaulters list for follow-up'],
    [
      ['finance-payments', ['Payments and receipts', 'Receipt, student, method, amount and status, filterable by date and method.']],
      ['finance-reports', ['Outstanding and ageing', 'How long unpaid balances have been due. Defaulters and collection reports are in the tabs.']],
    ]),

  // 21 ── expenses
  hero('fees', 'Fees & finance · Expenses', 'Expenses with <em>approvals</em>',
    'Record what the school spends, with receipts. Larger expenses wait for approval before they count.',
    ['An approval queue for larger expenses', 'A summary by month and category', 'Export to CSV'],
    [['finance-expenses', ['Expenses', 'Spend by category and date, with Approved or Pending status.']]]),

  // 22 ── announcements
  duo('comms', 'Communication', 'Announcements that <em>reach the right people</em>',
    'Write once, choose who should receive it, then publish now or save a draft. Delivery and read status are tracked for every announcement.',
    ['Audience: everyone, a role, a grade or a section', 'Priority: normal, important or urgent', 'Read counts and acknowledgements', 'Push and e-mail, with quiet hours'],
    [
      ['comms-announcements', ['Announcements', 'Draft, scheduled, published, expired and archived, with audience, read counts and acknowledgements.']],
      ['comms-compose', ['Compose', 'Title, message and audience. Save a draft or publish.']],
    ]),

  // 23 ── events
  hero('comms', 'Communication · Calendar', 'One calendar for the <em>whole school</em>',
    'Holidays, events, exams, homework deadlines and parent–teacher meetings share one calendar, in month and agenda views.',
    ['Colour-coded by type', 'Registration and consent on events', 'Parent–teacher meetings alongside'],
    [['comms-events', ['Events and calendar', 'Month view with Holiday, Event, Exam paper, Homework due and Other categories.']]]),

  // 24 ── operations
  duo('ops', 'Operations', 'Transport and <em>library</em>',
    'Routes, stops and buses with seat counts, and a library catalogue with issue, return and overdue tracking.',
    ['Seats left on each route', 'Students allocated to each bus', 'Availability, shelf and category for every book', 'Loans, overdue items and lending rules'],
    [
      ['ops-transport', ['Transport', 'Routes with bus, pickup and drop times, stops and how many seats are taken.']],
      ['ops-library', ['Library', 'The catalogue with availability. Loans, overdue and policy have their own tabs.']],
    ]),

  // 25 ── reports
  hero('ops', 'Operations · Reports', 'Reports, grouped by <em>the question they answer</em>',
    'Attendance, fees and academics are laid out by what you want to know, not by table. Open a report to filter it, and export it where a CSV is offered.',
    ['Attendance, leave and absenteeism', 'Outstanding fees, defaulters and collection', 'Expense summary', 'CSV export on most reports'],
    [['reports-hub', ['Reports hub', 'Each card says what the report answers and whether a CSV export is available.']]]),

  // 26 ── roles + users
  duo('admin', 'Settings & access · Roles', 'Who can do what, <em>set by the school</em>',
    'Every role is a list of actions on records, each limited to a scope: own, linked children, assigned classes, or the whole school. Start from the built-in roles and adjust.',
    ['Built-in roles for principal, administrator, accountant, office and more', 'Scope: own, linked, assigned, school', 'Actions: view, create, edit, approve, publish, export, delete', 'Reset any role to its built-in setting'],
    [
      ['settings-roles', ['Roles and permissions', 'A matrix of modules by action, with a scope picker on each row.']],
      ['settings-users', ['User accounts', 'Everyone who can sign in: staff, students and parents, with role and last sign-in.']],
    ]),

  // 27 ── school + audit
  duo('admin', 'Settings & access · Identity and audit', 'The school’s identity, and <em>a record of what happens</em>',
    'Logo, name and colour make the app the school’s own. The audit log shows who did what and when; entries cannot be edited or deleted.',
    ['The school colour is softened automatically so text stays readable', 'Tabs for attendance, school days, exams, fees, library, notifications and features', 'Sign-ins and sensitive actions are logged'],
    [
      ['settings-school', ['School profile and branding', 'Logo, name and school colour, with tabs for the school’s rules.']],
      ['settings-audit', ['Audit log', 'Who, what, where and when, filterable and exportable to CSV.']],
    ]),

  // 28 ── teacher web 1
  duo('teacher', 'Teachers · Web', 'A home built for <em>the school day</em>',
    'Teachers open on today: attendance still to mark, homework to review, marks to enter and requests waiting. They see only the classes they teach.',
    ['Today’s lessons with period and room', 'Leave requests and parent meetings waiting', 'Roll call in a few taps'],
    [
      ['teacher-home', ['Teacher home', 'What needs doing today, the day’s lessons and requests waiting.']],
      ['teacher-rollcall', ['Roll call', 'Present, absent, late or half-day for each student, with keyboard shortcuts and Mark all present.']],
    ]),

  // 29 ── teacher web 2
  duo('teacher', 'Teachers · Web', 'Homework and marks, <em>without the paperwork</em>',
    'Set homework for a class, see who has handed in and review the work. Enter marks per student against a mark sheet and submit it for approval.',
    ['Hand-in progress on every task', 'Marks entry with absent flags and running totals', 'A draft is kept until you submit'],
    [
      ['teacher-homework', ['Homework', 'Set by me, or all homework in my classes, with hand-in progress.']],
      ['teacher-marks', ['Marks entry', 'One field per student, with average, highest and lowest shown as you type.']],
    ]),

  // 30 ── teacher web 3
  duo('teacher', 'Teachers · Web', 'My classes and <em>my week</em>',
    'Class pages show each student’s attendance and homework record. The timetable shows the week’s lessons, including any cover for a colleague.',
    ['Subjects and syllabus progress for each class', 'Attendance and homework history per student'],
    [
      ['teacher-class', ['Class overview', 'Students with attendance over 30 days and homework handed in.']],
      ['teacher-timetable', ['My timetable', 'The week’s lessons, with covers marked.']],
    ]),

  // 31 ── teacher mobile
  phones('teacher', 'Teachers · Mobile', 'The teacher’s day, <em>in a pocket</em>',
    'Roll call, homework and marks are what teachers do most. On the phone each one is a short, thumb-friendly flow.',
    ['Mark everyone present, then change the exceptions', 'See hand-in progress at a glance', 'Save marks as a draft, submit when done'],
    [
      ['10-teacher-home.png', ['Home', 'Attendance to mark, today’s lessons and to-dos.']],
      ['11-teacher-rollcall.png', ['Roll call', 'Tap present or absent for each student, or Mark all present.']],
      ['12-teacher-homework.png', ['Homework', 'Active, drafts and closed, with hand-in progress.']],
      ['13-teacher-marks.png', ['Marks', 'Enter marks for each student. Save a draft or submit.']],
    ]),

  // 32 ── student web 1
  duo('student', 'Students · Web', 'Today, <em>at a glance</em>',
    'Students get five simple tabs: Home, My Tasks, Calendar, Learning and Profile. Home shows attendance, homework due, open tasks and results.',
    ['Today’s classes, with the lesson happening now', 'Announcements from the school', 'Personal tasks next to homework'],
    [
      ['student-home', ['Student home', 'Attendance, homework to do, open tasks, results, today’s classes and announcements.']],
      ['student-tasks', ['My Tasks', 'Homework and personal to-dos in one list, with overdue items flagged.']],
    ]),

  // 33 ── student web 2
  duo('student', 'Students · Web', 'Homework, results and <em>progress</em>',
    'The Learning tab holds homework with hand-in status, the timetable, study materials, syllabus and exams. Results show a term at a glance and progress across exams.',
    ['Homework with due dates, status and marks', 'Study materials and syllabus', 'Report card as a PDF'],
    [
      ['student-learning', ['Learning', 'Homework with due dates, hand-in status and marks.']],
      ['student-results', ['Results', 'Overall percentage, grade and class rank, with a chart by subject.']],
    ]),

  // 34 ── student web 3
  duo('student', 'Students · Web', 'A calendar that includes <em>your own deadlines</em>',
    'Classes, exams, homework deadlines, holidays and school events share one calendar, in month and agenda views.',
    ['Exams and homework due dates on the same grid', 'Holidays and school events'],
    [
      ['student-calendar', ['Calendar', 'Month view with exams, homework due dates and holidays.']],
      ['student-home-dark', ['Dark mode', 'Available on every screen, for every role.']],
    ]),

  // 35 ── student mobile
  phones('student', 'Students · Mobile', 'Everything for a student, <em>on the phone</em>',
    'The home screen is short on purpose: what is on now, shortcuts for what students do most, and only what is due soon. The same five tabs as the web sit below.',
    ['Apply for leave, check attendance, homework and results in one tap', 'Today’s classes as a swipeable row', 'Homework detail with feedback from the teacher'],
    [
      ['05-student-home.png', ['Home', 'The lesson on now, one-tap shortcuts and three numbers at a glance.']],
      ['05b-student-home-scrolled.png', ['Today and due soon', 'Classes as a swipeable row, the next exam, homework due and the latest notice.']],
      ['06-student-homework.png', ['Homework detail', 'Instructions, due date, the student’s submission, marks and teacher feedback.']],
      ['09-student-results.png', ['Report card', 'Term result with percentage, grade, rank and every subject.']],
    ]),

  // 36 ── parent web 1
  duo('parent', 'Parents · Web', 'Every child, <em>one account</em>',
    'Parents see only the children whose link the school has verified, and switch between them from the top bar.',
    ['Attendance, homework and fees for the selected child', 'Fee balance, next due date and receipts', 'Parent–teacher meetings'],
    [
      ['parent-home', ['Parent home', 'Attendance, homework to do, fees due, the child’s day and meetings.']],
      ['parent-fees', ['Fees', 'What is due now, overdue amounts, the next due date, invoices and payment history.']],
    ]),

  // 37 ── parent web 2
  duo('parent', 'Parents · Web', 'Attendance and <em>school news</em>',
    'A month-by-month view shows attendance at a glance, with records and leave in their own tabs. Announcements, events and meetings arrive in one place.',
    ['Attendance rate, daily counts and a monthly heat map', 'Announcements with priority', 'Events, calendar, meetings and notifications'],
    [
      ['parent-attendance', ['Attendance', 'Attendance rate, daily counts and a month-by-month view.']],
      ['parent-communication', ['Communication', 'Announcements with priority, plus events, calendar, meetings and notifications.']],
    ]),

  // 38 ── parent mobile
  phones('parent', 'Parents · Mobile', 'Follow the day, <em>and the fees</em>',
    'Parents get the child selector, attendance, homework and fees on one Home screen, with the invoice details one tap away.',
    ['A selector for each linked child', 'Fee balance and next due date on Home', 'Online payment appears when the school turns it on'],
    [
      ['07a-parent-home-top.png', ['Home', 'Child selector and the day’s timetable.']],
      ['07-parent-home.png', ['Attendance, homework, fees', 'Scroll for attendance, homework due, fees due and exams.']],
      ['08-parent-fees.png', ['Fees', 'Due now, with the invoices for each child.']],
      ['08b-parent-invoice.png', ['Invoice', 'Items, total, paid and balance.']],
    ]),

  // 39 ── security
  {
    layout: 'raw', chapter: 'security', title: 'Built to keep a school’s data private', nav: 'Security',
    html: ({ head, icon }) => {
      const card = (ic, t, p, i) => `<div class="card" data-r style="--i:${i}"><div class="ic">${icon(ic)}</div><h3>${t}</h3><p>${p}</p></div>`;
      return `
      ${head({ kicker: 'Security & privacy', title: 'Built to keep a school’s <em>data private</em>', lede: 'Each school’s data lives in its own database, and every request is checked for who is asking and which school they belong to.' }, true)}
      <div class="cards">
        ${card('db', 'A database per school', 'No shared tables of school data and no filter to forget. A sign-in from one school cannot open another.', 2)}
        ${card('key', 'Strong sign-in', 'Passwords are hashed with Argon2id. Access is short-lived, refresh tokens rotate, and repeated failures lock the account.', 3)}
        ${card('shield', 'Role, scope and action', 'Every record is checked against what the person’s role may do. Records out of scope are answered as not found.', 4)}
        ${card('users', 'Verified family links', 'A parent sees a child only after the school has verified the link.', 5)}
        ${card('file', 'Audit trail', 'Who changed what, and when, with secrets redacted. Records are archived rather than deleted.', 6)}
        ${card('bell', 'Private notifications', 'Push messages never carry fees, marks or leave details, and recipients are resolved on the server.', 7)}
        ${card('phone', 'Safe on the phone', 'HTTPS only, sign-in tokens in the device’s secure storage, a biometric app lock and privacy screens on sensitive pages.', 8)}
        ${card('lock', 'Files and money', 'Each file is checked before it is served, privately. Payments use idempotency keys and verified webhooks.', 9)}
      </div>
      <p class="road" data-r style="--i:9"><b>On the roadmap</b><span>Two-factor sign-in for staff · app-integrity checks on the phone · object storage for files · an independent penetration test before go-live</span></p>`;
    },
  },

  // 40 ── pricing
  {
    layout: 'raw', chapter: 'pricing', title: 'Per student, per academic year', nav: 'Pricing',
    html: ({ web, head, icon }) => {
      const card = (ic, t, p, i) => `<div class="card" data-r style="--i:${i}"><div class="ic">${icon(ic)}</div><h3>${t}</h3><p>${p}</p></div>`;
      return `
      ${head({ kicker: 'Pricing & licence', title: 'Per student, <em>per academic year</em>', lede: 'One simple unit. A school pays for the students enrolled in an academic year. Staff, parents and administrator accounts are free and unlimited.' }, true)}
      <div class="price-grid">
        <div>
          <div class="cards c2" style="margin-top:0">
            ${card('users', 'Only students are counted', 'Teachers, parents and office accounts never use a seat.', 2)}
            ${card('clock', 'Counted once a year', 'A student is billable once per academic year, whatever happens to their section or parents. Promotion creates next year’s seat.', 3)}
            ${card('layers', 'Seats that can grow', 'A school commits to a number of seats. At the limit its terms either block new admissions or bill the extra students at the end.', 4)}
            ${card('lock', 'Never locked out', 'When a year ends there is a grace period of full access (30 days by default), then the school becomes read-only. Renewing restores editing at once.', 5)}
          </div>
          <div class="life" data-r style="--i:6">
            <div class="st"><span class="pill p-ok">Trial · Active</span><b>Full access</b><small>Inside the subscription year</small></div>
            <svg class="ar" viewBox="0 0 34 14"><line x1="2" y1="7" x2="32" y2="7"/></svg>
            <div class="st"><span class="pill p-grace">Grace</span><b>Full access</b><small>With renewal warnings</small></div>
            <svg class="ar" viewBox="0 0 34 14"><line x1="2" y1="7" x2="32" y2="7"/></svg>
            <div class="st"><span class="pill p-ro">Read-only</span><b>Everything readable</b><small>Changes pause until renewal</small></div>
          </div>
          <p class="lede" style="margin-top:14px;font-size:12.5px;--i:7" data-r>The price per student and the number of seats are agreed with each school. Usage is counted automatically through the year.</p>
        </div>
        <div>${web('settings-license', ['What the administrator sees', 'Students on the roll, seats licensed and remaining, time left, and the school’s terms.'], 3)}</div>
      </div>`;
    },
  },

  // 41 ── going live
  {
    layout: 'raw', chapter: 'rollout', title: 'Live in four steps', nav: 'Going live',
    html: ({ head }) => `
      ${head({ kicker: 'Going live', title: 'From an empty site to <em>a school in use</em>', lede: 'Four steps take a school from nothing to teachers, students and parents using it every day.' }, true)}
      <div class="tl">
        <div class="st" data-r style="--i:2"><span class="n">1</span><h3>Create the school’s site</h3><p>One command creates the school’s own database, its default roles and its first administrator. Add the name, colour and logo.</p></div>
        <div class="st" data-r style="--i:3"><span class="n">2</span><h3>Bring the people in</h3><p>Import students and staff from CSV. Parents are linked to their children and the school verifies each link.</p></div>
        <div class="st" data-r style="--i:4"><span class="n">3</span><h3>Set up academics and fees</h3><p>Years, grades, subjects, timetable and fee structures, guided by the setup checklist on the management dashboard.</p></div>
        <div class="st" data-r style="--i:5"><span class="n">4</span><h3>Switch on the apps</h3><p>Teachers, students and parents sign in on the web or in the mobile app, which asks for the school once.</p></div>
      </div>
      <div class="closing" data-r style="--i:6">
        <div><h3>Every screen in this catalogue can be tried.</h3><p>A demo school with sample students, staff, attendance, exams and fees is included, so a pilot can start with real screens, not slides.</p></div>
        <img src="assets/art/setup-complete.svg" alt="">
      </div>`,
  },
];
