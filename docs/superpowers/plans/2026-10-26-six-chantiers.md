# Six demandes du 26 octobre 2026 — plan et suivi

> Ce document est le suivi du chantier : je le mets à jour à chaque étape (qui fait quoi, ce qui est fini, ce qui est vérifié). Le tableau « Où on en
> est » dit l'état du moment ; le journal, en bas, garde l'histoire.

**La demande, en bref :** se confier une mission à soi-même ; un tapis de course dans sa pièce, sur lequel le mode Sport peut nous poser à la place de la
salle de sport ; une caméra qui peut déborder de 10 cases au-delà de la carte ; des parties qui se relancent bien, et plus de 6 aux petits chevaux quand on
n'a aucun cheval sur le plateau ; décorer le mur extérieur de sa pièce et la case devant ; des sols et des murs noirs gratuits, et les sols et les murs
rangés par couleur, avec un sélecteur de matière.

## Où on en est

**Dernière mise à jour : 26 oct., 18 h 46 (heure de la machine ; les heures du journal avant la reprise étaient estimées, en avance d'une dizaine
de minutes) — les six chantiers sont réunis dans le dossier principal et vérifiés, sans commit : il ne manque que ton feu vert.**

| # | Chantier | Qui | État |
|---|---|---|---|
| 1 | Se confier une mission à soi-même | session principale, dans le dossier principal | vérifié (tests, e2e `accueil`, vu dans le bac à sable) |
| 2 | Le mode Sport sur son tapis de course | agent « tapis » (deux agents de suite) | vérifié (tests, e2e `modes` 3/3, vu dans le bac à sable après la réunion) |
| 3 | La caméra déborde de 10 cases | session principale, dans le dossier principal | vérifié (tests, e2e `camera`, vu dans le bac à sable) |
| 4 | Jeux : la revanche, et le 6 aux petits chevaux | agent « jeux » (deux agents de suite) | vérifié (tests, les cinq e2e `jeux-*` : 25/25 ; la revanche vue par l'agent à deux navigateurs) |
| 5 | Décorer devant sa pièce | agent « devant », fini par la session principale | vérifié (tests, e2e `personnalisation`, vu dans A2 et A4) |
| 6 | Sols et murs noirs, rangés par couleur | agent « noirs », fini par la session principale | vérifié (tests, e2e `personnalisation`, vu dans A4) |
| — | Tout réunir, tester, vérifier à l'œil | session principale | fait (typecheck ; 5 122 tests unitaires ; 44 tests e2e ; README et décisions) |
| — | Ton feu vert, puis un seul commit (et le push si tu le veux) | toi | fait : D1 à D6 validés le 26 oct. à 18 h 52, un seul commit au titre neutre ; pas de push |

## Reprendre ici (pour la session qui reprend)

**Depuis la reprise (17 h 15, heure de la machine) :** les chantiers 5 et 6 sont **réunis dans le dossier principal et vérifiés** (le dossier
principal est indexé par `git add -A`, toujours sans commit) : il ne faut plus réunir les worktrees « devant » et « noirs ». « tapis » et « jeux » ont
été relancés sur leur worktree existant ; s'ils se sont arrêtés à leur tour, leur état est encore dans leur fichier d'état. Ce qui suit décrit la
situation de 17 h 25, avant la reprise : les étapes 1 à 3 de « Ce qui reste à faire » ne valent plus que pour « tapis » et « jeux ».

**Où sont les choses, le 26 oct. à 17 h 25**
- **Le dossier principal** (`main`, 42917f0, rien de commité) contient, non commités, les chantiers 1 et 3 finis et ce plan : `README.md`,
  `docs/decisions.md` (deux sections ajoutées à la fin : « Se confier une mission à soi-même », « La caméra au bord de la carte »),
  `apps/client/src/audio/sfx-events.ts`, `apps/client/src/game/scenes/Office.ts`, `apps/client/src/game/zoom.ts` (+ test),
  `apps/client/src/i18n/fr.ts`, `apps/client/src/office/ClerkDialog.tsx` (+ test), `QuestPanel.tsx` (+ test), `progress-announcements.tsx`,
  `apps/server/src/progress/progress-routes.ts`, `progress-service.ts`, `apps/server/src/realtime/handlers.ts`, `apps/server/test/progress-service.test.ts`,
  `realtime-progress.test.ts`, `packages/shared/src/progress/protocol.ts`, et les fichiers de ce dossier (`docs/superpowers/plans/2026-10-26-*`). **Ne
  pas les défaire.**
- **Les quatre agents** travaillaient chacun dans son worktree, sans commit (les changements ne sont que dans le dossier de travail) :

  | Agent | Worktree (sous `/Users/andreagauvreau/Tools/bureau-virtuel/.claude/worktrees/`) | Son état écrit, **dans son worktree** |
  |---|---|---|
  | « tapis » | `agent-afca37ed86fb60ba3` | `docs/superpowers/plans/2026-10-26-etat-tapis.md` |
  | « jeux » | `agent-a15cecbd58489706b` | `docs/superpowers/plans/2026-10-26-etat-jeux.md` |
  | « devant » | `agent-a8916c1ea0b969041` | `docs/superpowers/plans/2026-10-26-etat-devant.md` |
  | « noirs » | `agent-aec63d247d1106802` | `docs/superpowers/plans/2026-10-26-etat-noirs.md` |

  À 17 h 20, je leur ai demandé d'écrire leur état (ce qui est fait, ce qui reste, les tests, les choix) et d'y mettre leur rapport final quand ils
  ont fini. L'outil leur interdit d'écrire hors de leur worktree : le fichier d'état est **dans le worktree**, au chemin relatif ci-dessus (exemple :
  `.claude/worktrees/agent-a15cecbd58489706b/docs/superpowers/plans/2026-10-26-etat-jeux.md`). Ce fichier n'est pas à réunir avec le code : le
  retirer du patch (ou du dossier principal, une fois lu et reporté ici). Si la session a été coupée, les agents se sont sans doute arrêtés en route :
  leur travail reste dans leur worktree. Les worktrees sont verrouillés par l'outil des agents (`git worktree unlock <chemin>` avant de les retirer).

  **Déjà dit par l'agent « jeux » à 17 h 25 :** le serveur relance bien les quatre jeux tout de suite (60 à 95 ms) ; ce qui coince est à l'écran : le
  bouton « Revanche » est sous le pli à la fin, dans les quatre jeux ; on voit mal qui attend qui ; un second clic annule la revanche ; rien ne se passe
  quand le panneau est fermé. Le dé des petits chevaux (6 à 2/6 sans cheval en jeu) est fait et testé.
