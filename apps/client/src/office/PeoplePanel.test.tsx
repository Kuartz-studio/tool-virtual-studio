import { buildOfficeTiledMap, parseOfficeMap, type ActivityState, type OfficeMap, type PublicPlayer, type Status, type Zone } from '@bureau/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json } from '../test/fake-api';
import { PeoplePanel } from './PeoplePanel';

const player = (id: string, name: string, status: Status = 'available', over: Partial<PublicPlayer> = {}): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status,
  media: { mic: false, cam: false, screen: false },
  ...over,
});

// Les membres que le serveur connaît (GET /api/members), dans l'ordre d'arrivée.
const MEMBERS = [
  { id: 'moi', name: 'Moi', avatarKey: null },
  { id: 'zoe', name: 'Zoé', avatarKey: 'dev-red' },
  { id: 'bob', name: 'Bob', avatarKey: null },
  { id: 'alice', name: 'Alice', avatarKey: null },
  { id: 'elise', name: 'Élise', avatarKey: null },
];

const zone = (id: string, type: Zone['type'], x: number, y: number, width: number, height: number, extra: Partial<Zone> = {}): Zone => ({ id, type, name: null, text: null, x, y, width, height, ...extra });

// Une carte réduite à ses zones : un accueil (étiquette), une salle de réunion (pièce à part) ; ailleurs, le couloir.
const map = {
  widthTiles: 30,
  heightTiles: 30,
  tileSize: 32,
  blocked: new Uint8Array(900),
  spawn: { x: 48, y: 48 },
  switches: [],
  places: [],
  coffees: [],
  speakers: [],
  tables: [],
  signs: [],
  zones: [zone('1', 'label', 0, 320, 320, 64, { text: 'ACCUEIL' }), zone('2', 'private', 640, 0, 320, 320, { name: 'Salle de réunion' })],
} as unknown as OfficeMap;
// Où poser quelqu'un : à l'accueil, dans la salle de réunion, dans le couloir ; et le nom de chacun de ces lieux (placeAt), que la coque donne au panneau
// pour celui où l'on est.
const LOBBY = { x: 100, y: 340 };
const MEETING = { x: 700, y: 100 };
const HALL = { x: 500, y: 100 };
const AT_LOBBY = 'Accueil';
const AT_MEETING = 'Salle de réunion';

