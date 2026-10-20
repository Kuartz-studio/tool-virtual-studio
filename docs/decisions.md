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
| Un mode sans e-mail, `MAILER=none`, accepté en production : l'admin copie depuis le panneau Admin le lien d'invitation (à la création et à « Renvoyer ») et le lien de mot de passe (« Lien de mot de passe » sur chaque membre), et les transmet lui-même. Le lien n'est montré qu'à cet instant (la base n'en garde que l'empreinte), jamais journalisé ni relisible ; la page « Mot de passe oublié » dit de demander à un admin. `resend` reste possible, `memory` reste refusé en production | Pour deux ou trois personnes, Resend (un service payant, avec un domaine d'envoi à vérifier) n'est pas nécessaire : le coût doit rester le plus bas possible | Un lien voyage par un canal de discussion (Slack, WhatsApp…) au lieu d'un e-mail, et un admin peut lire le lien qu'il génère : avec un lien de mot de passe, il peut prendre la main sur le compte d'un autre membre, un admin compris (la personne le voit : ses sessions sont fermées). L'admin pouvait déjà inviter qui il voulait. Repasser à `MAILER=resend` rend les e-mails ; un admin seul qui perd son mot de passe n'a personne pour lui donner un lien |

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
| Choix d'interface du chat : un brouillon par onglet, panneau gardé en mémoire une fois fermé, Chat et Personnes ouverts ensemble, badge de non-lus sur « Tout le monde » seulement | Choix raisonnables, acceptés | Rien |

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

## Points restants

Ce sont des points connus, notés pour plus tard. Aucun ne bloque un premier usage par l'équipe.

**Robustesse, sans effet en pratique :**
- `OfficePage` : un clic sur « Entrer » avant la fin du montage ne connecterait pas. C'est impossible en pratique.

**Limites acceptées pour une équipe de confiance :**
- Un membre retiré ne peut pas être réinvité, et l'appli ne permet pas de le réactiver. Le README (« Retirer ») donne la commande SQL pour réactiver un compte retiré par erreur.
- Un client modifié pourrait rejoindre une salle audio/vidéo avec un ancien jeton pendant environ 11 minutes après en être sorti. Il apparaîtrait dans les vignettes.
- La vérification de vitesse des déplacements est souple. Les murs restent infranchissables.
- Un onglet resté ouvert pendant plusieurs jours garde l'ancien code. Il propose de recharger quand un fichier manque.
- Tant que les tâches 23 et 24 ne sont pas faites :
  - tout le monde a le même avatar par défaut ;
  - il n'y a pas de réglages dans le bureau : nom, avatar et mot de passe ne se changent pas (le mot de passe passe par « mot de passe oublié ») ;
  - micro et caméra ne se choisissent que sur l'écran d'entrée, en rechargeant la page ;
  - la carte est la carte de développement.
