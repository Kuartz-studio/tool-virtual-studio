# Bureau virtuel façon Gather : recherche

*Recherche faite le 19 octobre 2026. Les versions et les prix ont été vérifiés ce jour-là sur les sources officielles : npm, GitHub et les pages des packs. Ce qui n'a pas pu être vérifié est marqué « non vérifié ».*

## En bref

- **Gather n'est pas en 3D.** C'est une vue de dessus légèrement inclinée : on voit le dessus et la face avant des objets. Un tri de profondeur fait passer l'avatar devant ou derrière un meuble selon sa position à l'écran. Phaser fait ça sans extension.
- **Phaser 4 est sorti.** La 4.0.0 date du 10 avril 2026, la dernière version est la 4.2.1 du 9 juillet 2026. Phaser 4 gère la vue de dessus et l'isométrique (la vue en losange de Habbo Hotel). Il n'a **aucune vraie 3D** : une caméra qui tourne obligerait à remplacer Phaser par three.js.
- **Assets.** En vue de dessus, il existe des kits complets : LimeZu pour environ 12 $, ou LPC, gratuit et libre avec crédits obligatoires. En isométrique, il n'existe aucun kit gratuit de bureau en pixel art avec des avatars personnalisables.
- **Technologies recommandées :**
  - Phaser 4 + Vite + TypeScript, avec React pour l'interface ;
  - Socket.io 4.8 ;
  - Better Auth pour l'inscription par mail et mot de passe ;
  - Resend pour les e-mails ;
  - PostgreSQL + Drizzle ;
  - Railway pour l'hébergement au départ.
- **Projets existants.** WorkAdventure, le plus abouti, tourne sur Phaser 4 et sert de très bonne référence d'architecture. Sa licence interdit en revanche de reprendre son code. SkyOffice est abandonné. Aucun clone Phaser + Socket.io n'a de vraie traction : on part de zéro, en reprenant les bonnes idées.
- **Pièges de licence.** Les assets de Gather, ceux de WorkAdventure et le dossier d'images de SkyOffice ne sont pas réutilisables. Les packs payants d'itch.io interdisent de publier leurs fichiers dans un dépôt public.

---

## 1. La question de la « 3D »

### Ce que fait Gather

- Une grille de 32 px et trois couches : une image de fond, puis les avatars et objets, puis une image de premier plan qui passe par-dessus les avatars.
- Les objets sont triés selon leur position verticale (y) : plus un objet est bas à l'écran, plus il est dessiné devant. Un ingénieur de Gather le décrit dans un article de janvier 2026 sur la refonte de leur monde.
- Les fauteuils sont coupés en deux images, l'avant et l'arrière, pour que les accoudoirs passent devant un avatar assis.

### Ce que Phaser 4 sait faire

- **Types de cartes.** Le calque de tuiles standard accepte les cartes Tiled orthogonales (vue de dessus), isométriques, décalées et hexagonales. Le nouveau calque GPU, plus rapide, n'accepte que l'orthogonal.
- **Outils isométriques :**
  - `getIsoTileAtWorldXY` trouve la case sous la souris ;
  - `createFromObjects(…, sortByY)` trie les objets par position verticale.
- **Lumières.** Le nouveau système (`setLighting(true)`) ajoute des lumières placées en hauteur et des ombres propres. C'est utile pour donner du relief à du pixel art plat : lampes de bureau, cycle jour/nuit.
- **Pas de 3D.** Les objets Mesh et Plane ont été retirés. La documentation dit vouloir « gérer la 3D correctement à l'avenir », sans date.
- **enable3d (Phaser + three.js) est à éviter :**
  - dernière version en mars 2025 ;
  - bloqué sur Phaser 3 ;
  - licence LGPL ;
  - Phaser n'y sert plus qu'à afficher l'interface.

### Les options

