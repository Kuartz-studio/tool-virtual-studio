# Six chantiers du 26 octobre 2026 — les consignes des quatre agents

> Les consignes exactes données le 26 oct. à 16 h 30 aux quatre agents (un par chantier, chacun dans son worktree). Elles servent à relancer un
> agent si son travail s'est arrêté en route. Le plan et le suivi : [`2026-10-26-six-chantiers.md`](2026-10-26-six-chantiers.md). L'état de chaque
> agent, s'il a eu le temps de l'écrire : `2026-10-26-etat-<nom>.md`, à côté.
>
> Pour relancer un agent sur un worktree déjà commencé : lui donner le cadre commun, son chantier, et lui dire de **reprendre le travail déjà fait
> dans le worktree** (lire `git status` et `git diff`, et son fichier d'état s'il existe) au lieu de repartir de zéro.

## Le cadre commun (le même pour les quatre, avec leurs ports)

Tu travailles sur **bureau-virtuel**, un bureau virtuel en pixel art (React 19, Phaser 4.2, Socket.IO 4.8, zustand 5, zod 4, Drizzle sur Postgres ou
PGlite ; monorepo pnpm : `apps/client`, `apps/server`, `packages/shared` ; tests Vitest + happy-dom, e2e Playwright). Tout est en français :
l'interface, les commentaires, les messages. Écris le code comme celui qui l'entoure : mêmes noms, même idiome, et des commentaires de la même densité
et du même ton (des phrases complètes qui disent le pourquoi, pas de commentaire inutile).

**Ton cadre de travail**
- Tu es dans ton propre worktree git, créé pour toi à partir de `main` (42917f0). Commence par `pnpm install --frozen-lockfile --prefer-offline`. Le
  dossier principal `/Users/andreagauvreau/Tools/bureau-virtuel` est en lecture seule pour toi (tu peux y lire, et copier son `.env` dans ton worktree
  si le serveur en a besoin ; `.env` est ignoré par git). Le plan du chantier, à lire d'abord :
  `/Users/andreagauvreau/Tools/bureau-virtuel/docs/superpowers/plans/2026-10-26-six-chantiers.md`.
- **Aucun commit, aucun push, aucune branche.** Laisse tes changements dans le worktree : la session principale les récupère et les réunit.
- **Ne modifie ni `README.md`, ni `docs/decisions.md`, ni le plan** : les quatre agents travaillent en même temps et ces fichiers se chevaucheraient.
  Mets à la place, à la fin de ton rapport, le paragraphe à ajouter au README (et sous quel titre) et l'entrée pour `docs/decisions.md` (format de ce
  fichier : `## Titre (octobre 2026)`, la demande citée entre guillemets, puis le tableau `| Décision | Pourquoi | Si c'est faux |`).
