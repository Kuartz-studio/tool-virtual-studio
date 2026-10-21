CREATE TABLE "desk_setup" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"floor" text NOT NULL,
	"wall" text NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desk_setup" ADD CONSTRAINT "desk_setup_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;