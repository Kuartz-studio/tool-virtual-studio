import { afterEach, describe, expect, test, vi } from 'vitest';
import { createNoneMailer, isMemoryMailer, isNoneMailer, createMemoryMailer } from '../src/mail/mailer';
import { createResetLinkStore } from '../src/mail/reset-link-store';

const LINK = 'http://localhost:4000/api/auth/reset-password/jeton-secret?callbackURL=x';
const MINUTE_MS = 60_000;

afterEach(() => {
  vi.restoreAllMocks();
});

// Une horloge que le test avance à la main.
function clock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe('réserve des liens de mot de passe', () => {
  test('garde le lien par adresse, sans tenir compte de la casse, et le rend une seule fois', () => {
    const store = createResetLinkStore();
    store.put('Lea@X.fr', LINK);
    expect(store.size).toBe(1);
    expect(store.take('lea@x.fr')).toBe(LINK);
    expect(store.take('lea@x.fr')).toBeUndefined();   // rendu, il n'est plus gardé
    expect(store.size).toBe(0);
    expect(store.take('autre@x.fr')).toBeUndefined();
  });

  test('le dernier lien d\'une adresse remplace le précédent', () => {
    const store = createResetLinkStore();
    store.put('lea@x.fr', 'https://b.fr/premier');
    store.put('LEA@x.fr', 'https://b.fr/second');
    expect(store.size).toBe(1);
    expect(store.take('lea@x.fr')).toBe('https://b.fr/second');
  });

  test('discard oublie le lien d\'une adresse', () => {
    const store = createResetLinkStore();
    store.put('lea@x.fr', LINK);
    store.discard('Lea@x.fr');
    expect(store.take('lea@x.fr')).toBeUndefined();
    expect(() => store.discard('inconnue@x.fr')).not.toThrow();
  });

  test('un lien expire au bout de 10 minutes', () => {
    const time = clock();
    const store = createResetLinkStore({ now: time.now });
    store.put('lea@x.fr', LINK);
    time.advance(10 * MINUTE_MS - 1);
    expect(store.take('lea@x.fr')).toBe(LINK);

    store.put('lea@x.fr', LINK);
    time.advance(10 * MINUTE_MS);
    expect(store.take('lea@x.fr')).toBeUndefined();
    expect(store.size).toBe(0);   // l'entrée expirée n'est pas gardée
  });

  test('les liens expirés laissent la place aux autres, et la réserve ne dépasse pas 50 adresses : la plus ancienne part', () => {
    const time = clock();
    const store = createResetLinkStore({ now: time.now });
    for (let i = 0; i < 50; i++) store.put(`membre${i}@x.fr`, `https://b.fr/${i}`);
    expect(store.size).toBe(50);

    store.put('nouveau@x.fr', 'https://b.fr/nouveau');
    expect(store.size).toBe(50);
    expect(store.take('membre0@x.fr')).toBeUndefined();   // la plus ancienne
    expect(store.take('membre1@x.fr')).toBe('https://b.fr/1');
    expect(store.take('nouveau@x.fr')).toBe('https://b.fr/nouveau');

    // Remplacer une adresse la rend la plus récente : ce n'est pas elle qui part ensuite.
    const refreshed = createResetLinkStore({ now: time.now });
    for (let i = 0; i < 50; i++) refreshed.put(`membre${i}@x.fr`, `https://b.fr/${i}`);
    refreshed.put('membre0@x.fr', 'https://b.fr/0-bis');
    refreshed.put('nouveau@x.fr', 'https://b.fr/nouveau');
    expect(refreshed.take('membre1@x.fr')).toBeUndefined();
    expect(refreshed.take('membre0@x.fr')).toBe('https://b.fr/0-bis');

    // Les liens expirés sont écartés avant de compter.
    const aged = createResetLinkStore({ now: time.now });
    for (let i = 0; i < 50; i++) aged.put(`membre${i}@x.fr`, `https://b.fr/${i}`);
    time.advance(10 * MINUTE_MS);
    aged.put('nouveau@x.fr', 'https://b.fr/nouveau');
    expect(aged.size).toBe(1);
  });

  test('wait rend tout de suite un lien déjà là', async () => {
    const store = createResetLinkStore();
    store.put('lea@x.fr', LINK);
    await expect(store.wait('lea@x.fr', 1000)).resolves.toBe(LINK);
    expect(store.size).toBe(0);
  });

  test('wait attend le lien d\'une adresse, jusqu\'au délai : null passé ce délai', async () => {
    const store = createResetLinkStore();
    const waiting = store.wait('lea@x.fr', 2000);
    store.put('tom@x.fr', 'https://b.fr/tom');   // le lien d'une autre adresse ne le réveille pas
    setTimeout(() => store.put('Lea@x.fr', LINK), 10);
    await expect(waiting).resolves.toBe(LINK);
    expect(store.take('tom@x.fr')).toBe('https://b.fr/tom');

    const started = performance.now();
    await expect(store.wait('personne@x.fr', 50)).resolves.toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('un lien posé par un autre processus, jamais : wait ne laisse pas de minuterie derrière lui', async () => {
    vi.useFakeTimers();
    try {
      const store = createResetLinkStore();
      const waiting = store.wait('lea@x.fr', 2000);
      store.put('lea@x.fr', LINK);
      await expect(waiting).resolves.toBe(LINK);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mailer none', () => {
  test('sendInvitation ne fait rien', async () => {
    const mailer = createNoneMailer();
    await expect(mailer.sendInvitation({ to: 'lea@x.fr', link: 'https://b.fr/rejoindre?token=abc', invitedBy: 'Tom' })).resolves.toBeUndefined();
    expect(mailer.resetLinks.size).toBe(0);
  });

  test('sendPasswordReset garde le lien dans la réserve, par adresse en minuscules, sans rien écrire dans la console', async () => {
    const console_ = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')];
    const mailer = createNoneMailer();
    await mailer.sendPasswordReset({ to: 'Lea@X.fr', link: LINK });
    await mailer.sendPasswordReset({ to: 'tom@x.fr', link: 'https://b.fr/tom' });
    await mailer.sendPasswordReset({ to: 'lea@x.fr', link: `${LINK}2` });   // le dernier gagne
    expect(mailer.resetLinks.size).toBe(2);
    expect(mailer.resetLinks.take('lea@x.fr')).toBe(`${LINK}2`);
    for (const spy of console_) expect(spy).not.toHaveBeenCalled();
  });

  test('chaque mailer a sa propre réserve, et isNoneMailer ne reconnaît que lui', () => {
    const a = createNoneMailer();
    const b = createNoneMailer();
    a.resetLinks.put('lea@x.fr', LINK);
    expect(b.resetLinks.size).toBe(0);
    expect(isNoneMailer(a)).toBe(true);
    expect(isNoneMailer(createMemoryMailer())).toBe(false);
    expect(isMemoryMailer(a)).toBe(false);
    expect(isNoneMailer({ sendInvitation: async () => {}, sendPasswordReset: async () => {} })).toBe(false);
  });
});