- **Leurs consignes exactes** (pour relancer un agent) : [`2026-10-26-six-chantiers-briefs.md`](2026-10-26-six-chantiers-briefs.md), avec leurs
  ports et leurs numéros de migration.
- **Le bac à sable** de la session en pause : API sur le port 4300 (`memory://`), Vite sur le 5273. S'ils tournent encore, ce sont les siens : on peut
  les arrêter. Le PM2 d'Andréa ne fait pas tourner bureau-virtuel en ce moment (rien sur 3056 et 3057) ; ne jamais tuer ses processus PM2.
- Hors de ce chantier : le worktree `.claude/worktrees/determined-chebyshev-9b4fce` (branche `claude/determined-chebyshev-9b4fce`, déjà fusionnée
  dans `main`) n'est pas à nous : ne pas y toucher.

**Ce qui reste à faire, dans l'ordre**
1. **Pour chaque agent** : lire son fichier d'état. S'il y a mis son rapport final, son chantier est fini. Sinon, regarder son worktree
   (`git -C <worktree> status`, `git -C <worktree> diff --stat`) et relancer un agent dessus, avec le cadre commun et son chantier
   (fichier des consignes), en lui disant de **reprendre le travail déjà fait** dans ce worktree.
2. **Récupérer leur travail sans commit**, un patch par worktree, sans le fichier d'état :
   `git -C <worktree> add -A && git -C <worktree> diff --cached --binary -- . ':!docs/superpowers/plans' > <nom>.patch` (les worktrees partagent les
   objets du dépôt : les blobs du patch sont connus du dossier principal).
3. **Réunir dans le dossier principal** : `git add -A` (on indexe, on ne commite pas : `git apply --3way` le demande), puis
   `git apply --3way --binary <nom>.patch`, dans l'ordre jeux, tapis, devant, noirs. Conflits attendus : `packages/shared/src/index.ts` (tapis et noirs
   y ajoutent des exports), `packages/shared/src/protocol.ts`, `apps/client/src/i18n/fr.ts`, `apps/client/src/game/decor-layer.ts`,
   `apps/client/src/office/DecorPanel.tsx`, `apps/client/public/assets/maps/office.json` (et `dev-office.json`).
4. **Recalculer les fichiers générés**, une fois tout réuni : `pnpm --filter @bureau/client gen:assets`, puis `pnpm --filter @bureau/client gen:map`,
   puis `pnpm --filter @bureau/server map:check` ; vérifier qu'aucune tuile ancienne n'a changé de numéro.
5. **Tester** : `pnpm typecheck` ; `pnpm test` (la suite complète, ~4 min, en arrière-plan) ; puis les specs e2e une à une, `--workers=1`
   (jamais deux Playwright sur les mêmes ports) : `accueil`, `camera`, `modes`, `personnalisation`, `jeux-ludo`, `jeux-chess`, `jeux-connect4`,
   `jeux-backgammon`, `jeux-plateforme` (cassée depuis le 24 oct. si elle choisit encore « Ne pas déranger »).
