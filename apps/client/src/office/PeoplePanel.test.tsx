import type { PublicPlayer, Status } from '@bureau/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { statusCssColor } from '../lib/status';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json } from '../test/fake-api';
import { PeoplePanel } from './PeoplePanel';

const player = (id: string, name: string, status: Status = 'available'): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status,
  media: { mic: false, cam: false, screen: false },
});

// Les membres que le serveur connaît (GET /api/members), dans l'ordre d'arrivée.
const MEMBERS = [
  { id: 'moi', name: 'Moi', avatarKey: null },
  { id: 'zoe', name: 'Zoé', avatarKey: 'dev-red' },
  { id: 'bob', name: 'Bob', avatarKey: null },
  { id: 'alice', name: 'Alice', avatarKey: null },
  { id: 'elise', name: 'Élise', avatarKey: null },
];

beforeEach(() => {
  useOfficeStore.getState().reset();
});

// Le serveur a envoyé l'état de départ : soi-même, et ceux qui sont là.
function arrive(others: PublicPlayer[] = [], self: PublicPlayer = player('moi', 'Moi')): void {
  act(() => useOfficeStore.getState().applyInit({ self, players: others, mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const group = (name: RegExp) => screen.getByRole('region', { name });
const namesIn = (section: HTMLElement) => within(section).getAllByRole('listitem').map((row) => row.querySelector('.person-name')?.textContent);
const dot = (id: string): HTMLElement => document.querySelector(`[data-user="${id}"]`) as HTMLElement;

describe('la liste', () => {
  test('GET /api/members à l\'ouverture', async () => {
    const api = fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toBe('/api/members');
  });

  test('les personnes en ligne d\'abord, puis les autres, chaque liste par ordre alphabétique (français)', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('zoe', 'Zoé'), player('bob', 'Bob')]);
    render(<PeoplePanel onClose={() => {}} />);

    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(namesIn(group(/^En ligne/))).toEqual(['Bob', 'Moi', 'Zoé']);
    // « Élise » vient avec les E, avant « Zoé » : la comparaison est celle du français.
    expect(namesIn(group(/^Hors ligne/))).toEqual(['Alice', 'Élise']);
    expect(screen.getByRole('heading', { name: 'En ligne (3)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hors ligne (2)' })).toBeTruthy();
  });

  test('chaque personne a son point de statut (data-user, data-status) et son statut en toutes lettres ; les hors ligne ont un anneau vide', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('zoe', 'Zoé', 'dnd'), player('bob', 'Bob', 'busy')], player('moi', 'Moi', 'away'));
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });

    for (const [id, status] of [['moi', 'away'], ['zoe', 'dnd'], ['bob', 'busy']] as const) {
      expect(dot(id).getAttribute('data-status')).toBe(status);
      expect(dot(id).style.backgroundColor).toBe(statusCssColor(status));
      expect(dot(id).closest('li')?.textContent).toContain(fr.status[status]);
    }
    for (const id of ['alice', 'elise']) {
      expect(dot(id)).toBeTruthy();
      expect(dot(id).hasAttribute('data-status')).toBe(false);
      expect(dot(id).style.backgroundColor).toBe('');
      // Hors ligne, et rien de plus : pas de statut en toutes lettres.
      expect(dot(id).closest('li')?.textContent).toBe(MEMBERS.find((m) => m.id === id)!.name);
    }
  });

  test('on se reconnaît : « (toi) »', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob')]);
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(dot('moi').closest('li')?.textContent).toContain('(toi)');
    expect(dot('bob').closest('li')?.textContent).not.toContain('(toi)');
  });

  test('les points ne disent rien aux lecteurs d\'écran (le statut est écrit à côté)', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob', 'busy')]);
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(dot('bob').getAttribute('aria-hidden')).toBe('true');
  });

  // Un nom trop long pour le panneau est coupé (« … », en CSS) : son infobulle le donne en entier.
  test('chaque nom a son infobulle (title), le nom entier : en ligne comme hors ligne', async () => {
    const long = 'Marie-Hélène de La Tour-Dupin-Gouvernet';
    fakeApi({ 'GET /api/members': () => json(200, [...MEMBERS, { id: 'mh', name: long, avatarKey: null }]) });
    arrive([player('zoe', 'Zoé')]);
    render(<PeoplePanel onClose={() => {}} />);
    const offline = await screen.findByRole('region', { name: /^Hors ligne/ });
    const titles = (section: HTMLElement) => [...section.querySelectorAll('.person-name')].map((name) => name.getAttribute('title'));
    expect(titles(offline)).toEqual(['Alice', 'Bob', 'Élise', long]);
    expect(titles(group(/^En ligne/))).toEqual(['Moi', 'Zoé']);
  });

  test('une section vide n\'est pas affichée : tout le monde en ligne, pas de « Hors ligne »', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS.slice(0, 2)) });
    arrive([player('zoe', 'Zoé')]);
    render(<PeoplePanel onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText(fr.common.loading)).toBeNull());
    expect(screen.queryByRole('region', { name: /^Hors ligne/ })).toBeNull();
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Zoé']);
  });
});

