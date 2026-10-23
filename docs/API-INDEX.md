# API index (generated)

390 operations, API version 1.0.0. Base: `/api/v1`, header `X-Tenant: <site code>`, `Authorization: Bearer <token>`. Full schemas: `docs/openapi.json`; live docs: `/docs`.
Regenerate with `pnpm --filter @school-sync/api openapi`.

## Academics

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/academics/overview` | Counts for the academic structure (years, grades, sections, subjects, …) and the current year |
| `GET` | `/api/v1/academics/years` | Academic years, newest first |
| `POST` | `/api/v1/academics/years` | Create an academic year (dates may not overlap another year) |
| `GET` | `/api/v1/academics/years/{id}` | One academic year |
| `PATCH` | `/api/v1/academics/years/{id}` | Rename / re-date an academic year |
| `DELETE` | `/api/v1/academics/years/{id}` | Delete an unused academic year |
| `POST` | `/api/v1/academics/years/{id}/set-current` | Make this the (one) current academic year; assigned-section scopes of every teacher refresh |
| `POST` | `/api/v1/academics/years/{id}/copy-sections` | Create this year’s sections from an earlier year (optionally with class teachers and teaching assignments) |
| `GET` | `/api/v1/academics/years/{id}/terms` | Terms of a year |
| `POST` | `/api/v1/academics/years/{id}/terms` | Add a term (inside the year, not overlapping another term) |
| `PATCH` | `/api/v1/academics/terms/{id}` | Update a term |
| `DELETE` | `/api/v1/academics/terms/{id}` | Delete a term |
| `GET` | `/api/v1/academics/grades` | Grades / classes in order |
| `POST` | `/api/v1/academics/grades` | Create a grade |
| `PATCH` | `/api/v1/academics/grades/{id}` | Update a grade |
| `DELETE` | `/api/v1/academics/grades/{id}` | Delete an unused grade |
| `GET` | `/api/v1/academics/grades/{id}/subjects` | Subjects a grade offers, with periods per week |
| `PUT` | `/api/v1/academics/grades/{id}/subjects` | Set the full list of subjects a grade offers (replaces the previous list) |
| `GET` | `/api/v1/academics/subjects` | Subjects |
| `POST` | `/api/v1/academics/subjects` | Create a subject |
| `PATCH` | `/api/v1/academics/subjects/{id}` | Update a subject |
| `DELETE` | `/api/v1/academics/subjects/{id}` | Delete an unused subject |
| `GET` | `/api/v1/academics/periods` | School-day periods in order (including breaks) |
| `POST` | `/api/v1/academics/periods` | Add a period |
| `PATCH` | `/api/v1/academics/periods/{id}` | Update a period |
| `DELETE` | `/api/v1/academics/periods/{id}` | Delete an unused period |
| `GET` | `/api/v1/academics/sections` | Sections visible to me by scope (teacher = assigned, student = own, parent = children’s, management = all); `mine=true` = current year |
| `POST` | `/api/v1/academics/sections` | Create a section for a grade and year (optionally with its class teacher) |
| `GET` | `/api/v1/academics/sections/{id}` | A section with its teaching assignments (404 if outside my scope) |
| `PATCH` | `/api/v1/academics/sections/{id}` | Update section name / room / capacity |
| `DELETE` | `/api/v1/academics/sections/{id}` | Delete a section that has no enrolments |
| `PUT` | `/api/v1/academics/sections/{id}/class-teacher` | Assign (or, with staffId null, remove) the class teacher; keeps the class_teacher role in step |
| `PUT` | `/api/v1/academics/sections/{id}/teaching-assignments` | Replace a section’s whole subject → teacher grid |
| `GET` | `/api/v1/academics/teaching-assignments` | Who teaches what (section + subject → teacher), limited to sections in my scope |
| `POST` | `/api/v1/academics/teaching-assignments` | Assign a teacher to a subject in a section (one teacher per section + subject) |
| `PATCH` | `/api/v1/academics/teaching-assignments/{id}` | Change the teacher of an assignment |
| `DELETE` | `/api/v1/academics/teaching-assignments/{id}` | Remove a teaching assignment |

## Admissions

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/admissions` | Applications, newest first (filter by status, grade, year; search by name / application no / guardian) |
| `POST` | `/api/v1/admissions` | Staff enters an application (status: submitted) |
| `GET` | `/api/v1/admissions/{id}` | One application |
| `PATCH` | `/api/v1/admissions/{id}` | Edit an application that is not yet enrolled or rejected (documents are uploaded file ids) |
| `POST` | `/api/v1/admissions/{id}/status` | Move an application along: submitted → under_review → waitlisted | accepted | rejected. Review needs admissions:edit, decisions need admissions:approve |
| `POST` | `/api/v1/admissions/{id}/enroll` | Enrol an accepted application: student + login, parent (new or the registered one with that phone) + link, enrollment in the current year — one transaction, seat-checked. Passwords are returned once |

