# Refonte de l'interface et lumière partagée : plan d'intégration

> **Pour les agents qui l'exécutent :** sous-skill requis : superpowers:subagent-driven-development. Les étapes se cochent (`- [ ]`).

**But :** une interface moderne et légère, faite d'icônes connues (Lucide), posée sur le bureau en pixel art. S'y ajoute un interrupteur dans le couloir, commun à tous : éteint, il plonge le bureau dans une nuit tamisée où les lampes éclairent et chaque personne porte un halo, comme dans un Zelda.

**Architecture :**
- L'interface garde ses composants React, restylés sur les jetons de `styles.css` en deux thèmes, `day` et `night`. Le thème suit la lumière du bureau.
- Un seul panneau latéral ouvert à la fois, et un menu « Moi » qui regroupe statut, mode, apparence, bureau, son et déconnexion.
- La nuit est une couche Phaser : une texture d'obscurité trouée par des « cookies » de lumière à paliers, plus un halo chaud.
- L'état de la lumière vit sur le serveur. Il est persistant, diffusé à tous, et changé depuis l'interrupteur (touche E ou clic à portée).

**Pile :** React 19, Phaser 4.2.1 (WebGL), Socket.IO 4.8, zustand 5, zod 4, Drizzle (Postgres ou PGlite), Vitest et happy-dom, Playwright.

**Maquette de référence :** `/private/tmp/claude-501/-Users-andreagauvreau-Tools-bureau-virtuel/5e01fa34-b881-42df-b958-2677c32001cc/scratchpad/mockup/index.html`, avec ses rendus `jour.png` et `night.png` dans le même dossier. Elle reste hors du dépôt, puisqu'elle contient des images du jeu.

## Contraintes globales

- **Pas de `backdrop-filter`** sur les surfaces posées sur le canevas. C'est coûteux à chaque image et soupçonné de ralentir l'e2e (note de la refonte précédente). Les surfaces sont pleines.
- **Nouvelles dépendances :** seulement `lucide-react` et `@fontsource-variable/instrument-sans`. Rien d'autre sans le demander.
- **Lumière allumée = canevas identique au pixel près** (`e2e/world.spec.ts:112-143` lit des pixels). Allumée, la couche de nuit n'existe pas à l'écran et ne dessine rien.
- **Textes en français**, phrases courtes, sans majuscules de titre.
  - Chaque bouton à icône seule a un nom accessible et une infobulle identiques.
  - On garde les noms accessibles existants quand l'action ne change pas (« Chat », « Personnes », « Activer le micro », « Zoom avant »…).
  - Quand un libellé visible change, on met à jour dans la même tâche `fr.ts`, `fr.test.ts` et les specs e2e concernées.
- **`prefers-reduced-motion`** : pas de clignotement ni de fondu, changement instantané.
- **Couleurs :** on garde les noms de jetons existants (`--text`, `--surface`, `--accent`, `--border`…) et on change leurs valeurs. Les nouveaux jetons sont listés en tâche 1. On ne code aucune couleur en dur dans un composant.
- **Commits :** un par tâche, en français, au format du dépôt (`feat(client): …`). On fait `git add` des fichiers de la tâche seulement.
- **Budget :** 23 % de l'hebdo au départ, 24 % après l'analyse.
  - On mesure (`get_usage`) après chaque vague.
  - **31 % : on prévient**, et on termine seulement les P0.
  - **33 % : on arrête**, on commite ce qui marche et on fait le point.

## Points d'attention (non couverts ailleurs)

1. **Zoom ou redimensionnement pendant la nuit :** la couche d'obscurité doit recouvrir toute la vue, sans bande claire au bord. Test en tâche 7 (`viewRect`).
2. **Deux personnes appuient en même temps :** tout le monde finit dans le même état. Le serveur fait foi et `lights:set {on}` est idempotent. Test en tâche 5.
3. **Arriver pendant que c'est éteint :** on entre directement dans le noir, sans éclair blanc, avec le thème `night` dès le premier rendu. Test en tâche 7.
4. **Mouvement réduit :** bascule instantanée. Test en tâche 7.
5. **Rendu Canvas (sans WebGL) ou contexte WebGL perdu :** pas de plantage. On repasse à un voile sombre uni. Test en tâche 7.

