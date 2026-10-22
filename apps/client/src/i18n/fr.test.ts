import { expect, test } from 'vitest';
import { fr, t } from './fr';

test('t remplace chaque {clé} par sa valeur, et laisse une clé sans valeur telle quelle', () => {
  expect(t('Bonjour {name}', { name: 'Léa' })).toBe('Bonjour Léa');
  expect(t('{min} à {max} caractères, {min} au moins', { min: 10, max: 128 })).toBe('10 à 128 caractères, 10 au moins');
  expect(t('Bonjour {name}', {})).toBe('Bonjour {name}');
  expect(t('Sans clé')).toBe('Sans clé');
});

test('les textes attendus par les tests de bout en bout', () => {
  expect(fr.join.errors.used).toMatch(/déjà utilisé/);
  expect(fr.join.signOutAndContinue).toBe('Se déconnecter et continuer');
  expect(fr.office.signOut).toBe('Se déconnecter');
  expect(fr.office.barLabel).toBe('Barre du bureau');
  expect(fr.office.replaced).toBe('Ouvert dans un autre onglet');
  expect(fr.office.useHere).toBe('Utiliser ici');
  expect(fr.office.people.toggle).toBe('Personnes');
  expect(fr.me.status).toBe('Statut');
  expect(t(fr.me.statusChanged, { status: fr.status.dnd })).toBe('Statut : Ne pas déranger');
  expect(fr.office.people.you).toBe('toi');
  expect(fr.media.check.title).toBe('Prêt à entrer ?');
  expect(fr.media.check.enter).toBe('Entrer');
  expect(fr.media.check.enterAnyway).toBe('Entrer quand même');
  expect(fr.media.check.preview).toBe('Aperçu de ta caméra');
  expect(fr.media.permissionDenied).toBe('Sans micro ni caméra, tu pourras quand même écouter et écrire.');
  expect(fr.media.controls.mic).toBe('Micro');
  expect(fr.office.reconnecting).toBe('Connexion perdue, reconnexion…');
});

// L'interface par icônes : les noms des boutons sans texte (aussi leurs infobulles), que lisent les tests de bout en bout (e2e/helpers.ts).
test('les noms des boutons de la barre du bas et de ses menus', () => {
  expect(fr.ui.close).toBe('Fermer');
  expect(fr.office.more.toggle).toBe('Plus');
  expect(fr.office.more.menu).toBe('Plus d\'options');
  expect(fr.media.controls.screen).toBe('Partager l\'écran');
  expect(fr.zoom.in).toBe('Zoom avant');
  expect(fr.zoom.out).toBe('Zoom arrière');
  // Les noms qu'on garde : l'action ne change pas.
  expect(fr.chat.toggle).toBe('Chat');
  expect(fr.desk.toggle).toBe('Mon bureau');
  expect(fr.decor.toggle).toBe('Décorer');
  expect(fr.zoom.reset).toBe('Rétablir le zoom (100 %)');
  // Pas de bouton « Réactions » : rien n'existe derrière.
  expect(fr.media.controls).not.toHaveProperty('reactions');
});

// La puce « Moi » et son menu : les noms que lisent les tests de bout en bout (e2e/helpers.ts) et ceux des lignes qui ouvrent un panneau.
test('la puce « Moi » : son nom, celui de son menu, ses sections, et les lignes qui ouvrent un panneau', () => {
  expect(fr.me.chip).toBe('Mon profil');
  expect(fr.me.menu).toBe('Menu de mon profil');
  expect(fr.me.status).toBe('Statut');
  expect(fr.me.mode).toBe('Mode');
  expect(fr.me.modeNone).toBe('Aucun');
  expect(fr.me.modeManage).toBe('Mes états d\'activité…');
  // Les lignes du menu portent le nom du panneau qu'elles ouvrent, ou celui de l'action : « Personnage » est devenu « Changer d'apparence ». Le
  // bureau et le son n'y sont plus : ils sont dans le dock du milieu (test suivant).
  expect(fr.character.toggle).toBe('Changer d\'apparence');
  expect(fr.office.signOut).toBe('Se déconnecter');
  // Les panneaux gardent leur titre.
  expect(fr.character.title).toBe('Mon personnage');
});

// Le dock du milieu : la musique (le juke-box) et le bureau, que lisent les tests de bout en bout (e2e/helpers.ts, son.spec.ts, musique-lieux.spec.ts).
test('le juke-box : le nom du bouton et de sa fenêtre, ses interrupteurs et ses ambiances', () => {
  expect(fr.sound.toggle).toBe('Musique et ambiances');
  expect(fr.sound.music.label).toBe('Musique');
  expect(fr.sound.music.volume).toBe('Volume de la musique');
  expect(fr.sound.effects.label).toBe('Effets sonores');
  expect(fr.sound.effects.volume).toBe('Volume des effets sonores');
  expect(fr.sound.effects.test).toBe('Écouter un effet');
  expect(fr.sound.ambiance.auto).toBe('Selon l\'endroit');
  expect(t(fr.sound.ambiance.autoHere, { scene: fr.sound.scenes.lobby.title })).toBe('Ici : Salle d\'attente');
  expect(Object.values(fr.sound.scenes).map((scene) => scene.title)).toEqual(['Salle d\'attente', 'Concentration', 'Soleil', 'Crépuscule', 'Dérive', 'Expédition']);
});

test('le bouton du bureau : « Aller à mon bureau » dehors, « Réglages du bureau » dedans', () => {
  expect(fr.desk.goto).toBe('Aller à mon bureau');
  expect(fr.desk.settings).toBe('Réglages du bureau');
  // Le panneau garde son nom : c'est celui qu'il porte, et ce que son bouton de fermeture dit.
  expect(fr.desk.toggle).toBe('Mon bureau');
  expect(fr.desk.title).toBe('Mon bureau');
});

