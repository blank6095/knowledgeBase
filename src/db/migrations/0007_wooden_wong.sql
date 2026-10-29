CREATE TABLE "recall_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" text NOT NULL,
	"segment_id" uuid NOT NULL,
	"question" text NOT NULL,
	"reference_answer" text NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"result" text NOT NULL,
	"source_version" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_review_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "recall_reviews" ADD CONSTRAINT "recall_reviews_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recall_reviews_submission_idx" ON "recall_reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "recall_reviews_segment_idx" ON "recall_reviews" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "recall_reviews_reviewed_idx" ON "recall_reviews" USING btree ("reviewed_at");--> statement-breakpoint
CREATE INDEX "recall_reviews_next_idx" ON "recall_reviews" USING btree ("next_review_at");