- **Ton état** (ajouté à 17 h 20, quand la session principale a été mise en pause) : écris-le dans ton worktree, au chemin relatif
  `docs/superpowers/plans/2026-10-26-etat-<nom>.md` (l'outil des agents refuse toute écriture hors du worktree) : ce qui est fait, ce qui reste dans
  l'ordre, les tests et leurs résultats, les choix, les pièges, le chemin du worktree ; à jour à chaque étape, et le rapport final complet à la fin. Ce
  fichier ne se réunit pas avec le code.
- En même temps que toi : les trois autres agents (tapis, jeux, devant, noirs : voir plus bas) ; et la session principale, dans le dossier principal :
  se confier une mission à soi-même (ClerkDialog, progress-service) et les bornes de la caméra (`game/zoom.ts`). Reste dans ton chantier ; si tu dois
  toucher un fichier partagé (`i18n/fr.ts`, `decor-layer.ts`, `DecorPanel.tsx`, `protocol.ts`…), fais des changements localisés.
- **Bac à sable** : serveur `cd apps/server && SIM=1 MAP_KEY=office DATABASE_URL=memory:// PORT=<API> APP_URL=http://localhost:<WEB> pnpm dev`,
  client `cd apps/client && VITE_SIM=1 PORT=<WEB> API_PORT=<API> pnpm dev`, chacun en arrière-plan ; le compte de test du faux live est écrit dans le
  journal du serveur. Pour regarder le rendu, une capture headless avec Playwright (un petit script node avec `chromium` de `@playwright/test`, dans un
  dossier temporaire) — **pas le panneau Browser** (d'autres s'en servent). Une ou deux captures suffisent. À la fin, arrête ton bac à sable
  (seulement tes PID). Ne touche jamais aux processus PM2 ni aux ports d'un autre.
- **Tests** : pendant le travail, Vitest ciblé sur les fichiers touchés (`pnpm vitest run <chemins>`) ; à la fin, `pnpm typecheck` (tout le dépôt,
  e2e compris). Pas de suite complète. E2E : seulement la ou les specs de ton chantier, une fois à la fin, sur tes ports :
  `E2E_PORT=<E1> E2E_OFFICE_PORT=<E2> pnpm e2e <spec…> --workers=1` (en arrière-plan, attendre sa fin ; elle compile l'appli d'abord). Pas de fuzz, pas
  de mesures longues. Ajoute ou mets à jour les tests qui gardent ce que tu changes.
- **Base** : normalement aucune migration. S'il en faut une, son numéro est <NNNN> (le dire dans le rapport).

**Le rapport final** (court, en français) : ce qui est fait ; les fichiers touchés ; les tests lancés et leur résultat (avec les nombres) ; ce qui n'a
pas pu être vérifié ; les choix faits et pourquoi ; le chemin du worktree ; puis le texte pour le README et l'entrée pour `docs/decisions.md`.

## Les quatre agents

| Agent | Chantier | Worktree (dans `/Users/andreagauvreau/Tools/bureau-virtuel/.claude/worktrees/`) | API / client | E2E | Migration |
|---|---|---|---|---|---|
| « tapis » | 2. Le mode Sport sur son tapis de course | `agent-afca37ed86fb60ba3` | 4430 / 5430 | 3130 / 3131 | 0014 |
| « jeux » | 4. La revanche, et le 6 aux petits chevaux | `agent-a15cecbd58489706b` | 4420 / 5420 | 3120 / 3121 | 0015 |
| « devant » | 5. Décorer devant sa pièce | `agent-a8916c1ea0b969041` | 4440 / 5440 | 3140 / 3141 | 0016 |
| « noirs » | 6. Sols et murs noirs, rangés par couleur | `agent-aec63d247d1106802` | 4450 / 5450 | 3150 / 3151 | 0017 |

## Agent « tapis » : le mode Sport sur son tapis de course

La demande d'Andréa (26 oct.) : « si par exemple je mets un outil de sport dans ma room, ça débloque le fait que si par exemple je me mets en mode
sport, je peux choisir non pas de me téléporter dans la salle de sport, mais directement sur le tapis par exemple de course. Si par exemple j'ai un
tapis de course, ça va me mettre dessus et on va me voir courir par exemple avec le tapis qui tourne. Ça ne marche [que] pour le tapis de course. Rien
d'autre. »

Ce qui existe :
- Les modes (« états d'activité ») : `packages/shared/src/protocol.ts` (`activityInputSchema`, `place` : la clé d'une destination de la carte), les
  modes par défaut `packages/shared/src/activity/defaults.ts` (Sport : `place: 'gym'`, ni entendre ni être entendu). On prend un mode par `state:set`
  (son identifiant) ; le serveur fait le voyage dans `apps/server/src/modes/mode-travel.ts` (`createModeTravel` : vers une place libre de la salle,
  retour au bureau en sortant du mode si l'on est encore dans la salle). Le menu « Moi » du client liste les modes.
- Le décor des bureaux : `packages/shared/src/decor/` (`generated.ts` : l'élément `gy-10-30` « Tapis de course », 2 × 3, claim 2, solide ;
  `placement.ts` : coordonnées en cases dans la pièce, au dixième près) ; chaque bureau a sa déco (`DeskInfo.items`), dessinée par
  `apps/client/src/game/decor-layer.ts`.
- Les objets animés : `packages/shared/src/props/` (`generated.ts` : le prop `treadmill`, planche `/assets/props/treadmill.png`, 12 images de
  64 × 96 px, 12 i/s, en boucle ; console au nord, bande vers le sud). La salle de sport de la carte en a trois (`map/office.ts`), qui tournent en
  continu.
- Les joueurs : `PublicPlayer` dans `protocol.ts` ; les avatars `apps/client/src/game/objects/LocalPlayer.ts`, `RemotePlayer.ts`, l'animation de
  marche `step-animation.ts`.

Ce qu'il faut (plan, chantier 2 et D2) :
1. **Seulement `gy-10-30`** (vérifier que son image est bien la première image de `props/treadmill.png`, ou très proche ; sinon le dire, et prendre la
   planche animée pour les deux états).
2. **Le choix** : dans le menu « Moi », prendre un mode dont l'emplacement est la salle de sport, quand **sa propre pièce** a au moins un tapis de
   course, propose deux choix : « Salle de sport » et « Mon tapis de course » (libellé et forme dans le style du menu). Sans tapis, rien ne change.
3. **Le serveur fait foi** : il reçoit le mode avec l'option du tapis (`state:set` étendu de façon compatible, validé par zod), vérifie que la pièce de
   la personne a ce tapis, la pose sur la bande (le milieu de la bande, ses pieds dessus), tournée vers la console (le nord), et dit à tout le monde
   qu'elle court sur ce tapis (un champ facultatif sur `PublicPlayer`, redit à l'`init`). Les interrupteurs du mode s'appliquent comme d'habitude.
   Plusieurs tapis : le premier libre.
4. **Le rendu** : elle court sur place (la marche vers le haut, plus vive), pour elle comme pour les autres ; le tapis qu'elle occupe joue la planche
   animée tant qu'elle court, et revient à l'image fixe ensuite. L'avatar devant la bande.
5. **Descendre** : quand elle quitte le mode (un autre mode, « Disponible »), ou dès qu'elle se déplace (une touche, un clic pour marcher), elle descend
   sur la case libre la plus proche au sud du tapis (sinon à côté), et ne court plus ; se déplacer ne quitte pas le mode (comme sortir à pied de la
   salle de sport). **Jamais coincée dans le meuble** : ni après une reconnexion ou un redémarrage du serveur, ni si le tapis est retiré ou déplacé, ni
   si une validation de déplacement refuse de sortir d'une case bloquée (`packages/shared/src/movement/validate-move.ts`, le serveur des positions).
6. La salle de sport marche exactement comme avant.

Tests : le voyage du mode côté serveur (tapis présent, absent, retiré, sortie du mode, déplacement), le schéma, la logique pure du client (choix
proposé ou non, quand le tapis s'anime). L'e2e `e2e/modes.spec.ts` si un cas simple s'y ajoute. Les e2e qui choisissent « Ne pas déranger » sont cassés
depuis le 24 oct. (statut retiré) : ne pas s'en occuper, sauf si une spec du chantier en dépend.

## Agent « jeux » : la revanche des quatre jeux, et le dé des petits chevaux

La demande d'Andréa (26 oct.) : « j'ai l'impression que quand une partie est terminée, ça ne se relance pas directement. Je parle par exemple des
petits chevaux, les échecs, puissance 4, etc. Juste vérifie bien ça. J'ai l'impression que ça galère un peu. Et augmente dans les petits chevaux,
augmente très légèrement le taux de chance de tomber sur un 6 lorsque je n'ai aucun cheval sur la map. […] Si j'ai une chance sur 6, là tu vas faire
en sorte que j'ai deux chances sur 6 de tomber sur le numéro 6. Ça permet d'éviter d'avoir des parties qui traînent en longueur. »

Ce qui existe : les règles pures partagées `packages/shared/src/games/<jeu>/` (chess, backgammon, connect4, ludo ; `registry.ts`, `protocol.ts`,
`rng.ts`, `conformance.ts` qui rejoue une partie depuis son journal) ; le serveur qui fait foi `apps/server/src/games/games-service.ts` (tables,
chaises, `ready`, `startIfAllReady`, `finish` : à la fin, les joueurs restent assis, pas prêts ; la revanche, c'est tous de nouveau prêts) ; le client
`apps/client/src/games/` (`GameFrame.tsx`, `GameLobby.tsx` : « Prêt » devient « Revanche » après une partie, `GamePanel.tsx`). Les e2e
`e2e/jeux-*.spec.ts` et leurs aides (`e2e/jeux-helpers.ts`, `window.__office.debugGame`, dans le build e2e). La spec des jeux :
`docs/superpowers/specs/2026-10-22-jeux-regles-et-integration.md`.

Ce qu'il faut (plan, chantier 4 et D6) :
1. **Vérifier la revanche, jeu par jeu**, en vrai : deux joueurs (deux contextes headless, ou les aides des e2e), une partie menée jusqu'à sa fin
   (`debugGame` pour aller vite, ou un abandon), puis la revanche demandée des deux côtés. Pour chacun des quatre jeux : est-ce que ça repart ? tout de
   suite ? faut-il recharger, se relever, cliquer deux fois ? l'écran de fin cache-t-il le bouton ? un siège est-il perdu ? un délai bloque-t-il ?
   Méthode du skill `superpowers:systematic-debugging` : reproduire, trouver la cause, puis corriger.
2. **Corriger** ce qui coince, avec un test qui l'aurait vu. La règle ne change pas : une revanche commence quand **tous** les joueurs assis l'ont
   acceptée. Mais elle doit être immédiate et lisible : le bouton « Revanche » visible au bout de la partie ; on voit qui l'a acceptée et qui on
   attend ; dès que tous l'ont acceptée, la partie repart à l'instant. Si rien n'est cassé, le dire avec ce qui a été essayé, et améliorer seulement
   ce qui rend la revanche lente ou peu claire.
3. **Le dé des petits chevaux** : quand le joueur qui lance n'a **aucun cheval sur le plateau** (tous ceux qui lui restent sont à l'écurie ; ceux
   arrivés au bout ne comptent pas — la même condition que les « trois essais pour faire un 6 »), le dé fait 6 avec une probabilité de **2/6** ; les
   cinq autres faces se partagent le reste également (4/30 chacune). Avec au moins un cheval sur le plateau, le dé reste juste (1/6). Le tirage se fait
   **dans les règles partagées**, à partir des valeurs du générateur, pour qu'une partie se rejoue toujours à l'identique depuis son journal
   (`conformance.ts`) ; les dés imposés des tests (`forcedRolls`, `rngFromDice`) donnent toujours la valeur demandée. La règle affichée
   (`apps/client/src/games/ludo/fr.ts`) le dit en une phrase.

Tests : la loi du dé (générateur déterministe, quelques milliers de tirages au plus, et la conformance du jeu), la revanche côté serveur pour chaque
jeu, le client s'il change. E2E : les specs `jeux-*.spec.ts` touchées ou qui couvrent la revanche. Les e2e qui choisissaient encore « Ne pas déranger »
(`jeux-plateforme.spec.ts`, entre autres) sont cassés depuis le 24 oct. : si une spec lancée en dépend, la réparer (un mode qui ferme sa porte, comme
Concentration, joue ce rôle pour les invitations).

## Agent « devant » : décorer devant sa pièce

La demande d'Andréa (26 oct.) : « j'aimerais pouvoir mettre des éléments sur le mur extérieur de ma room. C'est-à-dire qu'il y a ma room personnelle,
je veux pouvoir mettre des choses uniquement sur mon mur, mais à l'extérieur et sur la première case devant ma room, que ce soit pour celle du bas que
celle du haut. Par exemple, je veux pouvoir mettre l'horloge devant ma room, je veux pouvoir mettre un pot de fleurs différent devant ma room. »

Ce qui existe :
- La carte `packages/shared/src/map/office.ts` (81 × 46 cases de 32 px ; les murs horizontaux sont des bandes de 2 cases, dont on voit la face sud).
  Les six bureaux : A1, A2, A5 en haut (pièce y 2 à 8, porte au sud dans la bande y 9-10, sur la rue nord y 11-14) ; A3, A4, A6 en bas (pièce y 17 à
  23, porte au nord dans la bande y 15-16 ; leur bande sud y 24-25 donne sur la rue sud y 26-29). Les pièces font 9 × 7 (A1 à A4) ou 6 × 7 (A5, A6).
  Les occupants repeignent les murs de leur pièce (`OfficeDeskSlot.walls`). Sur la face de la bande sud de A2 : l'interrupteur de la lumière (zone
  `switch`, x 28, y 10). Les panneaux de sortie (`mu-14-111-m` en x 1, y 11 et y 26). Des arbustes, des fontaines et un banc posés dans la rue juste
  sous ces bandes (le tableau `at([...])` des rues, vers la ligne 294). La plaque du bureau (« Libre » ou le nom de l'occupant) près de chaque porte :
  la garder visible.
- La déco d'une pièce : `packages/shared/src/decor/placement.ts` (`DeskRoomSpec`, `checkDecor`, `footprintOf`, `blockedCells`, `furnitureTiles`,
  `doorEntryCells`, `defaultDeskDecor`, `MAX_DECOR_ITEMS` = 80) : coordonnées en cases de la pièce, au dixième près ; un élément mural se pose à
  `y = 0` (dessiné sur la bande du dessus) ; deux éléments de la même sorte ne se chevauchent pas. Le serveur vérifie (`apps/server/src/desks/`), le
  client dessine (`apps/client/src/game/decor-layer.ts`, `decor-layout.ts`), l'éditeur pose (`apps/client/src/game/decor-editor.ts`,
  `apps/client/src/office/DecorPanel.tsx`, `decor-cart.ts`). `furnitureTiles` sert à `spotNear`, à la marche automatique et à « Suivre » ; vérifier
  aussi les collisions du client.

