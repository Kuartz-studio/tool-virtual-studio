# Les nouveautés : la fenêtre « Quoi de neuf ? »

À la première entrée au bureau après une mise à jour, une fenêtre dit à chacun ce qui a changé. On la revoit quand on veut depuis le menu « Moi ». Cette page dit comment elle marche, puis comment publier une version.

## Comment ça marche

### Le numéro de version

- La version se note **MAJEUR.MINEUR**, le mineur sur deux chiffres : 1.00, 1.01 … 1.09, 1.10 … 1.99, puis 2.00. Les numéros se comparent comme des nombres (1.10 vient après 1.09, et 10.00 après 9.99).
- La numérotation commence à la **1.00, le 29 octobre 2026**.
- La version en cours a une seule source : `CURRENT_RELEASE`, dans `packages/shared/src/releases.ts`. Le même fichier donne `compareReleases` (la comparaison) et `isReleaseBehind` (la personne a-t-elle encore des nouveautés à voir ?). Le client et le serveur lisent tous les deux ce numéro.

### Les notes

- Le texte des notes est dans le client : `apps/client/src/updates/releases.ts` (`RELEASES`), la plus récente d'abord. Chaque version a son numéro, sa date (`AAAA-MM-JJ`), une accroche (une phrase) et ses nouveautés. La fenêtre les range **par genre**, chacun sous son titre et dans cet ordre : *Nouveautés*, *Améliorations*, *Corrections*, et, rarement, *Suppressions* (`RELEASE_KINDS`, `groupsFor`). Un genre sans nouveauté n'a pas de titre.
- Une nouveauté a un **genre**, une **icône**, un **titre** et un **texte** :
  - `new` (groupe « Nouveautés », teinte de l'accent), `improved` (« Améliorations », vert), `fixed` (« Corrections », ambre), `removed` (« Suppressions », rouge : ce qu'on a retiré, rare) ;
  - l'icône se donne par son nom (`fullscreen`, `zoom`, `admin`, `whatsNew`, `statusDot`, `treadmill`, `decor`, `blackTiles`) ; `ReleaseIcon`, dans `apps/client/src/office/icons.tsx`, la fait correspondre à une icône de Lucide ;
  - `adminsOnly: true` la réserve aux admins (le panneau Admin, par exemple) : les membres ne la voient pas.
- Les textes de la fenêtre elle-même (le titre, les boutons, les titres des groupes) sont dans `apps/client/src/i18n/fr.ts`, sous `whatsNew`.

### Ce que le compte retient

- La colonne `last_release_seen` de la table `user` (migration `0014_release_seen`) garde la dernière version dont la personne a vu les nouveautés. Elle vaut `null` pour qui n'en a vu aucune.
- Better Auth la renvoie avec la session (`lastReleaseSeen`, un champ `input: false` dans `apps/server/src/auth/auth.ts`). Le client la lit dans `apps/client/src/lib/session.ts`. Personne ne peut l'écrire depuis le client : ni à la création du compte, ni par `PATCH /api/me`.
- `POST /api/me/release-seen` (session exigée) enregistre la version **du serveur**, jamais un numéro envoyé par le client. La route est idempotente. Elle ne fait jamais reculer un compte : après un retour en arrière du serveur, une version vue plus récente reste celle qu'il a. Le code est dans `apps/server/src/releases/release-routes.ts`.
- Le suivi se fait **par compte**, pas par appareil. Fermer la fenêtre sur l'ordinateur suffit : le téléphone ne la remontre pas.

### Qui la voit, et quand

- **Un compte créé à partir de maintenant** part à jour : le crochet `user.create.before` d'`auth.ts` lui donne la version en cours. Les invitations acceptées et le compte du bac à sable passent par ce crochet. Un nouveau venu n'a donc pas de « quoi de neuf » sur des choses qu'il n'a jamais connues.
- **Un compte d'avant la 1.00** (`null`) voit la version en cours, une fois.
- **Un compte en retard de plusieurs versions** voit toutes celles qu'il a manquées, la plus récente d'abord. Une note dont le numéro dépasserait `CURRENT_RELEASE` n'est jamais montrée ; c'est un filet de sécurité, le test des notes refusant déjà ce cas (plus bas, « Publier une version »).
- **Un membre** ne voit ni les nouveautés réservées aux admins ni une version qui n'aurait rien d'autre à lui dire : en retard d'une seule version faite pour les admins, il n'a pas de fenêtre du tout.
- **Quand** : en entrant au bureau, une fois l'interface en place. La fenêtre attend l'écran d'entrée (« Entrer »), puis le premier état du serveur, puis encore une demi-seconde (`WHATS_NEW_DELAY_MS`) : on voit d'abord qu'on est arrivé. Elle ne passe jamais devant la page de connexion ni devant l'écran d'entrée.
- **La fermer** l'enregistre comme vue. On la ferme avec « C'est parti », la croix, Échap ou un clic sur le fond. L'enregistrement est optimiste : la fenêtre ne revient pas dans la page, et si `POST /api/me/release-seen` échoue, elle reviendra à la prochaine entrée.
- **La revoir** : la ligne « Nouveautés » du menu « Moi » ouvre tout l'historique. Elle porte à droite le numéro de la version en cours (« v1.00 »). La fermer depuis là n'enregistre rien de plus.
- « Tout l'historique » s'affiche aussi en bas de la fenêtre quand il y a plus de versions que celles qu'elle montre (pas encore le cas avec la seule 1.00).

