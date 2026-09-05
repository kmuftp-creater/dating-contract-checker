CREATE TYPE "public"."analysis_mode" AS ENUM('merged', 'separate');--> statement-breakpoint
CREATE TYPE "public"."analysis_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."blocklist_type" AS ENUM('ip', 'cidr', 'email');--> statement-breakpoint
CREATE TYPE "public"."daily_quota_subject_type" AS ENUM('client', 'ip');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('checklist', 'regulation');--> statement-breakpoint
CREATE TYPE "public"."email_job_status" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_job_type" AS ENUM('analysis_hook', 'report_reply');--> statement-breakpoint
CREATE TYPE "public"."extract_method" AS ENUM('text', 'ocr');--> statement-breakpoint
CREATE TYPE "public"."ip_state" AS ENUM('normal', 'suspended', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."report_category" AS ENUM('wrong_result', 'upload_failed', 'regulation_error', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'replied', 'closed');--> statement-breakpoint
CREATE TYPE "public"."setting_key" AS ENUM('ai', 'analysis_hook', 'abuse_rules', 'retention', 'smtp');--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"ip" "inet" NOT NULL,
	"mode" "analysis_mode" NOT NULL,
	"status" "analysis_status" DEFAULT 'queued' NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_estimate" numeric(12, 6),
	"result_json" jsonb,
	"checklist_version_id" uuid,
	"regulation_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analysis_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"storage_path" text,
	"extract_method" "extract_method",
	"extracted_text" text,
	"page_count" integer,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blocklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "blocklist_type" NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"first_ip" "inet" NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "daily_quota" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "daily_quota_subject_type" NOT NULL,
	"subject" text NOT NULL,
	"day" date NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "document_kind" NOT NULL,
	"version" integer NOT NULL,
	"markdown" text NOT NULL,
	"attachment_path" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "email_job_type" NOT NULL,
	"payload_json" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" "email_job_status" DEFAULT 'queued' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" "inet" NOT NULL,
	"status" "ip_state" DEFAULT 'normal' NOT NULL,
	"suspended_until" timestamp with time zone,
	"reason" text,
	"suspend_count_24h" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" "inet" NOT NULL,
	"bucket_minute" timestamp with time zone NOT NULL,
	"upload_count" integer DEFAULT 0 NOT NULL,
	"analyze_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"body" text NOT NULL,
	"sent_email" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"ip" "inet" NOT NULL,
	"category" "report_category" NOT NULL,
	"message" text NOT NULL,
	"contact_email" text,
	"screenshot_path" text,
	"analysis_id" uuid,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "setting_key" NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_checklist_version_id_documents_id_fk" FOREIGN KEY ("checklist_version_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_regulation_version_id_documents_id_fk" FOREIGN KEY ("regulation_version_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_files" ADD CONSTRAINT "analysis_files_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_replies" ADD CONSTRAINT "report_replies_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_client_created_idx" ON "analyses" USING btree ("client_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analyses_status_idx" ON "analyses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "blocklist_type_value_idx" ON "blocklist" USING btree ("type","value");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_quota_subject_day_idx" ON "daily_quota" USING btree ("subject_type","subject","day");--> statement-breakpoint
CREATE INDEX "documents_kind_published_idx" ON "documents" USING btree ("kind","is_published");--> statement-breakpoint
CREATE UNIQUE INDEX "ip_status_ip_idx" ON "ip_status" USING btree ("ip");--> statement-breakpoint
CREATE UNIQUE INDEX "ip_windows_ip_bucket_minute_idx" ON "ip_windows" USING btree ("ip","bucket_minute");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_idx" ON "settings" USING btree ("key");