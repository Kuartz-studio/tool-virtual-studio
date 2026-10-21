# Bureau virtuel : document de conception

*Version 1 du 19 octobre 2026. Elle s'appuie sur [la recherche](recherche.md). Référence visuelle : [capture de Gather](reference-gather.webp).*

> **Légende**
> - **[ton choix]** : décidé par toi.
> - **[mon choix]** : une décision que j'ai prise et que tu peux contester.
> - Sans mention : découle des deux.

---

## 1. L'intention

Un bureau virtuel pour ton équipe, dans l'esprit de Gather **[ton choix]** :
- un monde en pixel art vu de dessus ;
- chacun a son avatar et se déplace entre les bureaux, la salle de réunion et le coin détente ;
- on parle avec les collègues dont on s'approche.

**Pourquoi** (mon interprétation de « d'un point de vue pro, des rooms pour se déplacer avec des copains ») : retrouver la présence d'un vrai bureau à distance. On voit qui est là, on va voir quelqu'un sans planifier d'appel, on se retrouve pour une réunion.

**Principe directeur : rester simple** **[ton choix]**. À chaque arbitrage, la version la plus simple qui marche l'emporte.

## 2. L'expérience, en un parcours

1. Un admin t'invite par e-mail. Tu reçois un lien, tu choisis ton nom et ton mot de passe : ton compte est créé.
2. Tu choisis ton avatar dans une galerie de personnages, puis tu vérifies ton micro et ta caméra.
3. Tu apparais dans le bureau. Tu vois les autres avatars bouger en temps réel, avec leur nom et un point de couleur pour leur statut.
4. Tu marches jusqu'au bureau de Tom avec les flèches du clavier. Dès que tu entres dans son espace de bureau, l'audio et la vidéo se connectent tout seuls, et vos vignettes vidéo apparaissent en haut de l'écran. Ses voisins de bureau ne vous entendent pas. Quand tu repars, la conversation se coupe.
5. Vous allez dans la salle de réunion. Tous ceux qui sont dans la salle s'entendent, personne dehors ne vous entend. Tom partage son écran.
6. Tu écris dans le chat « Tout le monde » pour annoncer ta pause, puis tu passes en « Ne pas déranger » : plus personne ne peut te rejoindre en audio.
7. Le lendemain, tu te reconnectes et tu réapparais là où tu étais, sauf si c'est au milieu d'une conversation en cours : tu réapparais alors à l'entrée.

## 3. Objectifs, non-objectifs, anti-objectifs

### Objectifs de la V1

- **Comptes** **[ton choix : équipe seulement, sur invitation]** :
  - inscription uniquement sur invitation, par e-mail et mot de passe ;
  - connexion, mot de passe oublié par e-mail, déconnexion.
- **Un seul bureau**, vu de dessus façon Gather, en pixel art **[ton choix]**.
- **Déplacement :**
  - au clavier (flèches, ZQSD ou WASD), dans 4 directions ; Maj enfoncée, on court (trois fois la vitesse de marche, sans effet visuel : LimeZu ne fournit pas de sprite d'effet de vitesse) ;
  - bloqué par les murs et les meubles ;
  - le zoom de la vue (molette, pincement du pavé tactile, boutons + / − en bas à gauche, ou touches + - 0) va de ×2 plus près à ×4 plus loin que la vue de départ, par crans qui gardent les tuiles nettes ;
  - l'avatar passe devant ou derrière les meubles.
- **Multijoueur :** chacun voit les autres bouger de façon fluide, avec leur nom et leur statut.
- **Audio/vidéo de proximité dès la V1** **[ton choix]** :
  - connexion automatique quand on s'approche de quelqu'un ;
  - une salle de réunion privée ;
  - micro et caméra activables, choix des périphériques ;
  - partage d'écran **[mon choix]**.
- **Statuts, choisis à la main :** Disponible, Occupé, Absent, et Ne pas déranger (on ne peut plus être rejoint). On est « en ligne » tant que le bureau est ouvert dans un onglet.
- **Chat texte :** un canal « Tout le monde », conservé, et un canal « À proximité », éphémère, pour la conversation en cours.
- **Avatars :** choix dans une galerie de personnages prêts à l'emploi.
- **Administration :** inviter quelqu'un, relancer ou annuler une invitation, retirer un membre.
- **En ligne** sur une adresse HTTPS, avec les crédits des assets visibles.
- **Interface en français**, textes regroupés à un seul endroit pour pouvoir traduire plus tard **[mon choix]**.

### Juste après la V1 (V1.1)

- S'asseoir sur une chaise, avec l'animation assise des personnages. La touche E existe déjà : elle actionne l'interrupteur de la lumière (voir plus bas), et servira aussi à s'asseoir.
- Des émotes au-dessus de la tête : coucou, cœur, etc.
- Rejoindre quelqu'un depuis la liste des personnes (téléportation à côté de lui).
- Un volume qui baisse avec la distance pendant une conversation.
- Des messages privés.
- Les lumières, faites : une lumière commune au bureau, que l'interrupteur du couloir éteint et rallume pour tout le monde (la nuit est dessinée dans une RenderTexture, avec le halo des lampes et celui des personnes). Un cycle jour/nuit automatique reste à faire.
- Absent automatique quand l'ordinateur est inactif, en option. Cette détection n'existe que dans Chrome et Edge, et demande une autorisation.

### Non-objectifs (hors projet, sauf si on le redécide)

- La vue en losange, la vue à la première personne, la 3D **[ton choix]**.
- Plusieurs bureaux, ou plusieurs équipes clientes.
- Un éditeur de carte dans l'appli : la carte se modifie dans Tiled.
- Une inscription ouverte au public.
- Le mobile et la tablette. Seuls les navigateurs d'ordinateur sont pris en charge : Chrome, Edge, Firefox et Safari récents.
- Les objets interactifs autres que l'interrupteur de la lumière, qui est dans le périmètre (tableaux blancs, jeux), les intégrations (calendrier, Slack) et l'enregistrement des appels.

### Anti-objectifs (des échecs, même si « ça marche »)

- **Un audio/vidéo peu fiable.** Si l'équipe doit retourner sur Meet ou Discord parce que ça coupe ou que ça ne se connecte pas, le projet a échoué.
- **Des déplacements saccadés** ou décalés.
- **Une fuite de confidentialité :** entendre une réunion privée depuis l'extérieur, ou recevoir le son d'une conversation dont on ne fait pas partie.
- **Des assets utilisés hors licence :** fichiers LimeZu publiés, crédits manquants.
- **Une maintenance lourde :** un outil interne qui demande de surveiller un serveur en permanence.
- **Un rendu incohérent :** des styles graphiques mélangés. Un studio de design le verrait tout de suite.

## 4. Contraintes

- **Phaser** pour le moteur de jeu et **Socket.io** pour le temps réel **[ton choix]**.
- **E-mail et mot de passe** pour l'authentification **[ton choix]**.
- **Un dépôt de code privé** **[mon choix]**. C'est obligatoire pour utiliser les assets LimeZu, dont la licence interdit la redistribution.
- **2 à 3 personnes au départ** **[ton choix]**, jusqu'à une dizaine connectées en même temps.
- **Un petit budget :**
  - assets : environ 7 à 12 $, une seule fois ;
  - hébergement : environ 5 à 15 $ par mois ;
  - audio/vidéo : gratuit au départ, puis 50 $ par mois si l'équipe dépasse l'offre gratuite (voir §8.5) **[ton choix]**.

---

## 5. Le monde

### 5.1 Rendu

- **La vue :** de dessus et légèrement inclinée, comme Gather. Tuiles de **32 px**, murs vus de face, meubles vus de dessus et de face.
- **La profondeur :**
  - les avatars et les meubles derrière lesquels on peut passer sont triés selon la position de leurs pieds ;
  - un calque de premier plan (encadrements de portes, hauts de murs, grandes plantes) est dessiné par-dessus les avatars.
- **La netteté :** rendu sans lissage (`pixelArt: true`), zoom entier (×1 ou ×2 selon l'écran), caméra qui suit ton avatar.
- **Les ombres :** une ombre portée sous chaque avatar.

### 5.2 La carte du bureau (V1)

Inspirée de la capture de référence :
- un **open space** avec des îlots de bureaux : un par membre, plus quelques places libres, avec si besoin des étiquettes d'équipe au sol. Chaque bureau a son propre espace, une petite zone privée (voir §8.1) ;
- une **salle de réunion** fermée, qui est une zone privée ;
- un **coin détente** : canapés, bibliothèque, plantes ;
- un **coin café** : tables, machine à café ;
- du décor : plantes, tableaux blancs, borne d'arcade, baby-foot ou ping-pong (purement décoratifs).

Taille indicative : 40 × 30 tuiles, avec un seul point d'apparition près de l'entrée.

### 5.3 La carte dans Tiled

La carte est un fichier JSON exporté de Tiled, avec les tilesets intégrés et les calques enregistrés en CSV (voir la recherche, §2). Les calques, dans l'ordre :

| Calque | Type | Rôle |
|---|---|---|
| `sol` | tuiles | sols, tapis |
| `murs` | tuiles | murs, fenêtres, portes ouvertes |
| `meubles-bas` | tuiles | ce qui reste toujours sous les avatars |
| `objets` | objets (tuiles) | meubles derrière lesquels on peut passer, triés par position verticale |
| `dessus` | tuiles | premier plan, toujours au-dessus des avatars |
| `collisions` | tuiles (invisible) | cases bloquantes |
| `zones` | objets | zones typées (ci-dessous) |

Les zones sont des rectangles avec une propriété `type` :
- `spawn` : le point d'apparition ;
- `private`, avec un `name` (par exemple « Salle de réunion ») : une zone d'audio/vidéo privée ;
- `desk` : l'espace d'un bureau, environ 3 × 3 cases autour de la chaise. Il se comporte comme une petite zone privée ;
- `label`, avec un `text` : une étiquette affichée dans le monde, comme « DEV TEAM » ;
- `switch` : un interrupteur de lumière, une case posée sur un mur (celui du couloir est en 32, 10) ;
- plus tard : `seat` (chaise où s'asseoir), et l'attribution d'un bureau à une personne.

Le **serveur lit le même fichier** pour connaître les cases bloquantes et les zones.

### 5.4 Assets [mon choix]

- **Les packs :** **LimeZu Modern Interiors** (version complète, payante) et **Modern Office – Revamped**, exportés en 32 px. Un seul artiste a tout dessiné : le style est cohérent et proche de Gather.
- **Les avatars :** une galerie de 12 à 16 personnages, fabriqués avec le **Character Generator** de LimeZu (fourni avec Modern Interiors). Ils ont 4 directions et des animations de marche et d'attente ; l'animation assise servira en V1.1.
- **L'interface :** moderne et sobre, dans l'esprit de celle de Gather, sans pack de pixel art. Je la construis avec des composants simples, et tu pourras la retoucher ensuite. Une police pixel, Pixelify Sans (licence OFL), sert pour les noms au-dessus des avatars.
- **La licence LimeZu :**
  - usage commercial autorisé ;
  - **crédit obligatoire avec un lien** : un écran « Crédits » et une mention discrète ;
  - **redistribution interdite** : les fichiers restent dans le dépôt privé. Les envoyer aux navigateurs pendant l'utilisation est normal.
- **À vérifier avec LimeZu :** une seule licence suffit-elle pour toute l'équipe ?

---

## 6. Comptes et accès

### 6.1 Rôles

Deux rôles : `admin` et `membre`. Le premier admin est créé par une commande (`pnpm admin:invite <email>`), qui génère une invitation admin.

### 6.2 De l'invitation au compte

1. Un admin saisit une adresse e-mail. Le serveur crée une invitation avec :
   - un jeton aléatoire, stocké sous forme hachée ;
   - un rôle ;
   - une date d'expiration, 7 jours plus tard ;
   - le nom de l'admin qui invite.
2. Resend envoie l'e-mail, avec le lien `/rejoindre?token=…`.
3. La page affiche l'adresse sans permettre de la modifier, et demande un nom affiché et un mot de passe de 10 caractères minimum.
4. Le serveur vérifie le jeton : valide, pas expiré, pas déjà utilisé. Il crée alors le compte pour **cette adresse uniquement**, la marque comme vérifiée (le lien prouve que l'adresse est la bonne), consomme l'invitation et ouvre la session.
5. Toute création de compte sans invitation valide est refusée, y compris par les routes de Better Auth.

Le mécanisme exact est laissé au builder : soit un crochet de Better Auth à la création d'un utilisateur, soit une route dédiée qui appelle l'API serveur de Better Auth. À vérifier dans la documentation de Better Auth 1.7 au moment d'écrire le code.

### 6.3 Connexion et session

- **Connexion** par e-mail et mot de passe, avec la limitation des tentatives de Better Auth, stockée en base.
- **Session** gardée dans un cookie sécurisé (`httpOnly`, `Secure`, `SameSite=Lax`), valable **30 jours** et prolongée à chaque utilisation **[mon choix]** : on ne se reconnecte pas tous les jours à son bureau.
- **Mot de passe oublié :** un e-mail avec un lien de réinitialisation, géré par Better Auth et envoyé par Resend.
- **Retrait d'un membre :** son compte est désactivé, ses sessions supprimées et ses connexions au bureau fermées immédiatement.

### 6.4 Réglages du compte

On peut changer son nom affiché, son avatar et son mot de passe. Pas de changement d'adresse e-mail en V1.

---

## 7. Architecture technique

### 7.1 Vue d'ensemble

```
Navigateur : React (interface) + Phaser 4 (monde)
   │  HTTPS     /api/*       ─►  Serveur Node (Express 5), une seule instance
   │  WebSocket /socket.io   ─►    ├─ Better Auth ────────────────► PostgreSQL (Drizzle)
   │                               ├─ Invitations, chat, profils ─► PostgreSQL
   │                               ├─ Socket.io : état du monde en mémoire
   │                               ├─ Jetons LiveKit
   │                               └─ E-mails ────────────────────► Resend
   └─ WebRTC                 ─►  LiveKit Cloud (audio, vidéo, partage d'écran)
```

Tout est servi **depuis la même adresse** (le client, l'API et Socket.io) pour éviter les problèmes de cookies et de CORS.

### 7.2 Technologies [mon choix, d'après la recherche]

| Couche | Choix (versions au 19/10/2026) |
|---|---|
| Client | Vite 8, React 19, TypeScript, Phaser 4.2, socket.io-client 4.8, livekit-client 2.x avec @livekit/components-react, client Better Auth |
| Serveur | Node 24 LTS, Express 5, Socket.io 4.8, Better Auth 1.7, livekit-server-sdk, Resend avec React Email, zod |
| Données | PostgreSQL 18, Drizzle ORM avec drizzle-kit pour les migrations |
| Cartes | Tiled 1.12 |
| Tests | Vitest, Playwright |
| Hébergement | Railway (serveur et Postgres), LiveKit Cloud, Resend |

Le client part du modèle officiel `template-react-ts` de Phaser, dont on met les dépendances à jour.

### 7.3 Organisation du code (monorepo pnpm)

```
apps/client      React + Phaser
apps/server      Express + Socket.io + Better Auth
packages/shared  types des événements, schémas zod, constantes,
                 lecture de la carte (collisions, zones), calcul des groupes
```

Le paquet partagé garantit que le client et le serveur appliquent les mêmes règles : collisions, constantes, format des messages.

### 7.4 Client

- **Phaser :**
  - une scène de chargement pour la carte, les tilesets et les personnages ;
  - une scène « Bureau » pour la carte, les avatars, la caméra et le clavier ;
  - la physique Arcade pour ton propre avatar, avec une zone de collision limitée aux pieds.
- **React, par-dessus le jeu :**
  - les pages de connexion et d'invitation ;
  - le choix d'avatar et la vérification du micro et de la caméra ;
  - les vignettes vidéo, en haut de l'écran ;
  - la barre de commandes : micro, caméra, partage d'écran, statut, chat, personnes, réglages ;
  - les panneaux chat, personnes et admin.
- **Communication Phaser ↔ React :** par un bus d'événements, déjà fourni par le modèle officiel.
- **Les autres avatars :** affichés avec environ 100 ms de retard, en glissant d'une position reçue à la suivante. Ils sautent directement à la bonne place après une téléportation ou un retour sur l'onglet.
- **Au-dessus de chaque tête :** le nom, un point de statut, et un indicateur quand la personne parle.

### 7.5 Serveur temps réel

**Principe : le client décide de son mouvement, le serveur vérifie** **[mon choix]**. C'est ce que font tous les projets existants, et c'est plus simple que de tout calculer côté serveur.

**À la connexion :**
1. `io.use` lit le cookie de session via Better Auth. La connexion est refusée s'il n'y a pas de session ou si le membre a été retiré.
2. Si la personne a déjà une connexion ouverte, l'ancienne reçoit `session:remplacee` et se ferme, avec le message « Ouvert dans un autre onglet ».
3. Le serveur place la personne à sa dernière position enregistrée. Si cette position est dans une zone où d'autres personnes sont en train de parler, il la place au point d'apparition, pour ne pas la faire tomber au milieu d'une réunion.
4. Le serveur envoie l'état de départ (la personne elle-même, les présents, la carte), puis annonce l'arrivée aux autres.

**Les événements** (C = client, S = serveur ; noms indicatifs) :

| Sens | Événement | Contenu | Remarque |
|---|---|---|---|
| C → S | `move` | `{x, y, dir, moving}`, en entiers | 10 fois par seconde au plus en mouvement ; tout de suite à l'arrêt ou au changement de direction |
| S → C | `world:tick` | les positions acceptées depuis le dernier envoi | toutes les 100 ms, en `volatile` |
| S → C | `move:correct` | `{x, y}` | position refusée : le client se recale |
| S → C | `player:joined` / `player:left` | profil public / identifiant | |
| C → S | `status:set` | le statut | |
| S → C | `status:changed` | identifiant, statut | |
| C → S | `chat:send` | `{canal, texte}` | 500 caractères au plus, nombre de messages limité |
| S → C | `chat:message` | le message | |
| S → C | `media:join` / `media:leave` | le nom de la room LiveKit et le jeton | voir §8 |
| C → S | `media:state` | `{micro, camera, ecran}` | pour l'affichage chez les autres |

**Les vérifications sur chaque `move`** : la position est dans la carte, sur une case praticable, et la distance parcourue ne dépasse pas la vitesse maximale multipliée par le temps écoulé, avec une marge. Tous les messages reçus sont vérifiés par un schéma zod.

**Ce qui est gardé où :**
- en mémoire : positions, statuts, connexions et groupes ;
- en base : la dernière position, enregistrée à la déconnexion et toutes les 60 secondes.

**À la déconnexion :** 10 secondes de délai avant d'annoncer le départ, pour qu'une brève coupure réseau ne fasse pas disparaître l'avatar. La récupération de connexion de Socket.io est activée.

**Une seule instance de serveur :** pas de répartition sur plusieurs machines en V1, c'est inutile pour 10 personnes.

---

## 8. Audio/vidéo de proximité

### 8.1 Groupes

Le **serveur** calcule les groupes de conversation 4 fois par seconde **[mon choix]** :
- **Dans une zone** (salle de réunion, espace de bureau) : tous ceux qui sont dans la même zone forment un groupe, quelle que soit la distance. Personne à l'extérieur ne peut les rejoindre, même collé au mur, et deux zones voisines ne s'entendent jamais.
- **Dans les espaces ouverts** (allées, coin détente, coin café) :
  - deux personnes à moins de **3 cases** l'une de l'autre sont reliées, et un groupe réunit toutes les personnes reliées de proche en proche ;
  - on ne rejoint un groupe **qu'à l'arrêt** : passer à côté de quelqu'un en marchant ne connecte pas ;
  - on quitte le groupe au-delà de **4 cases**. L'écart entre les deux distances évite que la conversation se coupe et se rétablisse en boucle à la limite.
- Un changement n'est appliqué que s'il dure **500 ms**.
- Les personnes en **Ne pas déranger** n'entrent dans aucun groupe.

Les conséquences voulues :
- assis à ton bureau, tu es seul, sauf si quelqu'un entre dans ton espace de bureau ;
- marcher dans une allée ne te fait entrer dans aucune conversation ;
- les appels ne durent que le temps des vraies conversations, ce qui limite les minutes LiveKit (§8.5).

Si l'équipe préfère des îlots où les voisins s'entendent en permanence, comme dans un open space, il suffit de dessiner une zone autour de l'îlot dans Tiled. Aucun code à changer.

Les distances et les délais sont des valeurs de départ, à régler à l'usage. Le calcul est une fonction pure dans le paquet partagé, testée unitairement.

**Mise à jour (octobre 2026).** Les espaces ouverts ne forment plus un cercle serré : le son baisse avec la distance (100 % jusqu'à 6 cases, silence à 14), et on rejoint la room de ceux qu'on pourrait entendre, à moins de 14 cases, qu'on marche ou non ; on y reste jusqu'à 15 cases. Entrer dans une zone n'attend plus que 150 ms. Le détail et les valeurs sont dans le README (« Le son selon la distance »). Les distances d'origine (3 et 4 cases, à l'arrêt) restent une configuration (`CLOSE_RANGE_GROUPING`).

### 8.2 LiveKit [mon choix]

- **Une room LiveKit par groupe.** Quand un groupe se forme ou change, le serveur envoie `media:join` à chaque membre, avec un jeton valable **uniquement pour cette room**. À la sortie, il envoie `media:leave`.
- **Fusion et séparation :** quand des groupes fusionnent ou se séparent, la partie la plus grande garde sa room et seuls les autres en changent. Changer de room coupe environ une seconde.
- **Confidentialité :** un client ne peut entrer que dans la room pour laquelle il a un jeton. C'est donc le serveur qui garantit la confidentialité des zones privées.
- **Une interface unique côté client** regroupe tout l'audio/vidéo : rejoindre une room avec un jeton, la quitter, gérer le micro, la caméra et le partage d'écran, recevoir les événements. On pourra ainsi passer plus tard à LiveKit hébergé chez nous, ou à du pair-à-pair, sans réécrire le reste.

### 8.3 Interface

- Avant d'entrer dans le bureau, un écran de vérification du micro et de la caméra, avec le choix des périphériques et un aperçu. Les choix sont mémorisés sur l'appareil.
- Les vignettes des membres du groupe s'affichent en haut de l'écran, avec leur nom et l'état de leur micro. Un clic agrandit une vignette ; un partage d'écran s'affiche en grand.
- La barre du bas contient le micro, la caméra, le partage d'écran et le statut.

### 8.4 Pourquoi LiveKit plutôt que du pair-à-pair

Le pair-à-pair est gratuit. Mais il faut alors écrire soi-même la mise en relation, la reconnexion et le partage d'écran, et prévoir un relais pour les réseaux d'entreprise : environ 15 % des utilisateurs en ont besoin, d'après WorkAdventure. LiveKit fournit tout ça, relais compris. C'est la solution simple et fiable.

### 8.5 Coûts

Tarifs de LiveKit Cloud vérifiés le 19/10/2026 sur [leur page](https://livekit.io/pricing) :
- **Offre Build, gratuite :** 5 000 minutes par mois. Une minute compte pour chaque personne connectée à une conversation.
- **Offre Ship, 50 $ par mois :** 150 000 minutes, puis 0,0005 $ la minute.

Avec les règles du §8.1, on n'est connecté que pendant les vraies conversations. 3 personnes qui parlent chacune environ 1 h 15 par jour atteignent la limite gratuite ; 5 personnes la dépassent.

**Décision [ton choix] :**
- On démarre sur l'offre gratuite, sans carte bancaire, et on passe à l'offre Ship si l'équipe dépasse la limite.
- Leur page n'indique pas ce qui se passe quand l'offre gratuite atteint ses 5 000 minutes : aucun dépassement n'y est facturé. On suit donc la consommation dans le tableau de bord de LiveKit pour voir venir la limite.
- Héberger LiveKit nous-mêmes reste possible plus tard, sans changer le code, grâce à l'interface du §8.2.

---

## 9. Chat

- **Tout le monde :** conservé en base. Les 200 derniers messages se chargent à l'ouverture.
- **À proximité :** envoyé aux membres du groupe actuel, sans être conservé. Désactivé quand on est seul.
- Texte brut avec liens cliquables, 500 caractères au plus, nombre de messages limité par personne.

## 10. Statuts et présence

- **Statuts, choisis à la main** **[mon choix]** :
  - Disponible (vert) ;
  - Occupé (orange) et Absent (gris), purement indicatifs ;
  - Ne pas déranger (rouge) : on ne peut plus être rejoint.
- **Présence :** on est « en ligne » tant que le bureau est ouvert dans un onglet, même en arrière-plan. Fermer l'onglet ou mettre l'ordinateur en veille fait passer « hors ligne » après le délai de 10 secondes du §7.5.
- **Pas d'absence automatique en V1.** Une page web ne voit que le clavier et la souris utilisés sur elle-même : quelqu'un qui travaille dans Figma serait marqué absent au bout de 10 minutes. La détection d'inactivité de tout l'ordinateur n'existe que dans Chrome et Edge, avec une autorisation : c'est pour la V1.1, en option.
- **Panneau « Personnes » :** les membres en ligne, puis ceux hors ligne, avec leur statut.

## 11. Données (PostgreSQL)

| Table | Contenu |
|---|---|
| `user`, `session`, `account`, `verification` | les tables de Better Auth. `user` reçoit en plus `role`, `avatarKey`, `lastX`, `lastY`, `lastDir` et `disabledAt` |
| `invitation` | `id`, `email`, `tokenHash`, `role`, `invitedBy`, `expiresAt`, `acceptedAt`, `revokedAt` |
| `chat_message` | `id`, `userId`, `body`, `createdAt` (canal « Tout le monde ») |
| `rateLimit` | la limitation des tentatives de connexion de Better Auth |

Le nom de la carte vient de la configuration, puisqu'il n'y a qu'un seul bureau. Pas de table « espace » en V1 **[mon choix]**.

## 12. Hébergement, configuration, exploitation

- **Railway :** un service Node, qui sert aussi le client compilé, et une base Postgres. Domaine personnalisé en HTTPS. Coût estimé : 5 à 15 $ par mois.
- **LiveKit Cloud :** un projet, dont les clés vont dans les variables d'environnement.
- **Resend :** envoi depuis un sous-domaine du domaine du studio, avec SPF, DKIM et DMARC configurés.
- **Variables d'environnement :** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`/`APP_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- **Déploiement :** les migrations Drizzle sont lancées à chaque déploiement, et le serveur écrit des journaux structurés.
- **Redémarrage :** tout le monde se reconnecte automatiquement. L'état du monde est en mémoire, mais les positions sont restaurées depuis la base.

## 13. Sécurité

- HTTPS partout. Cookies `httpOnly`, `Secure` et `SameSite=Lax`, avec la vérification d'origine de Better Auth.
- Tout ce qui vient du client est vérifié (zod) et considéré comme non fiable. Le débit est limité pour les connexions au bureau, les mouvements et le chat.
- Les jetons LiveKit ont une courte durée de vie et ne valent que pour une room. Les zones privées sont appliquées par le serveur.
- Aucune route d'administration n'est accessible sans session admin. Peu de plugins Better Auth, et les mises à jour de sécurité sont suivies.

## 14. Qualité et performances visées

- **Fluidité :** 60 images par seconde sur un portable milieu de gamme, avec 10 avatars et une visio en cours.
- **Réactivité :** les mouvements des autres paraissent fluides, avec un décalage ressenti sous 150 ms.
- **Audio/vidéo :** connecté en moins de 2 secondes après s'être approché.
- **Tests :**
  - tests unitaires pour les fonctions partagées : collisions, groupes, vérification des messages ;
  - tests d'intégration pour le code serveur qui traite les messages Socket.io ;
  - parcours complets avec Playwright :
    - invitation, puis création du compte, puis entrée dans le bureau ;
    - deux navigateurs qui se voient bouger ;
    - deux navigateurs qui se connectent en audio avec un micro et une caméra simulés.

## 15. Ordre de construction

1. **Socle :** monorepo, serveur, base, comptes (invitation, connexion, mot de passe oublié, e-mails), déploiement sur Railway.
2. **Le monde en solo :** carte Tiled, déplacement, collisions, profondeur, caméra.
3. **Multijoueur :** présence, synchronisation des mouvements, noms, statuts, panneau « Personnes ».
4. **Audio/vidéo :** groupes, zones privées, LiveKit, vignettes, micro, caméra, partage d'écran.
5. **Chat.**
6. **Finitions :** galerie d'avatars, panneau admin, crédits, carte définitive, mise en production.

Chaque étape est mise en ligne et utilisable avant de passer à la suivante.

## 16. Ce qu'il te faudra faire

- Acheter **LimeZu Modern Interiors** (version complète) et **Modern Office – Revamped**, pour environ 7 à 12 $, et me fournir les fichiers.
- Créer les comptes **Railway**, **LiveKit Cloud** et **Resend**. Leurs offres gratuites suffisent pour commencer.
- Choisir l'adresse de l'appli et l'adresse d'envoi des e-mails, et avoir accès aux réglages DNS du domaine.

## 17. Laissé au builder

- Les noms exacts des événements, l'organisation fine des fichiers, le choix des petites bibliothèques (état côté client, journaux).
- Le réglage des valeurs : vitesse, distances, fréquences, zoom.
- Le mécanisme précis qui empêche de s'inscrire sans invitation dans Better Auth.
- Le design détaillé de l'interface, à valider avec toi.

## 18. Risques

| Risque | Parade |
|---|---|
| Audio/vidéo qui échoue sur certains réseaux | LiveKit Cloud inclut le relais ; tests sur plusieurs réseaux dès l'étape 4 |
| Coût de LiveKit si l'équipe parle toute la journée | Suivre la consommation ; héberger LiveKit soi-même si besoin |
| Phaser 4 encore jeune (six mois) | S'en tenir aux bases (sprites, cartes, caméra, physique Arcade) ; aucun ancien plugin Phaser 3 |
| Alertes de sécurité de Better Auth | Peu de plugins, mises à jour rapides |
| Ambiguïté de la licence LimeZu par personne | Poser la question à LimeZu avant la mise en production |
| Coupure d'environ une seconde quand les groupes changent | Délai de 500 ms, et la plus grande partie garde sa room |

## 19. Questions ouvertes

1. **Le budget audio/vidéo** *(tranché)* : on démarre sur l'offre gratuite de LiveKit Cloud. Si l'équipe dépasse 5 000 minutes par mois, on passe à l'offre Ship, à 50 $ par mois **[ton choix]**. On garde donc Railway + LiveKit Cloud.
2. **La licence LimeZu par personne** : à demander à LimeZu avant la mise en production (§5.4).

## 20. Critères de réussite *(ma proposition)*

L'équipe utilise le bureau tous les jours pendant une semaine entière, sans retourner sur Meet ou Discord :
- tout le monde se connecte en moins de 10 secondes ;
- les conversations démarrent toutes seules quand on s'approche ;
- personne ne se plaint de saccades.
