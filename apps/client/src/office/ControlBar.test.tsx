import type { DeskInfo, MediaJoinPayload, PublicPlayer } from '@bureau/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAudioStore } from '../audio/audio-store';
import { DEFAULT_AUDIO_PREFS } from '../audio/prefs';
import { fr, t } from '../i18n/fr';
import { FakeMediaClient } from '../media/fake-media-client';
import type { MediaPrefs } from '../media/media-client';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { ControlBar } from './ControlBar';
import type { PanelControls } from './panels';

const payload = (room: string): MediaJoinPayload => ({ url: 'wss://livekit.test', room, token: `jeton-${room}` });

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

const clients: FakeMediaClient[] = [];

beforeEach(() => {
  useOfficeStore.getState().reset();
  act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.leave();
});

// Les panneaux de la coque, pour la barre : rien d'ouvert, le serveur a parlé, et ce que la barre en demande est retenu.
function fakePanels(over: Partial<PanelControls> = {}): PanelControls {
  return { open: null, toggle: vi.fn(), show: vi.fn(), idOf: (id) => `panneau-${id}`, ready: true, unread: 0, admin: false, sim: false, ...over };
}

interface Options {
  prefs?: MediaPrefs;
  panels?: PanelControls;
  onSignOut?: () => void;
  signingOut?: boolean;
  micCutBy?: string | null;
}

// La barre, avec l'état du faux client à jour à chaque changement (comme useMedia dans la page).
function renderBar({ prefs = { mic: true, cam: true }, panels = fakePanels(), onSignOut = () => {}, signingOut = false, micCutBy = null }: Options = {}) {
  const client = new FakeMediaClient(prefs);
  clients.push(client);
  const socket = new FakeSocket();
  socket.serverAccepts();
  function LiveBar({ currentPanels }: { currentPanels: PanelControls }) {
    const snapshot = useSyncExternalStore(
      (notify) => client.subscribe(() => notify()),
      () => client.getSnapshot(),
    );
    return (
      <ControlBar name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} client={client} snapshot={snapshot} panels={currentPanels} micCutBy={micCutBy} onSignOut={onSignOut} signingOut={signingOut} />
    );
  }
  const view = render(<LiveBar currentPanels={panels} />);
  const rerender = (next: Partial<PanelControls>) => view.rerender(<LiveBar currentPanels={{ ...panels, ...next }} />);
  return { client, socket, view, panels, rerender };
}

const bar = () => screen.getByRole('group', { name: fr.office.barLabel });
const button = (name: string) => within(bar()).getByRole('button', { name }) as HTMLButtonElement;

test('ControlBar : les boutons appellent setMic, setCam et setScreenShare', async () => {
  const user = userEvent.setup();
  const { client } = renderBar({ prefs: { mic: true, cam: true } });
  await act(() => client.join(payload('r1')));
  const setMic = vi.spyOn(client, 'setMic');
  const setCam = vi.spyOn(client, 'setCam');
  const setScreenShare = vi.spyOn(client, 'setScreenShare');

  await user.click(button(fr.media.controls.mic));
  expect(setMic).toHaveBeenLastCalledWith(false);
  await user.click(button(fr.media.controls.mic));
  expect(setMic).toHaveBeenLastCalledWith(true);

  await user.click(button(fr.media.controls.cam));
  expect(setCam).toHaveBeenLastCalledWith(false);

  await user.click(button(fr.media.controls.screen));
  expect(setScreenShare).toHaveBeenLastCalledWith(true);
  await act(() => client.idle());
  await user.click(button(fr.media.controls.screen));
  expect(setScreenShare).toHaveBeenLastCalledWith(false);

  expect(setMic).toHaveBeenCalledTimes(2);
  expect(setCam).toHaveBeenCalledTimes(1);
  expect(setScreenShare).toHaveBeenCalledTimes(2);
});