---

## Vue d'ensemble

| Vague | En parallèle | Priorité |
|---|---|---|
| 0 | Préalable (l'autre conversation est finie et commitée, tests verts) | P0 |
| 1 | T1 Fondations de l'interface ‖ T5 État de la lumière (partagé et serveur) | P0 |
| 2 | T2 Coque et docks ‖ T6 Interrupteur dans le couloir | P0 |
| 3 | T3 Puce et menu « Moi » ‖ T7 Rendu de la nuit | P0 |
| 4 | T4 Personnes et chat ‖ T8 Icônes des modes | P0 / P1 |
| 5 | T9 Pages d'accueil, vérification des appareils, téléphone | P1 |
| 6 | T10 Finitions, docs, vérification complète | P0 (vérification) / P2 (finitions) |

**Parallélisme :** chaque paire touche des fichiers disjoints.
- Côté interface : `apps/client/src/office/**` et `styles.css`.
- Côté jeu et serveur : `apps/client/src/game/**`, `apps/server/**` et `packages/shared/**`.
- Seul `fr.ts` est partagé, entre T2 et T6 en vague 2. Chacune n'y ajoute que sa propre section et relit le fichier juste avant de l'éditer.

Chaque agent lance les tests de son périmètre et ignore les erreurs de typage hors de ses fichiers, puisque l'autre agent est en cours. Le `pnpm typecheck` global se fait en fin de vague.

**Captures :** à chaque fin de vague, `node scratchpad/shoot.mjs` sur le bac à sable (ports 5273 et 4100, jamais les ports 3056 et 3057 du PM2). Elles partent sur le téléphone avec SendUserFile.

---

### Étape 0 : préalable

- [ ] L'autre conversation (« Coût d'intégration musicale ») ne tourne plus (`list_sessions`).
- [ ] Son travail est commité à part, avec l'accord d'Andrea : `feat: son et première refonte de l'interface`. Sans ce commit, les commits suivants mélangeraient les deux chantiers.
- [ ] `pnpm typecheck && pnpm test` passent. On note les échecs déjà présents.
- [ ] Le plan va dans `docs/superpowers/plans/2026-10-21-refonte-ui-nuit.md`. Commit `docs: plan de la refonte et de la nuit`.

### Tâche 1 : fondations de l'interface (P0)

**Fichiers**
- Modifier :
  - `apps/client/package.json` (deps `lucide-react`, `@fontsource-variable/instrument-sans`)
  - `apps/client/src/main.tsx` (import de la police)
  - `apps/client/src/styles.css` (jetons)
  - `apps/client/src/office/icons.tsx`
- Créer :
  - `apps/client/src/office/ui/IconButton.tsx` et `ui/IconButton.test.tsx`
  - `ui/Popover.tsx` et `ui/Popover.test.tsx`
  - `ui/Drawer.tsx`

**Interfaces produites**
- `icons.tsx` reste le seul point d'import des icônes. Il réexporte depuis `lucide-react` les icônes de la table ci-dessous et supprime les tracés collés à la main. Taille par CSS (`svg.lucide { width: 20px; height: 20px; stroke-width: 1.75 }`).
- `IconButton({ label, shortcut?, pressed?, tone?: 'default' | 'danger' | 'accent', badge?, onClick, children })` :
  - `aria-label={label}` ;
  - `aria-pressed` si `pressed` est défini ;
  - infobulle CSS via `data-tip` (avec `shortcut` en `<kbd>`) ;
  - `badge` rendu dans `.icon-badge`.
- `Popover({ open, onClose, anchorRef, placement: 'top-start' | 'top-end', children, label })` : rôle choisi par l'appelant, fermeture sur Échap et sur clic dehors, focus rendu à l'ancre.
- `Drawer({ title, onClose, children })` : `<aside aria-label={title}>` avec en-tête (titre, bouton « Fermer ») et corps qui défile.

**Jetons**