6. **Vérifier à l'œil** chaque point dans un bac à sable (`SIM=1 MAP_KEY=office DATABASE_URL=memory://`, compte de test du faux live) : « Moi » chez
   l'administratrice ; la caméra au bord ; le tapis (le choix, la course, la descente) ; une revanche de chaque jeu ; une horloge et un pot devant un
   bureau du haut et un du bas ; les sols et murs noirs et le rangement par couleur.
7. **Écrire** le README et `docs/decisions.md` pour les chantiers 2, 4, 5, 6 (les agents donnent leur texte dans leur rapport, dans leur fichier
   d'état) ; reporter leur état dans ce plan (cases à cocher, journal). Les fichiers d'état restent dans les worktrees, qui partiront avec eux.
8. **Montrer** la version à jour à Andréa. **Sur son feu vert seulement** : un seul commit de l'ensemble, au **titre neutre** (aucun titre de commit
   ne parle de missions, d'XP, de niveaux, de boutique ni de monnaie : c'est une surprise pour ses collègues), puis le push s'il le demande ; ensuite
   retirer les quatre worktrees et leurs branches `worktree-agent-*`.

Les états : **à faire** → **en cours** → **fait** (codé et testé de son côté) → **réuni** (dans le dossier principal, avec le reste) → **vérifié** (vu
tourner dans le bac à sable).

## Comment je m'organise

- Quatre agents en parallèle (2, 4, 5, 6), chacun dans son worktree, avec ses ports, sans commit. Pendant ce temps, je fais les deux petits chantiers (1
  et 3) dans le dossier principal.
- Quand ils ont fini, je réunis leurs changements dans le dossier principal, toujours sans commit, puis : le typecheck de tout le dépôt, la suite unitaire
  complète (en arrière-plan), les specs e2e touchées (une à la fois), et un tour dans le bac à sable pour chaque point.
- Pendant le travail, des tests ciblés seulement ; les suites complètes, une fois, à la fin. Pas de fuzz ni de longues mesures.
- Rien n'est commité ni poussé avant ton feu vert : un seul commit de l'ensemble, au titre neutre.

## Choix par défaut à valider (validés par Andréa le 26 oct. à 18 h 52)

- **D1. L'XP d'une mission qu'on se donne** est la même que celle d'une mission confiée, comme demandé (« c'est comme maintenant ») : on peut donc monter de
  niveau seule, sans complice. C'est la question du plafond des missions, déjà ouverte. Si tu veux un garde-fou : un plafond par jour pour les missions
  qu'on se donne, comme pour ses propres tâches.
- **D2. Seulement le « Tapis de course »** du décor (`gy-10-30`), celui dont le pack a l'animation ; pas le tapis « vue de dessus », ni les autres
  appareils.
- **D3. « Devant sa pièce », c'est son côté sud**, pour les six bureaux : la face extérieure du mur sud, que l'on voit de la rue, et la rangée de la rue
  juste dessous. Pour les bureaux du haut, c'est le côté de la porte (rue nord) ; pour ceux du bas, le mur qui donne sur la rue sud, car du côté de leur
  porte la face du mur est l'intérieur de la pièce (elle se décore déjà de l'intérieur). Si tu voulais aussi le côté porte pour les bureaux du bas, seule
  la rangée de la rue y serait possible (sans mur).
- **D4. Les plantes, fontaines et bancs que la carte posait devant les bureaux** deviennent la déco du dehors par défaut : les pièces libres et celles qui
  n'ont jamais été décorées les gardent ; une pièce déjà décorée commence avec un dehors vide.
- **D5. Des murs noirs aussi** (quatre matières), pas seulement des sols.
- **D6. La revanche reste acceptée par tous les joueurs** : personne n'est relancé dans une partie sans le vouloir ; ce qui la rend lente ou cassée, lui,
  est corrigé.

## 1. Se confier une mission à soi-même

**La demande :** pouvoir s'attribuer une mission, pas seulement en recevoir une. Le reste ne change pas : on passe toujours par une administratrice de
l'accueil, on choisit pour qui (soi compris), l'intitulé et la difficulté.

**Ce que je fais :**
- Dans le dialogue de l'administratrice, **« Moi »** en tête de la liste des personnes.
- Le serveur accepte une mission pour soi (il la refusait : `self`). Elle arrive dans sa liste **déjà vue** : pas de pastille « nouvelle », pas d'annonce
  « on t'a confié une mission », pas d'avis « elle est faite » envoyé à soi-même.
