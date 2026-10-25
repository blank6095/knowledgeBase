ALTER TABLE "review_logs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "review_logs" CASCADE;--> statement-breakpoint
DROP INDEX "segments_due_idx";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "ease";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "interval_days";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "reps";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "lapses";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "last_grade";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "due_at";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "mastery";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "status";