describe('en direct', () => {
  test('un statut qui change : le point et le texte suivent', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob')]);
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(dot('bob').getAttribute('data-status')).toBe('available');

    act(() => useOfficeStore.getState().setStatus('bob', 'dnd'));
    expect(dot('bob').getAttribute('data-status')).toBe('dnd');
    expect(dot('bob').style.backgroundColor).toBe(statusCssColor('dnd'));
    expect(dot('bob').closest('li')?.textContent).toContain('Ne pas déranger');
  });

  test('son propre statut aussi', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    act(() => useOfficeStore.getState().setStatus('moi', 'busy'));
    expect(dot('moi').getAttribute('data-status')).toBe('busy');
  });

  test('une arrivée passe la personne en ligne, un départ la repasse hors ligne', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi']);

    act(() => useOfficeStore.getState().upsertPlayer(player('alice', 'Alice')));
    expect(namesIn(group(/^En ligne/))).toEqual(['Alice', 'Moi']);
    expect(namesIn(group(/^Hors ligne/))).toEqual(['Bob', 'Élise', 'Zoé']);

    act(() => useOfficeStore.getState().removePlayer('alice'));
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi']);
    expect(namesIn(group(/^Hors ligne/))).toEqual(['Alice', 'Bob', 'Élise', 'Zoé']);
    expect(dot('alice').hasAttribute('data-status')).toBe(false);
  });

  test('le nom d\'une personne en ligne est celui que le serveur vient de dire, pas celui de la liste chargée à l\'ouverture', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob')]);
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });

    act(() => useOfficeStore.getState().setProfile({ id: 'bob', name: 'Robert', avatarKey: null }));
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Robert']);
  });
});

describe('chargement et échec', () => {
  test('en attendant la liste : les personnes en ligne (déjà connues) et « Chargement… » à la place des hors ligne', async () => {
    const pending = deferred<Response>();
    fakeApi({ 'GET /api/members': () => pending.promise });
    arrive([player('bob', 'Bob')]);
    render(<PeoplePanel onClose={() => {}} />);

    expect(namesIn(group(/^En ligne/))).toEqual(['Bob', 'Moi']);
    expect(screen.getByText(fr.common.loading)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /^Hors ligne/ })).toBeNull();

    pending.resolve(json(200, MEMBERS));
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(screen.queryByText(fr.common.loading)).toBeNull();
  });

  test.each([
    ['le serveur est injoignable', () => { throw new TypeError('Failed to fetch'); }],
    ['la session a expiré (401)', () => json(401, { error: 'unauthorized' })],
    ['erreur du serveur (500)', () => json(500, { error: 'boom' })],
  ])('échec (%s) : un message et « Réessayer » ; les personnes en ligne restent affichées ; réessayer recharge', async (_case, failure) => {
    let fail = true;
    const api = fakeApi({ 'GET /api/members': () => (fail ? failure() : json(200, MEMBERS)) });
    const user = userEvent.setup();
    arrive([player('bob', 'Bob')]);
    render(<PeoplePanel onClose={() => {}} />);

    expect((await screen.findByRole('alert')).textContent).toBe(fr.office.people.loadFailed);
    expect(namesIn(group(/^En ligne/))).toEqual(['Bob', 'Moi']);
    expect(screen.queryByRole('region', { name: /^Hors ligne/ })).toBeNull();

    fail = false;
    await user.click(screen.getByRole('button', { name: fr.common.retry }));
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api).toHaveBeenCalledTimes(2);
  });

  test('« Réessayer » : « Chargement… » en attendant', async () => {
    let attempt = 0;
    const second = deferred<Response>();
    fakeApi({ 'GET /api/members': () => (attempt++ === 0 ? json(500, {}) : second.promise) });
    const user = userEvent.setup();
    arrive();
    render(<PeoplePanel onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: fr.common.retry }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(fr.common.loading)).toBeTruthy();
    second.resolve(json(200, MEMBERS));
    await screen.findByRole('region', { name: /^Hors ligne/ });
  });
});