On garde les noms existants. Valeurs de jour, puis de nuit sous `.office-ui[data-theme='night']` :
- Encre : `--text` #15171c / #eef0f4 ; `--text-soft` #5d6270 / #a3aaba ; `--text-muted` #8a8f9c / #737a8c.
- Surfaces : `--surface` #ffffff / #171a22 ; `--surface-soft` #f1f2f5 / #232835.
- Trait : `--border` rgb(21 23 28 / 9%) / rgb(255 255 255 / 9%).
- Accent : `--accent` #3b5bdb / #ffc56b (la nuit, l'accent prend la couleur des lampes) ; `--accent-soft` #e9edff / rgb(255 197 107 / 14%).
- Nouveaux :
  - statuts : `--ok` #2fb35b, `--busy` #f5a524, `--away` #a1a6b3, `--dnd` #e5484d ;
  - `--danger-soft` ;
  - ombres : `--shadow-dock`, `--shadow-pop` (valeurs de la maquette) ;
  - rayons : `--radius-dock` 18px, `--radius-btn` 12px, `--radius-pop` 20px ;
  - mouvements : `--ease-out` cubic-bezier(.2,.8,.2,1), `--dur-fast` 160ms, `--dur-pop` 220ms, `--dur-theme` 500ms.
- Police : `'Instrument Sans Variable', system-ui, sans-serif`. Tailles 12, 13, 14 et 16 ; graisses 500 et 600 ; `font-variant-numeric: tabular-nums` sur les compteurs.

**Icônes Lucide**

| Usage | Icône |
|---|---|
| Micro | `Mic`, `MicOff` |
| Caméra | `Video`, `VideoOff` |
| Partager l'écran | `MonitorUp` |
| Réactions | `SmilePlus` |
| Chat | `MessageCircle` |
| Personnes | `Users` |
| Plus | `Ellipsis` |
| Zoom | `Plus`, `Minus` |
| Lieu | `MapPin` |
| Ouvrir le menu « Moi » | `ChevronUp` |
| Apparence | `Shirt` |
| Mon bureau | `LampDesk` |
| Son | `Volume2` |
| Appareils | `Settings2` |
| Déconnexion | `LogOut` |
| Lumière | `Lightbulb`, `LightbulbOff` |
| Décor | `Sofa` |
| Admin | `ShieldCheck` |
| Bac à sable | `FlaskConical` |
| Fermer | `X` |
| Envoyer | `SendHorizontal` |

**Étapes**
- [ ] Tests d'abord.
  - `IconButton` : nom accessible, `aria-pressed`, `badge` affiché (`'2'`), `tone="danger"` donne la classe `is-danger`.
  - `Popover` : Échap appelle `onClose` et rend le focus à l'ancre ; un clic dehors appelle `onClose`.
  - Vérifier qu'ils échouent.
- [ ] Implémenter, puis `pnpm --filter @bureau/client exec vitest run src/office/ui` passe.
- [ ] Remplacer les tracés de `icons.tsx` par les réexports.
- [ ] Jetons et police.
- [ ] `pnpm --filter @bureau/client exec vitest run` passe : les tests des panneaux ne doivent pas bouger, seuls les styles ont changé.
- [ ] Commit `feat(client): jetons jour et nuit, icônes Lucide, boutons, popovers et panneau`.

### Tâche 5 : état de la lumière, partagé et serveur (P0)

**Fichiers**
- Modifier :
  - `packages/shared/src/protocol.ts`
  - `packages/shared/src/constants.ts`
  - `packages/shared/src/map/parse-map.ts` (type de zone `switch`)
  - `packages/shared/test/protocol.test.ts`
  - `apps/server/src/db/schema.ts`
  - `apps/server/src/realtime/{handlers.ts,io.ts,presence.ts}`
  - `apps/client/src/state/office-store.ts`
  - `apps/client/src/net/office-connection.ts`
- Créer :
  - `apps/server/src/lights/lights-service.ts`, calqué sur `desks/desk-service.ts` : mémoire, écriture en base, `ready`, écritures en file avec `one-at-a-time.ts`
  - la migration `apps/server/drizzle/0004_*.sql`, générée par `pnpm --filter @bureau/server db:generate`
  - `apps/server/test/realtime-lights.test.ts`, calqué sur `realtime-desks.test.ts`