## Announcements

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/announcements` | My announcements |
| `POST` | `/api/v1/announcements` | Create an announcement (saved as a draft; give `publishAt` to schedule it) |
| `GET` | `/api/v1/announcements/unread-count` | Unread announcements and ones still waiting for my acknowledgement |
| `GET` | `/api/v1/announcements/manage` | Announcements I manage (authored by me; all of them with school-scope editing) |
| `GET` | `/api/v1/announcements/{id}` | One announcement (recipient, or its manager) |
| `PATCH` | `/api/v1/announcements/{id}` | Edit a draft (a published announcement can only change `expiresAt`) |
| `DELETE` | `/api/v1/announcements/{id}` | Delete a draft (author), or archive a published announcement (announcements:delete) |
| `POST` | `/api/v1/announcements/{id}/schedule` | Schedule a draft: it is published automatically at `publishAt` |
| `POST` | `/api/v1/announcements/{id}/unschedule` | Take a scheduled announcement back to a plain draft |
| `POST` | `/api/v1/announcements/{id}/publish` | Publish a draft now and notify its audience (`announcement.new`) |
| `POST` | `/api/v1/announcements/{id}/expire` | End a published announcement now (it disappears from feeds and is archived shortly after) |
| `POST` | `/api/v1/announcements/{id}/archive` | Archive an announcement (history is kept) |
| `POST` | `/api/v1/announcements/{id}/read` | Mark an announcement as read (idempotent) |
| `POST` | `/api/v1/announcements/{id}/ack` | Acknowledge an announcement that asks for it (idempotent; also marks it read) |
| `GET` | `/api/v1/announcements/{id}/stats` | Delivery statistics: audience size, read, acknowledged — overall, by user type and by section |
| `GET` | `/api/v1/announcements/{id}/recipients` | Who is in the audience, with read / acknowledged times (filter `unread` / `unacknowledged` to chase people) |

## Attendance

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/attendance/sections/{sectionId}` | Roll-call roster of a section for a date (and period) |
| `PUT` | `/api/v1/attendance/sections/{sectionId}` | Submit (or re-submit) the whole roll call of a section — idempotent upsert |
| `POST` | `/api/v1/attendance/records/{id}/corrections` | Ask for a correction of a submitted attendance record (after the edit window) |
| `GET` | `/api/v1/attendance/corrections` | Correction requests (default: pending) |
| `POST` | `/api/v1/attendance/corrections/{id}/approve` | Approve a correction: applies the change, audits before/after and notifies the student and verified guardians |
| `POST` | `/api/v1/attendance/corrections/{id}/reject` | Reject a correction (a note is required); the requester is notified |
| `GET` | `/api/v1/attendance/students/{studentId}/summary` | A student’s attendance summary: counts, percentage, month-by-month, shortage flag |
| `GET` | `/api/v1/attendance/students/{studentId}/records` | A student’s attendance history (newest first, keyset pagination) |
| `GET` | `/api/v1/attendance/sections/{sectionId}/summary` | Section attendance over a date range: per-day counts and per-student percentages (staff) |
| `GET` | `/api/v1/attendance/summary` | School-wide attendance for a day (management dashboard) |
| `GET` | `/api/v1/attendance/today` | Today’s attendance shaped for the role dashboards |
| `GET` | `/api/v1/attendance/export` | CSV export of attendance records (max 93 days per file) |
| `POST` | `/api/v1/attendance/shortage-scan` | Run the attendance shortage scan now (management) |

## Audit

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/audit` | Audit trail, newest first (keyset pagination; filter by actor, entity, action prefix, date range) |
| `GET` | `/api/v1/audit/export` | CSV export of the audit trail (same filters, capped at 50 000 rows); the export itself is audited |
| `GET` | `/api/v1/audit/{id}` | One audit entry with its before / after snapshots |

## Auth

| | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Sign in with username / email / phone / admission no. / employee id |
| `POST` | `/api/v1/auth/refresh` | Rotate the refresh token and get a new access token |
| `POST` | `/api/v1/auth/logout` | End this session and stop push to this device |
| `GET` | `/api/v1/auth/me` | Current user, roles, permissions and linked children |
| `POST` | `/api/v1/auth/change-password` |  |
| `POST` | `/api/v1/auth/forgot-password` | Email a reset link (always answers 202 — never reveals whether the account exists) |
| `POST` | `/api/v1/auth/reset-password` |  |
| `GET` | `/api/v1/auth/sessions` | Devices signed in to this account |
| `DELETE` | `/api/v1/auth/sessions/{id}` | Sign out one device |
| `POST` | `/api/v1/auth/sessions/revoke-others` | Sign out everywhere except here |

## Dashboard

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/dashboard/student` | Student home: today’s classes, attendance, homework, tasks, exams, announcements |
| `GET` | `/api/v1/dashboard/parent` | Parent home: every linked child at a glance + the selected child’s day, fees, meetings |
| `GET` | `/api/v1/dashboard/teacher` | Teacher home: today’s timetable, unmarked attendance, homework to review, marks to enter |
| `GET` | `/api/v1/dashboard/management` | Management home: KPIs, attendance, approvals queue, finance, alerts (each block only if permitted) |

## Devices

| | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/devices` | Register / refresh this device’s FCM token |
| `POST` | `/api/v1/devices/unregister` |  |

## Events

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/events` | Events & holidays I can see |
| `POST` | `/api/v1/events` | Create an event / holiday / PTM / sports day (draft, or published at once with `publish: true`) |
| `GET` | `/api/v1/events/{id}` | One event (with response counts for its organisers) |
| `PATCH` | `/api/v1/events/{id}` | Edit an event (creator, or school-scope editor); changed date / time / place of a published event notifies the audience |
| `DELETE` | `/api/v1/events/{id}` | Delete a draft event (or, with events:delete, a published one that has no responses) |
| `POST` | `/api/v1/events/{id}/publish` | Publish a draft event and notify its audience (`event.new`) |
| `POST` | `/api/v1/events/{id}/cancel` | Cancel an event (kept on the calendar as cancelled; the audience is notified) |
| `POST` | `/api/v1/events/{id}/respond` | Register for an event / give or deny consent, for one child (own child for students, linked child for parents) |
| `GET` | `/api/v1/events/{id}/responses` | Organisers: answers per child (`response=pending` lists children who have not answered) |
| `GET` | `/api/v1/calendar` | Calendar feed: events, holidays, exam papers and homework due dates for me (max 100 days) |

