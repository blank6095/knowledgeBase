CREATE TABLE "reading_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "stability" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "reading_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_events" ADD CONSTRAINT "reading_events_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_events_segment_idx" ON "reading_events" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "reading_events_started_idx" ON "reading_events" USING btree ("started_at");