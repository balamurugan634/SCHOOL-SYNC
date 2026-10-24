CREATE TABLE "email_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email_address" text NOT NULL,
	"sender_name" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT 'custom' NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_security" text DEFAULT 'starttls' NOT NULL,
	"smtp_username" text DEFAULT '' NOT NULL,
	"smtp_password_enc" text,
	"reply_to" text,
	"is_default_outgoing" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"always_use_account_address" boolean DEFAULT true NOT NULL,
	"daily_limit" integer,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"sent_count_day" date,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_error" text,
	"last_send_at" timestamp with time zone,
	"last_send_error" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_queue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"sender" text NOT NULL,
	"to_addresses" text[] NOT NULL,
	"cc_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"reply_to" text,
	"subject" text NOT NULL,
	"text_body" text,
	"html_body" text,
	"sensitive" boolean DEFAULT false NOT NULL,
	"priority" smallint DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'not_sent' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"reference_type" text,
	"reference_id" text,
	"message_id" text,
	"sent_at" timestamp with time zone,
	"sent_via" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_queue" ADD CONSTRAINT "email_queue_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_name_uq" ON "email_accounts" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_default_uq" ON "email_accounts" USING btree ("is_default_outgoing") WHERE "email_accounts"."is_default_outgoing";--> statement-breakpoint
CREATE INDEX "email_queue_due_idx" ON "email_queue" USING btree ("priority","created_at") WHERE "email_queue"."status" = 'not_sent';--> statement-breakpoint
CREATE INDEX "email_queue_status_idx" ON "email_queue" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_queue_created_idx" ON "email_queue" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_queue_account_idx" ON "email_queue" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_queue_one_sending_uq" ON "email_queue" USING btree ("status") WHERE "email_queue"."status" = 'sending';