## Exams

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/grade-scales` | Grade scales with their bands |
| `POST` | `/api/v1/grade-scales` | Create a grade scale (bands must cover 0-100 without overlap) |
| `GET` | `/api/v1/grade-scales/{id}` | One grade scale |
| `PATCH` | `/api/v1/grade-scales/{id}` | Rename, make default, or replace the bands of a grade scale |
| `DELETE` | `/api/v1/grade-scales/{id}` | Delete an unused, non-default grade scale |
| `GET` | `/api/v1/exams` | Exams visible to me (students/parents/teachers: scheduled or later, for their grades) |
| `POST` | `/api/v1/exams` | Create an exam (draft) |
| `GET` | `/api/v1/exams/{id}` | One exam |
| `PATCH` | `/api/v1/exams/{id}` | Edit an exam that is not yet published |
| `DELETE` | `/api/v1/exams/{id}` | Delete an exam that has no mark sheets yet |
| `POST` | `/api/v1/exams/{id}/schedule` | draft -> scheduled: makes the schedule visible to students, parents and teachers (needs at least one paper) |
| `POST` | `/api/v1/exams/{id}/open-marks` | scheduled -> marks_entry: subject teachers may enter marks |
| `POST` | `/api/v1/exams/{id}/start-review` | marks_entry -> under_review |
| `POST` | `/api/v1/exams/{id}/publish` | Publish the exam: publishes all approved mark sheets and notifies students and verified guardians |
| `GET` | `/api/v1/exams/{id}/papers` | The exam schedule (papers) — students/parents/teachers see only their grades |
| `POST` | `/api/v1/exams/{id}/papers` | Add a paper (grade x subject) to the schedule; rejects clashes for the same grade |
| `POST` | `/api/v1/exams/{id}/papers/bulk` | Create or update many papers at once (matched by grade + subject) |
| `PATCH` | `/api/v1/exams/{id}/papers/{paperId}` | Edit a paper |
| `DELETE` | `/api/v1/exams/{id}/papers/{paperId}` | Remove a paper that has no mark sheets |
| `POST` | `/api/v1/exams/{id}/sheets/generate` | Create mark sheets (exam x section x subject) from the teaching assignments; idempotent |
| `POST` | `/api/v1/exams/{id}/sheets/publish` | Publish all approved sheets of the exam (optionally one section / subject) |
| `GET` | `/api/v1/exams/{id}/analytics` | Per section/subject averages, pass %, top performers and distribution (within my scope) |

## Expenses

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/expenses` | Expenses |
| `POST` | `/api/v1/expenses` | Record an expense. Amounts above fees.expenseApprovalThresholdMinor are created `pending` and need expenses:approve |
| `GET` | `/api/v1/expenses/summary` | Monthly and per-category totals of approved expenses |
| `GET` | `/api/v1/expenses/export` | CSV of expenses (same filters as the list) |
| `GET` | `/api/v1/expenses/{id}` | One expense |
| `PATCH` | `/api/v1/expenses/{id}` | Edit an expense (editing a rejected one resubmits it; raising an approved one above the threshold sends it back for approval) |
| `DELETE` | `/api/v1/expenses/{id}` | Delete an expense (audited with a snapshot) |
| `POST` | `/api/v1/expenses/{id}/approve` | Approve a pending expense |
| `POST` | `/api/v1/expenses/{id}/reject` | Reject a pending expense |

## Fee reports

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/fees/reports/outstanding` | Outstanding fees with aging buckets (not due, 1-30, 31-60, 61-90, 90+ days), optionally grouped by grade or section |
| `GET` | `/api/v1/fees/reports/outstanding/export` | CSV of the outstanding / aging report |
| `GET` | `/api/v1/fees/reports/defaulters` | Defaulters: students with overdue balances, worst first, with the primary guardian’s phone |
| `GET` | `/api/v1/fees/reports/defaulters/export` | CSV of defaulters (up to 5000 rows) |
| `GET` | `/api/v1/fees/reports/collection` | Collection summary for a period: daily/monthly series, by payment method, by fee category |
| `GET` | `/api/v1/fees/reports/collection/export` | CSV of the collection series |
| `GET` | `/api/v1/finance/summary` | Management dashboard: collected vs expenses vs outstanding (expenses are null without expenses:view) |

## Fees

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/fees/categories` | Fee categories (tuition, transport, lab ...) |
| `POST` | `/api/v1/fees/categories` | Create a fee category |
| `PATCH` | `/api/v1/fees/categories/{id}` | Rename or (de)activate a fee category |
| `GET` | `/api/v1/fees/structures` | Fee structures (per academic year, per grade or all grades) with their instalment items |
| `POST` | `/api/v1/fees/structures` | Create a fee structure with instalment-level items (each with a due date) |
| `GET` | `/api/v1/fees/structures/{id}` | One fee structure |
| `PATCH` | `/api/v1/fees/structures/{id}` | Rename or (de)activate a structure |
| `POST` | `/api/v1/fees/structures/{id}/items` | Add an instalment item |
| `PATCH` | `/api/v1/fees/structures/{id}/items/{itemId}` | Edit an item (amount/due date/category are locked once invoices were generated from it) |
| `DELETE` | `/api/v1/fees/structures/{id}/items/{itemId}` | Remove an item that has not been billed |
| `GET` | `/api/v1/fees/plans` | Student fee plans |
| `POST` | `/api/v1/fees/plans` | Assign a fee structure to one student (one plan per student per academic year) |
| `POST` | `/api/v1/fees/plans/bulk` | Assign a structure to every active student of a grade / section / list (skips students who already have a plan) |
| `DELETE` | `/api/v1/fees/plans/{id}` | Remove a plan that has no live invoices |
| `POST` | `/api/v1/fees/dues/generate` | Generate invoices from plans, grouped by due date. Idempotent (never duplicates a plan + due date); applies only APPROVED concessions |
| `GET` | `/api/v1/fees/concessions` | Concessions in my scope (parents: their children) |
| `POST` | `/api/v1/fees/concessions` | Request a concession / scholarship (percent in basis points, or a fixed yearly amount); needs approval before it affects dues |
| `POST` | `/api/v1/fees/concessions/{id}/approve` | Approve a concession (applies to dues generated from now on) |
| `POST` | `/api/v1/fees/concessions/{id}/reject` | Reject a concession |
| `GET` | `/api/v1/fees/invoices` | Invoices in my scope (accounts/principal: all; parent: linked children; student: own) with derived balance, overdue flag and late fee |
| `POST` | `/api/v1/fees/invoices` | Create a one-off invoice for a student |
| `GET` | `/api/v1/fees/invoices/{id}` | Invoice with items, payments and refunds (404 outside my scope) |
| `POST` | `/api/v1/fees/invoices/{id}/void` | Void an invoice that has no payments (refund them first) |
| `POST` | `/api/v1/fees/invoices/{id}/pay` | Start an ONLINE payment for a linked child’s invoice (needs features.onlinePayments + setting fees.parentsCanPayOnline). Returns the gateway order; the invoice is only marked paid when the signed webhook arrives |