test('le lieu : « Couloir » pour une rue ou faute de zone, et combien sont ici', () => {
  expect(fr.office.where.hallway).toBe('Couloir');
  expect(fr.office.where.onePerson).toBe('1 personne ici');
  expect(t(fr.office.where.manyPeople, { count: 4 })).toBe('4 personnes ici');
});

// Les textes du panneau Admin que lisent les tests de bout en bout (e2e/admin.spec.ts).
test('le panneau Admin : ses textes et les messages de chaque erreur de l\'API', () => {
  expect(fr.admin.toggle).toBe('Admin');
  expect(fr.admin.title).toBe('Admin');
  expect(fr.admin.invite.submit).toBe('Envoyer l\'invitation');
  expect(t(fr.admin.invite.sent, { email: 'nina@x.fr' })).toBe('Invitation envoyée à nina@x.fr.');
  expect(t(fr.admin.members.removeLabel, { name: 'Bob' })).toBe('Retirer Bob');
  expect(t(fr.admin.removal.title, { name: 'Bob' })).toBe('Retirer Bob ?');
  expect(t(fr.admin.pending.titleCount, { count: 2 })).toBe('Invitations en attente (2)');
  expect(t(fr.admin.members.titleCount, { count: 3 })).toBe('Membres (3)');
  expect(fr.admin.pending.expired).toBe('expirée');
  // Les codes du serveur (admin-routes.ts) : un message pour chacun.
  expect(fr.admin.errors.alreadyInvited).toBe('Une invitation est déjà en attente pour cette adresse.');
  expect(fr.admin.errors.alreadyMember).toBe('Cette adresse a déjà un compte (actif ou retiré).');
  expect(fr.admin.errors.mailFailed).toBe('L\'e-mail n\'est pas parti. L\'invitation est gardée : tu peux la renvoyer.');
  for (const key of ['self', 'lastAdmin', 'notFoundInvitation', 'notFoundMember', 'invalid', 'unauthorized', 'forbidden'] as const) {
    expect(fr.admin.errors[key].length, key).toBeGreaterThan(10);
  }
});

test('les statuts : Disponible, Occupé, Absent, Ne pas déranger (spec §10)', () => {
  expect(fr.status).toEqual({ available: 'Disponible', busy: 'Occupé', away: 'Absent', dnd: 'Ne pas déranger' });
});

test('le panneau Personnes compte ses lignes', () => {
  expect(t(fr.office.people.online, { count: 3 })).toBe('En ligne (3)');
  expect(t(fr.office.people.offline, { count: 0 })).toBe('Hors ligne (0)');
});

// Sans e-mail (MAILER=none) : les phrases des liens à transmettre, mot pour mot.
test('les textes des liens à transmettre', () => {
  expect(t(fr.admin.invite.created, { email: 'nina@x.fr' })).toBe('Invitation créée pour nina@x.fr. Envoie-lui ce lien :');
  expect(t(fr.admin.invite.validity, { days: 7 })).toMatch(/^Ce lien est valable 7 jours\. Il ne sera plus affiché/);
  expect(t(fr.admin.pending.renewed, { email: 'nina@x.fr' })).toBe('Nouveau lien pour nina@x.fr : l\'ancien ne marche plus. Envoie-lui ce lien :');
  expect(t(fr.admin.members.passwordLinkIntro, { name: 'Bob' })).toBe('Ce lien permet de choisir un nouveau mot de passe pour Bob.');
  expect(fr.admin.members.passwordLink).toBe('Lien de mot de passe');
  expect(fr.admin.link.copy).toBe('Copier le lien');
  expect(fr.admin.link.copied).toBe('Copié');
  expect(fr.admin.errors.resetFailed.length).toBeGreaterThan(10);
  // Le texte d'une invitation créée ne promet aucun e-mail.
  expect(JSON.stringify([fr.admin.invite.created, fr.admin.pending.renewed, fr.admin.members.passwordLinkIntro])).not.toMatch(/e-mail|envoyé/i);
});

// Les textes que lit quelqu'un dont l'invitation est un lien reçu autrement que par e-mail ne parlent pas d'e-mail.
test('la page « Rejoindre » ne dit pas que le lien est reçu par e-mail', () => {
  for (const message of [fr.join.errors.missingToken, fr.join.errors.unknown]) {
    expect(message).toContain('le lien d\'invitation qu\'on t\'a envoyé');
    expect(message).not.toMatch(/e-mail/i);
  }
  expect(fr.join.errors.missingToken).toBe('Ce lien est incomplet. Ouvre en entier le lien d\'invitation qu\'on t\'a envoyé.');
  // Sans e-mail, on retrouve un lien perdu par « Nouveau lien » (plus de « Renvoyer »).
  expect(t(fr.admin.invite.validity, { days: 7 })).toContain('« Nouveau lien »');
  expect(fr.admin.invite.validity).not.toContain('Renvoyer');
});

// La lumière du bureau : ce que disent les messages passagers et l'étiquette de l'interrupteur, mot pour mot.
test('la lumière : les messages de ceux qui changent l\'état, le tien et celui des autres, et l\'étiquette de l\'interrupteur', () => {
  expect(t(fr.lights.off, { name: 'Léa' })).toBe('Léa a éteint la lumière');
  expect(t(fr.lights.on, { name: 'Léa' })).toBe('Léa a rallumé la lumière');
  expect(fr.lights.selfOff).toBe('Tu as éteint la lumière');
  expect(fr.lights.selfOn).toBe('Tu as rallumé la lumière');
  expect(fr.lights.use).toBe('Éteindre');
  expect(fr.lights.useOn).toBe('Allumer');
});