Ce qu'il faut (plan, chantier 5, D3 et D4) :
1. **« Devant », c'est le côté sud de la pièce**, pour les six bureaux : la face extérieure de sa bande sud, et la première rangée de la rue juste
   dessous, **sur la largeur de la pièce** (pas les pans, rien chez le voisin).
2. Un codage simple (à confirmer en lisant le code) : dans les coordonnées de pièce, la rangée du dehors est `y = hauteur + 2` (la bande sud occupe
   `hauteur` et `hauteur + 1`). Un élément mural à `y = hauteur + 2` est dessiné sur la face de la bande sud ; un objet ou un tapis à
   `y = hauteur + 2` occupe la rangée de la rue. Une seule liste (`items`), la limite de 80 pour le tout. Un codage plus propre si le code le montre,
   en disant pourquoi.
3. **Les règles du dehors** (dans `checkDecor`, avec des tests) : sur la rangée, seulement ce qui tient sur une case de profondeur (`claim` ≤ 1, `y` pile
   sur la rangée) ; un élément mural extérieur d'au plus 2 cases de haut, qui ne recouvre ni la porte (bureaux du haut), ni l'interrupteur, ni un
   panneau de sortie, ni la plaque du bureau (obstacles décrits depuis la carte, pas en dur dans la règle) ; rien de solide sur les cases de la rue
   juste devant la porte (`blocks_door`) ; rien entre deux rangées.
