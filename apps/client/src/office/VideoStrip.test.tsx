import type { MediaJoinPayload } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mediaDebug } from '../game/debug';
import { fr, t } from '../i18n/fr';
import { FakeMediaClient } from '../media/fake-media-client';
import type { MediaPrefs } from '../media/media-client';
import { VideoStrip } from './VideoStrip';

const payload = (room: string): MediaJoinPayload => ({ url: 'wss://livekit.test', room, token: `jeton-${room}` });

const clients: FakeMediaClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.leave();
  mediaDebug.tiles = 0;
});

// Les vignettes, avec l'état du faux client à jour à chaque changement (comme useMedia dans la page).
function LiveStrip({ client, onReconnect }: { client: FakeMediaClient; onReconnect?: () => void }) {
  const snapshot = useSyncExternalStore(
    (notify) => client.subscribe(() => notify()),
    () => client.getSnapshot(),
  );
  return <VideoStrip snapshot={snapshot} client={client} onReconnect={onReconnect} />;
}

// Le faux client, dans la room r1 (moi, avec micro et caméra), et ses vignettes.
async function inRoom(prefs: MediaPrefs = { mic: true, cam: true }, onReconnect?: () => void) {
  const client = new FakeMediaClient(prefs, { id: 'moi', name: 'Léa' });
  clients.push(client);
  const view = render(<LiveStrip client={client} onReconnect={onReconnect} />);
  await act(() => client.join(payload('r1')));
  return { client, view };
}

const tiles = () => within(screen.getByRole('list', { name: fr.media.tiles.label })).getAllByRole('listitem');
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// La vignette dont le nom commence ainsi (il finit par « , micro coupé » quand le micro l'est).
const tile = (name: string) => screen.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) });
const stage = () => document.querySelector('.video-stage');

test('VideoStrip : une vignette par participant, la sienne d\'abord ; partage d\'écran affiché en grand', async () => {
  const { client } = await inRoom();
  act(() => {
    client.addRemote({ id: 'bob', name: 'Bob', mic: true, cam: true });
    client.addRemote({ id: 'zoe', name: 'Zoé' });
  });

  // Une vignette par participant, la sienne d'abord, chacune avec son nom.
  const items = tiles();
  expect(items).toHaveLength(3);
  expect(items.map((item) => item.querySelector('.tile-name')?.textContent)).toEqual([t(fr.media.tiles.you, { name: 'Léa' }), 'Bob', 'Zoé']);
  expect(within(items[0]!).getByRole('button').hasAttribute('data-local')).toBe(true);
  // Pas de partage : rien en grand.
  expect(stage()).toBeNull();

  // Bob partage son écran : il s'affiche en grand, en plus des vignettes (sa caméra reste dans la liste).
  act(() => client.updateRemote('bob', { screen: true }));
  const shared = screen.getByRole('button', { name: t(fr.media.tiles.screen, { name: 'Bob' }) });
  expect(stage()?.contains(shared)).toBe(true);
  expect(shared.getAttribute('aria-pressed')).toBe('true');
  expect(tiles()).toHaveLength(3);
  // La vidéo du partage suit la piste d'écran de Bob.
  const video = shared.querySelector('video')!;
  expect(client.attachments).toContainEqual({ el: video, participantId: 'bob', source: 'screen' });

  // Le partage s'arrête : plus rien en grand, et sa vidéo est détachée.
  act(() => client.updateRemote('bob', { screen: false }));
  expect(stage()).toBeNull();
  expect(client.attachments.some((a) => a.el === video)).toBe(false);
});