## Files

| | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/files` | Upload a file (multipart: field `file`, plus `purpose`) |
| `GET` | `/api/v1/files/{id}` | Download / stream a file |
| `DELETE` | `/api/v1/files/{id}` | Delete a file (soft delete) |
| `PUT` | `/api/v1/me/avatar` | Set my profile picture (multipart field `file`; JPEG/PNG/WebP, max 5 MB) |
| `DELETE` | `/api/v1/me/avatar` | Remove my profile picture |

## Guardians

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/guardians` | Parents / guardians (teachers see those of children in their assigned sections) |
| `POST` | `/api/v1/guardians` | Register a parent; with createLogin the parent login (username = phone or email) is created with a temporary password shown once |
| `GET` | `/api/v1/guardians/{id}` | One parent with their children and link status (404 outside my scope) |
| `PATCH` | `/api/v1/guardians/{id}` | Edit a parent’s details (the login’s phone / email follow) |
| `DELETE` | `/api/v1/guardians/{id}` | Remove a parent who has no linked students (their login is deactivated) |
| `POST` | `/api/v1/guardians/{id}/login` | Create the parent login for a parent who has none (temporary password shown once) |

## Homework

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/homework` | Homework visible to me |
| `POST` | `/api/v1/homework` | Create homework for a section + subject you teach (draft, or publish immediately) |
| `GET` | `/api/v1/homework/{id}` | One homework (drafts are invisible to students and parents) |
| `PATCH` | `/api/v1/homework/{id}` | Edit homework (not once closed) |
| `DELETE` | `/api/v1/homework/{id}` | Delete homework that has no submissions (otherwise close it) |
| `POST` | `/api/v1/homework/{id}/publish` | Publish a draft; notifies students and their verified guardians |
| `POST` | `/api/v1/homework/{id}/close` | Close a published homework (no more submissions) |
| `GET` | `/api/v1/homework/{id}/roster` | Per-homework roster: every student of the section with submitted / late / reviewed / returned / missing |

## Leave

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/leave` | Student leave requests visible to me (pending first) |
| `POST` | `/api/v1/leave` | Apply for leave for a student (parent for a linked child, or the student) |
| `GET` | `/api/v1/leave/{id}` | One leave request (out-of-scope → 404) |
| `POST` | `/api/v1/leave/{id}/approve` | Approve a leave request |
| `POST` | `/api/v1/leave/{id}/reject` | Reject a leave request (a note is required) |
| `POST` | `/api/v1/leave/{id}/cancel` | Cancel my pending leave request |

## Library

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/library/books` | Search the catalogue (title, author, ISBN, category, accession no.) with availability |
| `POST` | `/api/v1/library/books` | Add a book to the catalogue |
| `GET` | `/api/v1/library/categories` | Catalogue categories (for filters) |
| `GET` | `/api/v1/library/books/{id}` | One book |
| `PATCH` | `/api/v1/library/books/{id}` | Edit a book; changing `totalCopies` moves the available stock with it (409 COPIES_ON_LOAN below the copies out) |
| `DELETE` | `/api/v1/library/books/{id}` | Archive a book (409 BOOK_ON_LOAN while a copy is out) |
| `POST` | `/api/v1/library/issues` | Issue a book to a student or a staff member |
| `GET` | `/api/v1/library/issues` | Loans (default: books currently out), filterable by status, book, borrower |
| `POST` | `/api/v1/library/issues/{id}/return` | Return a book: stock goes back up and the late fine (days late × fine per day) is recorded; `waiveFine` clears it |
| `GET` | `/api/v1/library/overdue` | Overdue loans with accrued fines, plus totals over all overdue loans |
| `GET` | `/api/v1/library/my-books` | Books borrowed by me (students), by my children (parents; narrow with `studentId`) or by me as staff |
| `GET` | `/api/v1/library/policy` | Loan period, fine per day and loan limits |
| `PUT` | `/api/v1/library/policy` | Change the library policy (also stored as the `library` school setting) |

## Marks

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/marks/sheets` | Mark sheets in my scope (teachers: sheets of my subjects and my class) |
| `GET` | `/api/v1/marks/sheets/{id}` | A mark sheet with entries. Students/parents: only published sheets, only their own entries; otherwise 404 |
| `PUT` | `/api/v1/marks/sheets/{id}/entries` | Bulk upsert marks (subject teacher only; sheet must be draft or returned) |
| `POST` | `/api/v1/marks/sheets/{id}/submit` | Submit for review (all students need marks or an absent flag). With exams.requireApproval=false it becomes approved/published directly |
| `POST` | `/api/v1/marks/sheets/{id}/approve` | Approve a submitted sheet |
| `POST` | `/api/v1/marks/sheets/{id}/return` | Send a submitted/approved sheet back to the teacher with a note (teacher is notified) |
| `POST` | `/api/v1/marks/sheets/{id}/publish` | Publish an approved sheet: students and verified guardians can now see it and are notified |
| `POST` | `/api/v1/marks/sheets/{id}/correct` | Correct marks AFTER publication (mandatory reason; before/after audited; families re-notified) |
| `GET` | `/api/v1/marks/export` | CSV export of submitted/approved/published marks in my scope |

