import type { MediaJoinPayload, PublicPlayer } from '@bureau/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { FakeMediaClient } from '../media/fake-media-client';
import type { MediaPrefs } from '../media/media-client';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { ControlBar, type PanelToggle } from './ControlBar';

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
  act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [], mapKey: 'dev-office', chatHistory: [] }));
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.leave();
});

interface Options {
  prefs?: MediaPrefs;
  panels?: PanelToggle[];
  onSignOut?: () => void;
  signingOut?: boolean;
}

// La barre, avec l'état du faux client à jour à chaque changement (comme useMedia dans la page).
function renderBar({ prefs = { mic: true, cam: true }, panels = [], onSignOut = () => {}, signingOut = false }: Options = {}) {
  const client = new FakeMediaClient(prefs);
  clients.push(client);
  const socket = new FakeSocket();
  socket.serverAccepts();
  function LiveBar() {
    const snapshot = useSyncExternalStore(
      (notify) => client.subscribe(() => notify()),
      () => client.getSnapshot(),
    );
    return (
      <ControlBar name="Léa" socket={socket.asSocket()} client={client} snapshot={snapshot} panels={panels} onSignOut={onSignOut} signingOut={signingOut} />
    );
  }
  const view = render(<LiveBar />);
  return { client, socket, view };
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
  test('des boutons bascule : enfoncés quand c\'est allumé, et ils suivent l\'état du client', async () => {
    const user = userEvent.setup();
    const { client } = renderBar({ prefs: { mic: true, cam: false } });
    expect(button(fr.media.controls.mic).getAttribute('aria-pressed')).toBe('true');
    expect(button(fr.media.controls.cam).getAttribute('aria-pressed')).toBe('false');
    expect(button(fr.media.controls.mic).getAttribute('title')).toBe(fr.media.controls.micOnHint);
    expect(button(fr.media.controls.cam).getAttribute('title')).toBe(fr.media.controls.camOffHint);

    await user.click(button(fr.media.controls.mic));
    expect(button(fr.media.controls.mic).getAttribute('aria-pressed')).toBe('false');
    expect(button(fr.media.controls.mic).getAttribute('title')).toBe(fr.media.controls.micOffHint);
    // Le client, pas la barre, décide : une caméra refusée dans la room repasse à « coupée ».
    client.denyDevices('cam');
    await act(() => client.join(payload('r1')));
    await user.click(button(fr.media.controls.cam));
    await act(() => client.idle());
    expect(button(fr.media.controls.cam).getAttribute('aria-pressed')).toBe('false');
  });

  test('hors conversation, micro et caméra se règlent quand même (pour la suivante) ; le partage d\'écran attend une conversation', async () => {
    const user = userEvent.setup();
    const { client } = renderBar({ prefs: { mic: true, cam: true } });
    const share = button(fr.media.controls.screen);
    expect(share.disabled).toBe(true);
    expect(share.getAttribute('title')).toBe(fr.media.controls.screenUnavailable);
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
    expect(button(fr.media.controls.screen).getAttribute('title')).toBe(fr.media.controls.screenHint);
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
    expect(button(fr.media.controls.screen).getAttribute('title')).toBe(fr.media.controls.screenStopHint);
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
});

describe('la barre', () => {
  test('dans l\'ordre : le nom, le statut, micro, caméra, partage d\'écran, les panneaux, puis Se déconnecter', () => {
    const panels: PanelToggle[] = [
      { label: 'Chat', open: false, onToggle: () => {} },
      { label: fr.office.people.toggle, open: false, onToggle: () => {} },
      { label: 'Admin', open: false, onToggle: () => {} },
    ];
    renderBar({ panels });
    const names = within(bar()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Statut : Disponible', 'Micro', 'Caméra', 'Partager l\'écran', 'Chat', 'Personnes', 'Admin', 'Se déconnecter']);
    expect(within(bar()).getByText('Léa').getAttribute('title')).toBe('Léa');
  });

  test('un panneau : son bouton dit s\'il est ouvert (aria-expanded, aria-controls) et le bascule', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { view, client } = renderBar({ panels: [{ label: 'Personnes', open: false, panelId: 'panneau', onToggle }] });
    const toggle = button('Personnes');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();

    view.rerender(
      <ControlBar
        name="Léa"
        socket={null}
        client={client}
        snapshot={client.getSnapshot()}
        panels={[{ label: 'Personnes', open: true, panelId: 'panneau', onToggle }]}
        onSignOut={() => {}}
        signingOut={false}
      />,
    );
    expect(button('Personnes').getAttribute('aria-expanded')).toBe('true');
    expect(button('Personnes').getAttribute('aria-controls')).toBe('panneau');
  });

  test('un panneau inactif : son bouton aussi', () => {
    renderBar({ panels: [{ label: 'Personnes', open: false, disabled: true, onToggle: () => {} }] });
    expect(button('Personnes').disabled).toBe(true);
  });

  test('Se déconnecter appelle onSignOut ; pendant la déconnexion, « Déconnexion… », inactif', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    const { view } = renderBar({ onSignOut });
    await user.click(button(fr.office.signOut));
    expect(onSignOut).toHaveBeenCalledOnce();
    view.unmount();
    renderBar({ signingOut: true });
    expect(button(fr.office.signingOut).disabled).toBe(true);
  });

  test('le menu des statuts est dans la barre, et parle à la socket de la page', async () => {
    const user = userEvent.setup();
    const { socket } = renderBar();
    await user.click(button('Statut : Disponible'));
    await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
    expect(socket.sentOf('status:set')).toEqual(['dnd']);
  });
});
