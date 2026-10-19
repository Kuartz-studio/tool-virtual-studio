import { INVITATION_TTL_MS } from '@bureau/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { createMemoryMailer, createResendMailer, type SentMail } from '../src/mail/mailer';

// Le vrai client Resend ne doit jamais appeler le réseau : on le remplace par un faux qui enregistre ses appels.
const resend = vi.hoisted(() => ({ send: vi.fn(), apiKeys: [] as string[] }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resend.send };
    constructor(apiKey: string) {
      resend.apiKeys.push(apiKey);
    }
  },
}));

beforeEach(() => {
  resend.send.mockReset();
  resend.apiKeys.length = 0;
});

const INVITATION_LINK = 'https://b.fr/rejoindre?token=abc';
const RESET_LINK = 'https://b.fr/reinitialiser?token=xyz';
const FROM = 'Bureau virtuel <bureau@exemple.fr>';

test('invitation : lien, inviteur et durée dans le HTML et le texte', async () => {
  const m = createMemoryMailer();
  await m.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: 'Tom' });
  const mail = m.last('lea@x.fr')!;
  expect(mail.subject).toBe('Invitation au bureau virtuel');
  expect(mail.html).toContain(INVITATION_LINK);
  expect(mail.html).toContain('Tom');
  expect(mail.text).toContain('7 jours');
  expect(mail.link).toBe(INVITATION_LINK);
});

test('réinitialisation : lien présent', async () => {
  const m = createMemoryMailer();
  await m.sendPasswordReset({ to: 'lea@x.fr', link: RESET_LINK });
  const mail = m.last('lea@x.fr')!;
  expect(mail.subject).toBe('Réinitialiser ton mot de passe');
  expect(mail.html).toContain(RESET_LINK);
  expect(mail.text).toContain(RESET_LINK);
  expect(mail.text).toContain("Si tu n'as rien demandé, ignore cet e-mail.");
  expect(mail.link).toBe(RESET_LINK);
});

test('invitation : titre, phrase, bouton et pied de page du texte brut, mot pour mot', async () => {
  const m = createMemoryMailer();
  await m.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: 'Tom' });
  const { text } = m.last()!;
  expect(text).toContain('Invitation au bureau virtuel');
  expect(text).toContain("Tom t'invite à rejoindre le bureau virtuel de l'équipe.");
  expect(text).toContain('Créer mon compte');
  expect(text).toContain('Ce lien est valable 7 jours.');
  // Sans HTML, le lien du bouton reste utilisable.
  expect(text).toContain(INVITATION_LINK);
  // L'aperçu de la boîte de réception (texte caché du HTML) n'est pas recopié dans le texte brut.
  expect(text.split("t'invite")).toHaveLength(2);
});

test('invitation sans inviteur : phrase de repli, sans « null » ni nom', async () => {
  const m = createMemoryMailer();
  await m.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: null });
  const { html, text } = m.last()!;
  expect(text).toContain("Une invitation t'attend pour rejoindre le bureau virtuel de l'équipe.");
  expect(text).not.toContain("t'invite");
  expect(text).not.toContain('null');
  expect(html).not.toContain('null');
});

test("invitation : un nom d'inviteur vide ou blanc donne aussi la phrase de repli", async () => {
  const m = createMemoryMailer();
  await m.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: '   ' });
  expect(m.last()!.text).toContain("Une invitation t'attend pour rejoindre le bureau virtuel de l'équipe.");
});

test("l'invitation annonce la durée de INVITATION_TTL_MS", async () => {
  // Le pied de page de l'e-mail écrit « 7 jours » en toutes lettres : ce test échoue si la durée change sans lui.
  const days = INVITATION_TTL_MS / (24 * 3600 * 1000);
  const m = createMemoryMailer();
  await m.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: 'Tom' });
  expect(m.last()!.text).toContain(`Ce lien est valable ${days} jours.`);
});

