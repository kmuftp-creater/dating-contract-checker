ALTER TABLE "analyses" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "pseudo_ipv4" "inet";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "country" text;