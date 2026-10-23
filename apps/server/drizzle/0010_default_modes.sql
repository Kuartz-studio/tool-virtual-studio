-- Les modes par défaut (Manger, Sport, Concentration : DEFAULT_MODES, que les comptes créés ensuite reçoivent à leur création) pour chaque compte qui existe déjà.
-- Des données seulement, aucun changement de schéma. Ils passent avant ses propres modes (la date de création du compte, une milliseconde d'écart entre eux),
-- et un compte qui a déjà un mode de ce nom (une copie de l'ancien « Concentration » tout prêt) ne le reçoit pas une seconde fois. Ses modes à lui restent tels quels.
INSERT INTO "activity_state" ("user_id", "label", "color", "icon", "place", "allow_entry", "hear", "heard", "created_at")
SELECT "user"."id", "d"."label", "d"."color", "d"."icon", "d"."place", "d"."allow_entry", "d"."hear", "d"."heard", "user"."created_at" + "d"."rank" * interval '1 millisecond'
FROM "user"
CROSS JOIN (VALUES
  (0, 'Manger', '#ec4899', 'utensils', NULL, true, false, false),
  (1, 'Sport', '#f97316', 'dumbbell', 'gym', true, false, false),
  (2, 'Concentration', '#6d28d9', 'headphones', NULL, false, true, true)
) AS "d" ("rank", "label", "color", "icon", "place", "allow_entry", "hear", "heard")
WHERE NOT EXISTS (
  SELECT 1 FROM "activity_state" AS "own" WHERE "own"."user_id" = "user"."id" AND lower("own"."label") = lower("d"."label")
);
