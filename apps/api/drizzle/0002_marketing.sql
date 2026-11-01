CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "communication_consents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "service_types" ADD COLUMN "rebook_after_days" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_tenant_created" ON "campaigns" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- Keep only the newest consent per customer, channel and purpose before the unique index.
DELETE FROM "communication_consents" a USING "communication_consents" b
  WHERE a."tenant_id" = b."tenant_id" AND a."customer_id" = b."customer_id" AND a."channel" = b."channel" AND a."purpose" = b."purpose"
  AND (coalesce(a."granted_at", a."revoked_at", 'epoch') < coalesce(b."granted_at", b."revoked_at", 'epoch') OR (coalesce(a."granted_at", a."revoked_at", 'epoch') = coalesce(b."granted_at", b."revoked_at", 'epoch') AND a."id" < b."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "consents_customer_channel_purpose" ON "communication_consents" USING btree ("tenant_id","customer_id","channel","purpose");