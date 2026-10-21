CREATE TABLE "activity_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"allow_entry" boolean DEFAULT true NOT NULL,
	"hear" boolean DEFAULT true NOT NULL,
	"heard" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_state" ADD CONSTRAINT "activity_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_state_user_id_idx" ON "activity_state" USING btree ("user_id");