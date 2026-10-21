# Décisions prises pendant la construction

Pendant l'exécution du plan, certaines questions n'avaient pas de réponse dans la conception ni dans le plan. Une décision a été prise à chaque fois pour ne pas bloquer le travail. Cette page les liste toutes. Chaque ligne donne ce qui a été décidé, pourquoi, et **ce que ça coûte si c'est faux**. Relis-les et signale celles qui ne te vont pas.

## Organisation du travail

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| Travail directement sur `main`, sans branche à part | Tu l'as choisi ; le dépôt était neuf | Rien |
| Pas de Docker en local : base PGlite (`pglite://.data/dev`), LiveKit local via `livekit-server --dev` | Tu as demandé d'éviter Docker | Le Dockerfile ne sera testé qu'au premier build Railway |
| Développement sur Node 22.14, image de production sur Node 24 (`engines.node >=22.12`) | Node 24 n'est pas installé ici | Une dépendance qui exigerait Node 24 casserait en dev (aucune connue) |
| Les documents de conception ont été recopiés à la main dans le dépôt | La copie automatique de l'appli n'avait pas eu lieu | Rien |
| Les étapes qui dépendent de toi sont mises de côté, et le travail continue avec la tâche suivante. Il s'agit du déploiement (tâche 8), de LiveKit Cloud (tâche 20), des assets LimeZu et de la carte (tâches 23 et 24) et des essais réels (tâche 26). | Elles demandent tes comptes ou tes achats | Des soucis propres au déploiement apparaîtront plus tard |
| Les tâches 23 (assets LimeZu, galerie d'avatars, réglages) et 24 (carte Tiled définitive, crédits) ne sont pas faites | Il faut d'abord acheter les assets et dessiner la carte | Rien |
| Tâche 26 : seules les vérifications automatiques et la section « Exploitation » du README sont faites | Le reste demande la production | Rien, le reste est listé pour toi |
| Rien n'est poussé (`git push`) | Le dépôt n'a pas de remote, et pousser demande ton accord | Un push à faire à la main |
| La correction du README de la tâche 26 a été relue par moi, sans relecteur séparé | Une dizaine de lignes de texte, déjà vérifiées une première fois | Une coquille dans le README |
| La relecture finale a été suivie d'une seule vague de corrections, qui reprend les 3 points importants et les 8 petits. Restent de côté l'identifiant de version dans `init` et la limite de débit sur `PATCH /api/me`. | Le prochain usage est le premier vrai jour de l'équipe | Un correctif plus gros à relire |

## Outils et conventions

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| Les tests importent `test`, `expect`, `vi`… depuis `vitest`, sans globals | Les extraits du plan ne passaient pas avec sa propre config | Rien (style) |
| TypeScript 7.0.2 est gardé ; chaque paquet déclare ses `types` | C'est la version actuelle | Un outil qui aurait besoin de l'ancienne API forcerait un retour en 6.x |
| Le port de dev est 4000 au lieu de 3000 | Tes autres projets occupent le 3000 | Rien |
| Les commandes de test et de smoke test définissent aussi `BETTER_AUTH_SECRET` | Le plan oubliait cette variable obligatoire | Rien |
| La télémétrie anonyme du modèle Phaser est retirée | Respect de la vie privée ; elle ne fait pas partie du produit | Rien |
| Un test e2e instable (`world.spec.ts`, maintien de touche) est corrigé côté test | Le dépassement venait du test | Rien |

## Comptes, connexion, invitations

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| Les routes de Better Auth pour changer le profil, l'e-mail ou supprimer le compte sont coupées ; seul `PATCH /api/me` modifie le profil | Better Auth contournait les règles sur le nom affiché | Rien |
| La page d'inscription gère aussi « invitation inconnue » et « adresse déjà membre », en français | Ces réponses existent côté serveur | Rien |
| Les e-mails envoyés en arrière-plan journalisent leurs erreurs au lieu de planter | Une panne de Resend ne doit pas arrêter le serveur | Le serveur planterait sur un e-mail raté |
| En dev (`MAILER=memory`), l'objet et le lien de chaque e-mail sont affichés dans le terminal | Sinon les liens d'invitation sont illisibles en dev | Rien |
| L'e-mail de mot de passe oublié part sans être attendu | L'attendre révélait, au temps de réponse, si un compte existe | Un échec d'envoi ne se voit que dans les journaux |
| Un nouveau mot de passe ferme toutes les autres sessions | Cas d'un compte compromis (pas demandé explicitement) | Tu es déconnecté de tes autres appareils après une réinitialisation |
| Après une réinitialisation, la personne revient sur `/connexion` avec un message de succès | La réinitialisation ne connecte personne | Rien |
| L'invitation envoyée par l'admin attend l'e-mail : en cas d'échec, réponse « mail_failed » et invitation gardée | L'admin doit savoir que l'e-mail n'est pas parti | Rien |
| La commande `admin:invite` prévient qu'il faut arrêter le serveur de dev quand la base est PGlite | Deux processus sur un même dossier PGlite perdent des écritures | Une invitation de dev perdue |
| L'adresse IP du client est lue derrière le proxy de Railway, pour que la limite de tentatives de connexion soit par personne | Sinon toutes les requêtes partagent un seul compteur | Limitation trop stricte ou trop lâche (à vérifier après le déploiement, voir README) |
| Toute limite par IP lit `X-Real-IP`, jamais `req.ip` | Le nombre de proxys de Railway n'est pas garanti | Des compteurs partagés ou contournables |
| La connexion temps réel lit la session sans la rafraîchir, et le client rafraîchit la session par HTTP toutes les 12 heures quand le bureau est ouvert | Une poignée de main WebSocket ne peut pas poser de cookie | Une session expirerait au bout de 30 jours d'usage temps réel seul |
| À la tâche 23 : rafraîchir la session côté client après un changement de profil ou d'avatar | La session n'est lue qu'au chargement | Avatar périmé jusqu'au rechargement |
| Un mode sans e-mail, `MAILER=none`, accepté en production : l'admin copie depuis le panneau Admin le lien d'invitation (à la création et avec « Nouveau lien », qui remplace « Renvoyer » quand rien n'est envoyé) et le lien de mot de passe (« Lien de mot de passe » sur chaque membre), et les transmet lui-même. Le lien n'est montré qu'à cet instant (la base n'en garde que l'empreinte), jamais journalisé (une ligne dit seulement quel admin a demandé un lien de mot de passe, et pour quel membre) ni relisible ; la page « Mot de passe oublié » dit de demander à un admin. `resend` reste possible, `memory` reste refusé en production | Pour deux ou trois personnes, Resend (un service payant, avec un domaine d'envoi à vérifier) n'est pas nécessaire : le coût doit rester le plus bas possible | Un lien voyage par un canal de discussion (Slack, WhatsApp…) au lieu d'un e-mail, et un admin peut lire le lien qu'il génère : avec un lien de mot de passe, il peut prendre la main sur le compte d'un autre membre, un admin compris (la personne le voit : ses sessions sont fermées). L'admin pouvait déjà inviter qui il voulait. Repasser à `MAILER=resend` rend les e-mails ; un admin seul qui perd son mot de passe passe par un second admin, créé avec `admin:invite` pour une autre adresse (`prenom+admin2@domaine.fr` est acceptée), qui lui donne un lien avec « Lien de mot de passe » |

## Temps réel et déplacements

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| La reprise automatique de connexion de Socket.io est désactivée, contrairement au §7.5 de la conception. Le délai de grâce de 10 s et un `init` frais donnent le même résultat visible. | Elle rejouait le trafic manqué avant le contrôle d'authentification, ce qui pouvait fuiter à un membre retiré | Un message « À proximité » envoyé pendant une coupure de moins de 10 s n'est pas rejoué |
| Battement de cœur toutes les 10 s, coupure après 5 s sans réponse | Avec les réglages par défaut, un portable en veille n'était détecté qu'après environ 55 s ; la conception dit 10 s | Un peu plus de trafic |
| La connexion temps réel refuse une origine (`Origin`) différente du site | Défense contre le détournement de WebSocket depuis un autre site | Rien |
| Le client réessaie avec un délai croissant quand le serveur répond « indisponible » | Socket.io ne réessaie pas seul après un refus | Rien |
| Le serveur utilise une horloge monotone, et les arrivées se font au point d'apparition choisi par le serveur | Un saut de l'horloge système fausserait la validation des mouvements | Rien |
| Le client envoie sa position arrondie vers le bas et renvoie son état « arrêté » après une correction du serveur | Sinon un joueur pouvait rester « en marche » pour le serveur, donc exclu des groupes | Rien |
| Le client renvoie une fois son arrêt 500 ms après s'être arrêté | Un arrêt avalé par la limite de débit laisserait l'avatar marcher chez les autres | Un message de plus par arrêt |
| Le corps de collision de l'avatar descend d'1 px sous les pieds | Sinon les mouvements contre un mur sud étaient refusés et l'avatar tressautait | Rien |
| Le serveur vérifie que le joueur existe avant d'appliquer un mouvement | Pour distinguer « inconnu » de « refusé » | Rien |
| À l'arrêt, le serveur enregistre toutes les positions avant de fermer les connexions | Pendant un déploiement, sinon, on pourrait relire une position périmée | Rien |
| Les minuteries du tick et des groupes sont protégées par un try/catch qui journalise | Une erreur dans un intervalle arrêterait tout | Rien |
| Les autres avatars sont affichés avec 150 ms de retard au lieu de 100 ms (la conception dit « environ 100 ms ») | À 100 ms, les avatars s'arrêtaient environ une fois par seconde, ce qui fait des déplacements saccadés | 50 ms de latence de plus pour voir bouger les autres |
| Quand les données manquent, un avatar en mouvement est prolongé sur sa trajectoire 60 ms au plus (le plan disait : pas d'extrapolation) | Il restait des micro-pauses visibles | Jusqu'à environ 10 px de dépassement, puis une petite correction |
| Cette extrapolation s'arrête aux murs | Sinon un joueur collé à un mur était dessiné dedans | Rien |
| Un « saut » d'avatar se définit comme une distance que la marche ne peut pas expliquer | Le seuil du plan contredisait un de ses propres tests | Rien |
| La caméra suit l'avatar sans se recentrer sur le point d'apparition | Sinon la caméra saute | Rien |
| La carte à charger est donnée par le serveur dans `init`, au lieu d'être écrite en dur | Passer à la carte définitive ne demandera pas de recompiler le client | Rien |
| Les avatars passent par un seul accès `avatarSpec`, qui prend l'avatar par défaut pour une clé inconnue | Un autre joueur peut porter une clé que ce client ne connaît pas | Plantage sur un avatar inconnu |
| `LocalPlayer` expose `movePayload()` au lieu de `state()` | Le nom `state` existe déjà dans Phaser | Rien |
| Le préchargeur de la tâche 10 ne charge que la carte ; les avatars arrivent à la tâche 11 | Le registre des avatars n'existait pas encore | Rien |

## Groupes de conversation

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| Quitter la zone d'un groupe privé (salle de réunion, bureau) est immédiat | Sinon il restait 500 ms pendant lesquelles on entendait une réunion privée | Rien |
| Le caractère « zone » d'un groupe est lu sur l'état courant | Sinon une personne restée dehors gardait le groupe 250 ms de trop | Rien |
| L'identifiant d'un groupe de zone n'est réutilisable que dans la même zone | Sinon les gens dans la salle rejoignaient pour 500 ms celui qui en sortait | Des personnes qui sortent ensemble d'une réunion perdent l'appel environ 1 s avant de se regrouper |
| Les identifiants de groupe sont attribués par vote des membres, en deux passes | La règle du plan (« le plus grand groupe d'abord ») coupait des gens qui n'avaient pas bougé | Aucun connu |
| En cas d'égalité, on garde le groupe qui reste dans sa zone | Sinon des gens immobiles étaient coupés | Rien |
| Un identifiant déjà utilisé par un groupe vivant n'est pas repris par un autre | Sinon des gens immobiles changeaient de salle (coupure d'environ 1 s) | Rien |

## Audio et vidéo

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| Un `media:join` pour la salle où l'on est déjà ne fait rien | Sinon chaque reconnexion coupait l'appel environ 1 s | Rien |
| La dernière consigne audio/vidéo reçue avant l'ouverture du bureau est gardée puis rejouée | Le serveur ne la renvoie pas | Rien |
| « Entrer » débloque le son, et un bouton « Activer le son » apparaît si le navigateur le bloque (Safari) | Les navigateurs bloquent la lecture sans geste de l'utilisateur | Rien |
| Une panne de connexion audio/vidéo s'affiche, avec un bouton « Reconnecter » | Sinon elle restait silencieuse jusqu'au changement de groupe suivant | Rien |
| La bibliothèque LiveKit n'est chargée qu'à la première conversation | Pour alléger le chargement | Rien |
| Les messages de refus du micro ou de la caméra sont plus précis que prévu, et « Entrer quand même » est toujours proposé | Ils sont plus justes | Rien |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY` et `LIVEKIT_API_SECRET` sont rognées à la lecture (les autres variables ne le sont pas) | Un espace ou un retour à la ligne collé avec la valeur dans Railway faisait répondre 401 à LiveKit Cloud pour chaque jeton, sans message clair (arrivé au propriétaire) | Une valeur qui devrait vraiment commencer ou finir par un espace serait modifiée (aucune ne le devrait) |

## Interface et chat

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| Un bandeau « connexion perdue, reconnexion… » s'affiche quand la connexion tombe | Avant, seuls les boutons grisaient | Rien |
| Le message « Bonjour {nom} » a été remplacé par la barre du bureau, et la déconnexion reste accessible (elle ira dans Réglages à la tâche 23) | C'est le shell définitif | Rien |
| Le clavier ne compte comme champ de saisie que les vrais champs texte, et les listes déroulantes | Sinon cliquer une case à cocher bloquait les déplacements | Rien |
| Les boutons Chat et Admin de la barre n'apparaissent qu'avec leurs panneaux | Avant, il n'y avait rien à ouvrir | Rien |
| Le chat retire les doublons par identifiant | Un message pouvait arriver deux fois au chargement | Rien |
| « Les 200 derniers messages » est une limite de lecture : rien n'est purgé en base | Conforme au §9 de la conception | La table grossit sans limite (négligeable pour une petite équipe) |
| Un code d'erreur « indisponible » existe pour le chat ; le brouillon est gardé en cas d'échec | Avant, une panne de base répondait « invalide » | Rien |
| « À proximité » n'est utilisable que pendant une conversation audio/vidéo | C'est la règle du plan | Pas de chat de proximité si LiveKit n'est pas configuré |
| Choix d'interface du chat : un brouillon par onglet, panneau gardé en mémoire une fois fermé, Chat et Personnes ouverts ensemble (depuis, un seul panneau à la fois : voir « Refonte de l'interface et nuit »), badge de non-lus sur « Tout le monde » seulement | Choix raisonnables, acceptés | Rien |

## Après la relecture finale

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| Le statut choisi (par exemple Ne pas déranger) est retenu par l'onglet et renvoyé après chaque reconnexion, sans être enregistré en base | La conception garde les statuts en mémoire ; un redéploiement les remettait à « Disponible » | Après un rechargement complet de la page, il faut remettre son statut |
| La connexion au bureau ne s'ouvre qu'au clic sur « Entrer » | Avant, quelqu'un resté sur l'écran d'entrée était déjà « dans » le bureau | Une barre de chargement d'environ 1 s après « Entrer » |
| Le statut retenu est oublié quand un autre onglet prend la place (« Utiliser ici ») ou à la déconnexion | Sinon un vieux choix reviendrait d'un autre onglet | Il faut remettre son statut après avoir changé d'onglet |
| Les appels à l'API LiveKit abandonnent au bout de 3 s | Un retrait en retard pouvait éjecter quelqu'un qui venait de revenir | Sur LiveKit Cloud, la bascule automatique vers une autre région est désactivée : pendant une panne régionale, un retrait échoue (avec un avertissement dans les journaux) au lieu d'être retenté ailleurs |
| La base PostgreSQL a des délais : 5 s pour se connecter, 10 s par requête (sauf pour les migrations) | Une base bloquée bloquait les arrivées et l'arrêt du serveur | Une requête légitime de plus de 10 s échouerait (aucune connue) |
| Changer de statut ou couper le micro ou la caméra est limité à 10 fois par seconde | Chaque changement est diffusé à tout le bureau | Rien pour un usage normal |
| Railway laisse 30 s au serveur pour s'arrêter (`drainingSeconds` dans `railway.json`, qui prime sur le tableau de bord) | Le temps d'enregistrer les positions | Un déploiement un peu plus lent |
| Les erreurs de base sont journalisées sans leurs valeurs (paramètres, et valeurs reprises dans le message) | Elles pouvaient contenir un jeton de session | Un diagnostic un peu moins précis dans les journaux |
| Les 4 petits points laissés par la dernière relecture ne sont pas corrigés tout de suite (voir plus bas) | Pas de deuxième vague de corrections : ils sont rares ou optionnels | Voir chaque point ci-dessous |

## Bureaux, grande carte, son selon la distance et états d'activité (octobre 2026)

Ajoutés après la première version, d'après la demande « update ». Là aussi, une décision a été prise à chaque fois qu'elle ne disait rien.

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| La grande carte est du code (`OFFICE`, dessinée avec `MapCanvas`), habillée des images du pack LimeZu (sols, murs, meubles) | Le plan reste vérifiable par des tests (atteignabilité, pièces closes) ; les images viennent d'un pipeline (`gen:assets`) | Dessiner la carte dans Tiled : garder les noms des zones et le calque `objets` |
| 66 × 47 cases, **6 bureaux de 9 × 7** (63 cases à décorer, contre 35 avant), une grande salle de 17 × 10, une salle de réunion de 14 × 10, une **zone détente de 42 × 12** | Moins de bureaux, plus grands et décorables ; la place gagnée sert à vivre ensemble (piscine, salon, musique) | Plus ou moins de places : changer les constantes de `office.ts` (les clés `A1`…`A6` restent) |
| `MAP_KEY` garde `dev-office` par défaut ; la bascule est `MAP_KEY=office` | Le README demandait déjà une bascule volontaire ; les tests et les e2e restent sur la petite carte | Oublier la variable laisse la petite carte (3 bureaux) |
| Un bureau = deux zones de même nom (`desk` + `door`), la clé de la place | Le nom de la zone est stable quand la carte change ; la porte sert au client (obstacle visuel et physique) | Une zone renommée dans Tiled détache son bureau en base |
| Le premier arrivé sans bureau reçoit la première place libre | « Chaque personne possède son propre bureau (attribué) » | Quelqu'un voudrait choisir : il change de place dans le panneau |
| Fermer la porte bloque l'entrée seulement : qui est déjà dedans reste | Évite de téléporter quelqu'un sans le dire ; « Exclure » existe pour ça | Quelqu'un reste dans un bureau fermé jusqu'à ce qu'on l'exclue |
| Les exclus et les admis ne sont pas enregistrés (valables le temps du serveur) | Moins de tables ; un redéploiement les efface, ce qui est une porte qui se rouvre | Un exclu revient après un déploiement : le réexclure |
| « Toquer » est un clic sur la porte, de près (3 cases), une fois toutes les 5 s | Pas de touche de plus à retenir ; évite le harcèlement | Un clic maladroit hors de portée affiche « porte fermée » sans toquer |
| La zone détente est une zone `private` (comme la salle de réunion) : tout le monde s'y entend | « Comme meeting, tout le monde s'entend dans cette grande zone » | Quelqu'un voudrait un coin plus calme : le déplacer dans un bureau ou la salle de réunion |
| La piscine est dessinée avec des tuiles de sol turquoise et une margelle faite par le script (le pack n'a pas d'eau) ; on ne marche pas dans l'eau | Aucune tuile d'eau dans le pack ; un bassin qui bloque évite des avatars qui flottent | Remplacer par de vraies tuiles d'eau si le pack en reçoit |
| Les murs horizontaux font 2 cases de haut, les verticaux 1 (convention des planches LimeZu) | C'est ainsi que sont dessinées les planches de murs | Les cartes d'avant (murs de 1 case) ne se lisent plus pareil ; elles sont régénérées |
| Le pack LimeZu n'est pas dans le dépôt : un script (`gen:assets`) range ce qui sert, le résultat est commité | La licence interdit de redistribuer les images ; les fichiers rangés sont utilisés dans l'appli | Le dépôt doit rester privé ; le crédit LimeZu est obligatoire |
| Les « singles » du pack Office (pièces de meubles modulaires) ne servent pas : les objets sont découpés à la main dans la grande planche | Un single n'est qu'un morceau de bureau ; une entrée de la curation est un objet entier | Plus d'éléments : ajouter une entrée dans `scripts/assets/curation/` et relancer `gen:assets` |
| Un avatar est une clé texte (`p.07` ou `c.corps.yeux.tenue.coiffure.accessoire`), assemblée dans le navigateur | Pas d'image par personne à stocker ni à servir ; le serveur ne garde qu'une chaîne qu'il valide | Un build qui ne connaît pas une pièce affiche le personnage prêt de la personne |
| Sans avatar choisi, chaque personne a un des 20 personnages prêts, toujours le même (d'après son identifiant) | Un bureau peuplé de clones ne ressemble à rien | Deux personnes peuvent avoir le même, tant qu'elles n'ont pas choisi |
| La déco d'un bureau appartient à la personne (table `desk_setup`), pas à la place | Elle suit son occupant quand il change de place, et reste s'il rend le bureau | Une personne retirée emporte sa déco (suppression en cascade) |
| Toute la déco s'enregistre d'un bloc et le serveur la valide en entier (`checkDecor`) | Un seul message, pas d'état à moitié valable ; le client et le serveur appliquent la même règle | Un geste valable seul peut être refusé en bloc : le message dit pourquoi |
| Les meubles solides d'un bureau n'arrêtent que celui qui les voit | Le serveur ne connaît que les cases de la carte ; refuser les pas contre un meuble coûterait un état de plus | Un client modifié traverse un meuble de bureau (comme il traverserait un tapis) |
| Le son suit la distance par une courbe douce (100 % jusqu'à 6 cases, silence à 14) | « Une grande zone à 100 %, puis ça réduit petit à petit » ; valeurs de départ, à régler à l'usage | Le rayon est trop grand ou trop petit : `AUDIO_FULL_DISTANCE_PX` et `AUDIO_SILENT_DISTANCE_PX` |
| Dans un espace ouvert, on rejoint la room à 14 cases, qu'on marche ou non | Le volume rend la voix inaudible à cette distance : plus besoin d'attendre l'arrêt | Plus de monde par room LiveKit (donc plus de minutes) dans l'espace ouvert |
| Le volume est réglé par le client (`setVolume`), pas par le serveur | Le client connaît les positions à 10 Hz sans aller-retour | Un client modifié entend tout : le son d'un espace ouvert n'est pas un secret |
| Entrer dans une zone attend 150 ms (500 ms ailleurs) ; calcul des groupes toutes les 100 ms | Le délai de 500 ms et le cycle de 250 ms faisaient une bonne part des 2 s ressenties | Quelqu'un qui frôle la zone peut y entrer une fraction de seconde |
| `livekit-client` est téléchargé à l'ouverture du bureau | Le premier `media:join` l'attendait | Un peu plus de données au chargement du bureau |
| Le reste des 2 s (connexion LiveKit puis micro, l'un après l'autre) n'est pas retouché | Demande de réécrire la file des opérations, très testée ; à mesurer en production d'abord | La première conversation d'une session reste plus lente que les suivantes |
| Un état d'activité passe avant le statut ; en prendre un ordinaire l'efface | Un seul point, un seul nom | Quelqu'un voudrait cumuler : créer un état qui fait les deux |
| « Être entendu » éteint se règle dans le jeton LiveKit (pas de micro) et rejoint la room avec un jeton neuf (environ 1 s) | Une garantie côté serveur, pas seulement un bouton | Une coupure d'environ 1 s à chaque changement de cet interrupteur |
| « Entendre » éteint est réglé par le client (volumes à 0) | LiveKit ne sait pas couper l'audio sans couper la vidéo d'un même participant | Un client modifié entend quand même |
| Sans entendre ni être entendu : hors de toute conversation, comme Ne pas déranger | Une conversation où personne ne parle ni n'écoute n'a pas de sens, et coûte des minutes | Rien |
| Douze états au plus par personne, 24 caractères de nom, couleur `#rrggbb` | Bornes courantes | Un plafond trop bas : `ACTIVITY_MAX_PER_USER` |
| L'état pris est en mémoire du serveur, pas en base | Comme le statut ; la connexion le redit après un redémarrage | Après un redémarrage, l'état revient si l'onglet est resté ouvert, sinon non |
| Le plein écran d'un partage ne concerne que celui des autres | Le sien serait un miroir à l'infini | Quelqu'un voudrait le voir en grand : le bouton est absent pour lui |

## Son, musique et refonte de l'interface (octobre 2026)

Ajoutés d'après la demande « retravail de l'interface » et « de la musique, des effets sonores », avec les boucles et le pack d'effets que tu as donnés. Une décision a été prise à chaque fois que la demande ne disait rien.

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| Deux circuits séparés, la **musique** et les **effets**, chacun avec son interrupteur et son volume ; la voix des autres n'en fait pas partie | « Masquer deux types de sons » : la musique, et tout ce qui n'est pas de la musique. La voix a déjà ses réglages (micro, sortie du système) | Quelqu'un voudrait couper aussi la voix des autres depuis ce panneau : c'est « Entendre » des états d'activité |
| Le son est joué par Web Audio (`AudioBufferSourceNode` en boucle), pas par des éléments `<audio>` | Un élément `<audio>` fait un petit trou au raccord d'une boucle, audible toutes les 15 secondes sur la plus courte ; Web Audio boucle à l'échantillon près | Un décodage de 53 s de stéréo pèse environ 19 Mo en mémoire (au plus trois ambiances sont gardées) |
| Les boucles sont livrées en `.ogg` (celui du pack) **et** en `.m4a` ; le moteur essaie d'abord ce que le navigateur dit lire, puis l'autre | Safari ne lit pas l'ogg ; l'ogg d'origine boucle sans coupure, pas toujours l'AAC (son décalage au début). Chaque copie pèse peu : les boucles sont courtes | Le dépôt grossit de 16 Mo (dont 4 Mo de copies AAC). Un navigateur qui ne lirait ni l'un ni l'autre n'aurait pas de musique |
| L'ogg est recopié **sans la pochette** (1,5 Mo par fichier) ni les étiquettes ; le flux audio est identique (vérifié : même empreinte du son décodé) | La pochette multipliait le poids par deux sans rien apporter | Aucune : le son est le même à l'échantillon près |
| Le contexte audio est à **44,1 kHz** | Tous les fichiers le sont : le navigateur ne les rééchantillonne pas au décodage (une boucle rééchantillonnée d'un bloc peut claquer à son raccord) | Un navigateur qui refuse cette fréquence prend la sienne (repli prévu) |
| Chaque son a un **gain mesuré** (volume intégré en LUFS pour une ambiance, RMS du moment le plus fort pour un effet), écrit dans `measured.generated.ts` par `gen:audio` | Les boucles vont de −11,6 à −15,1 LUFS et les effets de très doux à très forts : sans cela, un curseur ne voudrait pas dire la même chose d'un son à l'autre | Un son qui paraît trop fort ou trop doux : ajuster son `level` dans `catalog.ts` (effets), ou relancer `gen:audio` |
| Le curseur de volume vaut son **carré** en amplitude ; musique à 60 % et effets à 80 % par défaut | L'oreille entend des rapports : un curseur linéaire serait presque tout entier dans sa dernière moitié. La musique reste un fond | Trop bas ou trop haut : `DEFAULT_AUDIO_PREFS` |
| L'ambiance dépend de **l'endroit** : salle d'attente (connexion, accueil, couloir), concentration (bureaux, réunion), soleil (place centrale, piscine), crépuscule (salon), dérive (grande salle), expédition (coin musique) | Tu as décrit l'humeur de chaque morceau et donné deux usages (la salle d'attente pour les couloirs et la connexion) ; le reste est mon choix, le plus proche de ces humeurs | Une ambiance ailleurs : `sceneAt` (`scene-at.ts`), un seul endroit |
| Il faut rester **0,7 s** dans un autre endroit pour que l'ambiance change, et le fondu dure 2,4 s | Traverser une porte ou longer un mur ne doit pas faire changer la musique | La musique réagit trop tard ou trop tôt : `PLACE_SETTLE_MS` et `MUSIC_FADE_S` |
| Quand quelqu'un parle (soi-même compris), la musique descend à 30 % et remonte 1,2 s après la dernière voix | Une musique à pleine voix couvrirait la conversation ; le délai évite qu'elle pompe entre deux mots | `DUCK_LEVEL`, `DUCK_HOLD_MS` |
| La page de connexion et l'écran d'entrée jouent la salle d'attente dès le premier clic, avec un bouton **Musique** en haut à droite | Tu proposais cette ambiance pour la connexion ; sans bouton, on ne pourrait pas la couper avant d'entrer | Quelqu'un préfère le silence à la connexion : il coupe (c'est gardé), ou on retire la musique de `AuthLayout` |
| Un **seul onglet** joue du son : le dernier où l'on a cliqué ou tapé (un `BroadcastChannel` le dit aux autres) ; un onglet « Ouvert dans un autre onglet » ne joue rien | Deux onglets (la connexion laissée ouverte, un bureau) joueraient chacun leur musique, l'une sur l'autre : le genre de musique qui tourne « sans page ouverte » | Quelqu'un voudrait deux onglets qui jouent : retirer `useSingleTab` d'`AudioDirector` |
| La musique **continue en arrière-plan** (onglet masqué) | On garde le bureau ouvert en travaillant ailleurs ; la musique de travail en est une raison | Elle gênerait : la couper à la sortie de l'onglet (`visibilitychange`) est un petit changement |
| Les effets viennent des dossiers **UI**, **Other** (le toc toc) et **Musical Effects** du pack, tous les jingles au **vibraphone** | Tu indiquais Musical Effects ; ses jingles sont trop longs (1 à 4 s) pour un clic, donc les clics viennent du dossier UI du même pack. Une seule famille d'instrument rend le tout cohérent | Un effet qui déplaît : changer son fichier dans `SFX_SOURCES`, relancer `gen:audio` |
| Les clics sont posés **à un seul endroit** (un écouteur au clic), d'après `aria-expanded`, `aria-pressed` et les cases à cocher ; `data-sfx` les règle un par un | Une trentaine de boutons, dont certains dans des panneaux qui viendront : aucun à câbler | Un bouton qui sonne alors qu'il ne devrait pas : `data-sfx="none"` |
| En « Ne pas déranger », arrivées, départs, messages et toc toc ne sonnent pas ; ce qui vient de soi, si | Le statut dit « ne me dérange pas » | Quelqu'un voudrait être prévenu quand même : retirer `quiet()` dans `sfx-events.ts` |
| Une arrivée sonne une note, un départ la même, plus grave (vitesse 0,8) | Un seul fichier pour deux sens, et une famille de sons cohérente | Un départ trop discret : un fichier à lui |
| « Connexion perdue » ne sonne qu'après 1,5 s sans retour, et jamais pour un onglet remplacé ou une déconnexion | Se déconnecter coupe la connexion : un bruit d'erreur serait absurde | Un bruit manquant lors d'une vraie panne très brève : sans effet |
| Le son est **muet dans les tests** (`happy-dom` n'a pas Web Audio) ; les vrais fichiers sont éprouvés de bout en bout, dans Chromium | Les tests unitaires restent rapides et sûrs, et l'essentiel (le décodage, les ambiances, les déclencheurs) est vérifié dans un vrai navigateur | Un navigateur qu'on n'éprouve pas (Safari) peut se comporter autrement : l'AAC de repli y est à essayer à la main |
| Le pack d'effets n'a pas de fichier de licence : ses extraits sont dans l'appli, comme des fichiers servis | Rien à décider sans l'information ; le dépôt est privé | À vérifier auprès du vendeur avant de rendre le dépôt public (voir `CREDITS.txt`) |
| L'interface a des **jetons** (couleurs, rayons, ombres, tailles de texte) et des bulles dans le chat | « Plus travaillée et facile à lire » : mieux hiérarchisée, et d'un seul tenant | Un goût différent : tout est dans les jetons de `styles.css` |
| La première barre du bas, une seule rangée aux boutons qui perdaient leur nom par *container queries*, a été remplacée par des docks (voir « Refonte de l'interface et nuit » plus bas) | À 1 440 px la barre complète ne tenait pas sur une ligne ; trois docks, aux icônes qui parlent d'elles-mêmes, tiennent partout | Une icône qui ne parle pas : son nom est en infobulle et lu par les lecteurs d'écran |
| Les icônes sont celles de `lucide-react` (ISC), réunies dans `office/icons.tsx` | Voir « Refonte de l'interface et nuit » : des tracés collés à la main étaient fragiles | Le crédit Lucide est dans `CREDITS.txt` |
| Un thème sombre, d'abord écarté (le jeu était dessiné pour un fond clair), existe maintenant : `night`, qui est la lumière du bureau éteinte (`.office-ui[data-theme]`) | Voir « Refonte de l'interface et nuit » : le thème suit un état partagé du bureau, pas la préférence du système | Une demande de thème sombre à la carte : lier `data-theme` à `prefers-color-scheme` en plus |

## Refonte de l'interface et nuit (octobre 2026)

Ajoutés d'après la demande d'une interface refaite et d'une lumière qu'on éteint. Une décision a été prise à chaque fois que la demande ne disait rien.

| Décision | Pourquoi | Si c'est faux |
|---|---|---|
| Les icônes viennent de `lucide-react`, non de tracés collés à la main dans `icons.tsx` | Des tracés copiés à la main n'ont pas tous la même épaisseur ni les mêmes arrondis ; la bibliothèque les tient d'accord, et seules les icônes utilisées sont embarquées | La dépendance gêne : revenir à des tracés dans `icons.tsx`, dont les noms ne changeraient pas |
| La police est Instrument Sans (`@fontsource-variable/instrument-sans`, licence OFL, dans `CREDITS.txt`), servie avec l'appli | Lisible en petit, variable (une seule fonte pour toutes les graisses), et sans appel à un service tiers | Un goût différent : changer la `font-family` de `styles.css` |
| **Un seul panneau latéral à la fois** : en ouvrir un ferme l'autre | Le premier lot laissait Chat et Personnes ouverts ensemble ; deux panneaux côte à côte prenaient la place du jeu | Quelqu'un veut les deux : le panneau ouvert devient une liste de panneaux |
| La nuit est une **RenderTexture** d'obscurité trouée (paliers, halo des lampes, halo des personnes), non les `Light` de Phaser | Les lumières de Phaser sont limitées à 10 par passe, et une carte avec des lampes et des personnes en a bien plus ; la RenderTexture n'a pas de limite et rien n'est dessiné lumière allumée | La nuit est trop coûteuse sur un petit ordinateur : réduire les paliers dans `lighting.ts` |
| La lumière est **une pour tout le monde**, enregistrée (`office_lights`) et diffusée (`lights:changed`) | Un interrupteur que chacun règle de son côté ne serait qu'un réglage d'affichage ; partagé, c'est un geste que les autres voient | Quelqu'un veut sa propre nuit : l'apparence du menu « Moi » est faite pour cela |
| **Le serveur fait foi** : il vérifie la distance à l'interrupteur (3 cases) et laisse 800 ms entre deux changements d'une personne ; la lumière ne change qu'à `lights:changed` | Le client ne se croit pas : un client modifié pourrait éteindre de n'importe où, ou clignoter à l'infini | Un interrupteur qui semble ne rien faire : la personne est à plus de 3 cases, ou l'appui est venu trop vite |
| « Aller à mon bureau » **marche** (`auto-walk.ts`, `findPath` partagé) au lieu de téléporter | Une téléportation saute la carte : la personne apparaît d'un coup, sans que les autres la voient arriver ; en marchant, elle passe par les cases que le serveur accepte (`findPath`, le même code des deux côtés) | Quelqu'un préfère l'instantané : un bouton de plus, ou `debug:teleport` pour les tests |
| Le clignotement de néon au rallumage s'éteint avec `prefers-reduced-motion` | Un clignotement est exactement ce que ce réglage demande de retirer | Rien |


## Points restants

Ce sont des points connus, notés pour plus tard. Aucun ne bloque un premier usage par l'équipe.

**Robustesse, sans effet en pratique :**
- `OfficePage` : un clic sur « Entrer » avant la fin du montage ne connecterait pas. C'est impossible en pratique.

**Limites acceptées pour une équipe de confiance :**
- Un membre retiré ne peut pas être réinvité, et l'appli ne permet pas de le réactiver. Le README (« Retirer ») donne la commande SQL pour réactiver un compte retiré par erreur.
- Un client modifié pourrait rejoindre une salle audio/vidéo avec un ancien jeton pendant environ 11 minutes après en être sorti. Il apparaîtrait dans les vignettes.
- La vérification de vitesse des déplacements est souple. Les murs restent infranchissables.
- Un onglet resté ouvert pendant plusieurs jours garde l'ancien code. Il propose de recharger quand un fichier manque.
- Les réglages dans le bureau :
  - l'avatar se change (panneau Personnage), pas le nom ni le mot de passe (le mot de passe passe par « mot de passe oublié ») ;
  - micro et caméra ne se choisissent que sur l'écran d'entrée, en rechargeant la page.
