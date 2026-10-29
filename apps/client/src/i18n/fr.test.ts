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
  expect(fr.zoom.reset).toBe('Rétablir le zoom de départ');
  // Pas de bouton « Réactions » : rien n'existe derrière.
  expect(fr.media.controls).not.toHaveProperty('reactions');
});

// La puce « Moi » et son menu : les noms que lisent les tests de bout en bout (e2e/helpers.ts) et ceux des lignes qui ouvrent un panneau.
test('la puce « Moi » : son nom, celui de son menu, sa section, et les lignes qui ouvrent un panneau ou l\'éditeur', () => {
  expect(fr.me.chip).toBe('Mon profil');
  expect(fr.me.menu).toBe('Menu de mon profil');
  expect(fr.me.mode).toBe('Mode');
  // « Disponible » est le premier statut de la liste des modes, l'état normal (il n'y a plus de « Normal ») ; « Nouveau mode » ouvre l'éditeur, dans le menu.
  expect(fr.status.available).toBe('Disponible');
  expect(fr.modes.create).toBe('Nouveau mode');
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
  // « J'écoute » : la pièce ou sa musique à soi ; la liste des musiques et ses thèmes.
  expect([fr.sound.source.room, fr.sound.source.mine]).toEqual(['La pièce', 'Ma musique']);
  expect([fr.sound.themes.default, fr.sound.themes.pirate]).toEqual(['Par défaut', 'Pirate']);
  expect(fr.roomMusic.change).toBe('Changer la musique de la pièce');
  expect(fr.sound.mine.change).toBe('Changer ma musique');
  expect(t(fr.roomMusic.audience, { place: 'Café' })).toBe('Café · pour tout le monde ici');
  expect(Object.values(fr.sound.scenes).map((scene) => scene.title).slice(0, 7)).toEqual(['Salle d\'attente', 'Concentration', 'Soleil', 'Crépuscule', 'Dérive', 'Expédition', 'Silent Harbor']);
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
  expect(fr.admin.invite.toggle).toBe('Inviter');
  expect(fr.admin.invite.title).toBe('Inviter quelqu\'un');
  expect([fr.admin.tabs.members, fr.admin.tabs.invitations]).toEqual(['Membres', 'Invitations']);
  expect(t(fr.admin.actions, { name: 'Bob' })).toBe('Actions pour Bob');
  expect(fr.admin.members.remove).toBe('Retirer du bureau');
  expect(t(fr.admin.removal.title, { name: 'Bob' })).toBe('Retirer Bob du bureau ?');
  expect(fr.admin.pending.resend).toBe('Renvoyer l\'invitation');
  expect(fr.admin.pending.revoke).toBe('Annuler l\'invitation');
  expect(fr.admin.pending.expired).toBe('Expirée');
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
  expect(t(fr.admin.invite.validity, { days: 7 })).toMatch(/^Valable 7 jours\. Il ne sera plus affiché/);
  expect(t(fr.admin.pending.renewed, { email: 'nina@x.fr' })).toBe('Nouveau lien pour nina@x.fr : l\'ancien ne marche plus. Envoie-lui ce lien :');
  expect(t(fr.admin.members.passwordLinkIntro, { name: 'Bob' })).toBe('Ce lien permet de choisir un nouveau mot de passe pour Bob.');
  expect(fr.admin.members.passwordLink).toBe('Lien de mot de passe');
  expect(fr.admin.link.copy).toBe('Copier le lien');
  expect(fr.admin.link.copied).toBe('Lien copié.');
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
  expect(t(fr.lights.dim, { name: 'Léa' })).toBe('Léa a tamisé la lumière');
  expect(fr.lights.selfDim).toBe('Tu as tamisé la lumière');
  expect(fr.lights.action).toEqual({ on: 'Allumer', dim: 'Tamiser', off: 'Éteindre' });
});

// Les jeux : les noms et les phrases que lisent les tests de bout en bout (e2e/jeux-*.ts), mot pour mot, et les listes complètes (chaque jeu, chaque erreur du serveur).
test('les jeux : les noms, l\'étiquette d\'une table, l\'invitation et ses boutons', () => {
  expect(fr.games.names).toEqual({ chess: 'Échecs', backgammon: 'Backgammon', connect4: 'Puissance 4', ludo: 'Petits chevaux' });
  expect(t(fr.games.prompt, { game: fr.games.names.chess, action: fr.games.play })).toBe('[E] Échecs : jouer');
  expect(t(fr.games.prompt, { game: fr.games.names.ludo, action: fr.games.watch })).toBe('[E] Petits chevaux : regarder la partie');
  expect(t(fr.games.invitation, { name: 'Alice', game: fr.games.invitedTo.chess })).toBe('Alice t\'invite aux échecs');
  expect(t(fr.games.invitation, { name: 'Alice', game: fr.games.invitedTo.connect4 })).toBe('Alice t\'invite au Puissance 4');
  expect(t(fr.games.acceptLabel, { name: 'Alice' })).toBe('Accepter l\'invitation de Alice');
  expect(t(fr.games.declineLabel, { name: 'Alice' })).toBe('Refuser l\'invitation de Alice');
  expect(t(fr.games.notice.accepted, { name: 'Bastien', game: fr.games.names.chess })).toBe('Bastien a rejoint la table de Échecs.');
  expect(t(fr.games.notice.declined, { name: 'Claire' })).toBe('Claire a refusé ton invitation.');
  expect(t(fr.games.lobby.sitAt, { n: 2 })).toBe('S\'asseoir à la chaise 2');
  expect(fr.games.invite.toggle).toBe('Inviter quelqu\'un');
  expect(t(fr.games.invite.sendLabel, { name: 'Bastien' })).toBe('Inviter Bastien');
  expect(fr.games.soon).toBe('Bientôt disponible');
});

test('les jeux : chaque erreur du serveur a son texte, et chaque raison de fin de la plateforme aussi', async () => {
  const { GAME_ERRORS } = await import('@bureau/shared');
  expect(Object.keys(fr.games.errors).sort()).toEqual([...GAME_ERRORS].sort());
  for (const message of Object.values(fr.games.errors)) expect(message.length).toBeGreaterThan(5);
  for (const reason of ['resign', 'timeout', 'disconnect'] as const) {
    expect(fr.games.end[reason]).toContain('{loser}');
    expect(fr.games.end[reason]).toContain('{winner}');
    expect(fr.games.end[`${reason}Many`]).toContain('{loser}');
  }
});
