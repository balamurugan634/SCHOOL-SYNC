CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"summary" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"push_token" text NOT NULL,
	"platform" text NOT NULL,
	"device_name" text,
	"app_version" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"purpose" text DEFAULT 'other' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"scope" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_hash" text NOT NULL,
	"prev_refresh_hash" text,
	"platform" text DEFAULT 'web' NOT NULL,
	"device_name" text,
	"app_version" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_type" text NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text,
	"display_name" text NOT NULL,
	"avatar_file_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"auth_version" integer DEFAULT 1 NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade_subjects" (
	"grade_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"periods_per_week" integer DEFAULT 5 NOT NULL,
	CONSTRAINT "grade_subjects_grade_id_subject_id_pk" PRIMARY KEY("grade_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ordinal" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ordinal" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"is_break" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grade_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"class_teacher_id" uuid,
	"room" text,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'core' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teaching_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ordinal" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_no" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"dob" date,
	"gender" text,
	"grade_applied_id" uuid,
	"academic_year_id" uuid,
	"guardian_name" text NOT NULL,
	"guardian_relationship" text DEFAULT 'guardian',
	"guardian_phone" text NOT NULL,
	"guardian_email" text,
	"previous_school" text,
	"address" jsonb,
	"notes" text,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"student_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"roll_no" integer,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"started_at" date,
	"ended_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text,
	"phone" text,
	"email" text,
	"occupation" text,
	"address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_correction_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"requester_role" text NOT NULL,
	"changes" jsonb NOT NULL,
	"original" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"employee_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"designation" text,
	"department" text,
	"staff_type" text DEFAULT 'teaching' NOT NULL,
	"gender" text,
	"dob" date,
	"join_date" date,
	"qualification" text,
	"phone" text,
	"email" text,
	"address" jsonb,
	"emergency_contact" jsonb,
	"photo_file_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_guardians" (
	"student_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"relationship" text DEFAULT 'guardian' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"can_pickup" boolean DEFAULT true NOT NULL,
	"is_emergency_contact" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_guardians_student_id_guardian_id_pk" PRIMARY KEY("student_id","guardian_id")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"admission_no" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"dob" date,
	"gender" text,
	"blood_group" text,
	"nationality" text,
	"religion" text,
	"category" text,
	"photo_file_id" uuid,
	"address" jsonb,
	"medical_notes" text,
	"emergency_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"authorized_pickups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"admission_date" date,
	"current_section_id" uuid,
	"current_grade_id" uuid,
	"roll_no" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"month" text NOT NULL,
	"kind" text DEFAULT 'shortage' NOT NULL,
	"percentage" numeric(5, 1),
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"record_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"date" date NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"remarks" text,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"date" date NOT NULL,
	"period_id" uuid,
	"subject_id" uuid,
	"taken_by" uuid,
	"taken_by_user_id" uuid,
	"status" text DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_sessions_uq" UNIQUE NULLS NOT DISTINCT("section_id","date","period_id")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"section_id" uuid,
	"requested_by" uuid NOT NULL,
	"leave_type" text DEFAULT 'other' NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"attachment_file_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"check_in" time,
	"check_out" time,
	"note" text,
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_leave_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"leave_type" text DEFAULT 'casual' NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homework" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"staff_id" uuid,
	"created_by_user_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"allow_submission" boolean DEFAULT true NOT NULL,
	"max_marks" integer,
	"status" text DEFAULT 'published' NOT NULL,
	"due_reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homework_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"homework_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"text" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"marks" numeric(6, 2),
	"feedback" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"grade_id" uuid,
	"section_id" uuid,
	"subject_id" uuid NOT NULL,
	"file_id" uuid,
	"url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "student_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_at" timestamp with time zone,
	"remind_at" timestamp with time zone,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"completed_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "syllabus_topics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grade_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"term_id" uuid,
	"title" text NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"planned_hours" integer
);
--> statement-breakpoint
CREATE TABLE "timetable_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"period_id" uuid NOT NULL,
	"subject_id" uuid,
	"staff_id" uuid,
	"room" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timetable_substitutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slot_id" uuid NOT NULL,
	"date" date NOT NULL,
	"substitute_staff_id" uuid NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_progress" (
	"id" uuid PRIMARY KEY NOT NULL,
	"topic_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_papers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exam_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"exam_date" date,
	"start_time" time,
	"end_time" time,
	"room" text,
	"max_marks" numeric(6, 2) DEFAULT 100 NOT NULL,
	"pass_marks" numeric(6, 2)
);
--> statement-breakpoint
CREATE TABLE "exam_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exam_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"for_date" date NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"exam_type" text DEFAULT 'unit_test' NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"term_id" uuid,
	"grade_scale_id" uuid,
	"start_date" date,
	"end_date" date,
	"pass_percent" numeric(5, 2) DEFAULT 35 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade_scale_bands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scale_id" uuid NOT NULL,
	"label" text NOT NULL,
	"min_percent" numeric(5, 2) NOT NULL,
	"max_percent" numeric(5, 2) NOT NULL,
	"grade_point" numeric(4, 2),
	"remark" text
);
--> statement-breakpoint
CREATE TABLE "grade_scales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mark_sheets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exam_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"return_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sheet_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"marks_obtained" numeric(6, 2),
	"is_absent" boolean DEFAULT false NOT NULL,
	"remarks" text,
	"entered_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_remarks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exam_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"remark" text,
	"areas_to_improve" text,
	"conduct" text,
	"entered_by" uuid,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concession_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"concession_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"value" bigint NOT NULL,
	"category_id" uuid,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"spent_on" date NOT NULL,
	"paid_to" text,
	"reference" text,
	"receipt_file_id" uuid,
	"status" text DEFAULT 'approved' NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_on" date NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_structure_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"structure_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"due_date" date NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_structures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"grade_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"category_id" uuid,
	"structure_item_id" uuid,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_no" text NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_date" date NOT NULL,
	"total_minor" bigint NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"notes" text,
	"plan_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_by" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"gateway" text,
	"gateway_order_id" text,
	"gateway_payment_id" text,
	"idempotency_key" text,
	"receipt_no" text,
	"paid_at" timestamp with time zone,
	"received_by" uuid,
	"payer_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"processed_by" uuid,
	"processed_at" timestamp with time zone,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_fee_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_receipts" (
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"acked_at" timestamp with time zone,
	CONSTRAINT "announcement_receipts_announcement_id_user_id_pk" PRIMARY KEY("announcement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_ack" boolean DEFAULT false NOT NULL,
	"publish_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text DEFAULT '*' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"responded_by" uuid NOT NULL,
	"response" text NOT NULL,
	"note" text,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'event' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"all_day" boolean DEFAULT true NOT NULL,
	"location" text,
	"audience_all" boolean DEFAULT true NOT NULL,
	"registration_required" boolean DEFAULT false NOT NULL,
	"consent_required" boolean DEFAULT false NOT NULL,
	"consent_text" text,
	"registration_deadline" timestamp with time zone,
	"capacity" integer,
	"status" text DEFAULT 'published' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_id" uuid,
	"staff_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"topic" text NOT NULL,
	"proposed_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"duration_min" integer DEFAULT 15 NOT NULL,
	"mode" text DEFAULT 'in_person' NOT NULL,
	"location_or_link" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"outcome_notes" text,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"quiet_from" time,
	"quiet_to" time,
	CONSTRAINT "notification_preferences_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"read_at" timestamp with time zone,
	"push_status" text DEFAULT 'pending' NOT NULL,
	"pushed_at" timestamp with time zone,
	"deliver_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_books" (
	"id" uuid PRIMARY KEY NOT NULL,
	"accession_no" text NOT NULL,
	"isbn" text,
	"title" text NOT NULL,
	"author" text,
	"publisher" text,
	"category" text,
	"shelf" text,
	"total_copies" integer DEFAULT 1 NOT NULL,
	"available_copies" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_books_stock_chk" CHECK ("library_books"."available_copies" >= 0 and "library_books"."available_copies" <= "library_books"."total_copies")
);
--> statement-breakpoint
CREATE TABLE "library_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"book_id" uuid NOT NULL,
	"student_id" uuid,
	"staff_id" uuid,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"returned_on" date,
	"fine_minor" bigint DEFAULT 0 NOT NULL,
	"issued_by" uuid,
	"last_reminded_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_issues_borrower_chk" CHECK (("library_issues"."student_id" is not null) <> ("library_issues"."staff_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "student_transport" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"route_id" uuid NOT NULL,
	"stop_id" uuid,
	"start_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vehicle_id" uuid,
	"pickup_start_time" time,
	"drop_start_time" time,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"route_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ordinal" integer NOT NULL,
	"pickup_time" time,
	"drop_time" time,
	"lat" double precision,
	"lng" double precision,
	"fee_minor" bigint
);
--> statement-breakpoint
CREATE TABLE "transport_vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"registration_no" text NOT NULL,
	"model" text,
	"capacity" integer DEFAULT 40 NOT NULL,
	"driver_name" text,
	"driver_phone" text,
	"attendant_name" text,
	"insurance_expiry" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_subjects" ADD CONSTRAINT "grade_subjects_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_subjects" ADD CONSTRAINT "grade_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_teacher_id_staff_id_fk" FOREIGN KEY ("class_teacher_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_grade_applied_id_grades_id_fk" FOREIGN KEY ("grade_applied_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_correction_requests" ADD CONSTRAINT "record_correction_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_current_section_id_sections_id_fk" FOREIGN KEY ("current_section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_current_grade_id_grades_id_fk" FOREIGN KEY ("current_grade_id") REFERENCES "public"."grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_alerts" ADD CONSTRAINT "attendance_alerts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_record_id_attendance_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."attendance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_taken_by_staff_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_requests" ADD CONSTRAINT "staff_leave_requests_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_homework_id_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."homework"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_tasks" ADD CONSTRAINT "student_tasks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_substitutions" ADD CONSTRAINT "timetable_substitutions_slot_id_timetable_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."timetable_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_substitutions" ADD CONSTRAINT "timetable_substitutions_substitute_staff_id_staff_id_fk" FOREIGN KEY ("substitute_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_progress" ADD CONSTRAINT "topic_progress_topic_id_syllabus_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."syllabus_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_progress" ADD CONSTRAINT "topic_progress_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_reminders" ADD CONSTRAINT "exam_reminders_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_reminders" ADD CONSTRAINT "exam_reminders_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_grade_scale_id_grade_scales_id_fk" FOREIGN KEY ("grade_scale_id") REFERENCES "public"."grade_scales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_scale_bands" ADD CONSTRAINT "grade_scale_bands_scale_id_grade_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."grade_scales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_sheets" ADD CONSTRAINT "mark_sheets_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_sheets" ADD CONSTRAINT "mark_sheets_paper_id_exam_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."exam_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_sheets" ADD CONSTRAINT "mark_sheets_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_sheets" ADD CONSTRAINT "mark_sheets_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marks" ADD CONSTRAINT "marks_sheet_id_mark_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."mark_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marks" ADD CONSTRAINT "marks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_remarks" ADD CONSTRAINT "report_remarks_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_remarks" ADD CONSTRAINT "report_remarks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concession_applications" ADD CONSTRAINT "concession_applications_concession_id_concessions_id_fk" FOREIGN KEY ("concession_id") REFERENCES "public"."concessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concession_applications" ADD CONSTRAINT "concession_applications_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concessions" ADD CONSTRAINT "concessions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concessions" ADD CONSTRAINT "concessions_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concessions" ADD CONSTRAINT "concessions_category_id_fee_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."fee_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_reminders" ADD CONSTRAINT "fee_reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_structure_id_fee_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_category_id_fee_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."fee_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_category_id_fee_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."fee_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_structure_item_id_fee_structure_items_id_fk" FOREIGN KEY ("structure_item_id") REFERENCES "public"."fee_structure_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_student_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."student_fee_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_plans" ADD CONSTRAINT "student_fee_plans_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_plans" ADD CONSTRAINT "student_fee_plans_structure_id_fee_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_fee_plans" ADD CONSTRAINT "student_fee_plans_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_receipts" ADD CONSTRAINT "announcement_receipts_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_receipts" ADD CONSTRAINT "announcement_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_issues" ADD CONSTRAINT "library_issues_book_id_library_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."library_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_issues" ADD CONSTRAINT "library_issues_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_issues" ADD CONSTRAINT "library_issues_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_transport" ADD CONSTRAINT "student_transport_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_transport" ADD CONSTRAINT "student_transport_route_id_transport_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."transport_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_transport" ADD CONSTRAINT "student_transport_stop_id_transport_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."transport_stops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_vehicle_id_transport_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."transport_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_stops" ADD CONSTRAINT "transport_stops_route_id_transport_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."transport_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_logs" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity","entity_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_user_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_logs" USING btree ("action","at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_uq" ON "devices" USING btree ("push_token");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_key_uq" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_uploader_idx" ON "files" USING btree ("uploaded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_hash_uq" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_type_status_idx" ON "users" USING btree ("user_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_name_uq" ON "academic_years" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_current_uq" ON "academic_years" USING btree ("is_current") WHERE "academic_years"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "grades_name_uq" ON "grades" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "periods_ordinal_uq" ON "periods" USING btree ("ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_uq" ON "sections" USING btree ("grade_id","academic_year_id","name");--> statement-breakpoint
CREATE INDEX "sections_teacher_idx" ON "sections" USING btree ("class_teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_code_uq" ON "subjects" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "teaching_assignments_uq" ON "teaching_assignments" USING btree ("section_id","subject_id");--> statement-breakpoint
CREATE INDEX "teaching_assignments_staff_idx" ON "teaching_assignments" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_no_uq" ON "admissions" USING btree ("application_no");--> statement-breakpoint
CREATE INDEX "admissions_status_idx" ON "admissions" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_student_year_uq" ON "enrollments" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "enrollments_section_idx" ON "enrollments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "enrollments_year_idx" ON "enrollments" USING btree ("academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardians_user_uq" ON "guardians" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guardians_phone_idx" ON "guardians" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "correction_requests_status_idx" ON "record_correction_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "correction_requests_student_idx" ON "record_correction_requests" USING btree ("student_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "correction_requests_requester_idx" ON "record_correction_requests" USING btree ("requested_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "staff_employee_id_uq" ON "staff" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_uq" ON "staff" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "student_documents_student_idx" ON "student_documents" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_documents_file_idx" ON "student_documents" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "student_guardians_guardian_idx" ON "student_guardians" USING btree ("guardian_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_admission_no_uq" ON "students" USING btree ("admission_no");--> statement-breakpoint
CREATE UNIQUE INDEX "students_user_uq" ON "students" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "students_section_idx" ON "students" USING btree ("current_section_id","status");--> statement-breakpoint
CREATE INDEX "students_grade_idx" ON "students" USING btree ("current_grade_id");--> statement-breakpoint
CREATE INDEX "students_name_idx" ON "students" USING btree (lower("first_name"),lower("last_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_alerts_uq" ON "attendance_alerts" USING btree ("student_id","month","kind");--> statement-breakpoint
CREATE INDEX "attendance_corrections_status_idx" ON "attendance_corrections" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attendance_corrections_section_idx" ON "attendance_corrections" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_session_student_uq" ON "attendance_records" USING btree ("session_id","student_id");--> statement-breakpoint
CREATE INDEX "attendance_records_student_date_idx" ON "attendance_records" USING btree ("student_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attendance_records_section_date_idx" ON "attendance_records" USING btree ("section_id","date");--> statement-breakpoint
CREATE INDEX "attendance_records_date_status_idx" ON "attendance_records" USING btree ("date","status");--> statement-breakpoint
CREATE INDEX "attendance_sessions_date_idx" ON "attendance_sessions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "leave_requests_student_idx" ON "leave_requests" USING btree ("student_id","from_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("status","from_date");--> statement-breakpoint
CREATE INDEX "leave_requests_section_idx" ON "leave_requests" USING btree ("section_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_attendance_uq" ON "staff_attendance" USING btree ("staff_id","date");--> statement-breakpoint
CREATE INDEX "staff_attendance_date_idx" ON "staff_attendance" USING btree ("date","status");--> statement-breakpoint
CREATE INDEX "staff_leave_staff_idx" ON "staff_leave_requests" USING btree ("staff_id","from_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "staff_leave_status_idx" ON "staff_leave_requests" USING btree ("status","from_date");--> statement-breakpoint
CREATE INDEX "homework_section_due_idx" ON "homework" USING btree ("section_id","due_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "homework_staff_idx" ON "homework" USING btree ("staff_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "homework_due_idx" ON "homework" USING btree ("due_at") WHERE "homework"."status" = 'published';--> statement-breakpoint
CREATE INDEX "homework_attachments_gin" ON "homework" USING gin ("attachments" jsonb_path_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "homework_submissions_uq" ON "homework_submissions" USING btree ("homework_id","student_id");--> statement-breakpoint
CREATE INDEX "homework_submissions_student_idx" ON "homework_submissions" USING btree ("student_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "homework_submissions_attachments_gin" ON "homework_submissions" USING gin ("attachments" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "materials_section_idx" ON "materials" USING btree ("section_id","subject_id");--> statement-breakpoint
CREATE INDEX "materials_grade_idx" ON "materials" USING btree ("grade_id","subject_id");--> statement-breakpoint
CREATE INDEX "materials_file_idx" ON "materials" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "student_tasks_student_idx" ON "student_tasks" USING btree ("student_id","status","due_at");--> statement-breakpoint
CREATE INDEX "student_tasks_remind_idx" ON "student_tasks" USING btree ("remind_at") WHERE "student_tasks"."reminded_at" is null and "student_tasks"."status" <> 'done';--> statement-breakpoint
CREATE INDEX "syllabus_topics_idx" ON "syllabus_topics" USING btree ("grade_id","subject_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slots_uq" ON "timetable_slots" USING btree ("section_id","day_of_week","period_id");--> statement-breakpoint
CREATE INDEX "timetable_slots_staff_idx" ON "timetable_slots" USING btree ("staff_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_substitutions_uq" ON "timetable_substitutions" USING btree ("slot_id","date");--> statement-breakpoint
CREATE INDEX "timetable_substitutions_date_idx" ON "timetable_substitutions" USING btree ("date","substitute_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_progress_uq" ON "topic_progress" USING btree ("topic_id","section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_papers_uq" ON "exam_papers" USING btree ("exam_id","grade_id","subject_id");--> statement-breakpoint
CREATE INDEX "exam_papers_date_idx" ON "exam_papers" USING btree ("exam_date");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_reminders_uq" ON "exam_reminders" USING btree ("exam_id","grade_id","for_date");--> statement-breakpoint
CREATE INDEX "exams_year_idx" ON "exams" USING btree ("academic_year_id","start_date");--> statement-breakpoint
CREATE INDEX "grade_scale_bands_scale_idx" ON "grade_scale_bands" USING btree ("scale_id","min_percent");--> statement-breakpoint
CREATE UNIQUE INDEX "mark_sheets_uq" ON "mark_sheets" USING btree ("exam_id","section_id","subject_id");--> statement-breakpoint
CREATE INDEX "mark_sheets_status_idx" ON "mark_sheets" USING btree ("status","exam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marks_uq" ON "marks" USING btree ("sheet_id","student_id");--> statement-breakpoint
CREATE INDEX "marks_student_idx" ON "marks" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_remarks_uq" ON "report_remarks" USING btree ("exam_id","student_id");--> statement-breakpoint
CREATE INDEX "concession_applications_concession_idx" ON "concession_applications" USING btree ("concession_id");--> statement-breakpoint
CREATE INDEX "concession_applications_invoice_idx" ON "concession_applications" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "concessions_student_idx" ON "concessions" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "expenses_spent_idx" ON "expenses" USING btree ("spent_on");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category","spent_on");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_categories_code_uq" ON "fee_categories" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_reminders_uq" ON "fee_reminders" USING btree ("invoice_id","kind","sent_on");--> statement-breakpoint
CREATE INDEX "fee_structure_items_structure_idx" ON "fee_structure_items" USING btree ("structure_id","due_date");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_items_structure_item_idx" ON "invoice_items" USING btree ("structure_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_no_uq" ON "invoices" USING btree ("invoice_no");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_plan_due_uq" ON "invoices" USING btree ("plan_id","due_date") WHERE "invoices"."plan_id" is not null and "invoices"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "invoices_student_idx" ON "invoices" USING btree ("student_id","due_date");--> statement-breakpoint
CREATE INDEX "invoices_status_due_idx" ON "invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_uq" ON "payments" USING btree ("receipt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idem_uq" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_payment_uq" ON "payments" USING btree ("gateway_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_order_uq" ON "payments" USING btree ("gateway_order_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_student_idx" ON "payments" USING btree ("student_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_paid_at_idx" ON "payments" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "student_fee_plans_uq" ON "student_fee_plans" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_fee_plans_structure_idx" ON "student_fee_plans" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "announcement_receipts_user_idx" ON "announcement_receipts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "announcements_status_idx" ON "announcements" USING btree ("status","publish_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "announcements_attachments_gin" ON "announcements" USING gin ("attachments" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "announcements_creator_idx" ON "announcements" USING btree ("created_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audience_targets_owner_idx" ON "audience_targets" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "audience_targets_target_idx" ON "audience_targets" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_uq" ON "event_registrations" USING btree ("event_id","student_id");--> statement-breakpoint
CREATE INDEX "event_registrations_student_idx" ON "event_registrations" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "events_start_idx" ON "events" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "events_kind_idx" ON "events" USING btree ("kind","start_date");--> statement-breakpoint
CREATE INDEX "meetings_staff_idx" ON "meetings" USING btree ("staff_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "meetings_student_idx" ON "meetings" USING btree ("student_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_push_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."push_status" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_push_held_idx" ON "notifications" USING btree ("deliver_after") WHERE "notifications"."push_status" = 'held';--> statement-breakpoint
CREATE UNIQUE INDEX "library_books_acc_uq" ON "library_books" USING btree ("accession_no");--> statement-breakpoint
CREATE INDEX "library_books_title_idx" ON "library_books" USING btree ("title");--> statement-breakpoint
CREATE INDEX "library_issues_student_idx" ON "library_issues" USING btree ("student_id","returned_on");--> statement-breakpoint
CREATE INDEX "library_issues_staff_idx" ON "library_issues" USING btree ("staff_id","returned_on");--> statement-breakpoint
CREATE INDEX "library_issues_book_idx" ON "library_issues" USING btree ("book_id","returned_on");--> statement-breakpoint
CREATE INDEX "library_issues_due_idx" ON "library_issues" USING btree ("due_on") WHERE "library_issues"."returned_on" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "library_issues_open_student_uq" ON "library_issues" USING btree ("book_id","student_id") WHERE "library_issues"."returned_on" is null and "library_issues"."student_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "library_issues_open_staff_uq" ON "library_issues" USING btree ("book_id","staff_id") WHERE "library_issues"."returned_on" is null and "library_issues"."staff_id" is not null;--> statement-breakpoint
CREATE INDEX "student_transport_route_idx" ON "student_transport" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "transport_stops_route_idx" ON "transport_stops" USING btree ("route_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_vehicles_reg_uq" ON "transport_vehicles" USING btree ("registration_no");