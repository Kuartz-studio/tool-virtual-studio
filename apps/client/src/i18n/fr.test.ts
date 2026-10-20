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
  expect(fr.office.statusMenu.label).toBe('Statut');
  expect(t(fr.office.statusMenu.current, { status: fr.status.dnd })).toBe('Statut : Ne pas déranger');
  expect(fr.office.people.you).toBe('(toi)');
  expect(fr.media.check.title).toBe('Prêt à entrer ?');
  expect(fr.media.check.enter).toBe('Entrer');
  expect(fr.media.check.enterAnyway).toBe('Entrer quand même');
  expect(fr.media.check.preview).toBe('Aperçu de ta caméra');
  expect(fr.media.permissionDenied).toBe('Sans micro ni caméra, tu pourras quand même écouter et écrire.');
  expect(fr.media.controls.mic).toBe('Micro');
  expect(fr.office.reconnecting).toBe('Connexion perdue, reconnexion…');
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
