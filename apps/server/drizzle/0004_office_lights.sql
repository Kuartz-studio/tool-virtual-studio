CREATE TABLE "office_lights" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"on" boolean DEFAULT true NOT NULL,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_lights" ADD CONSTRAINT "office_lights_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;