4. **La marche** : les meubles solides du dehors bloquent la rue comme ceux du dedans (`furnitureTiles`, collisions du client), pour tout le monde ;
   téléportation, « Rejoindre », marche automatique et « Suivre » les contournent.
5. **Le rendu** : tout le monde voit le dehors, à la bonne profondeur. La face de la bande sud prend déjà la couleur du mur de l'occupant : le vérifier.
6. **L'éditeur** : depuis le panneau Décor, on pose dehors comme dedans (la rangée et le mur du dehors s'éclairent au survol) ; seulement devant **sa**
   pièce.
7. **La carte libère ces rangées** (D4) : ce qu'elle posait sur la rangée devant une pièce (x dans la largeur de la pièce, y 11 en haut, y 26 en bas)
   sort de la carte et entre dans la déco par défaut du dehors (`defaultDeskDecor`, par taille de pièce ; au moins une plante devant chaque pièce
   libre). Une pièce déjà décorée commence avec un dehors vide. Les panneaux de sortie et l'interrupteur restent à la carte. Régénérer
   (`pnpm --filter @bureau/client gen:map`, `apps/client/public/assets/maps/office.json`) et lancer `pnpm --filter @bureau/server map:check`.
8. Une déco qui suit son occupant dans un bureau de l'autre rangée : le dehors suit les mêmes règles que le dedans (`decorUnfit` si elle ne tient plus).