beforeEach(() => {
  useOfficeStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

// Le serveur a envoyé l'état de départ : soi-même, et ceux qui sont là.
function arrive(others: PublicPlayer[] = [], self: PublicPlayer = player('moi', 'Moi')): void {
  act(() => useOfficeStore.getState().applyInit({ self, players: others, mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
}

// Le jeu a chargé la carte : où l'on est, et où sont les autres, se lit sur elle.
function withMap(): void {
  act(() => useOfficeStore.getState().setOfficeMap(map));
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

const tab = (name: RegExp) => screen.getByRole('tab', { name }) as HTMLButtonElement;
const group = (name: RegExp) => screen.getByRole('region', { name });
const namesIn = (section: HTMLElement) => within(section).getAllByRole('listitem').map((row) => row.querySelector('.person-name')?.textContent);
const row = (id: string): HTMLElement => document.querySelector(`[data-user="${id}"]`) as HTMLElement;
const sub = (id: string) => row(id).querySelector('.person-sub');

// Le panneau sur « Tout le bureau » : tout le monde, et les hors ligne. Renvoie `user`, pour déplier ce groupe.
async function renderAll(props: { place?: string | null; talkingWith?: string[]; onClose?: () => void } = {}) {
  const user = userEvent.setup();
  render(<PeoplePanel place={null} onClose={() => {}} {...props} />);
  await user.click(tab(/^Tout le bureau/));
  return user;
}

// Les hors ligne, repliés par défaut : le bouton « Hors ligne (n) » les montre.
async function expandOffline(user: ReturnType<typeof userEvent.setup>) {
  const section = await screen.findByRole('region', { name: /^Hors ligne/ });
  await user.click(within(section).getByRole('button', { name: /^Hors ligne/ }));
  return section;
}

describe('le sélecteur', () => {
  test('« Ici » d\'abord et choisi, puis « Tout le bureau » ; chacun dit combien : ceux d\'ici, soi compris, et tous ceux qui sont en ligne', () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob', 'available', LOBBY), player('zoe', 'Zoé', 'available', MEETING)], player('moi', 'Moi', 'available', LOBBY));
    withMap();
    render(<PeoplePanel place={AT_LOBBY} onClose={() => {}} />);
    const tabs = within(screen.getByRole('tablist', { name: fr.office.people.tabsLabel })).getAllByRole('tab');
    expect(tabs.map((entry) => entry.textContent)).toEqual(['Ici 2', 'Tout le bureau 3']);
    expect(tabs.map((entry) => entry.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    // Le panneau de l'onglet choisi est nommé par lui.
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab(/^Ici/).id);
  });

  test('« Tout le bureau » montre tout le monde, et « Ici » seulement ceux qui sont où l\'on est', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    const user = userEvent.setup();
    arrive([player('bob', 'Bob', 'available', LOBBY), player('zoe', 'Zoé', 'available', MEETING)], player('moi', 'Moi', 'available', LOBBY));
    withMap();
    render(<PeoplePanel place={AT_LOBBY} onClose={() => {}} />);
    expect(namesIn(group(/^Ici/))).toEqual(['Moi', 'Bob']);
    await user.click(tab(/^Tout le bureau/));
    expect(tab(/^Tout le bureau/).getAttribute('aria-selected')).toBe('true');
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Bob', 'Zoé']);
    await user.click(tab(/^Ici/));
    expect(namesIn(group(/^Ici/))).toEqual(['Moi', 'Bob']);
  });

  test('« Ici », c\'est le même lieu que moi : mon lieu change (la coque le suit), la liste suit', () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob', 'available', LOBBY), player('zoe', 'Zoé', 'available', MEETING)], player('moi', 'Moi', 'available', LOBBY));
    withMap();
    const { rerender } = render(<PeoplePanel place={AT_LOBBY} onClose={() => {}} />);
    expect(namesIn(group(/^Ici/))).toEqual(['Moi', 'Bob']);
    // Je marche jusqu'à la salle de réunion : Zoé est là, pas Bob.
    rerender(<PeoplePanel place={AT_MEETING} onClose={() => {}} />);
    expect(namesIn(group(/^Ici/))).toEqual(['Moi', 'Zoé']);
    expect(tab(/^Ici/).textContent).toBe('Ici 2');
    // Puis au couloir : personne d'autre.
    rerender(<PeoplePanel place={fr.office.where.hallway} onClose={() => {}} />);
    expect(namesIn(group(/^Ici/))).toEqual(['Moi']);
    expect(screen.getByText(fr.office.people.nobodyHere)).toBeTruthy();
    expect(tab(/^Ici/).textContent).toBe('Ici 1');
  });

  test('les positions des autres, que le magasin tient sans prévenir, sont relues deux fois par seconde', async () => {
    vi.useFakeTimers();
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob', 'available', MEETING)], player('moi', 'Moi', 'available', LOBBY));
    withMap();
    render(<PeoplePanel place={AT_LOBBY} onClose={() => {}} />);
    expect(namesIn(group(/^Ici/))).toEqual(['Moi']);
    // Bob vient à l'accueil : le magasin a sa nouvelle position, sans que rien ne soit publié.
    useOfficeStore.getState().positions.set('bob', { ...LOBBY, dir: 'down', moving: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(namesIn(group(/^Ici/))).toEqual(['Moi', 'Bob']);
    expect(tab(/^Ici/).textContent).toBe('Ici 2');
  });

  test('sans carte (le jeu n\'est pas encore là), « Ici » n\'a que soi', () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob')]);
    render(<PeoplePanel place={null} onClose={() => {}} />);
    expect(namesIn(group(/^Ici/))).toEqual(['Moi']);
  });

  test('au clavier : ← et → passent de « Ici » à « Tout le bureau », le focus avec eux', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    const user = userEvent.setup();
    arrive();
    render(<PeoplePanel place={null} onClose={() => {}} />);
    tab(/^Ici/).focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab(/^Tout le bureau/));
    expect(tab(/^Tout le bureau/).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tab(/^Ici/));
  });
});

// « Ici », sur la grande carte : le même lieu que la puce du lieu (placeAt), qui nomme ses pièces d'après les lieux de la carte. Le café est bien plus
// large que la bande d'une case que la carte étiquette « CAFÉ » : deux personnes aux deux bouts du café sont ici ensemble, et non avec celle qui est
// dans la rue.
describe('« Ici » sur la grande carte', () => {
  const office = parseOfficeMap(buildOfficeTiledMap());
  const spot = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });
  const arriveInOffice = (others: PublicPlayer[], self: PublicPlayer) => {
    act(() => useOfficeStore.getState().applyInit({ self, players: others, mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
    act(() => useOfficeStore.getState().setOfficeMap(office));
  };

  test('au café, aux deux bouts : ensemble ; celui du couloir : ailleurs', () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arriveInOffice(
      [player('bob', 'Bob', 'available', spot(33, 3)), player('zoe', 'Zoé', 'available', spot(30, 12))],
      player('moi', 'Moi', 'available', spot(46, 8)),
    );
    render(<PeoplePanel place="Café" onClose={() => {}} />);
    expect(namesIn(group(/^Ici/))).toEqual(['Moi', 'Bob']);
    expect(tab(/^Ici/).textContent).toBe('Ici 2');
    expect(sub('moi')?.textContent).toBe('Café');
    expect(sub('bob')?.textContent).toBe('Café');
  });

  test('« Tout le bureau » dit le lieu de chacun : le café, l\'accueil, le couloir', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arriveInOffice(
      [player('bob', 'Bob', 'available', spot(40, 22)), player('zoe', 'Zoé', 'available', spot(30, 12))],
      player('moi', 'Moi', 'available', spot(35, 7)),
    );
    render(<PeoplePanel place="Café" onClose={() => {}} />);
    await userEvent.click(tab(/^Tout le bureau/));
    expect(sub('moi')?.textContent).toBe('Café');
    expect(sub('bob')?.textContent).toBe('Accueil');
    expect(sub('zoe')?.textContent).toBe('Couloir');
  });
});

describe('une ligne', () => {
  test('un portrait de 38 px avec la pastille de son statut, son nom, et sous lui ce qu\'elle fait', () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob', 'busy', LOBBY)], player('moi', 'Moi', 'away', LOBBY));
    withMap();
    render(<PeoplePanel place={AT_LOBBY} onClose={() => {}} />);
    for (const [id, status] of [['moi', 'away'], ['bob', 'busy']] as const) {
      const portrait = row(id).querySelector<HTMLElement>('.portrait')!;
      expect(portrait.style.getPropertyValue('--s')).toBe('38px');
      expect(portrait.querySelector('.portrait-dot')?.getAttribute('data-status')).toBe(status);
    }
    expect(row('bob').querySelector('.person-name')?.textContent).toBe('Bob');
  });

  test('on garde data-user et data-status sur les lignes (les tests de bout en bout les lisent) ; sans statut, pas de data-status', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('zoe', 'Zoé', 'dnd')], player('moi', 'Moi', 'away'));
    const user = await renderAll();
    await expandOffline(user);
    expect(row('moi').tagName).toBe('LI');
    expect(row('moi').getAttribute('data-status')).toBe('away');
    expect(row('zoe').getAttribute('data-status')).toBe('dnd');
    for (const id of ['alice', 'elise']) {
      expect(row(id).tagName).toBe('LI');
      expect(row(id).hasAttribute('data-status')).toBe(false);
    }
  });

  test('le statut est écrit pour un lecteur d\'écran (la pastille ne dit rien) ; hors ligne, la ligne n\'est que le nom', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('zoe', 'Zoé', 'dnd')]);
    const user = await renderAll();
    await expandOffline(user);
    expect(row('zoe').querySelector('.visually-hidden')?.textContent).toBe(fr.status.dnd);
    expect(row('zoe').querySelector('.portrait')?.getAttribute('aria-hidden')).toBe('true');
    // Hors ligne, rien de plus que le nom (le portrait, caché, n'a que ses initiales avant d'être dessiné).
    expect(row('alice').querySelector('.person-text')?.textContent).toBe('Alice');
    expect(row('alice').querySelector('.person-sub')).toBeNull();
  });

  test('on se reconnaît : « toi »', () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob')]);
    render(<PeoplePanel place={null} onClose={() => {}} />);
    expect(row('moi').querySelector('.person-you')?.textContent).toBe('toi');
    expect(fr.office.people.you).toBe('toi');
    expect(row('moi').querySelector('.person-you')).not.toBeNull();
  });

  // Un nom trop long pour le panneau est coupé (« … », en CSS) : son infobulle le donne en entier.
  test('chaque nom a son infobulle (title), le nom entier : en ligne comme hors ligne', async () => {
    const long = 'Marie-Hélène de La Tour-Dupin-Gouvernet';
    fakeApi({ 'GET /api/members': () => json(200, [...MEMBERS, { id: 'mh', name: long, avatarKey: null }]) });
    arrive([player('zoe', 'Zoé')]);
    const user = await renderAll();
    const offline = await expandOffline(user);
    const titles = (section: HTMLElement) => [...section.querySelectorAll('.person-name')].map((name) => name.getAttribute('title'));
    expect(titles(offline)).toEqual(['Alice', 'Bob', 'Élise', long]);
    expect(titles(group(/^En ligne/))).toEqual(['Moi', 'Zoé']);
  });

  describe('la ligne du dessous : le mode, sinon « Parle avec toi », sinon le lieu', () => {
    const focus: ActivityState = { id: 's1', label: 'Concentration', color: '#6d28d9', allowEntry: false, hear: false, heard: false, icon: 'headphones' };
    const dotOnly: ActivityState = { id: 's2', label: 'À table', color: '#f59e0b', allowEntry: true, hear: true, heard: true };

    test('un mode : son icône et son libellé, et le point de sa couleur quand il n\'a pas d\'icône', () => {
      fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
      arrive([player('bob', 'Bob', 'available', { ...LOBBY, activity: focus }), player('zoe', 'Zoé', 'available', { ...LOBBY, activity: dotOnly })], player('moi', 'Moi', 'available', LOBBY));
      withMap();
      render(<PeoplePanel place={AT_LOBBY} onClose={() => {}} />);
      expect(sub('bob')?.textContent).toBe('Concentration');
      expect(sub('bob')?.querySelector('svg.lucide-headphones')).not.toBeNull();
      expect(sub('zoe')?.textContent).toBe('À table');
      expect(sub('zoe')?.querySelector('.status-dot')).not.toBeNull();
      expect((sub('zoe')?.querySelector('.status-dot') as HTMLElement).style.backgroundColor).toBe('#f59e0b');
    });

    test('sans mode : « Parle avec toi » pour ceux de ma conversation', () => {
      fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
      arrive([player('bob', 'Bob', 'available', LOBBY), player('zoe', 'Zoé', 'available', LOBBY)], player('moi', 'Moi', 'available', LOBBY));
      withMap();
      render(<PeoplePanel place={AT_LOBBY} talkingWith={['bob']} onClose={() => {}} />);
      expect(sub('bob')?.textContent).toBe(fr.office.people.talking);
      expect(sub('bob')?.querySelector('svg.lucide')).not.toBeNull();
      expect(fr.office.people.talking).toBe('Parle avec toi');
      // Zoé n'y est pas : son lieu.
      expect(sub('zoe')?.textContent).toBe('Accueil');
    });

    test('un mode passe avant la conversation', () => {
      fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
      arrive([player('bob', 'Bob', 'available', { ...LOBBY, activity: focus })], player('moi', 'Moi', 'available', LOBBY));
      withMap();
      render(<PeoplePanel place={AT_LOBBY} talkingWith={['bob']} onClose={() => {}} />);
      expect(sub('bob')?.textContent).toBe('Concentration');
    });

    test('sinon le lieu : celui de la carte, pour chacun, soi compris ; sans carte, rien', async () => {
      fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
      arrive([player('bob', 'Bob', 'available', LOBBY), player('zoe', 'Zoé', 'available', MEETING), player('alice', 'Alice', 'available', HALL)], player('moi', 'Moi', 'available', LOBBY));
      render(<PeoplePanel place={AT_LOBBY} onClose={() => {}} />);
      const user = userEvent.setup();
      await user.click(tab(/^Tout le bureau/));
      // Sans carte, les autres n'ont pas de lieu.
      expect(sub('bob')?.textContent ?? '').toBe('');
      withMap();
      expect(sub('moi')?.textContent).toBe('Accueil');
      expect(sub('bob')?.textContent).toBe('Accueil');
      expect(sub('zoe')?.textContent).toBe('Salle de réunion');
      expect(sub('alice')?.textContent).toBe(fr.office.where.hallway);
    });

    test('mon propre mode, sur ma ligne', () => {
      fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
      arrive([], player('moi', 'Moi', 'available', { ...LOBBY, activity: focus }));
      withMap();
      render(<PeoplePanel place={AT_LOBBY} onClose={() => {}} />);
      expect(sub('moi')?.textContent).toBe('Concentration');
    });
  });
});

