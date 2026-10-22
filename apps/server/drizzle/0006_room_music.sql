CREATE TABLE "room_music" (
	"place_key" text PRIMARY KEY NOT NULL,
	"on" boolean DEFAULT true NOT NULL,
	"scene" text,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_music" ADD CONSTRAINT "room_music_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;