test('réinitialisation : titre, phrase, bouton et pied de page du texte brut, mot pour mot', async () => {
  const m = createMemoryMailer();
  await m.sendPasswordReset({ to: 'lea@x.fr', link: RESET_LINK });
  const { text } = m.last()!;
  expect(text).toContain('Réinitialiser ton mot de passe');
  expect(text).toContain('Clique sur le bouton pour choisir un nouveau mot de passe.');
  expect(text).toContain('Choisir un nouveau mot de passe');
  expect(text).toContain("Si tu n'as rien demandé, ignore cet e-mail.");
  expect(text.split('Clique sur le bouton')).toHaveLength(2);
});

test("le nom de l'inviteur est échappé dans le HTML et intact dans le texte", async () => {
  const m = createMemoryMailer();
  await m.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: '<b>Tom</b> & Co' });
  const { html, text } = m.last()!;
  expect(html).not.toContain('<b>Tom</b>');
  expect(html).toContain('&lt;b&gt;Tom&lt;/b&gt; &amp; Co');
  expect(text).toContain("<b>Tom</b> & Co t'invite à rejoindre le bureau virtuel de l'équipe.");
});

test('le HTML est un document complet, déclaré en français, avec le bouton vers le lien', async () => {
  const m = createMemoryMailer();
  await m.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: 'Tom' });
  const { html } = m.last()!;
  expect(html).toMatch(/^<!DOCTYPE html/);
  expect(html).toContain('charset=UTF-8');
  expect(html).toMatch(/<html [^>]*lang="fr"/);
  // <body> déclare sa propre langue (« en » par défaut) : elle doit être le français aussi.
  expect(html).toMatch(/<body [^>]*lang="fr"/);
  expect(html).not.toContain('lang="en"');
  // Un seul <title>, celui de l'e-mail : le composant Preview en ajoute un autre, avec l'aperçu, si on ne le lui interdit pas.
  expect(html.match(/<title>/g)).toHaveLength(1);
  expect(html).toContain('<title>Invitation au bureau virtuel</title>');
  expect(html).toMatch(/<a [^>]*href="https:\/\/b\.fr\/rejoindre\?token=abc"/);
  expect(html).toContain('Créer mon compte');
});

test("sent garde les e-mails dans l'ordre, et last() sans argument renvoie le dernier", async () => {
  const m = createMemoryMailer();
  expect(m.sent).toEqual([]);
  expect(m.last()).toBeUndefined();

  await m.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: 'Tom' });
  await m.sendPasswordReset({ to: 'tom@x.fr', link: RESET_LINK });

  expect(m.sent.map((mail) => mail.to)).toEqual(['lea@x.fr', 'tom@x.fr']);
  expect(m.sent.map((mail) => mail.link)).toEqual([INVITATION_LINK, RESET_LINK]);
  expect(m.last()).toBe(m.sent[1]);
});

test("last(to) renvoie le dernier e-mail de ce destinataire, sans tenir compte de la casse", async () => {
  const m = createMemoryMailer();
  await m.sendInvitation({ to: 'lea@x.fr', link: 'https://b.fr/rejoindre?token=1', invitedBy: null });
  await m.sendPasswordReset({ to: 'tom@x.fr', link: RESET_LINK });
  await m.sendInvitation({ to: 'lea@x.fr', link: 'https://b.fr/rejoindre?token=2', invitedBy: null });
  await m.sendPasswordReset({ to: 'tom@x.fr', link: 'https://b.fr/reinitialiser?token=2' });

  expect(m.last('lea@x.fr')!.link).toBe('https://b.fr/rejoindre?token=2');
  expect(m.last('Lea@X.fr')!.link).toBe('https://b.fr/rejoindre?token=2');
  expect(m.last('tom@x.fr')!.link).toBe('https://b.fr/reinitialiser?token=2');
  expect(m.last('inconnu@x.fr')).toBeUndefined();
  // L'adresse enregistrée reste celle qui a été donnée, pas une version normalisée.
  await m.sendPasswordReset({ to: 'Zoé@X.fr', link: RESET_LINK });
  expect(m.last('zoé@x.fr')!.to).toBe('Zoé@X.fr');
});