### La fenêtre

- Le code est dans `apps/client/src/updates/WhatsNew.tsx`, et la coque du bureau (`OfficeShell.tsx`) la garde montée. Les styles sont dans `styles.css`, dans le bloc « Les nouveautés ».
- C'est une carte de 520 px au milieu de la page. Sur un téléphone (moins de 560 px), c'est une feuille pleine largeur posée en bas. Elle est au-dessus de toute la couche du bureau, mais dans elle : elle prend les couleurs de la nuit quand la lumière est éteinte, et reste sous l'écran « Ouvert dans un autre onglet ».
- C'est une fenêtre modale (`role="dialog"`, `aria-modal`), nommée par son titre et décrite par l'accroche de la version. Le focus va à « C'est parti », Tab ne sort pas de la fenêtre, et à la fermeture le focus revient d'où il venait. Aucune touche n'en sort : l'avatar ne marche pas derrière elle.
- Quand les notes dépassent la hauteur de la carte, seul le corps défile, entre le bandeau et les boutons ; une ombre en haut ou en bas dit qu'il reste à lire. Le corps est une région qu'on atteint au clavier (Tab, entre la croix et les boutons) : les flèches et Page suivante le font alors défiler.
- La date s'écrit en toutes lettres, « 29 octobre 2026 », et le premier du mois « 1er janvier 2027 » (`formatReleaseDate`).

## Publier une version

1. **Monter le numéro.** Dans `packages/shared/src/releases.ts`, passer `CURRENT_RELEASE` à la version suivante : `1.01` pour une mise à jour ordinaire, `2.00` pour un grand changement.
2. **Écrire la note.** Dans `apps/client/src/updates/releases.ts`, ajouter la version **en tête** de `RELEASES`, avec la date de la mise en ligne, une accroche, et ses nouveautés, chacune avec son genre (la fenêtre les range d'elle-même).
3. **Une icône qui manque ?** L'ajouter à `ReleaseIconName` (`releases.ts`) et à `RELEASE_ICONS` (`icons.tsx`), en l'important de `lucide-react` dans la section des nouveautés.
4. **Vérifier** : `pnpm vitest run apps/client/src/updates packages/shared/test/releases.test.ts`. Le test refuse des notes dont la plus récente n'est pas `CURRENT_RELEASE`, des numéros en double ou dans le désordre, une date mal écrite, une note vide, et les mots de la surprise (plus bas).
5. **Mettre en ligne** comme d'habitude (un `git push` sur `main`). Il n'y a pas de migration à faire. À leur prochaine entrée, tous les comptes qui ont vu la version d'avant voient la nouvelle.

**Le numéro et la note vont ensemble, dans le même commit.** Monter le numéro sans écrire la note, ou écrire la note sans monter le numéro, ne montre rien, et le test des notes échoue dans les deux cas. Or Railway attend la CI : tant qu'elle est rouge, plus rien ne se déploie. Une note qu'on veut préparer à l'avance attend donc sur une branche, pas sur `main`.

### Écrire une note

- **Pour les collègues** : en français, au tutoiement, comme le reste de l'interface. On dit ce qu'on peut faire, pas comment c'est codé : « Passe la caméra de n'importe qui en plein écran », et non « Le composant VideoStrip gère le plein écran ».
- **Une ligne, pas plus** : un titre de 34 caractères au plus (« Un zoom tout en douceur ») et un texte de 56 au plus (`RELEASE_TITLE_MAX`, `RELEASE_TEXT_MAX` : à la largeur de la fenêtre, chacun tient sur une ligne ; le test des notes refuse plus long). L'accroche tient en une phrase.
- **Le bon genre** : `new` pour ce qui n'existait pas, `improved` pour ce qui marche mieux, `fixed` pour ce qui ne marchait pas, et `removed`, dans de très rares cas, pour ce qu'on a retiré. Tout va dans la liste : il n'y a pas de rubrique à part pour les petites choses.
- Ce qui ne concerne que les admins prend `adminsOnly: true`. Une version dont toutes les nouveautés sont pour les admins n'est pas montrée aux membres (voir « Qui la voit, et quand »).

### La règle de la surprise

Certaines choses sont encore une surprise pour les collègues, et le dépôt est public sur GitHub. Aucune note, aucune accroche, aucun titre de commit ne parle d'**XP**, de **niveaux**, de **missions**, de **boutique**, de **kuartzons** ni de **caractéristiques**. Le test des notes vérifie ces mots ; il ne remplace pas une relecture.

## Tester

- `packages/shared/test/releases.test.ts` : la forme des numéros et leur comparaison.
- `apps/client/src/updates/releases.test.ts` : les règles des notes, ce que la fenêtre montre selon la dernière version vue et le rôle, et la date.
- `apps/client/src/updates/WhatsNew.test.tsx` : la fenêtre (montrée en retard, pas à jour, enregistrée à la fermeture, Échap, le fond, le focus, le clavier qui n'en sort pas, le corps qui se prend au clavier, l'historique depuis le menu, effacé si la page du bureau part).
- `apps/server/test/releases.test.ts` : la colonne, la session, `POST /api/me/release-seen` et la route des tests.
- `e2e/nouveautes.spec.ts` : de bout en bout. La route `POST /api/test/release-seen/reset` (`E2E=1` seulement) remet un compte à `null`, comme un compte d'avant. Les comptes des autres tests sont créés à jour : la fenêtre ne les gêne pas.