describe('micro, caméra et partage d\'écran', () => {
  test('des boutons bascule : enfoncés quand c\'est allumé, rouges quand c\'est coupé, et ils suivent l\'état du client', async () => {
    const user = userEvent.setup();
    const { client } = renderBar({ prefs: { mic: true, cam: false } });
    expect(button(fr.media.controls.mic).getAttribute('aria-pressed')).toBe('true');
    expect(button(fr.media.controls.cam).getAttribute('aria-pressed')).toBe('false');
    expect(button(fr.media.controls.mic).classList.contains('is-danger')).toBe(false);
    expect(button(fr.media.controls.cam).classList.contains('is-danger')).toBe(true);

    await user.click(button(fr.media.controls.mic));
    expect(button(fr.media.controls.mic).getAttribute('aria-pressed')).toBe('false');
    expect(button(fr.media.controls.mic).classList.contains('is-danger')).toBe(true);
    // Le client, pas la barre, décide : une caméra refusée dans la room repasse à « coupée ».
    client.denyDevices('cam');
    await act(() => client.join(payload('r1')));
    await user.click(button(fr.media.controls.cam));
    await act(() => client.idle());
    expect(button(fr.media.controls.cam).getAttribute('aria-pressed')).toBe('false');
  });

  test('hors conversation, micro et caméra se règlent quand même (pour la suivante) ; le partage d\'écran attend une conversation, et le dit', async () => {
    const user = userEvent.setup();
    const { client } = renderBar({ prefs: { mic: true, cam: true } });
    const share = button(fr.media.controls.screen);
    expect(share.disabled).toBe(true);
    expect(screen.getByRole('button', { name: fr.media.controls.screen, description: fr.media.controls.screenUnavailable })).toBe(share);
    await user.click(button(fr.media.controls.mic));
    expect(client.getSnapshot().local.mic).toBe(false);
    // Rien n'est demandé aux périphériques hors room.
    expect(client.deviceLog).toEqual([]);

    // Pendant la connexion non plus : il n'y a pas encore de room où partager.
    const release = client.holdConnections();
    act(() => void client.join(payload('r1')));
    expect(button(fr.media.controls.screen).disabled).toBe(true);
    release();
    await act(() => client.idle());
    expect(button(fr.media.controls.screen).disabled).toBe(false);
    expect(button(fr.media.controls.screen).hasAttribute('aria-describedby')).toBe(false);
  });

  test('le partage d\'écran commence dans le clic même (le navigateur n\'ouvre le choix de l\'écran que pendant un geste)', async () => {
    const { client } = renderBar();
    await act(() => client.join(payload('r1')));
    const before = client.deviceLog.length;
    fireEvent.click(button(fr.media.controls.screen));
    // Pas d'attente : la demande est déjà partie, pendant le clic.
    expect(client.deviceLog.slice(before)).toEqual(['screen:on']);
    await act(() => client.idle());
    expect(button(fr.media.controls.screen).getAttribute('aria-pressed')).toBe('true');
    expect(button(fr.media.controls.screen).classList.contains('is-accent')).toBe(true);
    expect(screen.getByRole('button', { name: fr.media.controls.screen, description: fr.media.controls.screenStopHint })).toBeTruthy();
  });

  test('le partage arrêté par le navigateur : le bouton se relève', async () => {
    const user = userEvent.setup();
    const { client } = renderBar();
    await act(() => client.join(payload('r1')));
    await user.click(button(fr.media.controls.screen));
    await act(() => client.idle());
    act(() => client.endScreenShare());
    expect(button(fr.media.controls.screen).getAttribute('aria-pressed')).toBe('false');
  });

  test('un état d\'activité où l\'on n\'est pas entendu : le micro est inactif, et dit pourquoi', () => {
    renderBar({ micCutBy: 'En focus' });
    expect(button(fr.media.controls.mic).disabled).toBe(true);
    expect(screen.getByRole('button', { name: fr.media.controls.mic, description: t(fr.states.micCut, { label: 'En focus' }) })).toBeTruthy();
  });
});