## Materials

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/materials` | Study materials for my section / grade (students, parents via ?studentId=) or the classes I teach (teachers) |
| `POST` | `/api/v1/materials` | Publish a study material (uploaded file or link) for a section, or for a whole grade + subject |
| `GET` | `/api/v1/materials/{id}` | One study material |
| `PATCH` | `/api/v1/materials/{id}` | Edit a material you manage |
| `DELETE` | `/api/v1/materials/{id}` | Archive a material (hidden from students and parents; kept for history) |

## Meetings

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/meetings` | Parent–teacher meetings I can see |
| `POST` | `/api/v1/meetings` | Request a meeting with a teacher of my child (parents) |
| `GET` | `/api/v1/meetings/upcoming` | Upcoming confirmed meetings (soonest first) and requests still waiting for an answer |
| `GET` | `/api/v1/meetings/teachers` | Teachers a parent can ask for a meeting about a child (class teacher + subject teachers) |
| `GET` | `/api/v1/meetings/{id}` | One meeting |
| `POST` | `/api/v1/meetings/{id}/confirm` | Confirm a request with a time, mode and place (teacher / class teacher / office); the parent is notified (`meeting.confirmed`) |
| `POST` | `/api/v1/meetings/{id}/decline` | Decline a request with a reason; the parent is notified (`meeting.declined`) |
| `POST` | `/api/v1/meetings/{id}/reschedule` | Move a confirmed meeting to a new time (the teacher must be free); the parent is notified (`meeting.rescheduled`) |
| `POST` | `/api/v1/meetings/{id}/complete` | Close a confirmed meeting with outcome notes |
| `POST` | `/api/v1/meetings/{id}/cancel` | Cancel a pending or confirmed meeting (the parent who asked, or the teacher / class teacher / office); the other side is notified (`meeting.cancelled`) |

## Notifications

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/notifications` | My notification inbox (newest first, keyset pagination via `nextCursor`) |
| `GET` | `/api/v1/notifications/unread-count` | Number of unread notifications (for the app badge) |
| `POST` | `/api/v1/notifications/read-all` | Mark all my notifications (optionally one category) as read |
| `GET` | `/api/v1/notifications/preferences` | My notification settings per category (push / email / quiet hours) |
| `PUT` | `/api/v1/notifications/preferences` | Change my notification settings (only the categories / fields sent are changed) |
| `POST` | `/api/v1/notifications/test` | Send a test push to my registered devices (5 per minute) |
| `POST` | `/api/v1/notifications/{id}/read` | Mark one notification as read |
| `DELETE` | `/api/v1/notifications/{id}` | Delete one notification from my inbox |

## Payments

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/payments` | Payments in my scope — payment history (parents: their children; accounts: all) |
| `POST` | `/api/v1/payments` | Record an offline payment (cash/cheque/bank/UPI/card). Send an Idempotency-Key header so a retry never records it twice (replays answer 200 with the original payment, new payments 201) |
| `GET` | `/api/v1/payments/export` | CSV export of payments (same filters as the list, up to 5000 rows) |
| `GET` | `/api/v1/payments/refunds` | Refund requests |
| `POST` | `/api/v1/payments/refunds/{id}/approve` | Approve a refund request and (by default) process it: payment and invoice are adjusted in one transaction. Online payments are returned through the gateway first |
| `POST` | `/api/v1/payments/refunds/{id}/reject` | Reject a refund request |
| `POST` | `/api/v1/payments/refunds/{id}/process` | Process a previously approved refund (adjusts payment + invoice) |
| `GET` | `/api/v1/payments/{id}` | One payment (404 outside my scope). Poll this after starting an online payment |
| `GET` | `/api/v1/payments/{id}/receipt` | Receipt data (JSON) |
| `GET` | `/api/v1/payments/{id}/receipt/pdf` | Receipt as a PDF |
| `POST` | `/api/v1/payments/{id}/refunds` | Request a refund (full or partial) of a payment; needs payments:approve to take effect |
| `POST` | `/api/v1/payments/{id}/sync` | Ask the gateway (server to server) for the outcome of a pending online payment — use when the webhook is late. The client redirect is never trusted |
| `POST` | `/api/v1/payments/{id}/mock-complete` | DEV ONLY (mock gateway, absent in production): simulate the payer completing checkout; runs through the real webhook path |
| `POST` | `/api/v1/payments/webhook/{provider}` | Payment-gateway webhook (public; HMAC-signature verified over the raw body; idempotent). Resolves the school from X-Tenant, else the order metadata, else the Host. Responds 200 for any validly signed event. NOTE: the Razorpay adapter is untested against the live Razorpay API |