- Elle rapporte l'XP de sa difficulté (D1).
- Dans le panneau Missions, « Celles que j'ai confiées » ne la montre pas une deuxième fois ; dans les caractéristiques, elle compte dans les missions
  faites, pas dans les missions confiées.

**Fichiers :** `apps/server/src/progress/progress-service.ts`, `packages/shared/src/progress/protocol.ts`, `apps/client/src/office/ClerkDialog.tsx`,
`QuestPanel.tsx`, `i18n/fr.ts`, leurs tests, `e2e/accueil.spec.ts`.

**Fini quand :**
- [x] on se choisit dans la liste, et la mission arrive dans sa propre liste ;
- [x] ni pastille « nouvelle », ni annonce, ni avis pour soi-même ;
- [x] la faire rapporte l'XP de sa difficulté ;
- [x] les tests du service et du dialogue sont à jour et verts (6 fichiers, 116 tests, dont le temps réel ; typecheck vert) ;
- [x] vu en vrai dans le bac à sable (« Moi » en tête chez Inès ; « Ta propre mission » dans « Missions reçues », sans toast ni pastille).

**Fait aussi :** une mission qu'on s'est donnée s'**abandonne** au lieu de se rendre (« Ta propre mission », « Abandonner »,
« Abandonnée ») ; « Ta liste est pleine » au lieu de « Sa liste est pleine » quand c'est la sienne.

## 2. Le mode Sport sur son tapis de course

**La demande :** avec un tapis de course dans sa pièce, le mode Sport propose d'aller directement sur son tapis au lieu de la salle de sport ; on la
voit courir, le tapis tourne. Seulement pour le tapis de course.

**Ce que fait l'agent :**
- Le « Tapis de course » du décor (`gy-10-30`, 2 × 3 cases) : c'est celui dont le pack a l'animation (`props/treadmill.png`, 12 images, la console au
  nord, la bande vers le sud) (D2).
- Dans le menu « Moi », prendre un mode qui mène à la salle de sport (Sport) quand sa pièce a un tapis : deux choix, **Salle de sport** ou **Mon tapis de
  course**. Sans tapis : comme aujourd'hui.
- Sur le tapis : le serveur la pose sur la bande, tournée vers la console ; tout le monde la voit courir sur place et la bande défiler ; les interrupteurs
  du mode s'appliquent comme à la salle (pour Sport : ni entendre ni être entendue).
- Elle descend sur la case libre au sud du tapis quand elle quitte le mode, ou dès qu'elle se déplace (le mode reste, comme quand on sort à pied de la
  salle de sport). Jamais coincée dans le meuble, même après une reconnexion, ou si le tapis est retiré de la pièce.

**Fini quand :**
- [x] le choix n'apparaît qu'avec un tapis de course dans sa propre pièce (« ↳ Mon tapis de course » sous la ligne du mode ; `MeMenu.test.tsx`) ;
- [x] sur le tapis, on court sur place et la bande défile, pour soi comme pour les autres (captures de l'agent ; e2e : Bastien voit le tapis
  tourner) ;
- [x] descendre (une touche, un autre mode, Disponible) pose devant le tapis, jamais dedans (tests du serveur, e2e ; le tapis retiré, la reconnexion
  et le redémarrage seulement en tests du serveur) ;
- [x] la salle de sport marche comme avant (les deux tests d'avant de `modes.spec.ts`) ;
- [x] les tests du serveur (voyage du mode) et du client sont à jour et verts.

**La cause, le choix :** l'agent a pris une ligne de plus sous celle du mode, plutôt que deux sous-lignes ; c'est le navigateur qui fait descendre
l'avatar (à la case que le serveur choisirait), pour qu'une touche fasse descendre et repartir dans la même image ; la course est la marche vers le
haut, plus vive (le pack n'a pas d'animation de course). Le détail : `docs/decisions.md`, « Le mode Sport sur son tapis de course ».

## 3. La caméra déborde de 10 cases

**La demande :** la caméra peut aller jusqu'à 10 cases au-delà du bord du monde, pour qu'en haut de la carte l'avatar ne passe pas sous l'interface.

**Ce que je fais :** sur un axe où la carte est plus grande que la vue, les bornes de la caméra s'élargissent de 10 cases (320 px) de chaque côté ;
au-delà de la carte, on voit le fond sombre. Une carte plus petite que la vue reste centrée, comme aujourd'hui. Le suivi de l'avatar, le glisser à la
souris et le zoom en profitent.

**Fichiers :** `apps/client/src/game/zoom.ts` (`cameraBounds`), `scenes/Office.ts`, `camera-drag.ts`, leurs tests, `e2e/camera.spec.ts`.

**Fini quand :**
- [x] en haut (et sur chaque bord) de la carte, l'avatar reste au milieu de l'écran jusqu'à 10 cases du bord (vu dans le bac à sable,
  dans le coin nord-ouest) ;
