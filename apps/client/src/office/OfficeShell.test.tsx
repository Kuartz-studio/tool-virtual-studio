import type { ChatMessage, MediaJoinPayload, OfficeMap, PublicPlayer, Role, Zone } from '@bureau/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAudioStore } from '../audio/audio-store';
import { DEFAULT_AUDIO_PREFS } from '../audio/prefs';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { FakeMediaClient } from '../media/fake-media-client';
import * as activityApi from '../lib/activity-api';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json } from '../test/fake-api';
import { FakeSocket } from '../test/fake-socket';
import { OfficeShell } from './OfficeShell';

const player = (id: string, name: string): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
});

const payload = (room: string): MediaJoinPayload => ({ url: 'wss://livekit.test', room, token: `jeton-${room}` });
const clients: FakeMediaClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.leave();
});

beforeEach(() => {
  useOfficeStore.getState().reset();
  fakeApi({
    'GET /api/members': () =>
      json(200, [
        { id: 'moi', name: 'Léa', avatarKey: null },
        { id: 'bob', name: 'Bob', avatarKey: null },
      ]),
  });
});

interface Options {
  signingOut?: boolean;
  connecting?: boolean;
  reconnecting?: boolean;
  errors?: string[];
  onSignOut?: () => void;
  onUseHere?: () => void;
  onReconnect?: () => void;
  init?: boolean;
  // Le rôle du compte connecté (la session) : « member » par défaut.
  role?: Role;
}

// Le bureau, avec une socket connectée et un faux client média (hors conversation). `init` : le serveur a envoyé l'état de départ.
function renderShell({
  signingOut = false,
  connecting = false,
  reconnecting = false,
  errors = [],
  onSignOut = () => {},
  onUseHere = () => {},
  onReconnect = () => {},
  init = true,
  role = 'member',
}: Options = {}) {
  const socket = new FakeSocket();
  socket.serverAccepts();
  const client = new FakeMediaClient({ mic: true, cam: false }, { id: 'moi', name: 'Léa' });
  clients.push(client);
  if (init) act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [player('bob', 'Bob')], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
  const shell = () => (
    <OfficeShell
      user={{ id: 'moi', name: 'Léa', email: 'lea@exemple.fr', role }}
      socket={socket.asSocket()}
      media={{ client, snapshot: client.getSnapshot() }}
      onReconnect={onReconnect}
      onSignOut={onSignOut}
      signingOut={signingOut}
      onUseHere={onUseHere}
      connecting={connecting}
      reconnecting={reconnecting}
      errors={errors}
    >
      <div data-testid="jeu" />
    </OfficeShell>
  );
  const view = render(shell());
  // Le client a changé (la page le suit par useMedia) : la page se redessine.
  const refresh = () => view.rerender(shell());
  return { socket, client, refresh, ...view };
}

const bar = () => screen.getByRole('group', { name: fr.office.barLabel });
const toggle = () => within(bar()).getByRole('button', { name: fr.office.people.toggle }) as HTMLButtonElement;
const chatToggle = () => within(bar()).getByRole('button', { name: /^Chat/ }) as HTMLButtonElement;
const moreButton = () => within(bar()).getByRole('button', { name: fr.office.more.toggle }) as HTMLButtonElement;
const meChip = () => within(bar()).getByRole('button', { name: fr.me.chip }) as HTMLButtonElement;
type User = ReturnType<typeof userEvent.setup>;
// Ce que choisit une ligne du menu « Plus » : Décorer, Admin, le zoom de départ.
async function chooseInMoreMenu(user: User, name: string) {
  await user.click(moreButton());
  await user.click(screen.getByRole('menuitem', { name }));
}
// Ce que choisit une ligne du menu de la puce « Moi » : l'apparence, les modes, Se déconnecter.
async function chooseInMeMenu(user: User, name: string) {
  await user.click(meChip());
  await user.click(screen.getByRole('menuitem', { name }));
}
const chatPanel = () => screen.getByRole('complementary', { name: fr.chat.title });
const chatInput = () => screen.getByRole('textbox') as HTMLInputElement;
const chatMessage = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channel: 'all',
  userId: 'bob',
  name: 'Bob',
  text: `message ${id}`,
  sentAt: '2026-10-20T10:00:00.000Z',
  ...over,
});