## Platform

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/platform/tenants` | All sites with license state and latest usage |
| `POST` | `/api/v1/platform/tenants` | Create a site (new database, default data, first super-admin) |
| `PUT` | `/api/v1/platform/tenants/{code}/subscription` | Create/renew the per-student subscription for an academic year |
| `POST` | `/api/v1/platform/tenants/{code}/status` | Suspend / resume a site |
| `GET` | `/api/v1/platform/tenants/{code}/billing` |  |
| `POST` | `/api/v1/platform/tenants/{code}/invoices` | Issue the committed-seats invoice or a true-up |
| `POST` | `/api/v1/platform/billing/snapshot` | Meter all active sites now (also run daily) |

## Profile

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/me/profile` | My contact details and emergency contacts (student: own, parent: each linked child, staff: own) |
| `PATCH` | `/api/v1/me/profile` | Update my phone, email (needs current password), address and emergency contacts. Names, birth date and medical details go through correction requests |

## Promotions

| | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/promotions/preview` | Dry run of the year-end promotion: who goes where, seats needed, problems to fix first |
| `POST` | `/api/v1/promotions/apply` | Apply the promotion: new-year enrollments (seat-checked), old ones closed, last grade → alumni. Needs promotions:approve |

## Report cards

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/report-cards/{examId}/students/{studentId}` | Report card: published subjects, total/percent/grade/rank, attendance %, class-teacher remarks (once published) |
| `GET` | `/api/v1/report-cards/{examId}/students/{studentId}/pdf` | Report card as a PDF |
| `PUT` | `/api/v1/report-cards/{examId}/students/{studentId}/remarks` | Class teacher writes remarks (saving takes them back to draft until published) |
| `GET` | `/api/v1/report-cards/{examId}/remarks` | Remarks of every student of a section (class teacher / school scope) |
| `POST` | `/api/v1/report-cards/{examId}/publish` | Publish class-teacher remarks (a section, or named students) so families see them on the report card |

## Results

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/results` | Published results of one student (all exams, or one with ?examId): subject marks, percent, grade, pass/fail, class rank |
| `GET` | `/api/v1/results/class` | Published results of a whole section for one exam (class teacher / school scope) |
| `GET` | `/api/v1/results/progress` | Progress trend: published marks per subject across exams |

## Roles

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/permissions/catalog` | Every resource/action, grouped by module, plus the factory role presets (for the role editor) |
| `GET` | `/api/v1/roles` | All roles with user and permission counts |
| `POST` | `/api/v1/roles` | Create a custom role (optionally cloned from another role) |
| `GET` | `/api/v1/roles/{id}` | A role with its grants as { permission: scope } |
| `PATCH` | `/api/v1/roles/{id}` | Rename a role / change its description (the key never changes) |
| `DELETE` | `/api/v1/roles/{id}` | Delete a custom role that nobody holds (system roles cannot be deleted) |
| `PUT` | `/api/v1/roles/{id}/permissions` | Change a role’s grants with a partial { permission: scope | null } map (null removes). Holders’ tokens go stale and refresh; every cached principal is dropped |

## Settings

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/license` | Subscription period and student-seat usage |
| `GET` | `/api/v1/settings` | Every settings group in one call |
| `GET` | `/api/v1/settings/branding` | School name, short name, logo and colours (what /site/info shows) |
| `PUT` | `/api/v1/settings/branding` | Update the school profile / branding (any subset); /site/info reflects it immediately |
| `GET` | `/api/v1/settings/features` | Feature toggles: fees, transport, library, onlinePayments, studentLogin |
| `PUT` | `/api/v1/settings/features` | Switch features on/off — super administrators only |
| `GET` | `/api/v1/settings/{group}` | One settings group (attendance, academic, school, exams, fees, notifications, …) with defaults filled in |
| `PUT` | `/api/v1/settings/{group}` | Update any subset of a settings group (validated against the group’s schema) |
| `GET` | `/api/v1/setup/status` | “Get your school ready” checklist: per step { key, done, count, hint } plus the license summary |

## Site

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/site/info` | Public school info used by the app during first-run setup |
| `GET` | `/api/v1/healthz` |  |
| `GET` | `/api/v1/site/logo` | The school’s logo image (public, cached 5 minutes) |

## Staff attendance

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/staff-attendance` | Staff register for a day (HR roster): every active staff member with their mark, or null |
| `PUT` | `/api/v1/staff-attendance` | Bulk-mark staff attendance for a day (HR) — idempotent upsert |
| `PATCH` | `/api/v1/staff-attendance/{id}` | Correct one staff attendance record (HR) |
| `POST` | `/api/v1/staff-attendance/check-in` | Check in for today (self-service) |
| `POST` | `/api/v1/staff-attendance/check-out` | Check out for today (self-service) |
| `GET` | `/api/v1/staff-attendance/me` | My own attendance (today + history, default last 30 days) |
| `GET` | `/api/v1/staff-attendance/summary` | Staff attendance summary per person over a range (default: this month) |
| `GET` | `/api/v1/staff-attendance/export` | CSV export of staff attendance (max 93 days) |

## Staff leave

| | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/staff-leave` | Apply for my own leave |
| `GET` | `/api/v1/staff-leave` | Staff leave requests (own; school scope sees everyone’s), pending first |
| `GET` | `/api/v1/staff-leave/balance` | Leave taken and pending this academic year, in school days per type (own; school scope may pass staffId) |
| `GET` | `/api/v1/staff-leave/{id}` | One staff leave request (others’ → 404) |
| `POST` | `/api/v1/staff-leave/{id}/approve` | Approve a staff leave request (HR / principal) |
| `POST` | `/api/v1/staff-leave/{id}/reject` | Reject a staff leave request (a note is required) |
| `POST` | `/api/v1/staff-leave/{id}/cancel` | Cancel my pending leave request |