| Option | Rendu | Référence | Avec Phaser | Assets gratuits | Effort |
|---|---|---|---|---|---|
| **A. Vue de dessus inclinée + tri de profondeur** | Les objets montrent le dessus et la face ; l'avatar passe derrière et devant | Gather, WorkAdventure | Natif | Nombreux | Faible (base de comparaison) |
| **B. Isométrique (losange)** | Grille en diamant, murs du fond, relief marqué | Habbo Hotel | Natif, mais le tri est à écrire soi-même | Rares, avatars à faire | Environ 1,5 à 2 fois A (estimation) |
| **C. Vraie 3D avec rendu pixelisé** | Caméra libre, rendu basse résolution façon pixel | [Exemple three.js](https://threejs.org/examples/webgl_postprocessing_pixel.html) | Mauvais outil : three.js à la place de Phaser | Bons : modèles 3D CC0 de Kenney, KayKit, Quaternius | Plusieurs fois A (estimation) |
| **D. Sprite stacking** | Objets en tranches empilées, façon voxel, rotation fluide | SpriteStack | Code maison | Peu, à modéliser soi-même | Moyen, utile seulement si la caméra tourne |

Deux compléments possibles à A ou à B :

- **Lumières de Phaser 4 et normal maps.** Les normal maps se génèrent avec Laigter (gratuit). Elles donnent du relief et de l'éclairage à du pixel art plat, pour un effort faible à moyen.
- **Modèles 3D rendus en sprites dans Blender.** Ça comble le manque d'assets isométriques. Le rendu fait « 3D pixelisée » plutôt que pixel art dessiné à la main.

### Le déplacement selon l'option

- **A :** déplacement libre au clavier (flèches ou ZQSD). Le client envoie sa position 5 à 10 fois par seconde, et les autres avatars sont affichés en douceur.
- **B :** on clique sur une case et l'avatar y marche en calculant son chemin. Le réseau est plus simple : on envoie seulement la case visée.
- **C :** position et orientation 10 à 20 fois par seconde. Chacun bouge sa propre caméra.

### Les pièges de l'isométrique

- **Profondeur.** Un calque de tuiles n'a qu'une seule profondeur. Tout objet derrière lequel un avatar peut passer doit donc être un sprite à part, trié selon la position de ses « pieds ».
- **Grands meubles.** Un meuble qui couvre plusieurs cases se trie mal à côté d'un avatar. Il faut le découper en bandes d'une case, ou utiliser un tri plus élaboré.
- **Murs.** On ne met des murs que sur les deux bords du fond, comme dans Habbo. Sinon il faut les rendre transparents quand un avatar passe derrière.
- **Documentation.** Je n'ai trouvé aucun tutoriel récent d'isométrique pour Phaser 4 ; ceux qui existent datent de 2015 à 2018.

### Recommandation

1. **A sur Phaser 4.**
   - Tri par position verticale, meubles coupés en avant et arrière, calque de premier plan, ombres portées, et les lumières de Phaser 4 pour le relief.
   - C'est la technique de Gather, avec le moins de risque et le plus d'assets. WorkAdventure prouve que ces technologies tiennent la route.
2. **B sur Phaser 4**, si tu veux un rendu qui se lit clairement comme de la 3D. Les avatars sont alors à commander à un artiste ou à générer depuis des modèles 3D.
3. **C**, seulement si la caméra doit tourner. Il faut alors abandonner Phaser pour three.js, en gardant Socket.io.

---

## 2. Technologies

| Couche | Choix | Version (au 19/10/2026) | Pourquoi |
|---|---|---|---|
| Moteur de jeu | Phaser 4 | 4.2.1 (09/07/2026) | Stable depuis six mois ; une carte de bureau n'utilise que les parties qui ont peu changé |
| Projet client | Vite + TypeScript + React | Vite 8.3.4, TypeScript 7.0.2 | Modèle officiel `template-react-ts` ; React pour les panneaux (connexion, chat, réglages) |
| Cartes | Tiled | 1.12.2 (27/05/2026) | Format lu directement par Phaser |
| Temps réel | Socket.io | 4.8.4 (25/09/2026) | Imposé, et simple |
| Authentification | Better Auth | 1.7.11 (19/10/2026) | Mail + mot de passe, vérification d'e-mail, mot de passe oublié et limitation des tentatives inclus |
| E-mails | Resend + React Email | React Email 6.11.3 | 3 000 e-mails gratuits par mois |
| Base de données | PostgreSQL + Drizzle ORM | PostgreSQL 18.6, Drizzle 0.45.4 | Stable, alors que Prisma est en pleine bascule vers sa version 8 |
| Hébergement | Railway au départ, Hetzner + Coolify ensuite | n/a | Garde les connexions WebSocket ouvertes, pour environ 5 à 15 $ par mois |
| Audio/vidéo (phase 2) | LiveKit Cloud | livekit-client 2.23.0 | Offre gratuite, serveur relais inclus |

### Phaser

- **Créer le projet** avec `npm create @phaserjs/game@latest`, ou depuis le modèle `template-react-ts`. Ces modèles figent Phaser 4.0.0, Vite 6 et TypeScript 5.7 : il faut mettre à jour les dépendances juste après.
- **Plugins.** Ceux écrits pour l'ancien système de rendu de Phaser 3 doivent être adaptés. La collection de plugins Rex a une version Phaser 4 (`phaser4-rex-plugins` 4.2.0).
- **Ce qui change par rapport à Phaser 3 :**
  - un nouveau moteur de rendu WebGL ;
  - le rendu Canvas est déprécié ;
  - les effets et les masques sont devenus des « Filters ».

  Le code qui n'utilise que des sprites, du texte et des cartes « devrait fonctionner tel quel ».

### Tiled → Phaser

- Exporter en JSON avec les tilesets intégrés à la carte (« Embed Tileset ») : Phaser refuse les tilesets externes.
- Enregistrer les calques en CSV ou en Base64 non compressé. Phaser ignore les calques compressés.
- Utiliser des calques d'objets pour les zones, les points d'apparition, les portes et les collisions : rectangles, points ou polygones, avec des propriétés. Éviter les nouvelles formes « capsule » et les propriétés de type liste, dont le support par Phaser n'est pas vérifié.
- **Le serveur lit le même fichier JSON** pour connaître les collisions et les zones.

### Socket.io

- **Organisation.** Un seul namespace, une room par espace, et une par zone si besoin.
- **Qui décide du mouvement.** Il y a deux écoles :
  - le serveur décide : le client envoie ses touches, le serveur calcule les positions ;
  - le client décide et le serveur vérifie.

  Pour un bureau virtuel, tous les projets existants prennent la seconde, plus simple. C'est ce que je recommande (voir section 4).
- **Types d'envoi.** Les positions partent en `volatile` : un message est abandonné si la connexion n'est pas prête, un peu comme en UDP. Le chat et les arrivées partent en envoi normal, dont la livraison est garantie.
- **Reconnexion.** La récupération d'état (« connection state recovery ») restaure l'identifiant, les rooms et les messages manqués. Elle fonctionne avec l'adaptateur en mémoire et avec Redis Streams, pas avec l'adaptateur Redis classique. Garder `skipMiddlewares: false` pour que l'authentification soit revérifiée à chaque reconnexion.
- **Authentification.** Elle se fait à la connexion avec `io.use()`, en lisant le cookie de session.
- **Une seule adresse.** Servir le client, l'API et Socket.io depuis le même domaine. Ça évite les problèmes de cookies tiers et de CORS.
- **Plusieurs serveurs.** Il faut que chaque client retombe toujours sur le même serveur (sessions « collantes »), et ajouter l'adaptateur Redis Streams. Plus simple : un espace par serveur, et l'état reste en mémoire.
- **Colyseus** (utilisé par SkyOffice) fournirait d'office les rooms, une synchronisation binaire des seuls changements et la reconnexion. Avec Socket.io brut, on écrit tout ça nous-mêmes, mais c'est modeste pour un bureau de quelques personnes.

### Authentification par mail et mot de passe

**Better Auth (recommandé)**

- Vérification d'e-mail et mot de passe oublié inclus.
- Limitation des tentatives incluse. Elle est gardée en mémoire par défaut ; `storage: "database"` la conserve en base.
- Sessions stockées en base et envoyées en cookie, valables 7 jours et renouvelées à l'usage.
- Mots de passe hachés en scrypt, Argon2 en option.
- Adaptateur Drizzle disponible.
- Côté Socket.io : appeler `auth.api.getSession({ headers: fromNodeHeaders(socket.request.headers) })` dans `io.use`.
- Points d'attention :
  - Une dizaine d'alertes de sécurité ont été publiées entre juin et septembre 2026, surtout dans les plugins. Utiliser peu de plugins et mettre à jour vite.
  - Les appels serveur `auth.api` échappent à la limitation des tentatives : il faut limiter nous-mêmes les connexions socket.
  - Fermer les sockets d'un utilisateur quand il se déconnecte.

**Alternatives écartées**

- **Auth.js** a rejoint Better Auth en septembre 2025 et ne reçoit plus que des correctifs de sécurité.
- **Lucia** est déprécié depuis mars 2025.
- **Supabase Auth** n'est intéressant que si Supabase héberge aussi la base. Son serveur mail par défaut n'envoie que 2 e-mails par heure.
- **Clerk** stocke les utilisateurs chez Clerk, hors de notre base.
- **Passport** n'a ni vérification d'e-mail, ni mot de passe oublié, ni limitation des tentatives.

### E-mails de vérification et de réinitialisation

- **Resend :** 3 000 e-mails gratuits par mois, 100 par jour au maximum. Accepte directement les modèles React Email.
- **Autres :** Postmark (100 gratuits par mois, 15 $ les 10 000), AWS SES (0,16 $ les 1 000), Brevo (300 gratuits par jour).
- **Pour ne pas finir en spam :** envoyer depuis un sous-domaine, avec SPF, DKIM et DMARC configurés.

### Base de données

- **À stocker en base :**
  - les tables d'authentification ;
  - les espaces (fichier de carte, point d'apparition) et leurs membres ;
  - l'avatar de chaque utilisateur ;
  - la dernière position par espace, enregistrée à la déconnexion et toutes les 30 à 60 secondes ;
  - l'historique du chat des canaux permanents.
- **En mémoire seulement :** les positions en direct, qui est en ligne, qui est dans quelle zone, les groupes de proximité, les indicateurs « en train d'écrire » et l'état des appels.

### Hébergement (2 à 10 personnes connectées)

| Option | Coût | Remarques |
|---|---|---|
| Railway | environ 5 à 15 $/mois (estimation) | Ne coupe pas les WebSockets ; serveur et Postgres faciles à monter |
| Render | environ 13 $/mois (non vérifié) | L'offre gratuite s'endort après 15 minutes et la base gratuite expire après 30 jours |
| Fly.io | environ 44 $/mois | Le serveur coûte peu, mais Postgres géré par Fly démarre à 38 $ |
| Hetzner + Coolify | à partir d'environ 5,49 €/mois | Le moins cher, et le seul qui peut aussi héberger LiveKit. Sauvegardes et mises à jour à notre charge. Les petites offres apparaissent indisponibles en ce moment |
| Vercel | n/a | WebSockets en bêta, mais coupés à la limite de durée des fonctions (300 s en offre Hobby) et sans mémoire partagée entre instances. Bon seulement pour le client statique |

### Audio/vidéo de proximité (la fonction phare de Gather)

- **Pair-à-pair** (chacun connecté directement à chacun) :
  - fonctionne bien jusqu'à 4 personnes, car chacun encode un flux par interlocuteur ;
  - il faut un serveur relais (TURN) pour les gens derrière un pare-feu strict. WorkAdventure indique qu'environ 15 % des utilisateurs en ont besoin ;
  - relais possibles : coturn hébergé soi-même, ou Cloudflare TURN (0,05 $ par Go).
- **LiveKit** (un serveur qui redistribue les flux) :
  - offre cloud gratuite de 5 000 minutes par mois, assez pour 3 personnes qui se parlent une heure par jour ;
  - 50 $ par mois pour 150 000 minutes ;
  - peut être hébergé sur notre propre serveur, avec les ports UDP 50000 à 60000 ouverts.
- **L'approche de WorkAdventure :** pair-à-pair jusqu'à 4 personnes, puis bascule sur LiveKit au-delà. Recommandation : prévoir une seule interface pour l'audio/vidéo dès le départ, pour pouvoir changer de solution sans tout réécrire.

---

## 3. Assets pixel art

### Vue de dessus (style Gather)

**Option « look Gather », dépôt privé (environ 12 $)**

- **Les packs, tous de LimeZu :**
  - [Modern Interiors](https://limezu.itch.io/moderninteriors), version complète à partir de 1,50 $ :
    - des milliers de meubles, des murs et des sols modulaires, plus de 100 objets animés ;
    - le **Character Generator 2.0** : plus de 100 tenues, 200 coiffures, 80 accessoires et 9 teintes de peau ;
    - animations : immobile, course, assis, et des actions ;
    - 4 directions, déduites des fichiers de SkyOffice.
  - [Modern Office – Revamped](https://limezu.itch.io/modernoffice), 5 $ : plus de 300 éléments de bureau, avec plusieurs styles d'ombres.
  - [Modern Exteriors](https://limezu.itch.io/modernexteriors), à partir de 2,50 $ : rues, ville et véhicules animés.
  - [Modern UI](https://limezu.itch.io/modernuserinterface), à partir de 3,90 $ : fenêtres, boutons, boîtes de dialogue, et des portraits assortis au générateur d'avatars.
- **Taille.** Les packs existent en 16, 32 ou 48 px. Prendre **32 px**, l'échelle de Gather. Un seul artiste a tout dessiné, donc le style est cohérent.
- **Licence :**
  - usage commercial autorisé ;
  - **crédit obligatoire, avec un lien** ;
  - **redistribution interdite** : les fichiers restent dans un dépôt privé, ou dans un dossier ignoré par git et récupéré au moment du build ;
  - servir les images aux navigateurs pendant l'utilisation est normal ; les publier ne l'est pas.
- **Version gratuite.** Elle est réservée à un usage non commercial. Un outil interne de studio est sans doute un usage commercial : acheter la version payante.
- **Fichiers Tiled.** Aucun n'est fourni (seulement des PNG et des fichiers RPG Maker) : on monte nous-mêmes les tilesets dans Tiled.
- **À demander à LimeZu :** chaque membre de l'équipe doit-il acheter sa propre licence ?

**Option libre, dépôt public possible (gratuit)**

- **[LPC Revised](https://github.com/ElizaWy/LPC)** (sur GitHub, licence CC-BY 3.0 ou OGA-BY 3.0) :
  - meubles : bureau, photocopieuse, distributeur, ordinateur portable, machine à café, téléphones, télé, sièges, étagères, plantes, tapis ;
  - structure : sols, murs, portes, fenêtres ;
  - extérieur : arbres, fleurs ;
  - personnages : marche, immobile, assis, émotes, course.
- **Compléments :** [[LPC Revised] The Office](https://opengameart.org/content/lpc-revised-the-office) (choisir la licence OGA-BY) et [LPC Modern Streets](https://opengameart.org/content/lpc-modern-streets) (CC0).
- **Avatars :** le [Universal LPC Spritesheet Character Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) :
  - images de 64×64, 4 directions, cheveux, vêtements et peau en calques ;
  - chaque calque a sa propre licence : ne garder que ceux en CC0, CC-BY ou OGA-BY ;
  - le code du générateur est en GPL-3.0 : ne pas le copier dans notre client.
- **À prévoir :**
  - des crédits obligatoires : un fichier de crédits et un écran de crédits dans l'appli ;
  - LPC n'a ni écrans d'ordinateur ni tableaux blancs : ils sont à dessiner nous-mêmes ;
  - ne pas mélanger les corps LPC classiques et LPC Revised, dont les palettes et les tailles de tête diffèrent.

**Kenney (CC0)** : parfait pour un prototype, mais ses différents styles en 16 px ne vont ni entre eux ni avec LimeZu.

### Isométrique (style Habbo)

- **Meubles et sols :** [pixel_Salvaje Isometric Interiors](https://pixel-salvaje.itch.io/isometric-interiors), à partir de 18 $. Plus de 800 éléments, dont un bureau complet. Redistribution interdite.
- **Extérieur :** [Zephilie](https://zephilie.itch.io/isometric-pixel-art-assets) (CC BY 4.0) peut compléter. Vérifier d'abord que le style s'accorde.
- **Le gros manque, ce sont les avatars.** Il n'existe aucun avatar isométrique personnalisable gratuit. Deux solutions :
  - les commander à un artiste, sur un modèle à 8 directions ;
  - les générer depuis des modèles 3D (voir ci-dessous).
- **Alternative 100 % gratuite et cohérente :**
  - rendre le [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) et les [Kenney Mini Characters](https://kenney.nl/assets/mini-characters) (CC0) dans Blender, avec une caméra isométrique fixe, puis pixeliser ;
  - le rendu fait « 3D pixelisée », pas pixel art dessiné à la main ;
  - ne jamais le mélanger avec des packs dessinés à la main.

### Interface, émotes, polices

- **Interface :** [Kenney UI Pack – Pixel Adventure](https://kenney.nl/assets/ui-pack-pixel-adventure) (CC0), plus de 500 éléments : panneaux, boutons, curseurs.
- **Émotes :** [Kenney Emotes](https://kenney.nl/assets/emotes-pack) (CC0), 480 émotes, bulles comprises.
- **Polices pixel :**
  - en licence OFL 1.1 : Pixelify Sans, Silkscreen, VT323, Tiny5 et Press Start 2P (il faut renommer Press Start 2P si on la modifie) ;
  - en CC0 : [m5x7](https://managore.itch.io/m5x7) et [monogram](https://datagoblin.itch.io/monogram).

### Non réutilisables

- **Gather :** ses conditions d'utilisation interdisent de copier ses éléments ou d'en créer des dérivés, et de s'en servir pour construire un produit concurrent.
- **Le kit de cartes de WorkAdventure (map-starter-kit) :** ses tilesets ne servent que dans des cartes faites pour WorkAdventure.
- **SkyOffice :** le code est sous MIT, mais son dossier d'images contient des fichiers LimeZu redistribués, dont des personnages de la version gratuite, non commerciale. Ne pas copier ce dossier.
- **Habbo :** les dessins appartiennent à Sulake.

### Pièges de licence

1. **« Pas de redistribution »** (LimeZu, pixel_Salvaje, DonArg, Pixel Office, Cainos, Pipoya…) : mettre les fichiers dans un dépôt public, c'est les redistribuer, même si le pack était gratuit.
2. **CC-BY-SA** (certains calques LPC) : tout sprite modifié doit lui aussi être publié sous CC-BY-SA. Sur OpenGameArt, quand plusieurs licences sont proposées, on en choisit une : prendre OGA-BY ou CC-BY.
3. **GPL pour des images :** l'effet sur un projet non GPL est flou. À éviter.
4. **Attribution** (CC-BY, OGA-BY, LPC, LimeZu) : l'auteur, la licence et un lien, visibles dans l'appli. Kenney est en CC0, mais son logo est interdit.
5. **CC BY-ND** (aucune modification autorisée) : on ne peut même pas changer les couleurs.
6. **Licence contradictoire ou absente :** se fier au texte de la page et demander à l'auteur.

---

## 4. Ce qu'on retient des projets existants

### WorkAdventure, la référence ([GitHub](https://github.com/workadventure/workadventure))

- **Activité.** 5 900 étoiles, version 1.34.2 sortie le 16/10/2026, une nouvelle version par semaine. Tourne sur **Phaser 4.2** et Svelte 5.
- **Licence AGPL-3.0 + Commons Clause.** Interdiction de vendre un produit fait principalement de ce code, et obligation de publier notre code si on en reprend. On s'en inspire, mais **on ne copie aucun code**.
- **Cartes :**
  - Tiled en JSON, tuiles de 32×32, tilesets intégrés ;
  - un calque d'objets `floorLayer` indique où dessiner les personnages, et les calques placés après passent devant eux ;
  - la propriété `collides` marque les tuiles qui bloquent ;
  - un calque `start` définit les points d'apparition ;
  - des objets `area` portent des comportements : porte vers une autre carte, zone silencieuse, salle de réunion, son.
- **Les bulles de visio sont décidées par le serveur :**
  - seul un utilisateur arrêté peut rejoindre une bulle ;
  - il rejoint l'utilisateur libre le plus proche à moins de 64 px, ou un groupe dont le centre est à moins de 48 px ;
  - pair-à-pair jusqu'à 4 personnes, LiveKit au-delà.
- **Le mouvement est décidé par le client :**
  - il envoie `{x, y, direction, moving}` dès qu'il s'arrête ou change de direction, sinon toutes les 200 ms ;
  - le serveur découpe la carte en zones de 320×320 px et ne transmet les mouvements qu'aux clients qui voient la zone, par lots toutes les 100 ms ;
  - les autres avatars sont lissés sur 200 ms.
- **Points douloureux :**
  - environ 15 % des utilisateurs ont besoin d'un serveur relais pour l'audio/vidéo ;
  - l'auto-hébergement est lourd : WorkAdventure, LiveKit et coturn ;
  - un bug ouvert signale un décalage audio/vidéo quand on entre dans une bulle ou qu'on en sort.

### SkyOffice ([GitHub](https://github.com/kevinshen56714/SkyOffice))

- **État.** 1 300 étoiles, code sous MIT, mais **abandonné** : dernière modification du code en février 2024, et des signalements « impossible à compiler » restés sans réponse.
- **Technologies.** Phaser 3.55, Colyseus 0.14, React 18, PeerJS. Pas de comptes utilisateurs.
- **Bonnes idées :**
  - les meubles sont placés comme objets dans Tiled (chaise, ordinateur, tableau blanc) et triés par position verticale ;
  - une zone juste devant l'avatar détecte les objets : E pour s'asseoir, R pour utiliser un ordinateur ;
  - un ordinateur sert à partager son écran avec ceux qui l'utilisent.
- **À éviter :**
  - la position est envoyée à chaque image et jamais vérifiée par le serveur ;
  - il passe par le serveur public de PeerJS, sans relais, donc les appels échouent derrière les pare-feu ;
  - les nombres d'objets sont codés en dur ;
  - l'écran d'administration est accessible sans authentification.

### Clones Phaser + Socket.io

- **Aucun n'a de vraie traction.** Les clones populaires utilisent Colyseus ou Pixi.
- **Les plus proches de notre stack :**
  - [realkotob/rooms2d](https://github.com/realkotob/rooms2d) : MIT, Phaser 3 + Socket.io + PeerJS, volume selon la distance, 2021 ;
  - [Meshiest/demo-proximity-voice](https://github.com/Meshiest/demo-proximity-voice) : CC0, voix de proximité qui vient de la gauche ou de la droite selon la position.
- **Références récentes :**
  - [meetropolis](https://github.com/lass-machen/meetropolis) : Phaser 4 + Colyseus + LiveKit + Postgres, AGPL, mis à jour en octobre 2026. Ses zones audio privées sont gérées par le serveur ;
  - [small-village](https://github.com/hissinger/small-village) : Apache-2.0.
- **Sans licence :** [gather-clone](https://github.com/trevorwrightdev/gather-clone) et [2d-metaverse](https://github.com/hkirat/2d-metaverse) n'ont aucune licence, donc leur code ne peut pas être repris légalement.

### Isométrique

- [OpenHotel](https://github.com/openhotel/openhotel) est sous licence non commerciale (CC BY-NC-SA).
- Les serveurs « rétro » de Habbo sont à éviter : ils reposent sur les dessins de Sulake.

### Leçons pour notre architecture

1. **Le client décide de son mouvement, le serveur vérifie :**
   - les limites de la carte ;
   - la distance maximale parcourue dans un temps donné ;
   - les collisions (le serveur charge la même carte Tiled) ;
   - les zones verrouillées.

   Tout ce que le client envoie est considéré comme non fiable.
2. **Messages de mouvement :**
   - `{x, y, dir, moving}` en nombres entiers ;
   - envoyés à l'arrêt ou au changement de direction, sinon 5 à 10 fois par seconde ;
   - toujours livrer le dernier message « arrêté » ;
   - le serveur redistribue par room, par lots d'environ 100 ms ;
   - les autres avatars sont affichés avec 100 à 200 ms de retard, et leurs positions lissées.
3. **Cartes :**
   - Tiled, tilesets intégrés, tuiles de 32×32 ;
   - ordre des calques : sol, murs, personnages, premier plan ;
   - un calque d'objets typés, avec des identifiants stables : apparition, porte, réunion, zone privée, zone silencieuse ;
   - les meubles en objets, pour le tri et les interactions.
4. **Arrivée et départ :**
   - authentification à la connexion socket ;
   - envoi de la liste des joueurs présents, puis annonce de l'arrivée aux autres ;
   - retrait du joueur après un court délai de grâce quand il se déconnecte ;
   - une connexion en double chasse l'ancienne ;
   - une porte fait quitter la room A et rejoindre la room B à un point d'entrée nommé.
5. **Proximité :**
   - les groupes sont décidés par le serveur ;
   - on ne rejoint un groupe qu'à l'arrêt ;
   - attendre 500 à 750 ms avant de rejoindre ou de quitter un groupe, avec une distance de sortie plus grande que la distance d'entrée, pour éviter que ça clignote ;
   - les zones privées sont appliquées par le serveur.
6. **Audio/vidéo :**
   - pair-à-pair pour 2 à 4 personnes, avec la mise en relation via notre propre Socket.io ;
   - un serveur relais dès le premier jour, et HTTPS partout ;
   - LiveKit pour plus de 4 personnes ou pour les salles de réunion, derrière une interface unique.
7. **Profondeur et collisions :**
   - trier les sprites selon la position des pieds ;
   - la zone de collision ne couvre que les pieds ;
   - un calque de premier plan pour les encadrements de porte et les toits.
8. **Chat et présence :**
   - un chat temporaire pour la bulle, et des canaux permanents en base ;
   - des émotes validées ;
   - des statuts : en ligne, absent, occupé, ne pas déranger (qui fait sortir des bulles) ;
   - passage automatique en « absent » quand l'onglet est caché.
9. **À éviter :**
   - les serveurs publics de PeerJS ou de tableaux blancs ;
   - les objets et coordonnées codés en dur ;
   - la position envoyée à chaque image ;
   - les écrans d'administration sans authentification ;
   - les pièges de licence.

---

## 5. Non vérifié

- Le moteur utilisé par Gather. Une offre d'emploi mentionne Phaser, mais la page était inaccessible.
- Le nombre de directions des personnages LimeZu et LPC Revised, déduit des fichiers et de la norme LPC.
- Que le Kenney Furniture Kit actuel inclue encore les rendus isométriques. La source est une fiche de 2018.
- Le support par Phaser des formes « capsule » et des propriétés « liste » de Tiled 1.12.
- Les coûts de Railway (estimation) et de Render (tirés de résultats de recherche).
- Que le plugin Rex Board (grille isométrique et calcul de chemin) marche avec Phaser 4.
- Les écarts d'effort entre les options sont des estimations.
- Les notes de licence sont une lecture des textes, pas un avis juridique.

## Sources principales

- **Phaser :** [changelog v4.0.0](https://raw.githubusercontent.com/phaserjs/phaser/HEAD/changelog/v4/4.0/CHANGELOG-v4.0.0.md), [guide de migration](https://github.com/phaserjs/phaser/blob/master/changelog/v4/4.0/MIGRATION-GUIDE.md), [versions](https://github.com/phaserjs/phaser/releases)
- **Gather :** [Rebuilding Gather's virtual world](https://evangelinecheng.substack.com/p/rebuilding-gathers-virtual-world), [fond et premier plan](https://support.gather.town/articles/8324831589-mapmaker-background-foreground), [conditions d'utilisation](https://www.gather.town/terms-of-service)
- **Tiled :** [v1.12.2](https://github.com/mapeditor/tiled/releases/tag/v1.12.2)
- **Socket.io :** [rooms](https://socket.io/docs/v4/rooms/), [envois](https://socket.io/docs/v4/emitting-events/), [récupération de connexion](https://socket.io/docs/v4/connection-state-recovery), [middlewares](https://socket.io/docs/v4/middlewares/), [CORS](https://socket.io/docs/v4/handling-cors/), [plusieurs serveurs](https://socket.io/docs/v4/using-multiple-nodes/)
- **Lissage des positions :** [Gabriel Gambetta](https://www.gabrielgambetta.com/entity-interpolation.html)
- **Better Auth :** [mail + mot de passe](https://better-auth.com/docs/authentication/email-password), [limitation des tentatives](https://better-auth.com/docs/concepts/rate-limit), [Auth.js rejoint Better Auth](https://better-auth.com/blog/authjs-joins-better-auth), [alertes de sécurité](https://github.com/better-auth/better-auth/security/advisories)
- **E-mails :** [Resend](https://resend.com/pricing), [Postmark](https://postmarkapp.com/pricing)
- **Hébergement :** [Railway](https://docs.railway.com/networking/public-networking/specs-and-limits), [Fly.io](https://fly.io/docs/about/pricing/), [Render](https://render.com/docs/free), [Hetzner](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [Vercel WebSockets](https://vercel.com/support/articles/do-vercel-serverless-functions-support-websocket-connections)
- **Audio/vidéo :** [LiveKit](https://livekit.io/pricing), [ports LiveKit](https://docs.livekit.io/home/self-hosting/ports-firewall/), [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/)
- **Projets :** [WorkAdventure](https://github.com/workadventure/workadventure), [map-starter-kit](https://github.com/workadventure/map-starter-kit), [SkyOffice](https://github.com/kevinshen56714/SkyOffice), [enable3d](https://github.com/enable3d/enable3d)
- **Assets :** [LimeZu](https://limezu.itch.io/), [LPC Revised](https://github.com/ElizaWy/LPC), [Universal LPC Spritesheet Character Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator), [Kenney](https://kenney.nl/assets), [FAQ OpenGameArt](https://opengameart.org/content/faq)
