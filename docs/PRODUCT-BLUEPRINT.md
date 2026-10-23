# SchoolSync — Product Blueprint (condensed from the original plan)

One school ERP product, deployed to many schools. Each school is a **site** with its own database.
One application, **four role-based experiences**: Student, Parent, Teacher, Management.
The same record (student, attendance entry, homework) is shared; each role sees only what it is authorised to see.

## Modules (12)

1. **Student & Parent Management** — admission/registration, profile, photo, ID, class/section; parent/guardian profiles; many guardians per student, many children per parent account; emergency contacts + authorised pickup; transfer / promotion / withdrawal / alumni; documents.
2. **Academic Structure** — academic years & terms, grades/classes/sections, subjects & assignments, class teachers + subject teachers, working days/holidays/timings, promotion rules.
3. **Attendance & Leave** — daily or per-period attendance; present/absent/late/approved-leave; correction requests; student leave (parent applies, school approves); staff attendance & leave; attendance % and shortage alerts; parent absence notifications.
4. **Teaching & Learning** — timetable, homework/assignments/submissions, study materials, syllabus & lesson progress, teacher feedback, student to-do tracker + reminders.
5. **Examinations & Results** — schedules, subject-wise marks entry, grade scales + pass criteria, report cards, teacher remarks, result approval + publication, student/parent result access.
6. **Fees & Finance** — categories, structures, student fee plans, instalments/due dates, scholarships/concessions, collection, receipts, refunds, outstanding/overdue, parent payment history, expenses, basic finance summaries, accountant role.
7. **Communication & Events** — circulars/announcements, class messages, academic calendar, parent–teacher meetings, event registration/permission forms, push + email (+ optional WhatsApp), delivery/acknowledgement status.
8. **Staff & HR** — profiles, teacher-subject/class assignments, staff attendance & leave, substitutes, (later: payroll/payslips).
9. **Transport & Safety** — routes/stops, student allocation, vehicles/drivers, authorised pickup, (later: live tracking).
10. **Library & Resources** — catalogue, issue/return/due, overdue/fines, lab/equipment.
11. **Reports & Insights** — attendance/absenteeism, assignment completion, academic performance, class results, fee collection/dues, staff attendance/workload, exportable.
12. **Settings, Permissions & Audit** — accounts/roles/access, school identity, notification prefs, approval workflows, login + action history, export/retention, deactivation/sessions.

## Role experiences

Each role gets a purpose-built home, not one dashboard with hidden buttons.

* **Student** (5 tabs: Home · My Tasks · Calendar · Learning · Profile): today's classes, pending homework + personal to-dos, upcoming exams/events/deadlines, attendance %, announcements, results/materials. Can: view own data, manage own tasks, submit assignments, request leave/corrections where allowed. Never: modify attendance, marks, fees, other students.
* **Parent**: child selector (multi-child), attendance + leave, homework/exams/results, announcements/events, fee balance/receipts/dues/pay, PTM requests. Can: see only verified-linked children, submit leave/forms, pay fees, request meetings, request record corrections. Never: change attendance/marks/official details.
* **Teacher**: today's timetable, quick attendance, homework mgmt, marks entry + progress, class announcements + lesson progress, pending tasks/leave/meetings. Only assigned classes/subjects (class teacher gets class-wide extras). Never: fees, payroll, settings, other teachers' records.
* **Management**: KPIs (students/staff/classes), today's attendance + absences, pending admissions/requests, exam + performance summaries, fee collection + dues, events/staff leave/alerts. Sub-roles, not one all-powerful role: Principal, Administrator, Accounts, HR, Transport/Library staff, Super administrator. One person may hold several roles; effective permissions = union.

## Permission model: Role + Scope + Action

* **Role** — who (student, parent, teacher, principal, administrator, accountant, ...).
* **Scope** — which records: `own` · `linked` (verified children) · `assigned` (classes/subjects) · `school`.
* **Action** — `view · create · edit · approve · publish · export · delete` (delete is normally archive).

Default matrix (adjustable per school):

| Module | Student | Parent | Teacher | Management |
|---|---|---|---|---|
| Personal profile | own | linked child | own | authorised records |
| Attendance | own | linked child | mark assigned | school oversight |
| Timetable | own | child's | assigned | manage + publish |
| Homework | view + submit | child's status | create + review | oversight |
| Exams & marks | published | child's published | enter assigned | approve + publish |
| Fees | own if enabled | view/pay linked | none | accounts-authorised |
| Leave | apply | request for child | self | approve per policy |
| Events | view + register | view + consent | manage assigned | manage school-wide |
| Student records | own permitted fields | request changes | relevant read-only | by authority |
| Staff & HR | none | none | own | HR-authorised |
| Reports | personal | linked | assigned classes | authorised school-wide |
| Settings & roles | none | none | none | designated admins only |

## Key workflows (each has a status, a responsible person and an audit record)

| Workflow | Steps |
|---|---|
| New admission | application → review → confirm → student account → parent linking → class allocation |
| Academic year start | create year → classes/subjects → assign students + teachers → publish timetable |
| Daily attendance | teacher records → records update → parent notified → management summary |
| Homework | teacher publishes → student reminded → submits → teacher reviews → parent sees progress |
| Examinations | schedule → enter marks → review/approve → publish → student/parent view report |
| Fees | assign plan → generate dues → collect → receipt → reconcile |
| Event | create → announce → collect consent/registration → record participation |
| Year-end promotion | review results → approve → move to new classes → preserve history |

## Non-negotiables

1. Verify every parent↔student relationship through a school-approved process before access.
2. Enforce permissions on **every request** server-side (not just hidden buttons).
3. Audit trail for attendance, marks, fees, approvals, permission changes (who/what/when).
4. Protect sensitive data (documents, medical/emergency, payroll, finance).
5. Approval workflows for marks publication, attendance corrections, refunds.
6. Notifications only to authorised recipients; no private data on lock screens.
7. Preserve history (transfer/graduation) — archive, don't delete.
8. Secure account recovery, session control, timely revocation.

## Phasing

* **Phase 1 (essential)**: four role experiences; student/parent/teacher/class management; academic years/classes/subjects/sections; timetable + calendar; attendance + leave; homework + student tasks; announcements + notifications; basic exams/results; role+record permissions; management dashboard + audit.
* **Phase 2**: admissions + documents; fees + receipts; staff attendance/leave; exam approval + report cards; parent–teacher meetings; library + transport; expenses + finance reports; notification preferences.
* **Phase 3**: AI study planner; growth passport; multilingual; advanced insights; bus tracking + pickup; wellbeing check-ins; automation/integrations.