## Staff

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/staff` | Staff directory (school-wide for HR / admin; a teacher sees only their own record) |
| `POST` | `/api/v1/staff` | Add a teacher or non-teaching staff member: employee id, login (temporary password shown once), roles (teacher is automatic for teaching staff; others need roles:edit) |
| `GET` | `/api/v1/staff/{id}` | One staff member with login status and roles |
| `PATCH` | `/api/v1/staff/{id}` | Edit a staff member (the login’s name / phone / email follow) |
| `GET` | `/api/v1/staff/{id}/workload` | Sections led, subjects taught and periods per week (current year), from the teaching assignments |
| `POST` | `/api/v1/staff/{id}/deactivate` | Deactivate (resigned / terminated): login off, sessions revoked. Refused while they still lead sections or teach subjects, unless releaseAssignments is set |
| `POST` | `/api/v1/staff/{id}/reactivate` | Reactivate a deactivated staff member and their login |
| `PUT` | `/api/v1/staff/{id}/roles` | Replace the roles of a staff member’s login (needs roles:edit; bumps the auth version so their tokens refresh) |

## Students

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/students` | Students visible to me (teacher = assigned sections, parent = verified children, student = self); search by name / admission no |
| `POST` | `/api/v1/students` | Add a student: admission number, enrollment in the current year (seat-checked), student login with a temporary password (shown once), optional guardians |
| `POST` | `/api/v1/students/import` | Bulk import from CSV text or JSON rows (max 500). dryRun=true (default) reports per-row problems and whether the licence has seats for the whole batch; dryRun=false writes everything or nothing |
| `GET` | `/api/v1/students/{id}` | One student (404 outside my scope). Medical notes, documents and contact details appear only if I am permitted |
| `PATCH` | `/api/v1/students/{id}` | Edit a student’s record (including photo file id, emergency contacts and authorised pickups) |
| `POST` | `/api/v1/students/{id}/status` | Suspend / reinstate, or archive a student as transferred, withdrawn or alumni (never deleted; login switched off; history kept). Archiving needs students:delete |
| `POST` | `/api/v1/students/{id}/move-section` | Move a student to another section of the current year (updates the enrollment; no new seat) |
| `POST` | `/api/v1/students/{id}/guardians` | Link a registered parent to a student. The link grants NO access until it is verified (or created with verified=true) |
| `PATCH` | `/api/v1/students/{id}/guardians/{guardianId}` | Change relationship / primary / pickup / emergency flags of a link |
| `DELETE` | `/api/v1/students/{id}/guardians/{guardianId}` | Remove the link between a parent and a student |
| `POST` | `/api/v1/students/{id}/guardians/{guardianId}/verify` | Verify the parent↔child relationship: from now on the parent can see this child (audited; the parent is notified) |
| `POST` | `/api/v1/students/{id}/guardians/{guardianId}/unverify` | Withdraw verification: the parent immediately loses access to this child (the link stays) |
| `GET` | `/api/v1/students/{id}/documents` | Student documents (certificates, ID proofs, medical) |
| `POST` | `/api/v1/students/{id}/documents` | Attach an uploaded file as a student document |
| `POST` | `/api/v1/students/{id}/documents/{docId}/verify` | Mark a document as checked by the school |
| `DELETE` | `/api/v1/students/{id}/documents/{docId}` | Remove a student document record |
| `POST` | `/api/v1/students/{id}/correction-requests` | A verified-linked parent (or the student) asks the school to correct an official field. Nothing changes until it is approved |
| `GET` | `/api/v1/correction-requests` | Correction requests: reviewers see all, parents and students see the ones they filed |
| `GET` | `/api/v1/correction-requests/{id}` | One correction request |
| `POST` | `/api/v1/correction-requests/{id}/approve` | Approve: the change is applied to the student record in the same audited transaction |
| `POST` | `/api/v1/correction-requests/{id}/reject` | Reject (a reason is required) |
| `POST` | `/api/v1/correction-requests/{id}/cancel` | Withdraw my own pending request |

## Submissions

| | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/homework/{id}/submit` | Student submits (or resubmits) their work |
| `GET` | `/api/v1/homework/{id}/submission` | My (or my child’s, via ?studentId=) submission for this homework — 404 NOT_SUBMITTED when none |
| `GET` | `/api/v1/submissions` | Submissions visible to me (teachers: their classes; students/parents: own / linked children) |
| `GET` | `/api/v1/submissions/{id}` | One submission |
| `POST` | `/api/v1/submissions/{id}/review` | Teacher reviews: marks (≤ max) and/or feedback → reviewed; the student is notified |
| `POST` | `/api/v1/submissions/{id}/return` | Teacher returns a submission for rework (feedback required); the student may resubmit |

## Syllabus

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/syllabus/topics` | Syllabus topics of a grade (+subject/term) with the section’s lesson progress |
| `POST` | `/api/v1/syllabus/topics` | Add a syllabus topic for a grade + subject (teachers: only subjects they teach in that grade) |
| `PATCH` | `/api/v1/syllabus/topics/{id}` | Edit a syllabus topic |
| `DELETE` | `/api/v1/syllabus/topics/{id}` | Remove a syllabus topic (and its progress rows) |
| `PUT` | `/api/v1/syllabus/topics/{id}/progress` | Set a section’s progress on one topic (not_started | in_progress | completed) |
| `PUT` | `/api/v1/syllabus/progress` | Set a section’s progress on several topics at once (atomic, audited) |
| `GET` | `/api/v1/syllabus/coverage` | Syllabus coverage % per section and subject (completed topics / all topics of the grade) |

