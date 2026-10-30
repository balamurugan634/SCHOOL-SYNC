CREATE TABLE "meeting_integrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"credentials_enc" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_error" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_meeting_cleanup" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"remote_meeting_id" text NOT NULL,
	"source" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_provider" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_remote_provider" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_meeting_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_join_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_start_url_enc" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_passcode" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_error" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_sync_sig" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "online_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_provider" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_remote_provider" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_meeting_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_join_url" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_start_url_enc" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_passcode" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_error" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_sync_sig" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_lease_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_integrations_provider_uq" ON "meeting_integrations" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_integrations_default_uq" ON "meeting_integrations" USING btree ("is_default") WHERE "meeting_integrations"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "online_meeting_cleanup_uq" ON "online_meeting_cleanup" USING btree ("provider","remote_meeting_id");--> statement-breakpoint
CREATE INDEX "online_meeting_cleanup_created_idx" ON "online_meeting_cleanup" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "events_online_idx" ON "events" USING btree ("online_status","start_date") WHERE "events"."online_provider" is not null or "events"."online_remote_provider" is not null;--> statement-breakpoint
CREATE INDEX "meetings_online_idx" ON "meetings" USING btree ("online_status","scheduled_at") WHERE "meetings"."online_provider" is not null or "meetings"."online_remote_provider" is not null;