**Interfaces produites**
- Partagé :
  - `type LightsState = { on: boolean; by: { id: string; name: string } | null; at: number }` ;
  - `InitPayload.lights?: LightsState`, optionnel pour ne pas toucher aux 9 tests qui construisent l'init ; absent veut dire allumé ;
  - client vers serveur `'lights:set'` avec `lightsSetSchema = z.object({ on: z.boolean() })` ;
  - serveur vers tous `'lights:changed'` avec un `LightsState`.
- Constantes : `LIGHTS_RATE_MS = 800` (un changement par personne et par 800 ms) et `LIGHT_SWITCH_REACH_TILES = 3`.
- Carte : zone de type `switch`, un point. `ParsedMap.switches: { x: number; y: number }[]`, en pixels, au centre de la case.
- Base : table `office_lights`, une seule ligne `id = 1` avec `on boolean not null default true`, `changed_by text`, `changed_at timestamptz not null default now()`.
- `LightsService` : `ready: Promise<void>`, `get(): LightsState` et `set(on, by): Promise<LightsState | null>`, qui rend `null` si rien ne change.
- Gestionnaire `lights:set` :
  - valide le schéma ;
  - applique la limite de rythme par utilisateur ;
  - vérifie la distance : la position (`world.get`) doit être à 3 cases ou moins d'un interrupteur de la carte du serveur ;
  - si l'état change, `io.to('office').emit('lights:changed', state)` ;
  - sinon, ne fait rien.
- Client :
  - `useOfficeStore` gagne `lights: LightsState` (allumé par défaut) et `setLights` ;
  - à l'init, l'état vient du payload ;
  - `office-connection` transforme `lights:changed` en mise à jour du store et en événement de bus `lights:changed` ;
  - il transforme l'événement de bus `local:lights {on}` en `socket.emit('lights:set', {on})`.

**Étapes**
- [ ] Tests serveur d'abord (`realtime-lights.test.ts`) :
  1. L'init contient `lights.on === true`.
  2. Un client à 2 cases de l'interrupteur envoie `{on:false}` : les deux clients reçoivent `lights:changed` avec `{ on: false, by: { name } }`.
  3. Un client à 10 cases : aucune diffusion.
  4. Deux envois à 100 ms d'écart : le second est ignoré.
  5. Deux clients envoient `{on:false}` en même temps : une seule diffusion, état final `false`.
  6. Après redémarrage sur la même base, l'init rend `on: false`.