- [x] pas au-delà ;
- [x] les tests des bornes sont à jour et verts (`zoom.test.ts`, 49 tests).

**Choix en route :** sur un axe où la carte tient tout entière à l'écran (de loin), elle reste centrée, sans débord : toute la carte est
déjà visible.

## 4. Jeux : la revanche, et le 6 aux petits chevaux

**La demande :** vérifier qu'une partie finie se relance bien (petits chevaux, échecs, puissance 4…) ; aux petits chevaux, sans cheval sur le plateau,
deux chances sur six de faire un 6.

**Ce que fait l'agent :**
- Jouer une fin de partie de chacun des quatre jeux à deux, demander la revanche des deux côtés, noter ce qui coince ; trouver la cause, la corriger, et
  ajouter le test qui l'aurait vue.
- Sans changer la règle (une revanche se joue quand tous les joueurs l'ont acceptée, D6), la rendre immédiate et lisible : le bouton au bout de la
  partie, qui attend qui.
- Petits chevaux : quand aucun de ses chevaux n'est sur le plateau (tous à l'écurie ; ceux qui sont arrivés ne comptent pas), le dé fait 6 **une fois sur
  trois** (2/6), les autres faces se partagent le reste ; dès qu'un cheval est sur le plateau, le dé redevient juste (1/6). Le tirage reste dans les
  règles partagées (une partie se rejoue toujours depuis son journal), et la règle affichée le dit.

**Fini quand :**
- [x] la revanche des quatre jeux repart dès que tous l'ont acceptée, sans recharger ni se relever (elle le faisait déjà : 52 à 95 ms ; un test
  serveur avec les quatre vrais jeux le garde) ;
- [x] la cause de ce qui coinçait est écrite ici, avec le test qui la garde (voir ci-dessous) ;
- [x] le 6 sort à 2/6 sans cheval sur le plateau, à 1/6 sinon (test des règles) ;
- [x] les tests des jeux sont à jour et verts (unitaires ; les e2e des jeux n'ont tourné qu'en partie, voir le journal).

**Ce qui coinçait :** l'écran, pas le serveur. Le bouton « Revanche » vivait dans la salle d'attente, rendue sous le plateau : à la fin d'une partie,
il était entre 740 et 992 px pour un panneau qui s'arrête vers 710 px (aux échecs et aux petits chevaux, même la phrase de fin était cachée) ; qui
attend qui n'était pas dit ; l'état enfoncé ne se voyait presque pas (un second clic annulait sans qu'on le voie) ; panneau fermé, rien ne prévenait.
Les e2e ne le voyaient pas : Playwright fait défiler jusqu'au bouton avant de cliquer. Corrigé par une barre « Revanche » juste sous la phrase de
fin, que le panneau fait défiler pour la montrer, une phrase « qui attend qui », un état enfoncé visible, et un toast panneau fermé. Gardé par des
`toBeInViewport` dans les e2e des échecs, du Puissance 4 et du backgammon, et par les tests de `GameLobby`, `GamePanel`, `table-view`,
`InviteToast` et `games-match` (serveur).

## 5. Décorer devant sa pièce

**La demande :** poser des éléments sur le mur extérieur de sa pièce, et sur la première case devant, pour les bureaux du haut comme pour ceux du bas :
une horloge devant sa pièce, un autre pot de fleurs…

**Ce que fait l'agent (D3, D4) :**
- « Devant », c'est le côté sud de la pièce, celui que l'on voit de la rue : la face extérieure de son mur sud, et la rangée de la rue juste dessous, sur
  la largeur de la pièce.
- Sur le mur : les éléments muraux (horloges, cadres, panneaux…), jamais sur la porte, l'interrupteur de la lumière ni un panneau de sortie.
- Sur la rangée : ce qui tient sur une case de profondeur (plantes, pots, bancs, lampadaires…) et les tapis ; rien de solide devant la porte.
- Le même éditeur qu'à l'intérieur, la même limite (80 éléments en tout). Le serveur vérifie tout ; les meubles solides du dehors arrêtent la marche comme
  ceux du dedans (collisions, marche automatique, téléportations).
- Ce que la carte posait sur ces bandes devient la déco du dehors par défaut.

**Fini quand :**
- [x] on pose une horloge sur le mur extérieur et un pot sur la case devant, dans un bureau du haut et dans un bureau du bas (vu dans le bac à
  sable, dans A2 et dans A4, et vu de la rue) ;
- [x] la porte, l'interrupteur et les panneaux de sortie restent libres (`checkDecor`, testé ; l'interrupteur de A2 vu dégagé) ;
- [x] les autres voient le dehors, et butent sur ce qui est solide (le dehors voyage dans la même liste que le dedans ; `furnitureTiles` et la marche
  testés ; vu seulement par l'occupante, pas depuis un second navigateur) ;
- [x] les tests de la place (partagés), du serveur et de l'éditeur sont à jour et verts (et l'e2e « un pot devant sa pièce »).