Tests : `packages/shared` (place du dehors, porte, interrupteur, panneaux, profondeur d'une case, marche), le serveur, le client (éditeur, calque).
E2E : `e2e/personnalisation.spec.ts` (un cas : un pot devant sa pièce), et ce qui casserait à cause de la carte. L'agent « noirs » touche en même temps
au jeu de tuiles et à l'onglet « Murs et sol » de `DecorPanel.tsx` : ne pas y toucher ; `office.json` sera recalculé après la réunion.

## Agent « noirs » : des sols et des murs noirs, et les listes rangées par couleur

La demande d'Andréa (26 oct.) : « j'aimerais que tu débloques plusieurs nouveaux skins de sol et de mur que tu débloques de manière gratuite avec aucune
animation, mais c'est des murs noirs et un sol noir uni, mais avec différentes textures. Ça veut dire par exemple un bois noir, un sol type tapis noir,
et un sol type carrelage noir, et un sol uni mat noir. Voilà, et ça on peut imaginer le ranger un petit peu mieux pour les murs et le sol, […] plutôt
par couleur. Par exemple, pour la couleur blanche, je vais avoir plusieurs types de textures, carrelage, briques, etc. Pour la couleur rouge, il n'y en
a qu'une, pour la couleur X ou Y, voilà. […] un petit sélecteur de texture pour voir tous les différents items possibles. »

Ce qui existe :
- Le jeu de tuiles est généré : `apps/client/scripts/assets/tileset.ts` (avec `pack.ts` pour le pack LimeZu, `shop-walls.ts` pour les murs de la
  boutique, `tile-motion.ts` et `theme-motions.ts` pour les murs qui bougent), par `pnpm --filter @bureau/client gen:assets` ; il écrit
  `apps/client/public/assets/tiles/office.png` (16 colonnes de cases de 32 px, 318 tuiles) et `packages/shared/src/decor/generated-themes.ts`
  (`FLOOR_THEMES`, `WALL_THEMES`, `SHOP_WALL_THEMES` avec un prix, `TILE_ANIMATIONS`). Les thèmes : `packages/shared/src/decor/themes.ts`. Les tests du
  pipeline : `apps/client/scripts/assets/pipeline.test.ts`.
- L'onglet « Murs et sol » : `apps/client/src/office/DecorPanel.tsx` (trois grilles de pastilles ; `FloorSwatch`, `WallSwatch`), son test
  `DecorPanel.test.tsx`, les textes dans `apps/client/src/i18n/fr.ts` (`fr.decor`).
- Depuis le 24 oct. (1ce9eab), **seuls les murs de la boutique bougent** ; les sols et murs gratuits sont fixes.

Ce qu'il faut (plan, chantier 6 et D5) :
1. **Quatre sols noirs** : Bois noir, Moquette noire, Carrelage noir, Noir mat. **Quatre murs noirs** : Noir mat, Lambris noir, Brique noire, Carrelage
   noir. Gratuits (dans `FLOOR_THEMES` et `WALL_THEMES`), **fixes**. D'abord chercher ces matières en noir dans le pack LimeZu ; sinon les tirer des
   tuiles existantes (parquet, moquette, carrelage, brique, un aplat pour le mat), assombries vers le noir en gardant le grain lisible. Un mur a ses
   trois tuiles (haut, bas de la face, pan) cohérentes.
2. **Aucune tuile existante décalée** : les nouvelles à la fin du jeu de tuiles (la carte, `TILE_ANIMATIONS` et tout numéro cité restent justes).
   Régénérer ce qui dépend du nombre de tuiles (`office.json` s'il le cite).
3. **Une couleur et une matière pour chaque sol et chaque mur**, boutique comprise (données partagées, typées, avec un test qui vérifie que chaque thème
   en a). Familles de couleur simples (blanc, crème, beige, gris, noir, brun, rouge, rose, orange, jaune, vert, bleu, violet, « multicolore » pour les
   motifs) et matières simples (uni, bois, carrelage, pierre, béton, moquette, brique, motif), ajustées à ce qui existe.
4. **L'onglet « Murs et sol »** : chaque liste (sols, puis murs) **rangée par couleur** (un titre avec la pastille de la couleur, puis les pastilles de
   ses matières), dans un ordre fixe ; au-dessus, un **sélecteur de matière** (Toutes, puis les matières qui existent) qui filtre les deux listes (une
   couleur sans rien dans cette matière disparaît). Les murs de la boutique rangés à leur couleur, avec cadenas et prix. Nom au survol et au lecteur
   d'écran ; panneau compact, utilisable au clavier.
5. Le serveur accepte les nouveaux thèmes (mêmes listes) ; rien à migrer.

Tests : le pipeline des tuiles (nouvelles tuiles, anciens numéros inchangés), les thèmes (couleur et matière partout), le panneau (rangement, filtre,
choix d'un sol noir). E2E : `e2e/personnalisation.spec.ts` si un cas simple s'y prête. L'agent « devant » touche en même temps à
`decor/placement.ts`, à l'éditeur, au calque du décor, à la carte et à la partie « éléments » de `DecorPanel.tsx` : ne pas y toucher ; `office.json`
sera recalculé après la réunion.