describe('la musique et le bureau', () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, status: 'running', playing: null, place: 'lobby' });
  });

  const music = () => button(fr.sound.toggle);

  test('le dock du milieu : micro, caméra, partage, puis la musique ; le bouton du bureau n\'y est que si l\'on a un bureau', () => {
    renderBar();
    const dock = () => within(bar()).getByRole('group', { name: fr.media.controls.label });
    const names = () => within(dock()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names()).toEqual(['Micro', 'Caméra', 'Partager l\'écran', 'Musique et ambiances']);
    act(() => useOfficeStore.getState().setDesk({ key: 'A1', ownerId: 'moi', ownerName: 'Léa', name: null, locked: false, closedByState: false, floor: '', wall: '', items: [] } as DeskInfo));
    expect(names()).toEqual(['Micro', 'Caméra', 'Partager l\'écran', 'Musique et ambiances', 'Aller à mon bureau']);
  });

  test('« Musique et ambiances » ouvre le juke-box au-dessus du bouton, et le ferme ; le bouton est enfoncé tant qu\'il est ouvert', async () => {
    const user = userEvent.setup();
    renderBar();
    expect(music().getAttribute('aria-pressed')).toBe('false');
    expect(music().getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(music());
    const jukebox = screen.getByRole('dialog', { name: fr.sound.toggle });
    expect(music().getAttribute('aria-pressed')).toBe('true');
    expect(music().getAttribute('aria-controls')).toBe(jukebox.id);
    await user.click(music());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(music().getAttribute('aria-pressed')).toBe('false');
  });

  test('Échap ferme le juke-box et rend le focus au bouton ; un clic ailleurs le ferme aussi', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(music());
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(music());
    await user.click(music());
    await user.click(button(fr.me.chip));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('musique coupée : le bouton est en retrait (is-muted) et sa note barrée ; elle revient avec le réglage', () => {
    renderBar();
    expect(music().classList.contains('is-muted')).toBe(false);
    expect(music().querySelector('.icon-struck')).toBeNull();
    act(() => useAudioStore.getState().setPrefs({ musicOn: false }));
    expect(music().classList.contains('is-muted')).toBe(true);
    expect(music().querySelector('.icon-struck')).not.toBeNull();
    act(() => useAudioStore.getState().setPrefs({ musicOn: true }));
    expect(music().classList.contains('is-muted')).toBe(false);
  });

  test('chaque ouverture et fermeture du juke-box a le bruit d\'un panneau (et non d\'un interrupteur)', async () => {
    renderBar();
    expect(music().getAttribute('data-sfx')).toBe('panel-open');
    await userEvent.click(music());
    expect(music().getAttribute('data-sfx')).toBe('panel-close');
  });
});