describe('la liste', () => {
  test('GET /api/members à l\'ouverture', async () => {
    const api = fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    await renderAll();
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toBe('/api/members');
  });

  test('les personnes en ligne, chaque liste par ordre alphabétique (français), soi-même d\'abord ; les autres, repliés sous « Hors ligne (n) »', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('zoe', 'Zoé'), player('bob', 'Bob')]);
    const user = await renderAll();
    const offline = await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Bob', 'Zoé']);
    expect(tab(/^Tout le bureau/).textContent).toBe('Tout le bureau 3');
    // Repliés : le compte est écrit, les lignes n'y sont pas.
    const toggle = within(offline).getByRole('button', { name: 'Hors ligne (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(offline).queryAllByRole('listitem')).toHaveLength(0);
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // « Élise » vient avec les E, avant « Zoé » : la comparaison est celle du français.
    expect(namesIn(offline)).toEqual(['Alice', 'Élise']);
    // Les replier les cache de nouveau.
    await user.click(toggle);
    expect(within(offline).queryAllByRole('listitem')).toHaveLength(0);
  });

  test('« Ici » n\'a pas de hors ligne : personne n\'est nulle part', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob')]);
    render(<PeoplePanel place={null} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText(fr.common.loading)).toBeNull());
    expect(screen.queryByRole('region', { name: /^Hors ligne/ })).toBeNull();
  });

  test('une section vide n\'est pas affichée : tout le monde en ligne, pas de « Hors ligne »', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS.slice(0, 2)) });
    arrive([player('zoe', 'Zoé')]);
    await renderAll();
    await waitFor(() => expect(screen.queryByText(fr.common.loading)).toBeNull());
    expect(screen.queryByRole('region', { name: /^Hors ligne/ })).toBeNull();
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Zoé']);
  });
});