## 6. Sols et murs noirs, rangés par couleur

**La demande :** des sols et des murs gratuits, sans animation, noirs, de matières différentes (bois noir, moquette noire, carrelage noir, noir mat
uni) ; ranger les sols et les murs par couleur (le blanc : carrelage, brique… ; le rouge : un seul…), avec un petit sélecteur de matière pour voir tout
ce qui existe.

**Ce que fait l'agent (D5) :**
- Quatre sols noirs : Bois noir, Moquette noire, Carrelage noir, Noir mat. Quatre murs noirs : Noir mat, Lambris noir, Brique noire, Carrelage noir.
  Gratuits, fixes, pris dans le pack s'il les a, sinon tirés des matières qui existent (le grain du parquet, de la moquette, du carrelage, de la brique)
  et assombris vers le noir.
- Chaque sol et chaque mur, ceux de la boutique compris, reçoit une couleur et une matière.
- L'onglet « Murs et sol » range chaque liste par couleur (un titre avec sa pastille, puis les matières de cette couleur), avec au-dessus un sélecteur de
  matière (Toutes, Uni, Bois, Carrelage, Moquette, Pierre, Brique, Motif…). Les murs de la boutique sont rangés à leur couleur, avec leur cadenas et leur
  prix.

**Fini quand :**
- [x] les huit noirs se posent dans sa pièce, gratuitement, sans bouger (le Bois noir et la Brique noire vus dans A4 ; la moquette noire dans l'e2e ;
  les huit dans `theme-looks.test.ts`) ;
- [x] les listes sont rangées par couleur, et le sélecteur de matière filtre (vu, et e2e) ;
- [x] aucune tuile existante n'a changé de numéro (comparées pixel par pixel ; `gen:assets` refait à l'identique après la réunion) ;
- [x] les tests du jeu de tuiles et du panneau sont à jour et verts.

## Réunir et vérifier

- [x] les changements des quatre agents réunis dans le dossier principal (sans commit), les fichiers générés recalculés une fois tout réuni ;
- [x] `pnpm typecheck` vert ;
- [x] `pnpm test` (la suite unitaire complète) vert (275 fichiers, 5 122 tests) ;
- [x] les specs e2e touchées (accueil, camera, modes, personnalisation, jeux) vertes, une à la fois, avec suivre, portes et lumiere (44 tests) ;
- [x] chaque point vu dans le bac à sable (1, 3, 5, 6 et 2 par moi ; la revanche de 4 par l'agent, à deux navigateurs, et par l'e2e) ;
- [x] le README et `docs/decisions.md` à jour ;
- [x] ton feu vert, puis un seul commit.

## Journal

- **26 oct., 16 h 30** — Lecture du code des six zones ; bac à sable lancé (API :4300, client :5273). Plan écrit. Je lance les quatre agents et je
  commence la caméra, puis les missions.
