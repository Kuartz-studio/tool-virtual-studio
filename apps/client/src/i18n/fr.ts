import type { ActivityIcon, Status } from '@bureau/shared';

// Tous les textes de l'interface. Un texte variable porte des {clés}, que t() remplace.
export const fr = {
  common: {
    appName: 'Bureau virtuel',
    loading: 'Chargement…',
    retry: 'Réessayer',
    passwordHint: '{min} caractères minimum',
    errors: {
      network: 'Impossible de joindre le serveur. Vérifie ta connexion, puis réessaie.',
      unexpected: 'Une erreur est survenue. Réessaie dans un instant.',
      tooManyAttempts: 'Trop de tentatives. Patiente une minute, puis réessaie.',
    },
  },
  // Les éléments de l'interface (office/ui) : les noms de leurs boutons sans texte, qui sont aussi leurs infobulles.
  ui: {
    close: 'Fermer',
  },
  // Toute l'appli : une nouvelle version déployée pendant que l'onglet était ouvert, une page qui ne s'affiche pas.
  app: {
    newVersion: 'Nouvelle version disponible',
    newVersionHint: 'Recharge la page pour continuer.',
    reload: 'Recharger',
    error: {
      title: 'La page ne s\'affiche pas',
      message: 'Une nouvelle version est peut-être en ligne, ou la connexion a coupé. Recharge la page.',
    },
  },
  login: {
    title: 'Connexion',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    submit: 'Se connecter',
    submitting: 'Connexion…',
    forgotPassword: 'Mot de passe oublié ?',
    passwordChanged: 'Ton mot de passe a été changé. Connecte-toi avec le nouveau.',
    errors: {
      invalidCredentials: 'Adresse e-mail ou mot de passe incorrect.',
      accountDisabled: 'Ce compte a été désactivé.',
    },
  },
  join: {
    title: 'Rejoindre le bureau',
    intro: 'Choisis le nom que verront les autres, et ton mot de passe.',
    email: 'Adresse e-mail',
    name: 'Nom affiché',
    password: 'Mot de passe',
    submit: 'Créer mon compte',
    submitting: 'Création du compte…',
    signedInAs: 'Ce navigateur est connecté au compte {email}. Pour créer le compte de cette invitation, déconnecte-toi d\'abord.',
    signOutAndContinue: 'Se déconnecter et continuer',
    signingOut: 'Déconnexion…',
    goToLogin: 'Aller à la connexion',
    goToOffice: 'Aller au bureau',
    errors: {
      missingToken: 'Ce lien est incomplet. Ouvre en entier le lien d\'invitation qu\'on t\'a envoyé.',
      unknown: 'Ce lien d\'invitation n\'est pas valable. Vérifie que tu as ouvert en entier le lien d\'invitation qu\'on t\'a envoyé, ou demande une nouvelle invitation.',
      used: 'Ce lien d\'invitation est déjà utilisé : le compte existe. Connecte-toi avec ton adresse e-mail et ton mot de passe.',
      expired: 'Ce lien d\'invitation a expiré. Demande à un admin de te renvoyer l\'invitation.',
      revoked: 'Cette invitation a été annulée. Demande une nouvelle invitation à un admin.',
      alreadyMember: 'Un compte existe déjà pour cette adresse. Connecte-toi avec ton mot de passe.',
      invalid: 'Le nom doit compter de 1 à {maxName} caractères, et le mot de passe de {minPassword} à {maxPassword} caractères.',
    },
  },
  forgotPassword: {
    title: 'Mot de passe oublié',
    intro: 'Indique ton adresse e-mail : tu recevras un lien pour choisir un nouveau mot de passe.',
    email: 'Adresse e-mail',
    submit: 'Envoyer le lien',
    submitting: 'Envoi…',
    sent: 'Si un compte existe pour {email}, un e-mail vient de partir avec un lien pour choisir un nouveau mot de passe. Ce lien est valable une heure.',
    // Serveur sans e-mail (MAILER=none) : un admin envoie le lien lui-même (panneau Admin, « Lien de mot de passe »).
    noMail: 'Les e-mails ne sont pas activés sur ce bureau. Demande à un admin de t\'envoyer un lien de réinitialisation.',
    backToLogin: 'Retour à la connexion',
  },
  resetPassword: {
    title: 'Nouveau mot de passe',
    intro: 'Choisis ton nouveau mot de passe. Les sessions ouvertes avec l\'ancien seront fermées.',
    password: 'Nouveau mot de passe',
    submit: 'Changer le mot de passe',
    submitting: 'Enregistrement…',
    invalidLink: 'Ce lien n\'est plus valable : il a expiré, ou il a déjà servi.',
    requestNewLink: 'Demander un nouveau lien',
  },
  // Les statuts, choisis à la main (spec §10).
  status: {
    available: 'Disponible',
    busy: 'Occupé',
    away: 'Absent',
    dnd: 'Ne pas déranger',
  } satisfies Record<Status, string>,
  // La puce « Moi », en bas à gauche, et son menu : ton portrait, ton nom, ton statut et ton mode, puis ce qui te concerne (l'apparence, le
  // bureau, le son, la déconnexion : leurs lignes portent le nom de leur panneau, `character.toggle`, `desk.toggle`, `sound.toggle`).
  me: {
    chip: 'Mon profil',
    menu: 'Menu de mon profil',
    status: 'Statut',
    // Ce qu'un lecteur d'écran annonce quand ton statut (ou ton mode) change.
    statusChanged: 'Statut : {status}',
    mode: 'Mode',
  },
  // Les modes à la manière d'Apple, dans le menu de la puce « Moi » : « Normal » (aucun mode : la tuile verte), les modes tout prêts, puis « Mes modes » et la tuile qui en crée
  // un ; et, dans le panneau, ce qui est propre aux modes tout prêts (on les copie, on ne les modifie pas) et à l'emplacement (la pièce où un mode conduit).
  modes: {
    normal: 'Normal',
    normalHint: 'Aucun mode : ton statut ordinaire.',
    presetHints: {
      focus: 'Ta porte se ferme ; tu entends et on t\'entend toujours.',
      sport: 'Tu vas à la salle de sport, sans entendre ni être entendu ; en sortir te ramène à ton bureau.',
    },
    mine: 'Mes modes',
    create: 'Créer un mode',
    presetsTitle: 'Modes prêts à l\'emploi',
    presetsIntro: 'Concentration et Sport ne se modifient pas : copie-les en mode perso pour les changer.',
    duplicate: 'Dupliquer en mode perso',
    duplicateLabel: 'Dupliquer {label} en mode perso',
    place: 'Emplacement',
    placeHint: 'Prendre ce mode te conduit dans cette pièce ; en sortir te ramène à ton bureau. Sans emplacement, tu ne bouges pas.',
    placeMap: 'Pièces où le mode peut te conduire',
    placeIn: 'à {place}',
  },
  office: {
    signOut: 'Se déconnecter',
    signingOut: 'Déconnexion…',
    mapLoadFailed: 'Impossible de charger la carte du bureau. Recharge la page pour réessayer.',
    connecting: 'Connexion au bureau…',
    replaced: 'Ouvert dans un autre onglet',
    replacedHint: 'Le bureau ne peut être ouvert que dans un onglet à la fois. Utilise-le ici pour reprendre la main : l\'autre onglet s\'arrêtera.',
    useHere: 'Utiliser ici',
    // Le nom, pour les lecteurs d'écran, de la barre du bas : ton nom, ton statut, les commandes.
    barLabel: 'Barre du bureau',
    people: {
      toggle: 'Personnes',
      title: 'Personnes',
      // Le sélecteur : ceux du même lieu que soi, ou tous (chacun avec son compte, écrit à côté).
      tabsLabel: 'Qui afficher',
      here: 'Ici',
      all: 'Tout le bureau',
      // Le nom de la liste de ceux d'ici, et de celle de tous ceux qui sont en ligne, pour les lecteurs d'écran ; le titre, replié, de ceux qui ne le sont pas.
      hereList: 'Ici ({count})',
      online: 'En ligne ({count})',
      offline: 'Hors ligne ({count})',
      nobodyHere: 'Personne d\'autre ici pour l\'instant.',
      you: 'toi',
      // Sous le nom de quelqu'un de ta conversation (son mode, s'il en a un, passe avant).
      talking: 'Parle avec toi',
      loadFailed: 'Impossible de charger la liste des membres.',
    },
    // Le lieu où l'on est (la puce en haut à gauche) et ceux qui y sont.
    where: {
      label: 'Lieu',
      // Les rues, et là où aucune zone de la carte ne porte de nom. Les pièces portent le nom que leur donne la carte (zone `place`).
      hallway: 'Couloir',
      onePerson: '1 personne ici',
      manyPeople: '{count} personnes ici',
    },
    // Le menu « Plus » de la barre du bas : ce qu'on ouvre moins souvent.
    more: {
      toggle: 'Plus',
      menu: 'Plus d\'options',
    },
    // La connexion au bureau est tombée après l'arrivée : Socket.io se reconnecte seul.
    reconnecting: 'Connexion perdue, reconnexion…',
    errors: {
      forbiddenOrigin: 'Le bureau refuse la connexion depuis cette page : ouvre l\'appli à son adresse habituelle.',
    },
  },
  // Les états d'activité (les « modes ») qu'on crée soi-même : un nom, une couleur, une icône, et ce qu'ils changent (entrée au bureau,
  // entendre, être entendu).
  states: {
    toggle: 'Mes états',
    title: 'Mes états d\'activité',
    intro: 'Crée tes états : un nom, une icône ou la couleur de ton point, et ce que chacun change pour toi. Tu les choisis ensuite dans le menu de ton profil, sous « Mode ».',
    listTitle: 'Mes états',
    empty: 'Aucun état pour l\'instant. Copie un mode prêt à l\'emploi, ou crée le tien ci-dessous.',
    take: 'Prendre',
    takeLabel: 'Prendre l\'état {label}',
    edit: 'Modifier',
    editLabel: 'Modifier l\'état {label}',
    remove: 'Supprimer',
    removeLabel: 'Supprimer l\'état {label}',
    current: 'En cours',
    formCreate: 'Nouvel état',
    formEdit: 'Modifier l\'état',
    label: 'Nom de l\'état',
    labelHint: '24 caractères au plus',
    // L'icône, facultative : quinze, dont le nom (pour les lecteurs d'écran et l'infobulle) est celui de la liste partagée.
    icon: 'Icône',
    iconHint: 'Facultative : sans icône, c\'est le point de la couleur. Clique de nouveau sur l\'icône choisie pour la retirer.',
    icons: {
      headphones: 'Casque',
      users: 'Personnes',
      coffee: 'Café',
      utensils: 'Repas',
      phone: 'Téléphone',
      'pen-tool': 'Plume',
      code: 'Code',
      'book-open': 'Livre',
      moon: 'Lune',
      plane: 'Avion',
      dumbbell: 'Haltère',
      music: 'Musique',
      check: 'Coche',
      waves: 'Vagues',
      'gamepad-2': 'Manette',
    } satisfies Record<ActivityIcon, string>,
    color: 'Couleur du point',
    colorCustom: 'Autre couleur',
    colorPick: 'Couleur {color}',
    switchesTitle: 'Ce que cet état change',
    allowEntry: 'Laisser entrer dans mon bureau',
    allowEntryOff: 'Ta porte reste fermée : on n\'entre que si tu laisses entrer.',
    hear: 'Entendre les autres',
    heard: 'Être entendu',
    cutOff: 'Sans entendre ni être entendu, tu sors de toutes les conversations.',
    create: 'Créer l\'état',
    save: 'Enregistrer',
    cancel: 'Annuler',
    saved: 'État enregistré.',
    // Ce qu'un état change, en résumé, dans la liste.
    summaryOpen: 'porte ouverte',
    summaryClosed: 'porte fermée',
    summaryHear: 'entend',
    summaryDeaf: 'n\'entend pas',
    summaryHeard: 'entendu',
    summaryMuted: 'pas entendu',
    // Le micro, quand l'état en cours coupe la voix.
    micCut: 'Ton état d\'activité « {label} » coupe ton micro.',
    errors: {
      limit: 'Tu as déjà {max} états : supprime-en un pour en créer un autre.',
      invalid: 'Ce nom ou cette couleur n\'est pas valable.',
      not_found: 'Cet état n\'existe plus.',
      generic: 'Cette action a échoué. Réessaie.',
    },
    loadFailed: 'Impossible de charger tes états.',
  },
  // Les bureaux : chacun a le sien, qu'il nomme, ferme à clé et dont il exclut qui il veut.
  desk: {
    toggle: 'Mon bureau',
    title: 'Mon bureau',
    close: 'Fermer le panneau Mon bureau',
    place: 'Place {key}',
    defaultName: 'Bureau de {name}',
    free: 'Libre',
    // Sans bureau (toutes les places étaient prises à l'arrivée, ou il a été rendu).
    none: 'Tu n\'as pas de bureau.',
    pickTitle: 'Choisis ta place',
    pickEmpty: 'Toutes les places sont prises.',
    take: 'Prendre la place {key}',
    // Le plan des places : une place prise dit qui l'a ; la sienne, « Toi ».
    takenBy: 'Place {key}, prise par {name}',
    you: 'Toi',
    yours: 'Place {key}, la tienne',
    // Les tuiles du panneau : y aller (ou « Tu y es », dedans), décorer, déménager (le plan des places libres s'ouvre dessous).
    gotoShort: 'Y aller',
    here: 'Tu y es',
    decorateShort: 'Décorer',
    moveTitle: 'Déménager',
    moveHint: 'Ta nouvelle place : ton nom, ta porte et ta déco te suivent.',
    // Le nom, modifiable sur place (enregistré en quittant le champ, ou avec Entrée).
    nameLabel: 'Nom du bureau',
    nameSaved: 'Nom enregistré.',
    // La porte : un interrupteur (allumé : fermée à clé) qui dit son état.
    lockSwitch: 'Fermer la porte',
    doorOpen: 'Porte ouverte',
    doorLocked: 'Porte fermée',
    openHint: 'Tout le monde peut entrer.',
    lockHint: 'On toque pour entrer.',
    closedByState: 'Ta porte est fermée par ton état d\'activité du moment.',
    goto: 'Aller à mon bureau',
    // Le bouton du dock quand on est dans son bureau : il ouvre le panneau du bureau (`title`).
    settings: 'Réglages du bureau',
    release: 'Rendre mon bureau',
    releaseConfirm: 'Rendre ce bureau ?',
    releaseHint: 'Ta place redevient libre, et ta déco t\'attend à la prochaine.',
    releaseYes: 'Oui, le rendre',
    releaseNo: 'Annuler',
    insideTitle: 'Dans ton bureau',
    insideEmpty: 'Personne d\'autre pour l\'instant.',
    kickLabel: 'Exclure {name} de ton bureau',
    bannedTitle: 'Exclus',
    unbanLabel: 'Réadmettre {name}',
    // Devant la porte fermée de quelqu'un d'autre.
    doorClosed: '{name} : porte fermée. Clique sur la porte pour toquer.',
    doorBanned: 'Tu ne peux pas entrer dans le bureau de {name}.',
    knockSent: 'Tu as toqué à la porte de {name}.',
    knockToast: '{name} toque à la porte de ton bureau.',
    admit: 'Laisser entrer',
    admitLabel: 'Laisser entrer {name}',
    ignore: 'Ignorer',
    ignoreLabel: 'Ignorer {name}',
    decorate: 'Décorer mon bureau',
    errors: {
      taken: 'Cette place vient d\'être prise.',
      unknown_desk: 'Cette place n\'existe pas.',
      no_desk: 'Tu n\'as pas de bureau.',
      not_inside: 'Cette personne n\'est plus dans ton bureau.',
      not_locked: 'Cette porte est ouverte.',
      bad_decor: 'Cette déco n\'est pas valable.',
      rate_limited: 'Trop d\'actions à la suite. Patiente un instant.',
      generic: 'Cette action a échoué. Réessaie.',
    },
  },
  // Les boutons de zoom du jeu, en bas à droite : de 25 % à 200 %, 100 % au départ ; le pourcentage du milieu le rétablit.
  zoom: {
    group: 'Zoom',
    in: 'Zoom avant',
    out: 'Zoom arrière',
    reset: 'Rétablir le zoom (100 %)',
    level: '{percent} %',
  },
  // La lumière du bureau : une pour tout le monde, que l'interrupteur du couloir allume ou éteint (touche E ou clic, de près). `off` et `on` sont
  // le message que voient les autres, `selfOff` et `selfOn` celui de qui a appuyé ; `use` et `useOn` ce que dit l'étiquette de l'interrupteur
  // (« [E] Éteindre » quand c'est allumé, « [E] Allumer » quand c'est éteint).
  lights: {
    off: '{name} a éteint la lumière',
    on: '{name} a rallumé la lumière',
    selfOff: 'Tu as éteint la lumière',
    selfOn: 'Tu as rallumé la lumière',
    use: 'Éteindre',
    useOn: 'Allumer',
  },
  // La musique de la pièce où l'on est : l'enceinte (« [E] Couper la musique », de près) et le bouton haut-parleur de la puce du lieu, dont la fenêtre règle l'état de la
  // pièce pour tous ceux qui y sont : allumée ou coupée, et son ambiance (« Par défaut » : celle que la carte lui donne). Dans un bureau, son propriétaire seul y touche.
  roomMusic: {
    mute: 'Couper la musique',
    play: 'Lancer la musique',
    // Le bouton de la puce du lieu, et la fenêtre qu'il ouvre : le même nom, qui est aussi l'infobulle.
    button: 'Musique de la pièce',
    title: 'Musique de la pièce',
    on: 'Musique allumée',
    // Le nom du groupe des ambiances, pour les lecteurs d'écran, et son premier choix : celle de la carte.
    scenes: 'Ambiance de la pièce',
    default: 'Par défaut',
    defaultHint: 'L\'ambiance de la pièce : {scene}',
    // Qui a réglé la pièce en dernier.
    by: 'Réglée par {name}',
    // Quand on écoute une ambiance choisie dans le panneau Son (son casque), le réglage de la pièce vaut pour les autres.
    headphones: 'Tu écoutes l\'ambiance choisie dans le panneau Son : ce réglage est pour ceux qui sont ici.',
  },
  // Le café : la machine du bar (« [E] Prendre un café », de près) et la pastille qui compte ce qu'il en reste, sous la puce du lieu.
  coffee: {
    take: 'Prendre un café',
    // La pastille, en secondes ; et son nom pour les lecteurs d'écran.
    left: '{seconds} s',
    pill: 'Café : encore {seconds} s',
  },
  // Les jeux de la salle de jeu (échecs, backgammon, Puissance 4, petits chevaux) : tout ce qui est commun aux quatre. Ce qui est propre à un jeu (ses cases, ses pièces, ses
  // raisons de fin, ses règles) est dans le fichier de textes de son dossier (`games/<jeu>/fr.ts`).
  games: {
    names: { chess: 'Échecs', backgammon: 'Backgammon', connect4: 'Puissance 4', ludo: 'Petits chevaux' },
    // Ce que dit l'étiquette « [E] » devant une table : s'y asseoir pour jouer, ou regarder la partie en cours.
    prompt: '[E] {game} : {action}',
    play: 'jouer',
    watch: 'regarder la partie',
    // Le panneau : son nom (celui de la table), le bouton des règles, les onglets.
    panel: 'Table de {game}',
    rules: 'Règles',
    rulesTitle: 'Règles du jeu',
    tabs: { label: 'Partie ou classement', match: 'Partie', ladder: 'Classement' },
    // Un jeu dont le module n'est pas là (le registre ne l'a pas) : sa table est fermée.
    soon: 'Bientôt disponible',
    soonHint: 'Ce jeu n\'est pas encore au bureau. Tu peux t\'asseoir à la table : la partie commencera quand il sera là.',
    loading: 'Chargement du jeu…',
    loadFailed: 'Impossible de charger le jeu. Ferme le panneau et rouvre-le pour réessayer.',
    // La salle d'attente : les chaises, qui est assis, le bouton « Prêt ».
    lobby: {
      title: 'À la table',
      free: 'Libre',
      seatLabel: 'Chaise {n}',
      sit: 'S\'asseoir',
      sitAt: 'S\'asseoir à la chaise {n}',
      stand: 'Se lever',
      ready: 'Prêt',
      notReady: 'Pas prêt',
      readyLabel: 'Je suis prêt',
      waitingFor: 'On attend {names}.',
      needMore: 'Il faut {count} joueurs au moins pour commencer.',
      allReady: 'Tout le monde est prêt : la partie commence.',
      sitHint: 'Assieds-toi à une chaise pour jouer, ou regarde la partie.',
      disconnected: 'déconnecté',
    },
    // Inviter quelqu'un du bureau à la table.
    invite: {
      toggle: 'Inviter quelqu\'un',
      title: 'Inviter à la table',
      nobody: 'Personne d\'autre n\'est en ligne.',
      send: 'Inviter',
      sendLabel: 'Inviter {name}',
      sent: 'Invitation envoyée à {name}.',
      busyNow: '{name} joue déjà une partie.',
    },
    // Le toast d'une invitation reçue, et les avis de ses réponses.
    invitedTo: { chess: 'aux échecs', backgammon: 'au backgammon', connect4: 'au Puissance 4', ludo: 'aux petits chevaux' },
    invitation: '{name} t\'invite {game}',
    accept: 'Accepter',
    decline: 'Refuser',
    acceptLabel: 'Accepter l\'invitation de {name}',
    declineLabel: 'Refuser l\'invitation de {name}',
    notice: {
      accepted: '{name} a rejoint la table de {game}.',
      declined: '{name} a refusé ton invitation.',
      expired: '{name} n\'a pas répondu à ton invitation.',
      gone: '{name} a quitté le bureau.',
    },
    // Les joueurs, d'une ligne à l'autre : le tour, le compte à rebours, la connexion, la sortie (une partie à plusieurs qui continue sans celui qui a abandonné).
    you: 'toi',
    turn: 'au trait',
    countdown: 'Il reste {time}',
    reconnect: 'déconnecté, encore {time}',
    out: 'sorti',
    timeWarning: 'Il reste moins d\'une minute pour jouer.',
    // La ligne d'état.
    status: {
      yourTurn: 'À toi de jouer',
      turnOf: 'Au tour de {name}',
      waiting: 'En attente de la partie',
      watching: 'Tu regardes la partie.',
      thinking: 'Coup en cours…',
      out: 'Tu as quitté la partie : elle continue sans toi.',
    },
    // Ce qui se passe quand une partie finit pour une raison que la plateforme écrit (celle d'un jeu est écrite par son module).
    end: {
      title: 'Partie finie',
      resign: '{loser} abandonne. {winner} gagne.',
      timeout: '{loser} n\'a pas joué depuis 5 minutes. {winner} gagne.',
      disconnect: '{loser} a quitté le bureau. {winner} gagne.',
      resignMany: '{loser} abandonne.',
      timeoutMany: '{loser} n\'a pas joué depuis 5 minutes.',
      disconnectMany: '{loser} a quitté le bureau.',
      agreement: 'Nulle par accord.',
      winner: '{name} gagne.',
      winners: '{names} gagnent.',
      won: 'Tu as gagné !',
      lost: 'Tu as perdu.',
      drawn: 'Match nul.',
      unranked: 'Partie non classée : il faut deux coups au moins pour compter au classement.',
      ratingLine: '{name} : {before} → {after} ({delta})',
    },
    // Les gestes d'une partie en cours, et d'une partie finie.
    actions: {
      resign: 'Abandonner',
      resignTitle: 'Abandonner la partie ?',
      resignBody: 'Tu perds la partie, et ton classement en tient compte.',
      resignConfirm: 'Abandonner',
      resignCancel: 'Annuler',
      rematch: 'Revanche',
      rematchWaiting: 'Revanche demandée : on attend l\'autre.',
      leave: 'Se lever',
      sit: 'S\'asseoir',
    },
    draw: {
      offer: 'Proposer la nulle',
      offered: 'Nulle proposée : on attend la réponse.',
      received: '{name} propose la nulle.',
      accept: 'Accepter la nulle',
      decline: 'Refuser',
    },
    spectators: {
      one: '1 spectateur : {names}',
      many: '{count} spectateurs : {names}',
    },
    interrupted: 'Partie interrompue : le serveur a redémarré. Les parties en cours ne sont pas gardées.',
    dismiss: 'Compris',
    // Pourquoi une commande de jeu est refusée (la réponse du serveur, `GameAck`) ; `stale`, un double clic ou un coup envoyé sur un état dépassé, n'est jamais montré.
    errors: {
      invalid: 'Commande refusée.',
      rate_limited: 'Doucement : trop de gestes à la suite.',
      unknown_game: 'Ce jeu n\'a pas de table ici.',
      too_far: 'Tu es trop loin de la table : approche-toi de la salle de jeu.',
      chair_taken: 'Cette chaise est déjà prise.',
      table_full: 'Toutes les chaises sont prises : tu peux regarder la partie.',
      already_here: 'Tu es déjà assis à cette table.',
      in_progress: 'Une partie est en cours à cette table.',
      busy: 'Une partie est en cours pour cette personne.',
      not_seated: 'Tu n\'es pas assis à cette table.',
      no_match: 'Aucune partie n\'est en cours.',
      stale: 'Coup trop tardif.',
      not_your_turn: 'Ce n\'est pas ton tour.',
      illegal: 'Coup refusé.',
      no_offer: 'Aucune nulle n\'est proposée.',
      already_offered: 'Une nulle est déjà proposée.',
      too_early: 'Trop tôt pour proposer la nulle : il faut jouer encore un peu.',
      self: 'Tu ne peux pas t\'inviter toi-même.',
      offline: 'Cette personne n\'est plus au bureau.',
      dnd: 'Cette personne ne veut pas être dérangée.',
      too_many: 'Trop d\'invitations en attente : patiente un instant.',
      expired: 'Cette invitation n\'est plus valable.',
      unavailable: 'Le serveur ne répond pas : réessaie dans un instant.',
    },
    // Le classement d'un jeu.
    ladder: {
      title: 'Classement',
      loading: 'Chargement du classement…',
      failed: 'Impossible de lire le classement.',
      retry: 'Réessayer',
      empty: 'Personne n\'est encore classé à ce jeu : la première partie classée ouvre la liste.',
      rank: 'Rang',
      player: 'Joueur',
      rating: 'Note',
      games: 'Parties',
      record: 'V / N / D',
      you: 'Ta place',
      table: 'Classement de {game}',
    },
  },
  // Le son : la musique d'ambiance (celle de l'endroit où l'on est, ou celle qu'on choisit) et les effets sonores (clics, arrivées, messages,
  // toc toc…), que l'on coupe et règle chacun de son côté, depuis le juke-box du dock du milieu. La voix des autres n'en fait pas partie : elle
  // suit le micro et la sortie du système.
  sound: {
    // Le bouton du dock (une note de musique) et sa fenêtre, le juke-box : le même nom, qui est aussi l'infobulle.
    toggle: 'Musique et ambiances',
    music: {
      label: 'Musique',
      volume: 'Volume de la musique',
    },
    effects: {
      label: 'Effets sonores',
      volume: 'Volume des effets sonores',
      test: 'Écouter un effet',
    },
    ambiance: {
      // Le nom du groupe des cartes, pour les lecteurs d'écran.
      label: 'Ambiance',
      auto: 'Selon la pièce',
      // L'infobulle de « Selon la pièce », et son sous-titre : l'ambiance de la pièce où l'on est (celle que ses occupants ont réglée, sinon l'ambiance qui lui va), ou
      // le silence quand ils ont coupé sa musique.
      autoHint: 'La musique change avec la pièce où tu es : celle que ses occupants ont réglée, sinon l\'ambiance qui lui va.',
      autoHere: 'Ici : {scene}',
      autoOff: 'Ici : musique coupée',
      // Dite aux lecteurs d'écran pour l'ambiance qu'on entend (l'égaliseur de sa carte est décoratif).
      playing: 'En cours',
    },
    // Les six ambiances : leur nom, ce qu'elles évoquent, et où elles jouent d'elles-mêmes.
    scenes: {
      lobby: { title: 'Salle d\'attente', mood: 'Calme, comme une ville la nuit', where: 'L\'accueil, la place et les rues, la connexion' },
      focus: { title: 'Concentration', mood: 'Chill, pour travailler ou se reposer', where: 'Les bureaux, la salle de réunion et la salle client' },
      sunny: { title: 'Soleil', mood: 'Joyeux et décontracté', where: 'Le café, la piscine et le salon' },
      dusk: { title: 'Crépuscule', mood: 'Mystérieux, façon Moyen Âge le soir', where: 'La salle de jeu' },
      drift: { title: 'Dérive', mood: 'Étrange et planant, un peu science-fiction', where: 'La salle de conférence' },
      quest: { title: 'Expédition', mood: 'Plus rythmé : aventure et découverte', where: 'La salle de sport' },
    },
    status: {
      locked: 'Le son démarre dès que tu cliques ou appuies sur une touche.',
      unsupported: 'Ce navigateur ne sait pas jouer le son de l\'appli.',
    },
    credits: 'Musique : Abstraction, « Music Loop Bundle » (CC0). Effets : « 400 Sounds Pack ».',
    // Le volume d'un curseur, lu par un lecteur d'écran.
    percent: '{percent} %',
  },
  // Le faux live (`pnpm dev:sim`) : le panneau « Bac à sable », réservé aux essais en local.
  // La déco du bureau : l'éditeur (panneau à droite, la pièce dans le jeu) et la banque d'éléments.
  decor: {
    toggle: 'Décorer',
    title: 'Décorer mon bureau',
    close: 'Fermer l\'éditeur de déco',
    noDesk: 'Prends d\'abord un bureau pour le décorer.',
    tabs: { label: 'Que régler', items: 'Objets', themes: 'Murs et sol' },
    categories: 'Catégories',
    items: 'Éléments : {category}',
    searchLabel: 'Chercher un élément',
    searchPlaceholder: 'Chercher…',
    empty: 'Aucun élément ne correspond.',
    help: 'Choisis un élément puis clique dans la pièce pour le poser ; sur un autre élément, il le remplace après confirmation. Clique sur un élément posé pour le reprendre, clic droit pour le jeter.',
    tools: 'Outils',
    erase: 'Gomme',
    eraseHelp: 'Gomme : clique sur un élément de la pièce pour l\'effacer. Échap pour reprendre la pose.',
    replace: {
      titleOne: 'Remplacer cet élément ?',
      titleMany: 'Remplacer ces éléments ?',
      bodyOne: 'Voulez-vous vraiment le remplacer par cet élément ?',
      bodyMany: 'Voulez-vous vraiment les remplacer par cet élément ?',
      detail: '{old} sera remplacé par {new}.',
      detailMany: '{old} seront remplacés par {new}.',
      confirm: 'Remplacer',
      cancel: 'Annuler',
    },
    held: 'En main : {name}. Clic dans la pièce pour le poser, clic droit pour le lâcher.',
    drop: 'Lâcher',
    floorTitle: 'Sol',
    wallTitle: 'Murs',
    count: '{count} / {max} éléments',
    unsaved: 'Modifications non enregistrées.',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    saved: 'Déco enregistrée.',
    cancel: 'Annuler',
    done: 'Fermer',
    reset: 'Poste par défaut',
    clear: 'Tout vider',
    // Sa déco enregistrée ne tient plus dans la pièce (la carte a changé) : le poste par défaut est montré, la déco reste en base, mais l'enregistrement d'une nouvelle la remplace.
    unfit: 'Ta déco enregistrée ne tient plus dans cette pièce depuis le changement de carte : c\'est le poste par défaut qui est montré, et enregistrer remplacera ta déco.',
    errors: {
      too_many: 'La pièce est pleine.',
      unknown_item: 'Cet élément n\'existe pas.',
      unknown_theme: 'Ce thème n\'existe pas.',
      bad_position: 'Cet élément ne se pose pas là.',
      out_of_room: 'Ça dépasse de la pièce.',
      overlap: 'Il y a déjà quelque chose ici.',
      blocks_door: 'Ça bloquerait ta porte.',
      unreachable: 'Un coin de la pièce deviendrait inaccessible.',
    },
    credits: 'Illustrations : LimeZu (limezu.itch.io)',
  },
  // Le builder de personnage.
  character: {
    // La ligne du menu « Moi » qui ouvre ce panneau.
    toggle: 'Changer d\'apparence',
    title: 'Mon personnage',
    close: 'Fermer le panneau Mon personnage',
    preview: 'Aperçu de ton personnage',
    previewWalk: 'Le voir marcher',
    tabs: { label: 'Comment le choisir', premade: 'Prêts à jouer', build: 'Créer le mien' },
    premadeLabel: 'Personnages prêts à jouer',
    premadeOne: 'Personnage {number}',
    parts: { body: 'Peau', eyes: 'Yeux', outfit: 'Tenue', hair: 'Coiffure', accessory: 'Accessoire' },
    partsLabel: 'Pièces du personnage',
    style: 'Modèle',
    color: 'Couleur',
    none: 'Aucun',
    bodyOne: 'Peau {number}',
    eyesOne: 'Yeux {number}',
    outfitOne: 'Tenue {number}',
    hairOne: 'Coiffure {number}',
    colorOne: 'Couleur {number}',
    random: 'Au hasard',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    saved: 'Personnage enregistré.',
    failed: 'Le personnage n\'a pas pu être enregistré. Réessaie.',
    loading: 'Assemblage…',
    credits: 'Illustrations : LimeZu (limezu.itch.io)',
  },
  sim: {
    toggle: 'Bac à sable',
    title: 'Bac à sable',
    close: 'Fermer le panneau Bac à sable',
    intro: 'Simulation locale : des personnes fictives et un faux audio, sans LiveKit. Glisse une personne sur la carte pour la faire marcher.',
    add: 'Ajouter une personne',
    importAudio: 'Importer un fichier audio',
    silence: 'Silence',
    audioLabel: 'Fichier audio de {name}',
    remove: 'Retirer {name}',
    empty: 'Aucune personne fictive pour l\'instant.',
    noAudio: 'Aucun fichier audio. Dépose-en dans le dossier sim-audio, ou importe-en un.',
    loadFailed: 'Impossible de lire l\'état du bac à sable.',
    actionFailed: 'Cette action a échoué.',
  },
  // Le chat : le panneau de droite, ses deux onglets (spec §9), le champ du message et ce qui peut mal tourner à l'envoi.
  chat: {
    toggle: 'Chat',
    title: 'Chat',
    close: 'Fermer le panneau Chat',
    tabsLabel: 'Canaux du chat',
    tabs: { all: 'Tout le monde', nearby: 'À proximité' },
    // L'infobulle de l'onglet À proximité quand on ne peut pas l'ouvrir : il n'y a de conversation qu'avec quelqu'un.
    nearbyUnavailable: 'Disponible pendant une conversation.',
    // Le nom, pour les lecteurs d'écran, de la liste des messages de chaque onglet, et du champ qui les écrit.
    log: { all: 'Messages de tout le monde', nearby: 'Messages de la conversation' },
    input: { all: 'Message à tout le monde', nearby: 'Message à la conversation' },
    empty: {
      all: 'Aucun message pour l\'instant. Écris le premier !',
      nearby: 'Ces messages ne vont qu\'aux personnes de ta conversation, et ne sont pas conservés.',
    },
    you: '(toi)',
    placeholder: 'Écrire un message…',
    send: 'Envoyer',
    // Dans l'onglet À proximité, hors conversation : on y lit encore ce qui s'est dit, mais personne ne recevrait ce qu'on écrit.
    noConversation: 'Personne n\'est à proximité. Rapproche-toi de quelqu\'un pour lui écrire ici.',
    // La connexion au bureau est tombée : le message ne partirait pas.
    reconnecting: 'Connexion perdue : tu pourras écrire dès qu\'elle sera rétablie.',
    // Le message n'est pas parti, et son texte reste dans le champ. Un cas, un message (la réponse du serveur : ChatAck).
    invalid: 'Ce message n\'a pas pu être envoyé : il est vide ou trop long.',
    rateLimited: 'Tu écris trop vite. Patiente quelques secondes, puis réessaie.',
    noGroup: 'Personne n\'est à proximité : ton message n\'est pas parti.',
    unavailable: 'Le serveur n\'a pas pu enregistrer ton message. Réessaie dans un instant.',
    timeout: 'Pas de réponse du serveur : ton message n\'est peut-être pas parti. Réessaie dans un instant.',
    // Les messages non lus, sur le bouton du panneau fermé (le nombre y est écrit, ceci est son nom pour les lecteurs d'écran).
    unreadOne: '{count} nouveau message',
    unreadMany: '{count} nouveaux messages',
  },
  // Le panneau Admin (réservé aux admins) : inviter, les invitations en attente, les membres, et ce que le serveur peut refuser.
  admin: {
    toggle: 'Admin',
    title: 'Admin',
    close: 'Fermer le panneau Admin',
    you: '(toi)',
    // Le rôle d'un compte : choisi en invitant, écrit dans les listes.
    roles: { member: 'Membre', admin: 'Admin' },
    invite: {
      title: 'Inviter',
      email: 'Adresse e-mail',
      role: 'Rôle',
      submit: 'Envoyer l\'invitation',
      submitting: 'Envoi…',
      sent: 'Invitation envoyée à {email}.',
      // Serveur sans e-mail (MAILER=none) : rien n'est envoyé, le serveur rend le lien de l'invitation, que l'admin transmet lui-même. Il ne
      // le redonne pas : « Nouveau lien », dans les invitations en attente, en donne un autre. Le bouton ne parle plus d'envoi.
      create: 'Créer le lien d\'invitation',
      creating: 'Création…',
      created: 'Invitation créée pour {email}. Envoie-lui ce lien :',
      validity: 'Ce lien est valable {days} jours. Il ne sera plus affiché : si tu le perds, utilise « Nouveau lien » dans les invitations en attente.',
    },
    // Les invitations ni acceptées ni annulées, expirées comprises (on les renvoie). `title` : la section avant l'arrivée de la liste,
    // `titleCount` : une fois la liste là.
    pending: {
      title: 'Invitations en attente',
      titleCount: 'Invitations en attente ({count})',
      empty: 'Aucune invitation en attente.',
      loadFailed: 'Impossible de charger les invitations en attente.',
      expired: 'expirée',
      resend: 'Renvoyer',
      resendLabel: 'Renvoyer l\'invitation à {email}',
      // Serveur sans e-mail : rien n'est renvoyé, « Renvoyer » devient « Nouveau lien ».
      renew: 'Nouveau lien',
      renewLabel: 'Nouveau lien d\'invitation pour {email}',
      revoke: 'Annuler',
      revokeLabel: 'Annuler l\'invitation de {email}',
      resent: 'Invitation renvoyée à {email}.',
      revoked: 'Invitation à {email} annulée.',
      // Serveur sans e-mail : « Nouveau lien » rend un lien neuf, et l'ancien ne marche plus.
      renewed: 'Nouveau lien pour {email} : l\'ancien ne marche plus. Envoie-lui ce lien :',
    },
    members: {
      title: 'Membres',
      titleCount: 'Membres ({count})',
      loadFailed: 'Impossible de charger la liste des membres.',
      remove: 'Retirer',
      removeLabel: 'Retirer {name}',
      removed: '{name} ne fait plus partie du bureau.',
      // Serveur sans e-mail : l'admin demande le lien par lequel la personne choisit un nouveau mot de passe, et le lui transmet.
      passwordLink: 'Lien de mot de passe',
      passwordLinkLabel: 'Lien de mot de passe de {name}',
      passwordLinkIntro: 'Ce lien permet de choisir un nouveau mot de passe pour {name}.',
      passwordLinkValidity: 'Ce lien est valable une heure. Il ne sera plus affiché : si tu le perds, demandes-en un autre.',
    },
    // La boîte d'un lien à transmettre (invitation créée ou renvoyée, mot de passe) : copier, ou masquer.
    link: {
      copy: 'Copier le lien',
      copied: 'Copié',
      selected: 'Lien sélectionné : copie-le avec Ctrl+C (⌘C sur Mac).',
      dismiss: 'Masquer',
    },
    // La confirmation d'un retrait : le compte est désactivé, pas supprimé, et son adresse ne peut plus être invitée (le serveur répond
    // alors « already_member »).
    removal: {
      title: 'Retirer {name} ?',
      body: 'Le compte {email} sera désactivé. La personne sera déconnectée tout de suite et ne pourra plus se connecter. Cette adresse ne pourra plus être invitée.',
      confirm: 'Retirer',
      confirming: 'Retrait…',
      cancel: 'Annuler',
    },
    // Le message de chaque refus du serveur (routes /api/admin) ; un serveur injoignable ou en panne a les messages de `common.errors`.
    errors: {
      alreadyInvited: 'Une invitation est déjà en attente pour cette adresse.',
      alreadyMember: 'Cette adresse a déjà un compte (actif ou retiré).',
      mailFailed: 'L\'e-mail n\'est pas parti. L\'invitation est gardée : tu peux la renvoyer.',
      invalid: 'Cette adresse e-mail n\'est pas valable.',
      self: 'Tu ne peux pas te retirer toi-même.',
      lastAdmin: 'Tu ne peux pas retirer le dernier admin : il en faut au moins un.',
      // « not_found » dépend de ce qu'on visait : une invitation (renvoyer, annuler), ou un membre (retirer).
      notFoundInvitation: 'Cette invitation n\'est plus en attente : elle a été acceptée ou annulée. Les listes viennent d\'être relues.',
      notFoundMember: 'Ce membre a déjà été retiré. La liste vient d\'être relue.',
      resetFailed: 'Le lien n\'a pas pu être créé. Réessaie dans un instant.',
      unauthorized: 'Ta session a expiré. Recharge la page pour te reconnecter.',
      forbidden: 'Cette action est réservée aux admins.',
    },
  },
  // L'audio et la vidéo : l'écran d'entrée, les vignettes et les commandes de la barre.
  media: {
    // Micro et caméra refusés ou absents, ou l'un des deux refusé et l'autre coupé.
    permissionDenied: 'Sans micro ni caméra, tu pourras quand même écouter et écrire.',
    micDenied: 'Micro refusé ou introuvable : les autres ne t\'entendront pas, mais tu pourras les écouter et écrire.',
    camDenied: 'Caméra refusée ou introuvable : les autres ne te verront pas, mais ils t\'entendront.',
    check: {
      title: 'Prêt à entrer ?',
      intro: 'Vérifie ton micro et ta caméra : ils serviront dès que tu t\'approcheras de quelqu\'un.',
      preview: 'Aperçu de ta caméra',
      camOff: 'Caméra coupée',
      camUnavailable: 'Caméra indisponible',
      asking: 'Autorise le micro et la caméra dans la fenêtre du navigateur.',
      micLevel: 'Niveau du micro',
      // Les boutons bascule : micro et caméra allumés en entrant.
      mic: 'Micro',
      cam: 'Caméra',
      // Les listes des périphériques.
      audioInput: 'Choix du micro',
      videoInput: 'Choix de la caméra',
      audioOutput: 'Sortie du son',
      systemDefault: 'Celui du système',
      enter: 'Entrer',
      enterAnyway: 'Entrer quand même',
    },
    controls: {
      // Le nom du groupe de boutons, pour les lecteurs d'écran.
      label: 'Micro, caméra et partage d\'écran',
      mic: 'Micro',
      cam: 'Caméra',
      screen: 'Partager l\'écran',
      micOnHint: 'Couper le micro',
      micOffHint: 'Activer le micro',
      camOnHint: 'Couper la caméra',
      camOffHint: 'Activer la caméra',
      screenHint: 'Partager une fenêtre ou ton écran avec la conversation',
      screenStopHint: 'Arrêter le partage',
      screenUnavailable: 'Le partage d\'écran se fait pendant une conversation.',
    },
    tiles: {
      label: 'Vidéos de la conversation',
      camera: 'Vidéo de {name}',
      cameraMuted: 'Vidéo de {name}, micro coupé',
      screen: 'Partage d\'écran de {name}',
      you: '{name} (toi)',
      enlarge: 'Agrandir',
      shrink: 'Réduire',
      fullscreen: 'Plein écran',
      exitFullscreen: 'Quitter le plein écran',
    },
    connectionFailed: 'La connexion audio et vidéo a échoué.',
    reconnect: 'Reconnecter',
    audioBlocked: 'Le navigateur a bloqué le son de la conversation.',
    enableAudio: 'Activer le son',
    devicesRefused: 'Micro ou caméra indisponible : tu entends et vois quand même les autres.',
  },
};

// Remplace chaque {clé} du texte par sa valeur ; une clé sans valeur reste telle quelle.
export function t(text: string, values: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, key: string) => (key in values ? String(values[key]) : placeholder));
}