describe('en direct', () => {
  test('un statut qui change : la pastille et le texte suivent', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob')]);
    await renderAll();
    await screen.findByRole('region', { name: /^Hors ligne/ });
    expect(row('bob').getAttribute('data-status')).toBe('available');

    act(() => useOfficeStore.getState().setStatus('bob', 'dnd'));
    expect(row('bob').getAttribute('data-status')).toBe('dnd');
    expect(row('bob').querySelector('.portrait-dot')?.getAttribute('data-status')).toBe('dnd');
    expect(row('bob').textContent).toContain('Ne pas déranger');
  });

  test('son propre statut aussi', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    await renderAll();
    await screen.findByRole('region', { name: /^Hors ligne/ });
    act(() => useOfficeStore.getState().setStatus('moi', 'busy'));
    expect(row('moi').getAttribute('data-status')).toBe('busy');
  });

  test('une arrivée passe la personne en ligne, un départ la repasse hors ligne', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    const user = await renderAll();
    const offline = await expandOffline(user);
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi']);

    act(() => useOfficeStore.getState().upsertPlayer(player('alice', 'Alice')));
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Alice']);
    expect(namesIn(offline)).toEqual(['Bob', 'Élise', 'Zoé']);

    act(() => useOfficeStore.getState().removePlayer('alice'));
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi']);
    expect(namesIn(offline)).toEqual(['Alice', 'Bob', 'Élise', 'Zoé']);
    expect(row('alice').hasAttribute('data-status')).toBe(false);
  });

  test('le nom d\'une personne en ligne est celui que le serveur vient de dire, pas celui de la liste chargée à l\'ouverture', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('bob', 'Bob')]);
    await renderAll();
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
    await renderAll();

    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Bob']);
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
    arrive([player('bob', 'Bob')]);
    const user = await renderAll();

    expect((await screen.findByRole('alert')).textContent).toBe(fr.office.people.loadFailed);
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Bob']);
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
    arrive();
    const user = await renderAll();
    await user.click(await screen.findByRole('button', { name: fr.common.retry }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(fr.common.loading)).toBeTruthy();
    second.resolve(json(200, MEMBERS));
    await screen.findByRole('region', { name: /^Hors ligne/ });
  });

  test('« Ici » n\'attend pas la liste : les gens d\'ici sont connus du bureau, sans « Chargement… »', () => {
    fakeApi({ 'GET /api/members': () => deferred<Response>().promise });
    arrive([player('bob', 'Bob', 'available', LOBBY)], player('moi', 'Moi', 'available', LOBBY));
    withMap();
    render(<PeoplePanel place={AT_LOBBY} onClose={() => {}} />);
    expect(namesIn(group(/^Ici/))).toEqual(['Moi', 'Bob']);
    expect(screen.queryByText(fr.common.loading)).toBeNull();
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
    const user = await renderAll();
    const offline = await expandOffline(user);
    expect(api).toHaveBeenCalledTimes(1);

    act(() => useOfficeStore.getState().upsertPlayer(player('nina', 'Nina', 'busy')));
    // Pas besoin d'attendre le serveur pour la voir en ligne.
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Nina']);
    expect(row('nina').getAttribute('data-status')).toBe('busy');
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));

    members = [...MEMBERS, NEWCOMER];
    await act(async () => reload.resolve(json(200, members)));
    expect(namesIn(group(/^En ligne/))).toEqual(['Moi', 'Nina']);

    // Quand elle repart, elle est dans la liste : hors ligne.
    act(() => useOfficeStore.getState().removePlayer('nina'));
    expect(namesIn(offline)).toEqual(['Alice', 'Bob', 'Élise', 'Nina', 'Zoé']);
    expect(api).toHaveBeenCalledTimes(2);
  });

  test('une arrivée d\'un membre connu ne recharge rien', async () => {
    const api = fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    await renderAll();
    await screen.findByRole('region', { name: /^Hors ligne/ });
    act(() => useOfficeStore.getState().upsertPlayer(player('bob', 'Bob')));
    act(() => useOfficeStore.getState().upsertPlayer(player('alice', 'Alice')));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api).toHaveBeenCalledTimes(1);
  });

  test('si le serveur ne la connaît toujours pas après le rechargement, on ne boucle pas', async () => {
    const api = fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('fantome', 'Fantôme')]);
    await renderAll();
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
    const user = await renderAll();
    const offline = await expandOffline(user);
    act(() => useOfficeStore.getState().upsertPlayer(player('nina', 'Nina')));
    await waitFor(() => expect(calls).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(namesIn(offline)).toEqual(['Alice', 'Bob', 'Élise', 'Zoé']);
  });

  test('deux demandes en vol : la réponse la plus récente gagne, même arrivée la première (StrictMode ouvre deux fois)', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const pending = [first, second];
    let calls = 0;
    const api = fakeApi({ 'GET /api/members': () => pending[calls++]!.promise });
    arrive();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <PeoplePanel place={null} onClose={() => {}} />
      </StrictMode>,
    );
    await user.click(tab(/^Tout le bureau/));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));

    await act(async () => second.resolve(json(200, MEMBERS)));
    const offline = await expandOffline(user);
    // La première réponse, plus lente, ne remet pas la liste à jour avec du plus ancien.
    await act(async () => first.resolve(json(200, [MEMBERS[0]])));
    expect(namesIn(offline)).toEqual(['Alice', 'Bob', 'Élise', 'Zoé']);
  });
});

describe('le panneau', () => {
  test('c\'est une région « Personnes », avec son titre', () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    render(<PeoplePanel place={null} onClose={() => {}} />);
    expect(screen.getByRole('complementary', { name: fr.office.people.title })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: fr.office.people.title })).toBeTruthy();
  });

  test('à l\'ouverture, le focus va au titre : un lecteur d\'écran l\'annonce, et Tab entre dans le panneau', () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive();
    render(<PeoplePanel place={null} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: fr.office.people.title }));
  });

  test('le bouton Fermer, et Échap, appellent onClose', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    const user = userEvent.setup();
    const onClose = vi.fn();
    arrive();
    render(<PeoplePanel place={null} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: fr.ui.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('t() remplit les compteurs des titres', () => {
    expect(t(fr.office.people.online, { count: 2 })).toBe('En ligne (2)');
    expect(t(fr.office.people.offline, { count: 4 })).toBe('Hors ligne (4)');
  });
});