- [ ] Test partagé : `lightsSetSchema` refuse `{on:'non'}` ; `parseMap` lit une zone `switch`.
- [ ] Implémenter, puis `pnpm --filter @bureau/server test` et `pnpm --filter @bureau/shared typecheck` passent.
- [ ] Tests client : `office-store` (`setLights`, et l'init sans `lights` donne allumé) et `office-connection` (aller-retour des deux événements).
- [ ] Commit `feat: état de la lumière partagé par tout le bureau`.

### Tâche 2 : coque et docks (P0)

**Fichiers**
- Modifier :
  - `apps/client/src/office/OfficeShell.tsx` et son test
  - `ControlBar.tsx`, découpé en docks
  - `VideoStrip.tsx` (style seulement)
  - `styles.css` (coque, docks, panneau)
  - `e2e/helpers.ts` et les specs qui cliquent dans la barre
- Créer :
  - `office/MediaDock.tsx` (micro, caméra, partage, réactions)
  - `office/SocialDock.tsx` (chat avec badge des non-lus, personnes avec le compte en ligne, menu « Plus » avec Décor, Admin, Bac à sable et Zoom 100 %)
  - `office/ZoomDock.tsx` (−, +)
  - `office/WhereChip.tsx` (nom du lieu, et jusqu'à 3 portraits des gens présents puis `+N`)
  - `office/Toasts.tsx`, qui remplace `DeskKnocks` (file zustand `useToasts` avec `push({ icon, avatarKey?, text, ttl = 3500 })`, en haut au centre)

**Disposition**

D'après la maquette `jour.png`, bords à 16px :
```
┌──────────────────────────────────────────────────────────────┐
│ [⌖ Lieu ◧◧◧ +4]        [vidéos]                  ┌──────────┐ │
│                         [toast]                  │ panneau  │ │
│                                                  │ (un seul)│ │
│                                                  └──────────┘ │
│ [◧ Nom / mode ⌃]     [🎤 📷 ⇪ | ☺]         [− +]  [💬 👥 ⋯] │
└──────────────────────────────────────────────────────────────┘
```

**Règles**
- `.office-ui` porte `data-theme="day|night"` et `data-lights="on|off"`.
- Le groupe accessible `Barre du bureau` entoure les docks du bas.
- Le panneau latéral s'arrête au-dessus des docks (`bottom: 88px`), sur 340px de large.
- `panel: PanelId | null`, avec `PanelId = 'chat' | 'people' | 'character' | 'desk' | 'decor' | 'states' | 'sound' | 'admin' | 'sim'`.
- Ouvrir un panneau ferme le précédent.
- `ChatPanel` reste monté et caché (attribut `hidden`) pour garder les non-lus.
- Le nom du lieu vient des zones `label` de la carte : la zone qui contient le joueur, sinon « Couloir ».
- Moins de 720px de large : les docks n'ont plus que des icônes, la puce « Moi » ne garde que le portrait, et le panneau devient une feuille en bas, sur 70 % de la hauteur.

**Étapes**
- [ ] Mettre à jour `OfficeShell.test.tsx`. Il n'y a plus d'empilement `.office-side > aside` : un seul `complementary` à la fois. Ouvrir « Personnes » puis « Chat » laisse un seul panneau visible. Les badges suivent.
- [ ] Implémenter, puis le test passe.
- [ ] `e2e/helpers.ts` : `openPanel(page, name)` et `openMoreMenu(page)`. Adapter les specs qui ouvraient des panneaux empilés. `pnpm e2e --grep "presence|chat"` passe.
- [ ] Captures du bac à sable sur le téléphone.
- [ ] Commit `feat(client): nouvelle coque, docks à icônes et un seul panneau à la fois`.

### Tâche 6 : interrupteur dans le couloir (P0)

**Fichiers**
- Modifier :
  - `packages/shared/src/map/office.ts` : un interrupteur sur la face du mur nord du couloir, case x=32 et y=10, ou la plus proche qui soit libre, entre les portes 26-27 et 37-38 ; vérifier à l'œil
  - la carte générée `public/assets/maps/office.json` (`pnpm --filter @bureau/client gen:map`)
  - `apps/client/src/game/scenes/Office.ts`
  - `game/input.ts` (touche E « utiliser »)
  - `game/scenes/Preloader.ts`
  - `i18n/fr.ts` et `fr.test.ts`
- Créer : `game/light-switch.ts` et `game/light-switch.test.ts`

**Interfaces produites**
- `class LightSwitch` avec `constructor(scene, pos, onUse: () => void)`, `setOn(on: boolean)` et `updateReach(player: {x,y}): boolean`.
  - La plaque est une texture créée au chargement (`switch:on` et `switch:off`, environ 10×14 px du monde, contour sombre façon LimeZu).
  - Un témoin ambré de 2×2 px, au-dessus de la nuit, permet de la trouver dans le noir.
  - À portée, au-dessus de la plaque, une étiquette dans le style des `NameTag` : `[E] Éteindre` ou `[E] Allumer`.
- Touche E ou clic sur la plaque à portée : `bus.emit('local:lights', { on: !store.lights.on })`.
- Textes de `fr.lights` :
  - `off: '{name} a éteint la lumière'` et `on: '{name} a rallumé la lumière'` ;
  - `selfOff: 'Tu as éteint la lumière'` et `selfOn: 'Tu as rallumé la lumière'` ;
  - `use: 'Éteindre'` et `useOn: 'Allumer'`.
- À chaque `lights:changed` : un toast avec le portrait de l'auteur, et un bruit d'interrupteur pris dans les sfx existants (`audio/sfx-events.ts`).

**Étapes**
- [ ] Tests d'abord :
  - `updateReach` est vrai à 3 cases et faux à 4 ;
  - `onUse` est appelé sur E seulement à portée ;
  - `parseMap(office)` contient un interrupteur.
- [ ] Implémenter, puis les tests passent. Regarder la plaque dans le bac à sable.
- [ ] Commit `feat: interrupteur commun dans le couloir (touche E ou clic)`.

### Tâche 3 : puce et menu « Moi » (P0)

**Fichiers**
- Créer :
  - `office/ui/AvatarPortrait.tsx` et son test
  - `office/MeChip.tsx`
  - `office/MeMenu.tsx` et son test
- Modifier : `OfficeShell.tsx`, `styles.css`, `e2e/helpers.ts` (`openMeMenu`)
- Supprimer : `StatusMenu.tsx`, dont la logique et les tests passent dans `MeMenu`

**Interfaces produites**
- `AvatarPortrait({ avatarKey, size, status? })` :
  - compose avec `composeAvatar` (`game/avatar-compose.ts`) ;
  - recadre l'image 18 (de face, à l'arrêt), source x = 18×32, y = 16, 32×32 ;
  - dessine sans lissage sur un canevas de `size` px ;
  - garde le résultat en cache par `avatarKey` (Map, 64 entrées au plus) ;
  - pendant le chargement, affiche les initiales.
- `MeChip` : bouton `aria-haspopup="menu"`, nommé « Mon profil ». Il montre le portrait avec la pastille de statut, le nom, puis le mode actif (icône et libellé), sinon le libellé du statut.
- `MeMenu` (`role="menu"`) contient :
  - en-tête : portrait 52, nom, e-mail, et « Changer d'apparence » qui ouvre le panneau `character` ;
  - « Statut » : 4 `menuitemradio` nommés comme aujourd'hui, avec les pastilles ;
  - « Mode » : les états d'activité en `menuitemradio`, « Aucun », et « + » qui ouvre le panneau `states` ;
  - entrées « Mon bureau » (panneau `desk`), « Son et musique » (panneau `sound`) et « Se déconnecter ».
- « Compte » n'existe pas dans l'appli : l'e-mail dans l'en-tête et la déconnexion en tiennent lieu.

**Étapes**
- [ ] Tests d'abord :
  - choisir « Occupé » appelle `setStatus('busy')` ;
  - choisir un état appelle `setActivity(id)` ;
  - Échap ferme et rend le focus à la puce ;
  - la puce affiche le mode actif s'il existe, sinon le statut ;
  - `AvatarPortrait` dessine 32×32 depuis l'image 18 (canevas simulé).
- [ ] Implémenter, déplacer les tests de `StatusMenu`, puis les tests passent.
- [ ] Adapter les e2e qui utilisaient `/^Statut/`, « Personnage », « Mon bureau » et « Se déconnecter » via `openMeMenu`. Les specs concernées passent.
- [ ] Commit `feat(client): puce et menu « Moi » (statut, mode, apparence, bureau, son)`.

### Tâche 7 : rendu de la nuit (P0)

**Fichiers**
- Créer :
  - `game/lighting.ts`
  - `game/light-sources.ts` et son test
  - `game/light-textures.ts` et son test
- Modifier :
  - `game/scenes/Office.ts` : créer la couche, l'alimenter, et appeler `update()` dans le POST_UPDATE (`:224`)
  - `OfficeShell.tsx` : `data-theme`
  - `styles.css` : transition du thème

**Interfaces produites**
- `light-sources.ts` :
  - `LIGHT_EMITTERS: Record<string, { kind: 'lamp' | 'screen' | 'fire'; radiusTiles: number; color: number }>` couvre les lampadaires `lr-12-9`, `lr-11-9`, `lr-13-9`, `lr-12-12` et `lr-13-12` ;
  - les lampes articulées `of-11-15`, `of-10-16`, `of-11-17`, `of-11-19`, `of-11-21` et `of-11-23` ;
  - les lampes de chevet `lr-14-7`, `lr-15-7`, `lr-14-9`, `lr-15-9`, `lr-14-13` et `lr-15-13` ;
  - `of-8-26` et `of-14-26`, la cheminée `lr-4-24` (`fire`), et les écrans `tv-10-3`, `of-9-14` et `tv-10-1` (`screen`, froid, petit) ;
  - `sourcesFromItems(items: { id: string; x: number; y: number; w: number; h: number }[]): LightSource[]` place l'ampoule en haut du sprite, au centre.
- `light-textures.ts` :
  - `bandAlpha(d: number): number`, pour d de 0 à 1 : 1 jusqu'à 0,52, puis 0,7 jusqu'à 0,70, 0,4 jusqu'à 0,86, et 0 au-delà ;
  - `softAlpha(d)` : `1 − smoothstep(0.35, 1, d)` ;
  - `createLightTextures(scene)` crée `light:banded`, `light:soft` et `light:glow` (CanvasTexture de 128 px, une seule fois).
- `class LightingLayer` :
  - `constructor(scene)` ;
  - `setOn(on: boolean, opts?: { instant?: boolean })` ;
  - `setStatic(sources: LightSource[])` ;
  - `track(id, getPos: () => { x: number; y: number })` et `untrack(id)` ;
  - `update()` et `destroy()`.

**Rendu**
- Couleur de nuit #080b1c, opacité 0,88.
- Une RenderTexture couvre `camera.worldView`, avec 2 px de marge. On la redimensionne quand le zoom ou la taille change, et sa position suit la vue.
- À chaque image, seulement si `level > 0` : `clear`, `fill`, puis `erase` du cookie à chaque source visible, et `render()`.
- Les lampes gagnent un halo chaud en `ADD` (#ffc56b, alpha 0,35 × level), juste au-dessus de l'obscurité.
- Halos des personnes : `light:soft`, rayon 2,2 cases. On suit la position dessinée du sprite (les autres ont 150 ms de retard).
- Profondeur 1 000 000,5 : au-dessus du calque `dessus`, sous les étiquettes de nom (1 000 001), qui restent lisibles.
- `level` vaut 0 quand c'est allumé. La couche est alors `visible = false` et ne dessine rien.

**Transitions**
- On éteint : fondu de 450 ms, ease-out.
- On allume : clignotement de néon, `level` passe par 1 → 0,25 → 0,9 → 0,15 → 0 en 320 ms.
- `prefers-reduced-motion` : instantané.
- La cheminée vacille (rayon ±4 % autour de 8 Hz), sauf en mouvement réduit.

**Repli**
- Si `renderer.type` n'est pas WebGL, ou si le contexte est perdu : un rectangle uni à l'écran, opacité 0,6 × level, sans trous.

**Thème**
- `data-theme="night"` quand `lights.on === false`. Les jetons de nuit passent en `--dur-theme`.

**Étapes**
- [ ] Tests d'abord :
  - `bandAlpha(0.5) === 1`, `bandAlpha(0.6) === 0.7`, `bandAlpha(0.9) === 0` ;
  - `sourcesFromItems` place l'ampoule de `lr-12-9` en haut du sprite et ignore un id inconnu ;
  - `viewRect(camera)` couvre `worldView` avec la marge pour un zoom de 0,5 et de 2 ;
  - `LightingLayer.setOn(false, { instant: true })` met `level` à 1 tout de suite ;
  - en mouvement réduit, `setOn` est toujours instantané ;
  - avec un faux renderer Canvas, la couche prend le repli.
- [ ] Implémenter, puis les tests passent.
- [ ] Le canevas reste identique allumé : `pnpm e2e --grep world` passe.
- [ ] Captures nuit (couloir, accueil, un bureau avec lampe articulée) sur le téléphone.
- [ ] Commit `feat: la nuit (obscurité, lampes, halos) et le thème sombre de l'interface`.

### Tâche 4 : personnes et chat (P0)

**Fichiers**
- Modifier : `PeoplePanel.tsx`, `ChatPanel.tsx`, leurs tests et `styles.css`.

**Règles**
- Personnes :
  - sélecteur « Ici · n » / « Tout le bureau · n » ; « Ici » veut dire la même zone que moi ;
  - chaque ligne : portrait 38 avec pastille, nom (et « toi »), puis en dessous le mode (icône et libellé), sinon « Parle avec toi », sinon le lieu ;
  - groupe « Hors ligne » replié, avec le compte ;
  - on garde `[data-user][data-status]` sur les lignes (e2e).
- Chat :
  - sélecteur « Tout le monde » / « À proximité » ;
  - messages groupés par auteur sur 3 minutes, avec un portrait de 28 en tête de groupe ;
  - zone de saisie collée en bas, jamais coupée (bug actuel) ; Entrée envoie, Maj+Entrée va à la ligne ; bouton envoyer à icône.

**Étapes**
- [ ] Tests : `PeoplePanel` (filtre Ici, ligne de mode, hors ligne replié) et `ChatPanel` (regroupement, Entrée envoie).
- [ ] Implémenter, puis ces tests et les e2e `chat` et `presence` passent.
- [ ] Commit `feat(client): panneaux Personnes et Chat redessinés`.

### Tâche 8 : icônes des modes de concentration (P1)

**Fichiers**
- Modifier :
  - `packages/shared/src/protocol.ts` (`activityInputSchema.icon`) et le partagé (`ACTIVITY_ICONS`)
  - `apps/server/src/db/schema.ts` (`activity_state.icon text`) et la migration `0005`
  - les routes des états
  - `StatesPanel.tsx`
- Créer : `office/activity-icons.ts` (nom vers composant Lucide)

**Règles**
- `ACTIVITY_ICONS` : `headphones`, `users`, `coffee`, `utensils`, `phone`, `pen-tool`, `code`, `book-open`, `moon`, `plane`, `dumbbell`, `music`.
- Le champ est optionnel. Sans icône, on affiche la pastille de couleur actuelle.
- Formulaire : une grille de 12 icônes.
- Sans aucun état, 3 suggestions en un clic : Concentration (casque), Réunion (personnes), Pause (café).

**Étapes**
- [ ] Tests : le schéma accepte `icon: 'coffee'` et refuse `'banane'` ; le serveur rend l'icône à l'aller-retour ; `StatesPanel` choisit une icône ; les suggestions créent l'état.
- [ ] Implémenter, puis les tests passent.
- [ ] Commit `feat: une icône pour chaque mode`.

### Tâche 9 : pages d'accueil, appareils, téléphone (P1)

**Fichiers**
- Modifier : `pages/AuthLayout.tsx` et les pages, `DeviceCheck.tsx`, `MusicToggle.tsx` et `styles.css`.

**Règles**
- Pages d'accueil : mêmes jetons et même police. `MusicToggle` devient un bouton à icône seule, nommé « Musique », dans l'en-tête de la carte.
- `DeviceCheck` : aperçu avec le niveau du micro en surimpression ; à droite, les appareils sur trois lignes compactes ; bouton principal « Entrer » ou « Entrer quand même » (regex e2e). On coupe les textes d'aide en infobulles.
- Téléphone : capture à 390×844 de chaque écran.

**Commit :** `feat(client): pages d'accueil et vérification des appareils au même style`.

### Tâche 10 : finitions et vérification (P0 vérification, P2 finitions)

**P2, si le budget le permet**
- `NameTag` : pastille plus fine, coins arrondis, contraste de nuit.
- Étiquettes de bureau (« Libre ») : seulement à 4 cases ou au survol.

**Docs**
- README : sections « Interface » et « Lumière du bureau ».
- `docs/decisions.md` : `lucide-react`, Instrument Sans, un seul panneau, la nuit en RenderTexture plutôt qu'en `Light` (limite de 10 lumières), et la distance vérifiée par le serveur.
- `docs/conception.md:66` et `:76` : l'interrupteur et la touche E entrent dans le périmètre.

**Vérification**
- [ ] `pnpm typecheck` et `pnpm test` passent.
- [ ] `pnpm e2e` passe. `personnalisation.spec.ts:38` et `multiplayer.spec.ts:240` échouent parfois en suite complète : on les relance seuls avant de conclure.
- [ ] E2E de la lumière dans le projet `office` (port 3101, vraie carte), pour ne pas assombrir `world.spec` : deux joueurs ; A va près de l'interrupteur et appuie sur E ; les deux voient `data-lights="off"` et le toast ; A rallume ; la spec finit allumée.
- [ ] Captures finales jour et nuit, ordinateur et téléphone, sur le téléphone d'Andrea. Bilan du budget.
- [ ] Commit `docs: interface et lumière du bureau`.

## Exécution

**Mode :** pilotée par sous-agents. Je pilote, je regarde les captures et je relis les diffs ; les tâches partent à des agents neufs.
- **Sonnet** pour les tâches très cadrées : T5, T6, T8, T9 et les mises à jour d'e2e.
- **Opus** pour celles où le rendu compte : T1, T2, T3, T4 et T7.

Une seule relecture complète à la fin, au lieu d'une par tâche, pour tenir le budget.
