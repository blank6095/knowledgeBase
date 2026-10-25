CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"in_tok" integer DEFAULT 0 NOT NULL,
	"out_tok" integer DEFAULT 0 NOT NULL,
	"ms" integer DEFAULT 0 NOT NULL,
	"cached" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_cache" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_kind_idx" ON "llm_calls" USING btree ("kind");