describe('un membre que la liste ne connaît pas', () => {
  const NEWCOMER = { id: 'nina', name: 'Nina', avatarKey: null };

  test('il arrive en ligne : la liste est rechargée, une seule fois ; la personne est affichée tout de suite, avant le rechargement', async () => {
    let members = MEMBERS;
    const reload = deferred<Response>();
    let calls = 0;
    const api = fakeApi({ 'GET /api/members': () => (++calls === 1 ? json(200, members) : reload.promise) });
    arrive();
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(api).toHaveBeenCalledTimes(1);

    act(() => useOfficeStore.getState().upsertPlayer(player('nina', 'Nina', 'busy')));
    // Pas besoin d'attendre le serveur pour la voir en ligne.
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Nina']);
    expect(dot('nina').getAttribute('data-status')).toBe('busy');
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));

    members = [...MEMBERS, NEWCOMER];
    await act(async () => reload.resolve(json(200, members)));
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Nina']);

    // Quand elle repart, elle est dans la liste : hors ligne.
    act(() => useOfficeStore.getState().removePlayer('nina'));
    expect(namesIn(group(/^Hors ligne/))).toEqual(['Alice', 'Bob', 'Élise', 'Nina', 'Zoé']);
    expect(api).toHaveBeenCalledTimes(2);
  });

  test('une arrivée d\'un membre connu ne recharge rien', async () => {
    const api = fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    act(() => useOfficeStore.getState().upsertPlayer(player('bob', 'Bob')));
    act(() => useOfficeStore.getState().upsertPlayer(player('alice', 'Alice')));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api).toHaveBeenCalledTimes(1);
  });

  test('si le serveur ne la connaît toujours pas après le rechargement, on ne boucle pas', async () => {
    const api = fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('fantome', 'Fantôme')]);
    render(<PeoplePanel onClose={() => {}} />);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api).toHaveBeenCalledTimes(2);
    // Toujours en ligne, sous le nom que le serveur du bureau lui connaît.
    expect(namesIn(group(/^En ligne/))).toContain('Fantôme');
    // Une autre inconnue plus tard : un nouveau rechargement, un seul.
    act(() => useOfficeStore.getState().upsertPlayer(player('autre', 'Autre')));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api).toHaveBeenCalledTimes(3);
  });

  test('un rechargement qui échoue ne casse pas la liste déjà là', async () => {
    let calls = 0;
    fakeApi({ 'GET /api/members': () => (++calls === 1 ? json(200, MEMBERS) : json(500, {})) });
    arrive();
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    act(() => useOfficeStore.getState().upsertPlayer(player('nina', 'Nina')));
    await waitFor(() => expect(calls).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(namesIn(group(/^Hors ligne/))).toEqual(['Alice', 'Bob', 'Élise', 'Zoé']);
  });

  test('deux demandes en vol : la réponse la plus récente gagne, même arrivée la première (StrictMode ouvre deux fois)', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const pending = [first, second];
    let calls = 0;
    const api = fakeApi({ 'GET /api/members': () => pending[calls++]!.promise });
    arrive();
    render(
      <StrictMode>
        <PeoplePanel onClose={() => {}} />
      </StrictMode>,
    );
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));

    await act(async () => second.resolve(json(200, MEMBERS)));
    await screen.findByRole('region', { name: /^Hors ligne/ });
    // La première réponse, plus lente, ne remet pas la liste à jour avec du plus ancien.
    await act(async () => first.resolve(json(200, [MEMBERS[0]])));
    expect(namesIn(group(/^Hors ligne/))).toEqual(['Alice', 'Bob', 'Élise', 'Zoé']);
  });
});

describe('le panneau', () => {
  test('c\'est une région « Personnes », avec son titre', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    render(<PeoplePanel onClose={() => {}} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(screen.getByRole('complementary', { name: fr.office.people.title })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: fr.office.people.title })).toBeTruthy();
  });

  test('à l\'ouverture, le focus va au titre : un lecteur d\'écran l\'annonce, et Tab entre dans le panneau', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    render(<PeoplePanel onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: fr.office.people.title }));
    await screen.findByRole('region', { name: /^Hors ligne/ });
  });

  test('le bouton Fermer, et Échap, appellent onClose', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    const user = userEvent.setup();
    const onClose = vi.fn();
    arrive();
    render(<PeoplePanel onClose={onClose} />);
    await screen.findByRole('region', { name: /^Hors ligne/ });

    await user.click(screen.getByRole('button', { name: fr.office.people.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('t() remplit les compteurs des titres', () => {
    expect(t(fr.office.people.online, { count: 2 })).toBe('En ligne (2)');
  });
});