describe('les vignettes', () => {
  test('hors conversation : aucune vignette, rien à l\'écran', () => {
    const client = new FakeMediaClient();
    clients.push(client);
    const { container } = render(<LiveStrip client={client} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
  });

  test('caméra allumée : sa vidéo est attachée à la vignette, et détachée quand la caméra s\'éteint ou que la personne part', async () => {
    const { client } = await inRoom({ mic: true, cam: false });
    act(() => client.addRemote({ id: 'bob', name: 'Bob', cam: true }));
    const video = tile('Vidéo de Bob').querySelector('video')!;
    expect(video).toBeTruthy();
    expect(video.muted).toBe(true);
    expect(client.attachments).toEqual([{ el: video, participantId: 'bob', source: 'camera' }]);

    act(() => client.updateRemote('bob', { cam: false }));
    expect(tile('Vidéo de Bob').querySelector('video')).toBeNull();
    expect(client.attachments).toEqual([]);

    act(() => client.updateRemote('bob', { cam: true }));
    expect(client.attachments).toHaveLength(1);
    act(() => client.removeRemote('bob'));
    expect(screen.queryByRole('button', { name: /Bob/ })).toBeNull();
    expect(client.attachments).toEqual([]);
  });

  test('caméra éteinte : ses initiales à la place de la vidéo', async () => {
    const { client } = await inRoom({ mic: true, cam: false });
    act(() => client.addRemote({ id: 'bob', name: 'Bob Martin' }));
    expect(tile('Vidéo de Bob Martin').querySelector('.tile-initials')?.textContent).toBe('BM');
    expect(tile(`Vidéo de ${t(fr.media.tiles.you, { name: 'Léa' })}`).querySelector('.tile-initials')?.textContent).toBe('L');
  });

  test('sa propre caméra est vue en miroir, pas celle des autres', async () => {
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', cam: true }));
    const own = document.querySelector('[data-local] video')!;
    expect(own.classList.contains('tile-video-mirrored')).toBe(true);
    expect(tile('Vidéo de Bob').querySelector('video')!.classList.contains('tile-video-mirrored')).toBe(false);
  });

  test('micro coupé : dit dans le nom de la vignette et montré par une icône', async () => {
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', mic: false }));
    const muted = screen.getByRole('button', { name: t(fr.media.tiles.cameraMuted, { name: 'Bob' }) });
    expect(muted.querySelector('.tile-muted')).toBeTruthy();
    act(() => client.updateRemote('bob', { mic: true }));
    const unmuted = screen.getByRole('button', { name: t(fr.media.tiles.camera, { name: 'Bob' }) });
    expect(unmuted.querySelector('.tile-muted')).toBeNull();
  });

  test('qui parle est entouré', async () => {
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', mic: true }));
    act(() => client.setSpeaking('bob'));
    expect(tile('Vidéo de Bob').hasAttribute('data-speaking')).toBe(true);
    expect(document.querySelector('[data-local]')!.hasAttribute('data-speaking')).toBe(false);
    act(() => client.setSpeaking('moi'));
    expect(tile('Vidéo de Bob').hasAttribute('data-speaking')).toBe(false);
    expect(document.querySelector('[data-local]')!.hasAttribute('data-speaking')).toBe(true);
  });

  test('window.__office.media.tiles suit le nombre de vignettes (une par participant), et revient à 0', async () => {
    const { client, view } = await inRoom();
    expect(mediaDebug.tiles).toBe(1);
    act(() => client.addRemote({ id: 'bob', name: 'Bob', screen: true }));
    expect(mediaDebug.tiles).toBe(2);
    await act(() => client.leave());
    expect(mediaDebug.tiles).toBe(0);
    await act(() => client.join(payload('r2')));
    expect(mediaDebug.tiles).toBe(1);
    view.unmount();
    expect(mediaDebug.tiles).toBe(0);
  });
});

describe('agrandir', () => {
  test('un clic agrandit une vignette, un autre la remet dans la liste', async () => {
    const user = userEvent.setup();
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', cam: true }));
    const bob = () => tile('Vidéo de Bob');
    expect(bob().getAttribute('aria-pressed')).toBe('false');
    expect(bob().getAttribute('title')).toBe(fr.media.tiles.enlarge);

    await user.click(bob());
    expect(stage()?.contains(bob())).toBe(true);
    expect(bob().getAttribute('aria-pressed')).toBe('true');
    expect(bob().getAttribute('title')).toBe(fr.media.tiles.shrink);
    // Une seule vidéo pour Bob : la vignette a changé de place, elle n'est pas en double ; la liste garde les autres.
    expect(client.attachments.filter((a) => a.participantId === 'bob')).toHaveLength(1);
    expect(tiles()).toHaveLength(1);

    await user.click(bob());
    expect(stage()).toBeNull();
    expect(bob().getAttribute('aria-pressed')).toBe('false');
    // Revenue à sa place : après la sienne.
    expect(tiles().map((item) => item.querySelector('.tile-name')?.textContent)).toEqual([t(fr.media.tiles.you, { name: 'Léa' }), 'Bob']);
  });

  test('pendant un partage d\'écran, agrandir une vignette passe devant ; la réduire rend la place au partage', async () => {
    const user = userEvent.setup();
    const { client } = await inRoom();
    act(() => {
      client.addRemote({ id: 'bob', name: 'Bob', cam: true, screen: true });
      client.addRemote({ id: 'zoe', name: 'Zoé', cam: true });
    });
    const shared = () => screen.getByRole('button', { name: t(fr.media.tiles.screen, { name: 'Bob' }) });
    expect(stage()?.contains(shared())).toBe(true);

    await user.click(tile('Vidéo de Zoé'));
    expect(stage()?.contains(tile('Vidéo de Zoé'))).toBe(true);
    expect(stage()?.contains(shared())).toBe(false);

    await user.click(tile('Vidéo de Zoé'));
    expect(stage()?.contains(shared())).toBe(true);
  });

  test('la vignette agrandie qui disparaît (la personne part) rend la place au partage d\'écran, ou à rien', async () => {
    const user = userEvent.setup();
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'zoe', name: 'Zoé', cam: true }));
    await user.click(tile('Vidéo de Zoé'));
    act(() => client.removeRemote('zoe'));
    expect(stage()).toBeNull();
    // Elle revient : en petit.
    act(() => client.addRemote({ id: 'zoe', name: 'Zoé', cam: true }));
    expect(stage()).toBeNull();
  });

  test('son propre partage d\'écran reste en petit (pas d\'effet miroir) ; un clic l\'agrandit', async () => {
    const user = userEvent.setup();
    const { client } = await inRoom();
    await act(() => client.setScreenShare(true));
    const own = () => screen.getByRole('button', { name: t(fr.media.tiles.screen, { name: t(fr.media.tiles.you, { name: 'Léa' }) }) });
    expect(stage()).toBeNull();
    expect(tiles()).toHaveLength(2);
    await user.click(own());
    expect(stage()?.contains(own())).toBe(true);
  });

  test('au clavier : Tab va aux vignettes, Entrée agrandit puis réduit ; le focus suit la vignette qui change de place', async () => {
    const user = userEvent.setup();
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', cam: true }));
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(tile('Vidéo de Bob'));
    await user.keyboard('{Enter}');
    expect(tile('Vidéo de Bob').getAttribute('aria-pressed')).toBe('true');
    expect(stage()?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(tile('Vidéo de Bob'));
    await user.keyboard('{Enter}');
    expect(stage()).toBeNull();
    expect(document.activeElement).toBe(tile('Vidéo de Bob'));
  });
});

