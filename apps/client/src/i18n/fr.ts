import type { Status } from '@bureau/shared';

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
      missingToken: 'Ce lien d\'invitation est incomplet. Ouvre le lien reçu par e-mail en entier.',
      unknown: 'Ce lien d\'invitation n\'est pas valable. Vérifie que tu as ouvert le lien complet reçu par e-mail, ou demande une nouvelle invitation.',
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
    statusMenu: {
      label: 'Statut',
      // Le nom du bouton, et ce qu'un lecteur d'écran annonce quand le statut change.
      current: 'Statut : {status}',
      menu: 'Choisir mon statut',
    },
    people: {
      toggle: 'Personnes',
      title: 'Personnes',
      close: 'Fermer le panneau Personnes',
      online: 'En ligne ({count})',
      offline: 'Hors ligne ({count})',
      you: '(toi)',
      loadFailed: 'Impossible de charger la liste des membres.',
    },
    // La connexion au bureau est tombée après l'arrivée : Socket.io se reconnecte seul.
    reconnecting: 'Connexion perdue, reconnexion…',
    errors: {
      forbiddenOrigin: 'Le bureau refuse la connexion depuis cette page : ouvre l\'appli à son adresse habituelle.',
    },
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