- **26 oct., 16 h 35** — Caméra faite : `cameraBounds` prend une marge (`CAMERA_MARGIN_TILES` = 10) ; vue dans le bac à sable (dans le coin
  nord-ouest, la caméra déborde dans le vide et l'avatar reste près du centre).
- **26 oct., 17 h 05** — Missions faites (serveur, protocole, dialogue de l'accueil, panneau Missions, annonces et sons) ; 116 tests verts sur
  les fichiers touchés, typecheck vert. README et `docs/decisions.md` à jour pour ces deux chantiers. J'attends les quatre agents.
- **26 oct., 17 h 15** — E2E `accueil.spec.ts` et `camera.spec.ts` verts (4 tests, 1,7 min).
- **26 oct., 17 h 25** — Andréa met la session en pause pour la reprendre sur un autre compte. Les quatre agents sont encore au travail ; je leur
  demande d'écrire leur état dans `docs/superpowers/plans/2026-10-26-etat-<nom>.md` (dans leur worktree : ils ne peuvent pas écrire ailleurs).
  Consignes des agents recopiées dans `2026-10-26-six-chantiers-briefs.md` ; la marche à suivre est dans « Reprendre ici ». L'agent « jeux » a déjà
  trouvé ce qui coince à la revanche (l'écran, pas le serveur) et fini le dé.
- **26 oct., 17 h 15 (heure de la machine, comme la suite)** — Reprise par une nouvelle session. Les quatre agents s'étaient arrêtés avec la session,
  aucun n'avait écrit son rapport final ; leur état est lu dans leur worktree. « tapis » (reste tout le client) et « jeux » (reste la revanche à
  l'écran, le test serveur des quatre jeux, `jeux-plateforme.spec.ts`) sont relancés, chacun sur **son worktree existant** (sans l'isolement de
  l'outil : consigne d'écrire seulement dedans, et d'attendre qu'aucun autre Playwright ne tourne avant leur e2e). Il ne restait à « devant » et
  « noirs » que les vérifications : je les finis moi-même, dans le dossier principal.
- **26 oct., 17 h 18** — « devant » et « noirs » réunis dans le dossier principal (`git apply --3way`, aucun conflit ; leurs cartes `office.json` et
  `dev-office.json` laissées de côté et recalculées). `gen:assets` refait à l'identique le jeu de tuiles des noirs (334 tuiles) ; `gen:map` refait
  `office.json` comme l'agent « devant », plus les deux nombres du jeu de tuiles ; `map:check` valide les deux cartes. Le typecheck trouvait trois
  erreurs de types dans leurs tests (ils ne l'avaient pas encore lancé) : corrigées. Typecheck vert ; tests ciblés des chantiers 1, 3, 5, 6 :
  64 fichiers, 1 445 tests verts. Ajouté à `e2e/personnalisation.spec.ts` le cas des noirs (le sélecteur « Moquette » puis « Brique », la moquette
  noire et la brique noire s'enregistrent, gratuites).
- **26 oct., 17 h 27** — E2E `personnalisation.spec.ts` vert : 8 tests (3,8 min), dont « un pot devant sa pièce » et le cas des noirs.
- **26 oct., 17 h 35** — Vu dans un bac à sable (le build e2e, `SIM=1 E2E=1`, :4300 ; captures headless, le panneau Browser étant caché) :
  « Moi » en tête chez Inès, la mission qu'on se donne dans « Missions reçues » (« Ta propre mission », Abandonner) sans toast ; une horloge sur le
  mur du dehors et un pot sur la rangée de la rue devant A2 (en haut) et devant A4 (en bas), à côté des plantes par défaut, l'interrupteur dégagé ;
  le Bois noir et la Brique noire dans A4, les murs rangés par couleur ; la caméra qui déborde au-dessus du café. README et `docs/decisions.md`
  écrits pour les chantiers 5 et 6. Suite unitaire complète lancée en arrière-plan.
- **26 oct., 17 h 45** — Suite unitaire complète : 5 045 tests verts, 1 en échec, `realtime-presence.test.ts` (« arrivée : init puis
  player:joined »), à cause de « devant » : l'agent avait fait de `DEFAULT_SETUP` (aide des tests serveur) le poste par défaut de A1 sur la grande
  carte, dehors compris, alors que ce test tourne sur la petite carte, dont les bureaux n'ont pas de dehors. Ajouté `DEV_DEFAULT_SETUP` (le poste de la
  pièce standard, sans dehors) pour ce test : `realtime-presence`, `realtime-desks` et `desks` verts (113 tests), typecheck du serveur vert.
- **26 oct., 18 h** — Rapport final de « jeux » (le second agent : la revanche à l'écran, le test serveur des quatre jeux, `jeux-plateforme.spec.ts`
  réparée avec « Concentration »). Ses e2e n'ont tourné qu'en partie : 11 verts, 3 tombés, 11 pas lancés ; les trois échecs sont dans `giveDeskBack`
  (l'avatar encore dans le couloir au bout de 60 s), pas dans les jeux. La machine est saturée (charge ~590 pour 14 cœurs) : **16 processus `yes`
  orphelins** (parent `launchd`, sans terminal) tournent depuis le 25 oct. à 22 h 49 et prennent ~9 cœurs ; sans doute laissés par la session qui
  reproduisait la lenteur de la CI. L'outil m'a refusé de les arrêter (ils ne sont pas à cette session) : à Andréa de décider. Réuni dans le dossier
  principal (30 fichiers, aucun conflit) ; typecheck vert ; 63 fichiers de tests des jeux verts (1 562 tests).
- **26 oct., 18 h 03** — Rapport final de « tapis » (le second agent : tout le client ; Vitest, typecheck et e2e `modes` 3/3 verts chez lui). Réuni
  (35 fichiers) : un seul conflit, un commentaire de `walkToDesk` dans `Office.ts` (« devant » et « tapis » l'avaient réécrit), les deux réunis ;
  `packages/shared/src/index.ts` a les deux exports. Typecheck vert. README (« Le mode Sport sur son tapis de course », « La revanche », le dé) et
  `docs/decisions.md` écrits depuis leurs rapports. Suite unitaire complète relancée.
- **26 oct., 18 h 12** — Suite unitaire complète, les six chantiers réunis : **275 fichiers, 5 122 tests verts** (6 sautés, comme avant). Vu dans un
  bac à sable (build e2e) : un tapis de course posé dans A1 à côté du poste par défaut ; « ↳ Mon tapis de course » sous « Sport · Salle de sport » ;
  sur le tapis, elle court et le tapis tourne (`treadmills()` = `A1:65:20`) ; une touche brève la fait descendre, le tapis s'arrête, le mode reste.
  À noter : la case juste au sud du tapis était le canapé du poste par défaut (traversable) : elle est descendue dessus (la règle prend la case libre
  la plus proche ; un siège n'arrête pas). Les captures des agents (la barre de la revanche, le toast, le menu, la course) montrent ce qui est attendu.
- **26 oct., 18 h 15** — E2E lancées, une fois, `--workers=1` : `accueil`, `camera`, `modes`, `personnalisation`, `suivre`, `portes`, `lumiere`
  (la rue et les bureaux ont changé) et les cinq `jeux-*`. La machine est toujours chargée par les 16 `yes`.
- **26 oct., 18 h 14** — Andréa arrête les 16 `yes` : les processus prennent ~950 % de CPU sur 1 400 %, au lieu de saturer.
- **26 oct., 18 h 17** — La session s'arrête pendant les e2e, et le run avec elle, au 14e test sur 44 : **13 verts** (`accueil` 2, `camera` 2,
  `lumiere` 1, `modes` 3 dont le tapis de course, `personnalisation` 5 dont les sols noirs) ; le 14e (« un clic dans la pièce pose l'élément
  tenu ») est marqué tombé au moment de l'arrêt, sans détail d'erreur. Reprise à 18 h 21 : le second serveur du run (port 3101, lancé par lui)
  est arrêté, et les specs pas finies sont relancées : `personnalisation` (en entier), `suivre`, `portes` et les cinq `jeux-*`.
- **26 oct., 18 h 29** — 24 verts (dont `personnalisation` 8/8 : le 14e d'avant avait donc été coupé par l'arrêt, `portes`, `jeux-plateforme`
  5/5, backgammon, échecs 3/3, petits chevaux 6/6), 3 tombés, 9 pas lancés (la suite du Puissance 4, en série). Trois causes, toutes dans les tests,
  qu'une machine soulagée fait apparaître :
  - `suivre`, le clic droit : la page de Bruno voyait encore Alice à l'accueil, d'où elle venait d'être téléportée (trace : `players[alice]` =
    1296, 720) ; le clic est parti hors de l'écran (1408, 810). Le test n'attendait que de la connaître. → il attend de la voir à sa nouvelle place.
  - `suivre`, l'invitation : Alice n'avait pas de bureau (ni « Aller à mon bureau » ni « Réglages ») : les six étaient pris. Chacun en reçoit un à sa
    première arrivée (`autoAssign`) ; les tests de déco gardent le leur, `portes` les deux siens, et les arrivants de `suivre`, qui n'en ont pas
    besoin, aussi. Les deux tests nouveaux (le pot devant sa pièce, les noirs) en prenaient deux de plus. → ces deux tests le rendent à la fin
    (`giveBack`) ; dans `suivre`, qui n'en a pas besoin le rend en arrivant (`giveDeskBack`), comme dans les autres specs.
  - Puissance 4 : deux boutons « Inviter Bastien » : le Bastien du dernier test des échecs, fini juste avant, reste 10 s dans le bureau après son
    départ (`DISCONNECT_GRACE_MS`). Sur la machine chargée, il était parti avant. → le test attend qu'il n'en reste qu'un.
  Relancés : `personnalisation`, `portes`, `suivre` et les cinq `jeux-*`.
- **26 oct., 18 h 44** — **36 verts sur 36** (8,8 min) : `personnalisation` 8, `portes` 1, `suivre` 2, `jeux-plateforme` 5, backgammon 1, échecs 3,
  Puissance 4 10, petits chevaux 6. Avec les 8 du premier passage (`accueil` 2, `camera` 2, `lumiere` 1, `modes` 3), les 44 tests des specs
  touchées sont verts. Les captures que les e2e des jeux écrivent dans `.superpowers/captures/` (non ignoré par git) sont déplacées hors du dépôt.
  Reste `.claude/launch.json`, apparu à 18 h 27, qui n'est pas de ce chantier : laissé hors du commit.
- **26 oct., 18 h 52** — Feu vert d'Andréa pour D1 à D6 : un seul commit de l'ensemble, au titre neutre (sans push). Après le commit, les quatre
  worktrees des agents et leurs branches `worktree-agent-*` sont retirés (leur travail est dans le commit ; leurs fichiers d'état, copiés hors du
  dépôt avant).

## Hors périmètre

- Les tapis de la salle de sport : le mode Sport y pose toujours à une place libre, comme aujourd'hui.
- Le plafond des missions (D1), tant que tu n'as pas tranché.