describe('la mise en page', () => {
  test('le jeu occupe la page, sous le reste ; la page a son titre', () => {
    const { container } = renderShell();
    const main = container.querySelector('main.office')!;
    expect(main.querySelector(':scope > [data-testid="jeu"]')).toBeTruthy();
    // Le reste (vignettes, panneaux, barre) est une couche par-dessus, qui ne contient pas le jeu.
    const ui = main.querySelector(':scope > .office-ui')!;
    expect(ui).toBeTruthy();
    expect(ui.querySelector('[data-testid="jeu"]')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: fr.common.appName })).toBeTruthy();
  });

  test('en haut, les vignettes de la conversation : rien hors conversation ; la sienne et celles des autres dedans', async () => {
    const { container, client, refresh } = renderShell();
    const top = container.querySelector('.office-ui > .office-top')!;
    expect(top.childElementCount).toBe(0);
    await act(() => client.join(payload('r1')));
    act(() => client.addRemote({ id: 'bob', name: 'Bob' }));
    refresh();
    const tiles = within(top as HTMLElement).getByRole('list', { name: fr.media.tiles.label });
    expect(within(tiles).getAllByRole('listitem')).toHaveLength(2);
    expect(within(tiles).getByRole('button', { name: new RegExp(`^${t(fr.media.tiles.camera, { name: 'Bob' })}`) })).toBeTruthy();
  });

  test('la barre du bas : la puce « Moi », micro, caméra, partage d\'écran et musique, le zoom, puis Chat, Personnes et Plus ; le nom et le statut sont dans la puce', () => {
    renderShell();
    const names = within(bar()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Mon profil', 'Micro', 'Caméra', 'Partager l\'écran', 'Musique et ambiances', 'Zoom arrière', 'Rétablir le zoom (100 %)', 'Zoom avant', 'Chat', 'Personnes', 'Plus']);
    expect(within(meChip()).getByText('Léa')).toBeTruthy();
    expect(within(meChip()).getByText(fr.status.available)).toBeTruthy();
  });

  // La lumière du bureau est une pour tous : éteinte, la couche d'interface prend les couleurs de la nuit (les jetons de
  // `.office-ui[data-theme='night']`, styles.css), et `data-lights` le dit aussi.
  test('la couche dit le jour (lumière allumée) ou la nuit (éteinte) : data-theme et data-lights, qui suivent la lumière du magasin', () => {
    const { container } = renderShell();
    const layer = container.querySelector('.office-ui')!;
    expect([layer.getAttribute('data-theme'), layer.getAttribute('data-lights')]).toEqual(['day', 'on']);
    act(() => useOfficeStore.getState().setLights({ on: false, by: { id: 'bob', name: 'Bob' }, at: 1 }));
    expect([layer.getAttribute('data-theme'), layer.getAttribute('data-lights')]).toEqual(['night', 'off']);
    act(() => useOfficeStore.getState().setLights({ on: true, by: { id: 'moi', name: 'Léa' }, at: 2 }));
    expect([layer.getAttribute('data-theme'), layer.getAttribute('data-lights')]).toEqual(['day', 'on']);
  });

  test('arrivé quand la lumière est éteinte : la nuit dès le premier rendu de l\'init', () => {
    const { container } = renderShell({ init: false });
    expect(container.querySelector('.office-ui')?.getAttribute('data-theme')).toBe('day');
    act(() =>
      useOfficeStore.getState().applyInit({
        self: player('moi', 'Léa'),
        players: [],
        mapKey: 'dev-office',
        chatHistory: [],
        desks: [],
        closedDesks: [],
        deskBans: [],
        lights: { on: false, by: { id: 'bob', name: 'Bob' }, at: 1 },
      }),
    );
    expect(container.querySelector('.office-ui')?.getAttribute('data-theme')).toBe('night');
  });

  test('en haut à gauche, le lieu où l\'on est (la carte n\'est pas là : rien) ; les messages passagers sont sous les vignettes', () => {
    const { container } = renderShell();
    expect(container.querySelector('.office-ui > .dock-where')).toBeNull();
    act(() => useOfficeStore.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' }));
    expect(container.querySelector('.office-ui > .toasts')?.textContent).toContain(t(fr.desk.knockToast, { name: 'Bob' }));
  });

  test('la barre dit sa hauteur à la couche (--bar-size) : les panneaux s\'arrêtent au-dessus d\'elle, même sur plusieurs lignes', () => {
    let notify: () => void = () => {};
    const observed: Element[] = [];
    class FakeResizeObserver {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe(element: Element) {
        observed.push(element);
      }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { container } = renderShell();
    const layer = container.querySelector<HTMLElement>('.office-ui')!;
    const barElement = layer.querySelector<HTMLElement>('.office-bar')!;
    expect(observed).toEqual([barElement]);

    // Une fenêtre étroite : la barre passe sur deux lignes.
    vi.spyOn(barElement, 'getBoundingClientRect').mockReturnValue({ height: 112 } as DOMRect);
    notify();
    expect(layer.style.getPropertyValue('--bar-size')).toBe('112px');
    vi.spyOn(barElement, 'getBoundingClientRect').mockReturnValue({ height: 56 } as DOMRect);
    notify();
    expect(layer.style.getPropertyValue('--bar-size')).toBe('56px');
  });

  test('les commandes de la barre parlent au client média', async () => {
    const user = userEvent.setup();
    const { client, refresh } = renderShell();
    await user.click(within(bar()).getByRole('button', { name: fr.media.controls.mic }));
    expect(client.getSnapshot().local.mic).toBe(false);
    refresh();
    expect(within(bar()).getByRole('button', { name: fr.media.controls.mic }).getAttribute('aria-pressed')).toBe('false');
  });

  test('« Connexion perdue, reconnexion… » quand la connexion est tombée après l\'arrivée', () => {
    renderShell({ reconnecting: true });
    expect(screen.getByRole('status').textContent).toBe(fr.office.reconnecting);
  });

  test('la connexion audio et vidéo a échoué : « Reconnecter », en haut, appelle onReconnect', async () => {
    const user = userEvent.setup();
    const onReconnect = vi.fn();
    const { client, refresh } = renderShell({ onReconnect });
    client.failConnections();
    await act(() => client.join(payload('r1')));
    refresh();
    await user.click(screen.getByRole('button', { name: fr.media.reconnect }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  test('le nom affiché est celui de la session avant l\'init, puis celui que le serveur donne (un changement de nom suit)', () => {
    renderShell({ init: false });
    expect(within(bar()).getByText('Léa')).toBeTruthy();
    act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa Martin'), players: [], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
    expect(within(bar()).getByText('Léa Martin')).toBeTruthy();
    act(() => useOfficeStore.getState().setProfile({ id: 'moi', name: 'Léa M.', avatarKey: null }));
    expect(within(bar()).getByText('Léa M.')).toBeTruthy();
  });

  test('« Connexion au bureau… » en attendant le serveur', () => {
    renderShell({ connecting: true, init: false });
    expect(screen.getByRole('status').textContent).toBe(fr.office.connecting);
  });

  test('pas de message de connexion une fois connecté', () => {
    renderShell({ connecting: false });
    expect(screen.queryByText(fr.office.connecting)).toBeNull();
  });

  test('les erreurs : chacune est une alerte', () => {
    renderShell({ errors: ['Première', 'Seconde'] });
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Première', 'Seconde']);
  });
});

describe('Se déconnecter', () => {
  test('la ligne du menu « Moi » appelle onSignOut', async () => {
    const onSignOut = vi.fn();
    renderShell({ onSignOut });
    await chooseInMeMenu(userEvent.setup(), fr.office.signOut);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  test('pendant la déconnexion : « Déconnexion… », inactif', async () => {
    renderShell({ signingOut: true });
    await userEvent.click(meChip());
    const item = screen.getByRole('menuitem', { name: fr.office.signingOut }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  test('il marche avant l\'init (le serveur ne répond pas) : on doit pouvoir se déconnecter', async () => {
    const onSignOut = vi.fn();
    renderShell({ init: false, connecting: true, onSignOut });
    await chooseInMeMenu(userEvent.setup(), fr.office.signOut);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('le statut', () => {
  test('« Ne pas déranger » part au serveur (status:set) par la socket de la page', async () => {
    const user = userEvent.setup();
    const { socket } = renderShell();
    await user.click(meChip());
    await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
    expect(socket.sentOf('status:set')).toEqual(['dnd']);
  });
});

describe('le panneau Personnes', () => {
  test('fermé au départ ; le bouton l\'ouvre et le ferme, et le dit (aria-expanded, aria-controls)', async () => {
    const user = userEvent.setup();
    renderShell();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().hasAttribute('aria-controls')).toBe(false);

    await user.click(toggle());
    const panel = screen.getByRole('complementary', { name: fr.office.people.title });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.id).not.toBe('');

    await user.click(toggle());
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  test('il s\'ouvre dans la couche par-dessus le jeu : le jeu ne bouge pas (pas de décalage, même élément)', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    const game = screen.getByTestId('jeu');
    await user.click(toggle());
    const panel = screen.getByRole('complementary');
    expect(container.querySelector('.office-ui .office-side')?.contains(panel)).toBe(true);
    expect(game.parentElement?.matches('main.office')).toBe(true);
    expect(screen.getByTestId('jeu')).toBe(game);
    await user.click(toggle());
    expect(screen.getByTestId('jeu')).toBe(game);
  });

  test('à l\'ouverture le focus passe au panneau (son titre) ; Échap le ferme et rend le focus au bouton', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(toggle());
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: fr.office.people.title }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  test('le bouton Fermer du panneau le ferme aussi, focus rendu au bouton', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: fr.ui.close }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  test('au clavier : Entrée ouvre le panneau, et Tab y entre', async () => {
    const user = userEvent.setup();
    renderShell();
    toggle().focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('complementary')).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.ui.close }));
  });

  test('il liste les gens (l\'appel à /api/members part à l\'ouverture)', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(toggle());
    await user.click(screen.getByRole('tab', { name: /^Tout le bureau/ }));
    expect(await screen.findByRole('region', { name: 'En ligne (2)' })).toBeTruthy();
    // Les hors ligne sont ceux que l'appel a apportés : ici, personne de plus que ceux qui sont là.
    expect(screen.queryByRole('region', { name: /^Hors ligne/ })).toBeNull();
  });

  // Le panneau n'existe qu'ouvert : le lieu où l'on est, il ne peut le suivre qu'à partir de l'ouverture. C'est la coque, toujours là, qui le suit (comme
  // la puce du lieu) et le lui donne : marché avant d'ouvrir le panneau, « Ici » est bien là où l'on est.
  test('« Ici » est le lieu où l\'on est à l\'ouverture, même après y avoir marché avant : la coque l\'a suivi, et le donne à la puce comme au panneau', async () => {
    const zone = (id: string, type: Zone['type'], x: number, y: number, width: number, height: number, extra: Partial<Zone> = {}): Zone => ({ id, type, name: null, text: null, x, y, width, height, ...extra });
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
      zones: [zone('1', 'private', 640, 0, 320, 320, { name: 'Salle de réunion' })],
    } as unknown as OfficeMap;
    const user = userEvent.setup();
    renderShell();
    act(() => useOfficeStore.getState().setOfficeMap(map));
    // Bob est dans la salle de réunion ; on y marche (les pieds que le jeu envoie), puis on ouvre le panneau.
    useOfficeStore.getState().positions.set('bob', { x: 720, y: 120, dir: 'down', moving: false });
    act(() => void emitOnBus(EventBus, 'local:move', { x: 700, y: 100, dir: 'up', moving: true }));
    expect(screen.getByRole('group', { name: fr.office.where.label }).textContent).toContain('Salle de réunion');
    await user.click(toggle());
    expect(await screen.findByRole('region', { name: /^Ici \(2\)/ })).toBeTruthy();
    expect(document.querySelector('[data-user="moi"] .person-sub')?.textContent).toBe('Salle de réunion');
    expect(document.querySelector('[data-user="bob"] .person-sub')?.textContent).toBe('Salle de réunion');
  });

  test('sa ligne dit qu\'on parle avec ceux de la conversation (les participants de la room, sans soi)', async () => {
    const user = userEvent.setup();
    const { client, refresh } = renderShell();
    await act(() => client.join(payload('r1')));
    client.addRemote({ id: 'bob', name: 'Bob', mic: true, cam: false });
    refresh();
    await user.click(toggle());
    await user.click(screen.getByRole('tab', { name: /^Tout le bureau/ }));
    expect(await screen.findByText(fr.office.people.talking)).toBeTruthy();
    expect(document.querySelector('[data-user="bob"] .person-sub')?.textContent).toBe(fr.office.people.talking);
    expect(document.querySelector('[data-user="moi"] .person-sub')?.textContent ?? '').not.toBe(fr.office.people.talking);
  });

  test('il est inactif tant que le serveur n\'a pas dit qui est là (avant l\'init)', () => {
    renderShell({ init: false });
    expect(toggle().disabled).toBe(true);
  });
});

describe('le juke-box', () => {
  const music = () => within(bar()).getByRole('button', { name: fr.sound.toggle }) as HTMLButtonElement;
  const jukebox = () => screen.getByRole('dialog', { name: fr.sound.toggle });

  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, status: 'locked', playing: null, place: 'lobby' });
  });

  test('fermé au départ ; le bouton du dock l\'ouvre au-dessus de lui, et ce n\'est pas un panneau de droite', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(music());
    expect(container.querySelector('.office-ui')?.contains(jukebox())).toBe(true);
    expect(container.querySelector('.office-side')?.contains(jukebox())).toBe(false);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  test('il marche avant l\'init : le son ne dépend pas du serveur', async () => {
    renderShell({ init: false });
    expect(music().disabled).toBe(false);
    await userEvent.click(music());
    expect(jukebox()).toBeTruthy();
  });

  test('il laisse le panneau de droite en place : Personnes et le juke-box sont ouverts ensemble', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(toggle());
    await user.click(music());
    expect(screen.getByRole('complementary', { name: fr.office.people.title })).toBeTruthy();
    expect(jukebox()).toBeTruthy();
  });

  test('Échap le ferme et rend le focus à son bouton', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(music());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(music());
  });

  test('choisir une ambiance y change la musique voulue, et le bouton se barre quand la musique est coupée', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(music());
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${fr.sound.scenes.drift.title}`) }));
    expect(useAudioStore.getState().prefs.scene).toBe('drift');
    await user.click(screen.getByRole('switch', { name: fr.sound.music.label }));
    expect(useAudioStore.getState().prefs.musicOn).toBe(false);
    expect(music().classList.contains('is-muted')).toBe(true);
  });

  test('un seul panneau à la fois : Personnes, puis Chat laissent le dernier seul', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(toggle());
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    await user.click(chatToggle());
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(chatPanel()).toBeTruthy();
  });
});

describe('le panneau Chat', () => {
  test('fermé au départ ; le bouton l\'ouvre et le ferme, et le dit (aria-expanded, aria-controls)', async () => {
    const user = userEvent.setup();
    renderShell();
    // Fermé, il n'est pas dans la page pour un lecteur d'écran ni pour le clavier.
    expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(chatToggle().getAttribute('aria-expanded')).toBe('false');
    expect(chatToggle().hasAttribute('aria-controls')).toBe(false);

    await user.click(chatToggle());
    expect(chatToggle().getAttribute('aria-expanded')).toBe('true');
    expect(chatToggle().getAttribute('aria-controls')).toBe(chatPanel().id);
    expect(chatPanel().id).not.toBe('');

    await user.click(chatToggle());
    expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
    expect(chatToggle().getAttribute('aria-expanded')).toBe('false');
    expect(chatToggle().hasAttribute('aria-controls')).toBe(false);
  });

  test('il s\'ouvre dans la couche par-dessus le jeu, à droite : le jeu ne bouge pas', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    const game = screen.getByTestId('jeu');
    await user.click(chatToggle());
    expect(container.querySelector('.office-ui .office-side')?.contains(chatPanel())).toBe(true);
    expect(screen.getByTestId('jeu')).toBe(game);
    await user.click(chatToggle());
    expect(screen.getByTestId('jeu')).toBe(game);
  });

  test('à l\'ouverture le focus passe au champ du message ; Échap ferme et rend le focus au bouton, à chaque fois', async () => {
    const user = userEvent.setup();
    renderShell();
    for (let times = 0; times < 2; times++) {
      await user.click(chatToggle());
      expect(document.activeElement).toBe(chatInput());
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
      expect(document.activeElement).toBe(chatToggle());
    }
  });

  test('le bouton Fermer du panneau le ferme aussi, focus rendu au bouton', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(chatToggle());
    await user.click(screen.getByRole('button', { name: fr.ui.close }));
    expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
    expect(document.activeElement).toBe(chatToggle());
  });

  test('au clavier : Entrée ouvre le panneau, le focus est dans le champ', async () => {
    const user = userEvent.setup();
    renderShell();
    chatToggle().focus();
    await user.keyboard('{Enter}');
    expect(chatPanel()).toBeTruthy();
    expect(document.activeElement).toBe(chatInput());
  });

  test('fermé, le panneau garde le brouillon et l\'onglet : on les retrouve à la réouverture', async () => {
    const user = userEvent.setup();
    const { client, refresh } = renderShell();
    await act(() => client.join(payload('r1')));
    refresh();
    await user.click(chatToggle());
    await user.click(screen.getByRole('tab', { name: fr.chat.tabs.nearby }));
    await user.type(chatInput(), 'Pas fini');
    await user.keyboard('{Escape}');
    await user.click(chatToggle());
    expect(screen.getByRole('tab', { name: fr.chat.tabs.nearby }).getAttribute('aria-selected')).toBe('true');
    expect(chatInput().value).toBe('Pas fini');
    expect(document.activeElement).toBe(chatInput());
  });

  test('il liste les messages, ceux de l\'historique et ceux qui arrivent, et envoie par la socket de la page', async () => {
    const user = userEvent.setup();
    const { socket } = renderShell();
    act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [player('bob', 'Bob')], mapKey: 'dev-office', chatHistory: [chatMessage('m1')], desks: [], closedDesks: [], deskBans: [] }));
    await user.click(chatToggle());
    expect(within(screen.getByRole('log')).getAllByRole('listitem')).toHaveLength(1);
    act(() => useOfficeStore.getState().addChatMessage(chatMessage('m2')));
    expect(within(screen.getByRole('log')).getAllByRole('listitem')).toHaveLength(2);

    await user.type(chatInput(), 'Salut{Enter}');
    expect(socket.sentOf('chat:send')).toEqual([{ channel: 'all', text: 'Salut' }]);
  });

  test('« À proximité » s\'ouvre avec la room du client média : en conversation seulement', async () => {
    const user = userEvent.setup();
    const { client, refresh } = renderShell();
    await user.click(chatToggle());
    const nearby = () => screen.getByRole('tab', { name: fr.chat.tabs.nearby }) as HTMLButtonElement;
    expect(nearby().disabled).toBe(true);
    await act(() => client.join(payload('r1')));
    refresh();
    expect(nearby().disabled).toBe(false);
    await act(() => client.leave());
    refresh();
    expect(nearby().disabled).toBe(true);
  });

  test('il est inactif tant que le serveur n\'a pas dit qui est là (avant l\'init)', () => {
    renderShell({ init: false });
    expect(chatToggle().disabled).toBe(true);
  });

  test('Personnes puis Chat laissent un seul panneau visible, et chaque bouton dit s\'il est ouvert', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(toggle());
    await user.click(chatToggle());
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(chatPanel()).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: fr.office.people.title })).toBeNull();
    expect(chatToggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    await user.click(toggle());
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(screen.getByRole('complementary', { name: fr.office.people.title })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(chatToggle().getAttribute('aria-expanded')).toBe('false');
  });

  test('quitter le Chat pour un autre panneau le garde monté, caché : on retrouve le brouillon en y revenant', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(chatToggle());
    await user.type(chatInput(), 'Pas fini');
    await user.click(toggle());
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(chatToggle());
    expect(chatInput().value).toBe('Pas fini');
  });

  test('la colonne de droite dit quel panneau est ouvert (data-panel)', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    const side = container.querySelector('.office-side')!;
    expect(side.hasAttribute('data-panel')).toBe(false);
    await user.click(chatToggle());
    expect(side.getAttribute('data-panel')).toBe('chat');
    await user.click(toggle());
    expect(side.getAttribute('data-panel')).toBe('people');
    await user.click(toggle());
    expect(side.hasAttribute('data-panel')).toBe(false);
  });

  test('l\'écran « Ouvert dans un autre onglet » rend le panneau inerte avec le reste', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await user.click(chatToggle());
    act(() => useOfficeStore.getState().setReplaced(true));
    expect(container.querySelector('.office-ui')?.contains(chatPanel())).toBe(true);
    expect(container.querySelector('.office-ui')?.hasAttribute('inert')).toBe(true);
  });

  describe('le badge de non-lus', () => {
    const badge = () => chatToggle().querySelector('.icon-badge');

    test('rien tant qu\'il n\'y a rien de nouveau ; l\'historique de l\'arrivée est lu', () => {
      renderShell({ init: false });
      act(() =>
        useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [], mapKey: 'dev-office', chatHistory: [chatMessage('m1'), chatMessage('m2')], desks: [], closedDesks: [], deskBans: [] }),
      );
      expect(badge()).toBeNull();
      expect(chatToggle().getAttribute('aria-label')).toBe('Chat');
    });

    test('sur le bouton fermé : le nombre de nouveaux messages « Tout le monde » des autres, et un nom accessible qui le dit', () => {
      renderShell();
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1')));
      expect(badge()?.textContent).toBe('1');
      expect(chatToggle().getAttribute('aria-label')).toBe('Chat, 1 nouveau message');
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m2')));
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m3')));
      expect(badge()?.textContent).toBe('3');
      expect(chatToggle().getAttribute('aria-label')).toBe('Chat, 3 nouveaux messages');
      // Le badge est décoratif : le nom accessible dit déjà le nombre.
      expect(badge()?.getAttribute('aria-hidden')).toBe('true');
      expect(screen.getByRole('button', { name: 'Chat, 3 nouveaux messages' })).toBeTruthy();
    });

    test('ni les siens, ni « À proximité » ne comptent', () => {
      renderShell();
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1', { userId: 'moi', name: 'Léa' })));
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('n1', { channel: 'nearby' })));
      expect(badge()).toBeNull();
    });

    test('au-delà de 99, « 99+ » (le nom accessible, lui, donne le nombre)', () => {
      renderShell();
      for (let i = 1; i <= 120; i++) act(() => useOfficeStore.getState().addChatMessage(chatMessage(`m${i}`)));
      expect(badge()?.textContent).toBe('99+');
      expect(chatToggle().getAttribute('aria-label')).toBe('Chat, 120 nouveaux messages');
    });

    test('l\'ouverture les lit : le badge disparaît, et ne revient pas pour ce qui arrive panneau ouvert, ni à la fermeture', async () => {
      const user = userEvent.setup();
      renderShell();
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1')));
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m2')));
      expect(badge()?.textContent).toBe('2');

      await user.click(chatToggle());
      expect(badge()).toBeNull();
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m3')));
      expect(badge()).toBeNull();
      await user.click(chatToggle());
      expect(badge()).toBeNull();

      // Fermé de nouveau : on compte ce qui est arrivé depuis.
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m4')));
      expect(badge()?.textContent).toBe('1');
    });

    test('pas de badge sur le bouton ouvert, même pour des messages que l\'onglet affiché ne montre pas (À proximité) ; à la fermeture ils comptent', async () => {
      const user = userEvent.setup();
      const { client, refresh } = renderShell();
      await act(() => client.join(payload('r1')));
      refresh();
      await user.click(chatToggle());
      await user.click(screen.getByRole('tab', { name: fr.chat.tabs.nearby }));
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1')));
      expect(badge()).toBeNull();
      await user.click(chatToggle());
      expect(badge()?.textContent).toBe('1');
    });

    test('le message « Tout le monde » lu en direct panneau ouvert est lu : il ne revient pas en badge', async () => {
      const user = userEvent.setup();
      renderShell();
      await user.click(chatToggle());
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1')));
      await user.click(chatToggle());
      expect(badge()).toBeNull();
    });
  });
});

describe('le panneau Admin', () => {
  // Léa (le compte connecté, 'moi') est admin ; Bob est un membre.
  const adminLists = {
    'GET /api/admin/members': () =>
      json(200, [
        { id: 'moi', name: 'Léa', email: 'lea@x.fr', role: 'admin' },
        { id: 'bob', name: 'Bob', email: 'bob@x.fr', role: 'member' },
      ]),
    'GET /api/admin/invitations': () => json(200, []),
  };
  // Admin est une ligne du menu « Plus », pour un admin seulement.
  const adminEntry = () => screen.getByRole('menuitem', { name: fr.admin.toggle }) as HTMLButtonElement;
  const openAdmin = (user: User) => chooseInMoreMenu(user, fr.admin.toggle);
  const adminPanel = () => screen.getByRole('complementary', { name: fr.admin.title });
  const adminCalls = (api: ReturnType<typeof fakeApi>) => api.mock.calls.filter(([url]) => String(url).startsWith('/api/admin'));

  test('un membre n\'a pas de ligne Admin : ni panneau, ni requête à /api/admin, même Personnes ouvert', async () => {
    const user = userEvent.setup();
    const api = fakeApi({ 'GET /api/members': () => json(200, []) });
    renderShell({ role: 'member' });
    await user.click(toggle());
    await user.click(moreButton());
    expect(screen.queryByRole('menuitem', { name: fr.admin.toggle })).toBeNull();
    expect(screen.queryByRole('complementary', { name: fr.admin.title })).toBeNull();
    expect(adminCalls(api)).toEqual([]);
  });

  test('un admin a Admin dans le menu « Plus », après Décorer et avant le zoom', async () => {
    const user = userEvent.setup();
    renderShell({ role: 'admin' });
    await user.click(moreButton());
    const names = screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label') ?? item.textContent);
    expect(names).toEqual([fr.decor.toggle, fr.admin.toggle, fr.zoom.reset]);
  });

  test('fermé au départ, sans rien demander au serveur ; la ligne l\'ouvre (le panneau a son id), Fermer le ferme', async () => {
    const user = userEvent.setup();
    const api = fakeApi(adminLists);
    renderShell({ role: 'admin' });
    expect(screen.queryByRole('complementary', { name: fr.admin.title })).toBeNull();
    expect(adminCalls(api)).toEqual([]);

    await openAdmin(user);
    expect(adminPanel().id).not.toBe('');
    expect(await screen.findByRole('region', { name: 'Membres (2)' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: fr.admin.close }));
    expect(screen.queryByRole('complementary', { name: fr.admin.title })).toBeNull();
  });

  test('à l\'ouverture le focus passe au panneau (son titre) ; Échap le ferme et rend le focus au bouton « Plus », à chaque fois', async () => {
    const user = userEvent.setup();
    fakeApi(adminLists);
    renderShell({ role: 'admin' });
    for (let times = 0; times < 2; times++) {
      await openAdmin(user);
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: fr.admin.title }));
      await screen.findByRole('region', { name: 'Membres (2)' });
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('complementary', { name: fr.admin.title })).toBeNull();
      expect(document.activeElement).toBe(moreButton());
    }
  });

  test('le bouton Fermer du panneau le ferme aussi, focus rendu au bouton « Plus »', async () => {
    const user = userEvent.setup();
    fakeApi(adminLists);
    renderShell({ role: 'admin' });
    await openAdmin(user);
    await user.click(screen.getByRole('button', { name: fr.admin.close }));
    expect(screen.queryByRole('complementary', { name: fr.admin.title })).toBeNull();
    expect(document.activeElement).toBe(moreButton());
  });

  test('au clavier : Entrée ouvre le menu, le focus va à la première ligne qu\'on peut choisir (Admin : Décorer attend un bureau), Entrée ouvre le panneau, et Tab y entre', async () => {
    const user = userEvent.setup();
    fakeApi(adminLists);
    renderShell({ role: 'admin' });
    moreButton().focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(adminEntry());
    await user.keyboard('{Enter}');
    expect(adminPanel()).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.admin.close }));
  });

  test('il s\'ouvre dans la couche par-dessus le jeu, à droite, et prend la place d\'un autre panneau', async () => {
    const user = userEvent.setup();
    fakeApi({ ...adminLists, 'GET /api/members': () => json(200, []) });
    const { container } = renderShell({ role: 'admin' });
    const game = screen.getByTestId('jeu');
    await user.click(chatToggle());
    await openAdmin(user);
    const side = container.querySelector('.office-ui .office-side')!;
    expect(side.contains(adminPanel())).toBe(true);
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
    await user.click(toggle());
    expect(screen.queryByRole('complementary', { name: fr.admin.title })).toBeNull();
    expect(screen.getByTestId('jeu')).toBe(game);
  });

  test('le panneau reconnaît le compte connecté : sa ligne est « (toi) » et n\'a pas de bouton Retirer, celle de Bob oui', async () => {
    const user = userEvent.setup();
    fakeApi(adminLists);
    renderShell({ role: 'admin' });
    await openAdmin(user);
    const members = await screen.findByRole('region', { name: 'Membres (2)' });
    const lea = within(members).getByText('Léa').closest('li')!;
    expect(lea.textContent).toContain(fr.admin.you);
    expect(within(lea).queryByRole('button')).toBeNull();
    expect(within(members).getByRole('button', { name: 'Retirer Bob' })).toBeTruthy();
  });

  // Le mode d'envoi du serveur (GET /api/config) décide si les membres ont « Lien de mot de passe » : OfficeShell le lit à l'ouverture
  // du panneau, jamais avant, et jamais pour un membre.
  describe('sans e-mail (GET /api/config)', () => {
    const configCalls = (api: ReturnType<typeof fakeApi>) => api.mock.calls.filter(([url]) => String(url) === '/api/config');
    const passwordLink = (name: string) => screen.queryByRole('button', { name: t(fr.admin.members.passwordLinkLabel, { name }) });

    test('MAILER=none : la configuration est lue à l\'ouverture du panneau, et Bob a « Lien de mot de passe » (Léa, qui est connectée, non)', async () => {
      const user = userEvent.setup();
      const api = fakeApi({ ...adminLists, 'GET /api/config': () => json(200, { mail: 'none' }) });
      renderShell({ role: 'admin' });
      expect(configCalls(api)).toHaveLength(0);   // panneau fermé : rien n'est demandé

      await openAdmin(user);
      const members = await screen.findByRole('region', { name: 'Membres (2)' });
      expect(await within(members).findByRole('button', { name: t(fr.admin.members.passwordLinkLabel, { name: 'Bob' }) })).toBeTruthy();
      expect(passwordLink('Léa')).toBeNull();
      expect(configCalls(api)).toHaveLength(1);

      // Fermé puis rouvert : la configuration est connue, elle n'est pas relue, et les boutons sont là tout de suite.
      await user.click(screen.getByRole('button', { name: fr.admin.close }));
      await openAdmin(user);
      expect(await screen.findByRole('button', { name: t(fr.admin.members.passwordLinkLabel, { name: 'Bob' }) })).toBeTruthy();
      expect(configCalls(api)).toHaveLength(1);
    });

    test.each([
      ['MAILER=resend', () => json(200, { mail: 'resend' })],
      ['MAILER=memory', () => json(200, { mail: 'memory' })],
      ['la configuration ne se lit pas (500)', () => json(500, { error: 'internal' })],
      ['le serveur ne répond pas', () => {
        throw new TypeError('Failed to fetch');
      }],
    ])('%s : pas de « Lien de mot de passe », et rien ne s\'affiche en erreur', async (_name, config) => {
      const user = userEvent.setup();
      const api = fakeApi({ ...adminLists, 'GET /api/config': config });
      renderShell({ role: 'admin' });
      await openAdmin(user);
      const members = await screen.findByRole('region', { name: 'Membres (2)' });
      await waitFor(() => expect(configCalls(api)).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(passwordLink('Bob')).toBeNull();
      expect(within(members).getByRole('button', { name: 'Retirer Bob' })).toBeTruthy();
      expect(within(adminPanel()).queryByRole('alert')).toBeNull();
    });

    test('un membre ne lit pas la configuration : pas de panneau', async () => {
      const api = fakeApi({ 'GET /api/members': () => json(200, []), 'GET /api/config': () => json(200, { mail: 'none' }) });
      renderShell({ role: 'member' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(configCalls(api)).toHaveLength(0);
    });
  });

  test('il n\'attend pas l\'init (il ne parle qu\'à l\'API, et ne lit du bureau que qui est là) : la ligne est active avant elle', async () => {
    renderShell({ role: 'admin', init: false });
    await userEvent.click(moreButton());
    expect(adminEntry().disabled).toBe(false);
  });

  test('l\'écran « Ouvert dans un autre onglet » rend le panneau inerte avec le reste', async () => {
    const user = userEvent.setup();
    fakeApi(adminLists);
    const { container } = renderShell({ role: 'admin' });
    await openAdmin(user);
    act(() => useOfficeStore.getState().setReplaced(true));
    expect(container.querySelector('.office-ui')?.contains(adminPanel())).toBe(true);
    expect(container.querySelector('.office-ui')?.hasAttribute('inert')).toBe(true);
  });
});

describe('les états d\'activité', () => {
  const focus = { id: 's1', label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false };
  const lunch = { id: 's2', label: 'À table', color: '#f59e0b', allowEntry: true, hear: false, heard: true };
  const micButton = () => within(bar()).getByRole('button', { name: fr.media.controls.mic }) as HTMLButtonElement;
  test('à l\'arrivée (connexion prête), ses états sont lus au serveur et rangés au magasin ; ils sont dans le menu « Moi », sous « Mode »', async () => {
    const user = userEvent.setup();
    vi.mocked(activityApi.listActivityStates).mockResolvedValueOnce([focus, lunch]);
    renderShell();
    await waitFor(() => expect(useOfficeStore.getState().myStates).toEqual([focus, lunch]));
    await user.click(meChip());
    expect(screen.getByRole('menuitemradio', { name: 'En focus' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: fr.modes.create })).toBeTruthy();
  });

  test('« Nouveau mode » ouvre l\'éditeur dans le menu même, sans panneau à droite ; Échap revient à la liste', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(meChip());
    await user.click(screen.getByRole('menuitem', { name: fr.modes.create }));
    expect(screen.getByRole('dialog', { name: fr.modes.titleCreate })).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('menu', { name: fr.me.menu })).toBeTruthy();
  });

  test('lecture impossible : le menu n\'a que les statuts ordinaires, sans erreur', async () => {
    vi.mocked(activityApi.listActivityStates).mockRejectedValueOnce(new Error('réseau'));
    renderShell();
    await Promise.resolve();
    expect(useOfficeStore.getState().myStates).toEqual([]);
  });

  test('un état où l\'on n\'est pas entendu coupe le micro et le bouton est inactif, avec la raison ; à la fin de l\'état, il se rallume à la main', async () => {
    const user = userEvent.setup();
    const { client, refresh } = renderShell();
    await act(() => client.setMic(true));
    refresh();
    expect(micButton().disabled).toBe(false);
    expect(client.getSnapshot().local.mic).toBe(true);

    act(() => useOfficeStore.getState().setActivity('moi', focus));
    refresh();
    await act(() => client.idle());
    refresh();
    expect(client.getSnapshot().local.mic).toBe(false);
    expect(micButton().disabled).toBe(true);
    expect(screen.getByRole('button', { name: fr.media.controls.mic, description: t(fr.states.micCut, { label: 'En focus' }) })).toBe(micButton());

    act(() => useOfficeStore.getState().setActivity('moi', null));
    refresh();
    expect(micButton().disabled).toBe(false);
    expect(client.getSnapshot().local.mic).toBe(false);   // pas rallumé tout seul
    await user.click(micButton());
    expect(client.getSnapshot().local.mic).toBe(true);
  });

  test('un état où l\'on est entendu ne touche pas au micro', async () => {
    const { client, refresh } = renderShell();
    await act(() => client.setMic(true));
    act(() => useOfficeStore.getState().setActivity('moi', lunch));
    refresh();
    expect(client.getSnapshot().local.mic).toBe(true);
    expect(micButton().disabled).toBe(false);
  });

  test('le panneau Personnes : le nom et la couleur de l\'état d\'activité de chacun, sous son nom (sa pastille garde son statut)', async () => {
    const user = userEvent.setup();
    renderShell();
    act(() => useOfficeStore.getState().setActivity('bob', focus));
    await user.click(toggle());
    await user.click(screen.getByRole('tab', { name: /^Tout le bureau/ }));
    const bob = document.querySelector('[data-user="bob"]') as HTMLElement;
    // Le mode n'a pas d'icône : le point de sa couleur (celle que le serveur a validée) devant son nom.
    const dot = bob.querySelector('.person-sub [data-activity="s1"]') as HTMLElement;
    expect(dot.style.backgroundColor).toMatch(/^(#6d28d9|rgb\(109, 40, 217\))$/i);
    expect(bob.querySelector('.person-sub')?.textContent).toBe('En focus');
    // La pastille du portrait dit toujours le statut.
    expect(bob.querySelector('.portrait-dot')?.getAttribute('data-status')).toBe('available');
  });
});

describe('ouvert dans un autre onglet', () => {
  test('l\'écran couvre le bureau, dont la couche est inerte ; « Utiliser ici » relance la connexion', async () => {
    const onUseHere = vi.fn();
    const { container } = renderShell({ onUseHere });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.office-ui')?.hasAttribute('inert')).toBe(false);

    act(() => useOfficeStore.getState().setReplaced(true));
    expect(screen.getByRole('dialog', { name: fr.office.replaced })).toBeTruthy();
    expect(container.querySelector('.office-ui')?.hasAttribute('inert')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: fr.office.useHere }));
    expect(onUseHere).toHaveBeenCalledTimes(1);
  });

  test('l\'écran disparaît quand le serveur répond (l\'init rend la main)', () => {
    const { container } = renderShell();
    act(() => useOfficeStore.getState().setReplaced(true));
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.office-ui')?.hasAttribute('inert')).toBe(false);
  });

  test('le jeu reste monté dessous : même élément', () => {
    renderShell();
    const game = screen.getByTestId('jeu');
    act(() => useOfficeStore.getState().setReplaced(true));
    expect(screen.getByTestId('jeu')).toBe(game);
  });
});