describe('la barre', () => {
  test('dans l\'ordre : la puce « Moi », micro, caméra, partage d\'écran, musique, le zoom, puis Chat, Personnes et Plus ; le nom est dans la puce ; pas de réactions', () => {
    renderBar();
    const names = within(bar()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Mon profil', 'Micro', 'Caméra', 'Partager l\'écran', 'Musique et ambiances', 'Zoom arrière', 'Rétablir le zoom (100 %)', 'Zoom avant', 'Chat', 'Personnes', 'Plus']);
    expect(within(button(fr.me.chip)).getByText('Léa').getAttribute('title')).toBe('Léa');
  });

  test('chaque dock est un groupe : le micro, la caméra, la musique, le zoom', () => {
    renderBar();
    expect(within(bar()).getByRole('group', { name: fr.media.controls.label })).toBeTruthy();
    expect(within(bar()).getByRole('group', { name: fr.zoom.group })).toBeTruthy();
  });

  test('un panneau : son bouton dit s\'il est ouvert (aria-expanded, aria-controls) et le bascule, en disant quel bouton l\'a ouvert', async () => {
    const user = userEvent.setup();
    const { panels, rerender } = renderBar();
    const people = button('Personnes');
    expect(people.getAttribute('aria-expanded')).toBe('false');
    expect(people.hasAttribute('aria-controls')).toBe(false);
    await user.click(people);
    expect(panels.toggle).toHaveBeenCalledExactlyOnceWith('people', people);

    rerender({ open: 'people' });
    expect(button('Personnes').getAttribute('aria-expanded')).toBe('true');
    expect(button('Personnes').getAttribute('aria-controls')).toBe('panneau-people');
    // Un seul panneau est ouvert : le bouton du chat reste fermé.
    expect(button('Chat').getAttribute('aria-expanded')).toBe('false');
  });

  test('Chat et Personnes attendent que le serveur ait dit qui est là', () => {
    renderBar({ panels: fakePanels({ ready: false }) });
    expect(button('Chat').disabled).toBe(true);
    expect(button('Personnes').disabled).toBe(true);
    // Le menu « Plus » et le zoom n'attendent rien.
    expect(button('Plus').disabled).toBe(false);
    expect(button(fr.zoom.in).disabled).toBe(false);
  });

  test('Personnes montre le compte de ceux qui sont en ligne, soi compris', () => {
    renderBar();
    expect(button('Personnes').querySelector('.icon-count')?.textContent).toBe('1');
    act(() => useOfficeStore.getState().upsertPlayer(player('bob', 'Bob')));
    expect(button('Personnes').querySelector('.icon-count')?.textContent).toBe('2');
    // Le nom du bouton ne change pas : le compte est un repère visuel.
    expect(screen.getByRole('button', { name: 'Personnes' })).toBeTruthy();
  });

  describe('la pastille du chat', () => {
    test('le nombre de messages non lus est affiché, le nom accessible le dit, et rien sans compteur', () => {
      const { rerender } = renderBar({ panels: fakePanels({ unread: 3 }) });
      const chat = () => button('Chat, 3 nouveaux messages');
      expect(chat().querySelector('.icon-badge')?.textContent).toBe('3');
      expect(chat().querySelector('.icon-badge')?.getAttribute('aria-hidden')).toBe('true');
      expect(chat().getAttribute('data-tip')).toBe('Chat, 3 nouveaux messages');

      rerender({ unread: 1 });
      expect(button('Chat, 1 nouveau message').querySelector('.icon-badge')?.textContent).toBe('1');
      rerender({ unread: 250 });
      expect(button('Chat, 250 nouveaux messages').querySelector('.icon-badge')?.textContent).toBe('99+');
      rerender({ unread: 0 });
      expect(button('Chat').querySelector('.icon-badge')).toBeNull();
      expect(button('Chat').getAttribute('aria-label')).toBe('Chat');
    });

    test('ouvert, le chat n\'a rien de non lu à signaler', () => {
      renderBar({ panels: fakePanels({ unread: 3, open: 'chat' }) });
      expect(button('Chat').querySelector('.icon-badge')).toBeNull();
    });
  });

  // Le menu « Moi » est testé en détail dans MeMenu.test.tsx : ici, qu'il est bien dans la barre, avec ses lignes, et que « Plus » ne les a plus.
  test('Se déconnecter est dans le menu de la puce « Moi » : il appelle onSignOut ; pendant la déconnexion, « Déconnexion… », inactif', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    const { view } = renderBar({ onSignOut });
    await user.click(button(fr.me.chip));
    await user.click(screen.getByRole('menuitem', { name: fr.office.signOut }));
    expect(onSignOut).toHaveBeenCalledOnce();
    view.unmount();
    renderBar({ signingOut: true });
    await user.click(button(fr.me.chip));
    expect((screen.getByRole('menuitem', { name: fr.office.signingOut }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('la puce « Moi » ouvre l\'apparence, depuis son bouton ; le menu « Plus » ne l\'a pas', async () => {
    const user = userEvent.setup();
    const { panels } = renderBar();
    await user.click(button(fr.me.chip));
    await user.click(screen.getByRole('menuitem', { name: fr.character.toggle }));
    expect(panels.show).toHaveBeenLastCalledWith('character', button(fr.me.chip));
    await user.click(button('Plus'));
    const more = screen.getAllByRole('menuitem').map((line) => line.getAttribute('aria-label') ?? line.textContent);
    expect(more).toEqual([fr.decor.toggle, fr.zoom.reset]);
  });

  test('le menu « Moi » est dans la barre, et parle à la socket de la page : un statut, puis un mode', async () => {
    const user = userEvent.setup();
    const { socket } = renderBar();
    act(() => useOfficeStore.getState().setMyStates([{ id: 's1', label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false }]));
    await user.click(button(fr.me.chip));
    await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
    await user.click(button(fr.me.chip));
    await user.click(screen.getByRole('menuitemradio', { name: 'En focus' }));
    expect(socket.sent).toEqual([
      ['status:set', 'dnd'],
      ['state:set', 's1'],
    ]);
  });
});
