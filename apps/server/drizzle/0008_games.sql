CREATE TABLE "game_match" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"players" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"moves" jsonb NOT NULL,
	"move_count" integer NOT NULL,
	"ranked" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_rating" (
	"user_id" text NOT NULL,
	"game" text NOT NULL,
	"rating" integer DEFAULT 1200 NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_rating_user_id_game_pk" PRIMARY KEY("user_id","game")
);
--> statement-breakpoint
ALTER TABLE "game_rating" ADD CONSTRAINT "game_rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_match_game_ended_at_idx" ON "game_match" USING btree ("game","ended_at");--> statement-breakpoint
CREATE INDEX "game_rating_game_rating_idx" ON "game_rating" USING btree ("game","rating");