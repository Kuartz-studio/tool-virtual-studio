CREATE TABLE "progress" (
	"user_id" text PRIMARY KEY NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"kuartzons" integer DEFAULT 0 NOT NULL,
	"check_in_day" text,
	"streak" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_purchase" (
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"price" integer NOT NULL,
	"bought_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_purchase_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"giver_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"tier" integer,
	"xp" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "xp_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"source" text NOT NULL,
	"label" text NOT NULL,
	"day" text NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_purchase" ADD CONSTRAINT "shop_purchase_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_giver_id_user_id_fk" FOREIGN KEY ("giver_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_event" ADD CONSTRAINT "xp_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_owner_status_idx" ON "task" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "task_giver_created_idx" ON "task" USING btree ("giver_id","created_at");--> statement-breakpoint
CREATE INDEX "xp_event_user_day_idx" ON "xp_event" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "xp_event_user_created_idx" ON "xp_event" USING btree ("user_id","created_at");