describe('quand ça ne marche pas', () => {
  test('connexion audio et vidéo impossible : un message, et « Reconnecter »', async () => {
    const user = userEvent.setup();
    const onReconnect = vi.fn();
    const client = new FakeMediaClient();
    clients.push(client);
    render(<LiveStrip client={client} onReconnect={onReconnect} />);
    client.failConnections();
    await act(() => client.join(payload('r1')));

    expect(screen.getByRole('alert').textContent).toContain(fr.media.connectionFailed);
    await user.click(screen.getByRole('button', { name: fr.media.reconnect }));
    expect(onReconnect).toHaveBeenCalledOnce();

    // La consigne suivante réussit : le message s'en va.
    client.failConnections(false);
    await act(() => client.join(payload('r1')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: fr.media.reconnect })).toBeNull();
  });

  test('le son bloqué par le navigateur : « Activer le son » le lance (startAudio, dans le clic)', async () => {
    const user = userEvent.setup();
    const { client } = await inRoom();
    act(() => client.blockAudio());
    expect(screen.getByText(fr.media.audioBlocked)).toBeTruthy();
    const startAudio = vi.spyOn(client, 'startAudio');
    await user.click(screen.getByRole('button', { name: fr.media.enableAudio }));
    expect(startAudio).toHaveBeenCalledOnce();
    await act(() => client.idle());
    expect(screen.queryByRole('button', { name: fr.media.enableAudio })).toBeNull();
  });

  test('micro ou caméra refusés dans la conversation : on le dit, sans bouton', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    clients.push(client);
    render(<LiveStrip client={client} />);
    client.denyDevices('mic', 'cam');
    await act(() => client.join(payload('r1')));
    expect(screen.getByRole('status').textContent).toBe(fr.media.devicesRefused);
  });
});
