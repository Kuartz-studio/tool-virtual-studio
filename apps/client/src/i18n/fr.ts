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
  office: {
    hello: 'Bonjour {name}',
    signOut: 'Se déconnecter',
    signingOut: 'Déconnexion…',
    mapLoadFailed: 'Impossible de charger la carte du bureau. Recharge la page pour réessayer.',
    connecting: 'Connexion au bureau…',
    replaced: 'Ouvert dans un autre onglet',
    errors: {
      forbiddenOrigin: 'Le bureau refuse la connexion depuis cette page : ouvre l\'appli à son adresse habituelle.',
    },
  },
};

// Remplace chaque {clé} du texte par sa valeur ; une clé sans valeur reste telle quelle.
export function t(text: string, values: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, key: string) => (key in values ? String(values[key]) : placeholder));
}