## Tasks

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/tasks/feed` | “My Tasks” feed: personal tasks + pending/overdue homework as virtual items, sorted by due date (undated last) |
| `GET` | `/api/v1/tasks` | My personal tasks |
| `POST` | `/api/v1/tasks` | Add a personal task (priority, due date, optional reminder → `tasks.reminder` notification) |
| `GET` | `/api/v1/tasks/{id}` | One of my tasks |
| `PATCH` | `/api/v1/tasks/{id}` | Edit a task or change its status (todo | doing | done) |
| `DELETE` | `/api/v1/tasks/{id}` | Delete one of my tasks |

## Timetable

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/timetable/sections/{id}` | Weekly timetable grid of a section (days × periods) with the week’s substitutions |
| `PUT` | `/api/v1/timetable/sections/{id}` | Replace a section’s whole timetable (validated as a set; atomic, audited) |
| `PUT` | `/api/v1/timetable/slots` | Set one timetable slot (creates or replaces the lesson at section + day + period) |
| `DELETE` | `/api/v1/timetable/slots/{id}` | Clear a timetable slot |
| `GET` | `/api/v1/timetable/me` | My school day: a student’s section, a parent’s child (?studentId=), or a teacher’s own lessons including covers |
| `GET` | `/api/v1/timetable/today` | Today’s timetable for the dashboards: entries tagged past/current/upcoming by school time, plus `current` and `next` |
| `GET` | `/api/v1/timetable/substitutions` | One-day covers in a date range (defaults to the next two weeks) visible to me |
| `POST` | `/api/v1/timetable/substitutions` | Arrange a one-day cover for a lesson; the substitute (and the covered teacher) are notified |
| `DELETE` | `/api/v1/timetable/substitutions/{id}` | Cancel a one-day cover |

## Transport

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/transport/vehicles` | Vehicles (with insurance status: valid / expiring within 30 days / expired) |
| `POST` | `/api/v1/transport/vehicles` | Add a vehicle |
| `PATCH` | `/api/v1/transport/vehicles/{id}` | Edit a vehicle (driver, insurance, capacity …) |
| `DELETE` | `/api/v1/transport/vehicles/{id}` | Take a vehicle out of service (409 while an active route uses it) |
| `GET` | `/api/v1/transport/routes` | Routes with vehicle, stop count, students on board and seats left |
| `POST` | `/api/v1/transport/routes` | Create a route |
| `GET` | `/api/v1/transport/routes/{id}` | A route with its ordered stops |
| `PATCH` | `/api/v1/transport/routes/{id}` | Edit a route (name, vehicle, start times); the vehicle must seat the students already on it |
| `DELETE` | `/api/v1/transport/routes/{id}` | Take a route out of service (409 while students are allocated) |
| `POST` | `/api/v1/transport/routes/{id}/stops` | Add a stop (appended, or inserted at `ordinal`) |
| `PUT` | `/api/v1/transport/routes/{id}/stops/order` | Reorder the stops: send every stop id of the route in driving order |
| `PATCH` | `/api/v1/transport/stops/{id}` | Edit a stop (name, times, location, fee) |
| `DELETE` | `/api/v1/transport/stops/{id}` | Delete a stop nobody boards at |
| `GET` | `/api/v1/transport/routes/{id}/manifest` | Route manifest: every student per stop in driving order |
| `GET` | `/api/v1/transport/allocations` | Students using the bus (filter by route, stop, student or name) |
| `PUT` | `/api/v1/transport/students/{studentId}` | Put a student on a route / stop (or move them) |
| `DELETE` | `/api/v1/transport/students/{studentId}` | Take a student off the bus |
| `GET` | `/api/v1/transport/my-bus` | My bus: route, stop, pickup / drop times and driver / attendant contact |
| `GET` | `/api/v1/transport/students/{studentId}/authorized-pickups` | Authorised pickup persons recorded for a student (read-through; own / linked / school scope) |

## Users

| | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/users` | User accounts (search by name / username / email / phone; filter by type, role, status) |
| `POST` | `/api/v1/users` | Create a staff login (temporary password returned once). Assigning roles needs roles:edit |
| `GET` | `/api/v1/users/{id}` | One account |
| `PUT` | `/api/v1/users/{id}/roles` | Replace the roles of a user (needs roles:edit; the user’s tokens go stale and refresh) |
| `POST` | `/api/v1/users/{id}/roles` | Add one role to a user |
| `DELETE` | `/api/v1/users/{id}/roles/{roleId}` | Remove one role from a user (never the last active super administrator) |
| `POST` | `/api/v1/users/{id}/deactivate` | Deactivate an account: signs the user out everywhere and blocks sign-in (never the last super administrator) |
| `POST` | `/api/v1/users/{id}/reactivate` | Reactivate a deactivated account |
| `POST` | `/api/v1/users/{id}/reset-password` | Admin password reset: temporary password returned once, must be changed at next sign-in, all sessions revoked |
| `POST` | `/api/v1/users/{id}/unlock` | Clear a sign-in lockout |
| `POST` | `/api/v1/users/{id}/force-logout` | Sign the user out of every device |
| `GET` | `/api/v1/users/{id}/sessions` | Active sessions (devices) of a user |
| `DELETE` | `/api/v1/users/{id}/sessions/{sessionId}` | Sign one device of a user out |
