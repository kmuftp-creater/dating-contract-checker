CREATE TYPE "public"."chain_error_category" AS ENUM('unreachable', 'rate_limit', 'timeout', 'server_error', 'bad_request', 'parse_error');--> statement-breakpoint
CREATE TABLE "ai_chain_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layer_id" text NOT NULL,
	"ok" boolean NOT NULL,
	"error_category" "chain_error_category",
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_chain_attempts_layer_created_idx" ON "ai_chain_attempts" USING btree ("layer_id","created_at" DESC NULLS LAST);