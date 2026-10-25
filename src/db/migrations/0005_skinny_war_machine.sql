CREATE TABLE "llm_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"output" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "summary" text;