test('onSend reçoit chaque e-mail composé, tel que gardé dans sent', async () => {
  const seen: SentMail[] = [];
  const m = createMemoryMailer({ onSend: (mail) => seen.push(mail) });
  await m.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: 'Tom' });
  await m.sendPasswordReset({ to: 'tom@x.fr', link: RESET_LINK });
  expect(seen).toEqual(m.sent);
  expect(seen.map((mail) => [mail.subject, mail.link])).toEqual([
    ['Invitation au bureau virtuel', INVITATION_LINK],
    ['Réinitialiser ton mot de passe', RESET_LINK],
  ]);
});

test('deux mailers en mémoire ne partagent pas leurs e-mails', async () => {
  const a = createMemoryMailer();
  const b = createMemoryMailer();
  await a.sendPasswordReset({ to: 'lea@x.fr', link: RESET_LINK });
  expect(a.sent).toHaveLength(1);
  expect(b.sent).toHaveLength(0);
});

test("Resend : le client reçoit from, to, objet, HTML et texte de l'invitation", async () => {
  resend.send.mockResolvedValue({ data: { id: 'mail-1' }, error: null, headers: null });
  const mailer = createResendMailer({ apiKey: 're_cle_de_test', from: FROM });
  await mailer.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: 'Tom' });

  expect(resend.apiKeys).toEqual(['re_cle_de_test']);
  expect(resend.send).toHaveBeenCalledTimes(1);
  // Même rendu que le mailer en mémoire : ce qu'on lit en test est ce que Resend envoie.
  const memory = createMemoryMailer();
  await memory.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: 'Tom' });
  const expected = memory.last()!;
  expect(resend.send).toHaveBeenCalledWith({
    from: FROM,
    to: 'lea@x.fr',
    subject: 'Invitation au bureau virtuel',
    html: expected.html,
    text: expected.text,
  });
  expect(expected.html).toContain(INVITATION_LINK);
  expect(expected.text).toContain('7 jours');
});

test('Resend : le client reçoit from, to, objet, HTML et texte de la réinitialisation', async () => {
  resend.send.mockResolvedValue({ data: { id: 'mail-2' }, error: null, headers: null });
  const mailer = createResendMailer({ apiKey: 're_cle_de_test', from: FROM });
  await mailer.sendPasswordReset({ to: 'lea@x.fr', link: RESET_LINK });

  const memory = createMemoryMailer();
  await memory.sendPasswordReset({ to: 'lea@x.fr', link: RESET_LINK });
  const expected = memory.last()!;
  expect(resend.send).toHaveBeenCalledTimes(1);
  expect(resend.send).toHaveBeenCalledWith({
    from: FROM,
    to: 'lea@x.fr',
    subject: 'Réinitialiser ton mot de passe',
    html: expected.html,
    text: expected.text,
  });
});

test("Resend : une réponse en erreur fait échouer l'envoi, sans recopier le lien", async () => {
  resend.send.mockResolvedValue({
    data: null,
    error: { name: 'invalid_api_key', statusCode: 403, message: 'API key is invalid' },
    headers: null,
  });
  const mailer = createResendMailer({ apiKey: 're_mauvaise_cle', from: FROM });

  const failure = await mailer.sendInvitation({ to: 'lea@x.fr', link: INVITATION_LINK, invitedBy: 'Tom' }).then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(failure).toBeInstanceOf(Error);
  const { message } = failure as Error;
  expect(message).toContain('Invitation au bureau virtuel');
  expect(message).toContain('invalid_api_key');
  expect(message).toContain('API key is invalid');
  // Le message finit dans les journaux : le jeton du lien (il ouvre un compte) et l'adresse n'ont rien à y faire.
  expect(message).not.toContain('token=');
  expect(message).not.toContain('lea@x.fr');

  await expect(mailer.sendPasswordReset({ to: 'lea@x.fr', link: RESET_LINK })).rejects.toThrow('API key is invalid');
});

test("Resend : un échec du client (le réseau, par exemple) fait aussi échouer l'envoi", async () => {
  resend.send.mockRejectedValue(new Error('connexion perdue'));
  const mailer = createResendMailer({ apiKey: 're_cle_de_test', from: FROM });
  await expect(mailer.sendPasswordReset({ to: 'lea@x.fr', link: RESET_LINK })).rejects.toThrow('connexion perdue');
});
