CREATE TABLE "desk" (
	"key" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desk_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
ALTER TABLE "desk" ADD CONSTRAINT "desk_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;