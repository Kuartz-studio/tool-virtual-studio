import type { MediaJoinPayload } from '@bureau/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

test('ce qui se règle pour la conversation (le verrou) : au-dessus des vignettes, seulement quand on n\'y est pas seul', async () => {
  const client = new FakeMediaClient({ mic: true, cam: false }, { id: 'moi', name: 'Léa' });
  clients.push(client);
  function WithControls() {
    const snapshot = useSyncExternalStore(
      (notify) => client.subscribe(() => notify()),
      () => client.getSnapshot(),
    );
    return <VideoStrip snapshot={snapshot} client={client} controls={<p>le verrou</p>} />;
  }
  render(<WithControls />);
  await act(() => client.join(payload('r1')));
  expect(screen.queryByText('le verrou')).toBeNull();   // seul dans la room
  act(() => client.addRemote({ id: 'bob', name: 'Bob' }));
  const strip = document.querySelector('.video-strip')!;
  expect(strip.firstElementChild?.textContent).toBe('le verrou');
  act(() => client.removeRemote('bob'));
  expect(screen.queryByText('le verrou')).toBeNull();
});

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

// Le plein écran d'un élément, que jsdom n'a pas : requestFullscreen pose fullscreenElement et le dit (fullscreenchange), comme un
// navigateur ; exitFullscreen le retire. `childrenAtRequest` retient ce que l'élément contenait à chaque demande.
function fakeFullscreen(enabled = true) {
  let current: Element | null = null;
  const childrenAtRequest: number[] = [];
  const change = () => document.dispatchEvent(new Event('fullscreenchange'));
  const request = vi.fn(async function (this: Element) {
    childrenAtRequest.push(this.childElementCount);
    current = this;
    change();
  });
  const exit = vi.fn(async () => {
    current = null;
    change();
  });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: enabled });
  // Comme un navigateur : un élément retiré de la page n'est plus en plein écran.
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => (current?.isConnected ? current : null) });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, writable: true, value: request });
  return { request, exit, childrenAtRequest, current: () => current };
}

function removeFakeFullscreen() {
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) delete (document as unknown as Record<string, unknown>)[key];
  delete (Element.prototype as unknown as Record<string, unknown>).requestFullscreen;
}

// La scène du plein écran (toujours dans la page), le bouton « Plein écran » d'une vignette, et celui qui en sort.
const scene = () => document.querySelector<HTMLElement>('.video-fullscreen');
const enterButton = (name: string) => screen.getByRole('button', { name: t(fr.media.fullscreen.camera, { name }) });
const exitButton = () => screen.queryByRole('button', { name: fr.media.fullscreen.exit });

describe('le plein écran', () => {
  afterEach(removeFakeFullscreen);

  test('la caméra d\'un autre, la sienne, le partage d\'un autre ont leur bouton « Plein écran » ; son propre partage non, ni rien quand le navigateur ne sait pas', async () => {
    fakeFullscreen();
    const { client } = await inRoom({ mic: true, cam: false });
    act(() => client.addRemote({ id: 'bob', name: 'Bob', cam: true, screen: true }));
    await act(() => client.setScreenShare(true));
    const you = t(fr.media.tiles.you, { name: 'Léa' });

    expect(enterButton('Bob')).toBeTruthy();
    // Sa propre caméra, même coupée (ses initiales).
    expect(enterButton(you)).toBeTruthy();
    // Le partage de Bob, agrandi de lui-même : son bouton est dans la scène agrandie.
    expect(stage()?.contains(screen.getByRole('button', { name: t(fr.media.fullscreen.screen, { name: 'Bob' }) }))).toBe(true);
    expect(screen.queryByRole('button', { name: t(fr.media.fullscreen.screen, { name: you }) })).toBeNull();
    // Un bouton à côté de la vignette, pas dedans (un bouton dans un bouton n'est pas permis).
    expect(tile('Vidéo de Bob').querySelector('button')).toBeNull();

    removeFakeFullscreen();
    act(() => client.updateRemote('bob', { mic: true }));
    expect(screen.queryByRole('button', { name: /^Plein écran/ })).toBeNull();
  });

  test('le bouton demande le plein écran dans le clic même, sur la scène, qui montre la vidéo, le nom et le micro ; « Quitter » en sort et rend le focus', async () => {
    const user = userEvent.setup();
    const fullscreen = fakeFullscreen();
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', cam: true, mic: false }));
    expect(scene()?.childElementCount).toBe(0);

    // Demandé dans le clic même (le navigateur le refuse hors d'un geste), sur la scène déjà dans la page et encore vide : elle se
    // remplit après.
    await user.click(enterButton('Bob'));
    expect(fullscreen.request).toHaveBeenCalledOnce();
    expect(fullscreen.request.mock.contexts[0]).toBe(scene());
    expect(fullscreen.childrenAtRequest).toEqual([0]);

    const shown = scene()!;
    expect(shown.getAttribute('aria-label')).toBe(t(fr.media.tiles.cameraMuted, { name: 'Bob' }));
    expect(shown.querySelector('.tile-name')?.textContent).toBe('Bob');
    expect(shown.querySelector('.tile-muted')).toBeTruthy();
    // Sa propre vidéo, sur la piste de Bob ; la vignette garde la sienne.
    const video = shown.querySelector('video')!;
    expect(client.attachments).toContainEqual({ el: video, participantId: 'bob', source: 'camera' });
    expect(client.attachments.filter((a) => a.participantId === 'bob')).toHaveLength(2);
    expect(document.activeElement).toBe(shown);
    // Le plein écran ne change rien derrière : Bob reste en petit.
    expect(stage()).toBeNull();

    await user.click(exitButton()!);
    expect(fullscreen.exit).toHaveBeenCalledOnce();
    expect(scene()?.childElementCount).toBe(0);
    expect(client.attachments.filter((a) => a.participantId === 'bob')).toHaveLength(1);
    expect(document.activeElement).toBe(enterButton('Bob'));
  });

  test('la vignette qui disparaît (la personne part, coupe son partage) fait sortir du plein écran ; Échap aussi, et la scène se vide', async () => {
    const user = userEvent.setup();
    const fullscreen = fakeFullscreen();
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', screen: true }));
    await user.click(screen.getByRole('button', { name: t(fr.media.fullscreen.screen, { name: 'Bob' }) }));
    expect(document.fullscreenElement).toBe(scene());
    act(() => client.updateRemote('bob', { screen: false }));
    expect(document.fullscreenElement).toBeNull();
    expect(scene()?.childElementCount).toBe(0);

    // Échap : le navigateur sort de lui-même.
    await user.click(enterButton('Bob'));
    expect(exitButton()).toBeTruthy();
    await act(() => fullscreen.exit());
    expect(exitButton()).toBeNull();

    // Bob s'en va pendant le plein écran de sa caméra.
    await user.click(enterButton('Bob'));
    act(() => client.removeRemote('bob'));
    expect(document.fullscreenElement).toBeNull();
  });

  test('un double-clic met la vignette en plein écran sans l\'agrandir ; un clic seul l\'agrandit, après le délai du double-clic', async () => {
    const user = userEvent.setup();
    fakeFullscreen();
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', cam: true, mic: true }));

    await user.dblClick(tile('Vidéo de Bob'));
    expect(document.fullscreenElement).toBe(scene());
    expect(scene()?.getAttribute('aria-label')).toBe(t(fr.media.tiles.camera, { name: 'Bob' }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(stage()).toBeNull();
    await user.click(exitButton()!);

    await user.click(tile('Vidéo de Bob'));
    expect(stage()).toBeNull();
    await waitFor(() => expect(stage()?.contains(tile('Vidéo de Bob'))).toBe(true));
    expect(document.fullscreenElement).toBeNull();
  });

  test('en plein écran, ← → (et les chevrons) passent à la vignette d\'avant ou d\'après, en faisant le tour ; aucune touche ne va au jeu, et Tab reste dans la scène', async () => {
    const user = userEvent.setup();
    fakeFullscreen();
    const { client } = await inRoom();
    act(() => {
      client.addRemote({ id: 'bob', name: 'Bob', mic: true, cam: true, screen: true });
      client.addRemote({ id: 'zoe', name: 'Zoé', mic: true, cam: true });
    });
    await act(() => client.setScreenShare(true));
    // Ce que voit le clavier du jeu (game/input.ts), à l'écoute de la fenêtre.
    const seen: string[] = [];
    const listen = (event: KeyboardEvent) => seen.push(`${event.type} ${event.key}`);
    window.addEventListener('keydown', listen);
    window.addEventListener('keyup', listen);
    const shown = () => scene()?.getAttribute('aria-label');

    await user.click(enterButton('Bob'));
    expect(shown()).toBe(t(fr.media.tiles.camera, { name: 'Bob' }));
    await user.keyboard('{ArrowRight}');
    expect(shown()).toBe(t(fr.media.tiles.screen, { name: 'Bob' }));
    await user.keyboard('{ArrowRight}');
    expect(shown()).toBe(t(fr.media.tiles.camera, { name: 'Zoé' }));
    // Après Zoé, on revient à soi (son propre partage n'en est pas).
    await user.click(screen.getByRole('button', { name: fr.media.fullscreen.next }));
    expect(shown()).toBe(t(fr.media.tiles.camera, { name: t(fr.media.tiles.you, { name: 'Léa' }) }));
    await user.keyboard('{ArrowLeft}');
    expect(shown()).toBe(t(fr.media.tiles.camera, { name: 'Zoé' }));
    // ZQSD (W sur un QWERTY), E (l'interrupteur à portée), le zoom : rien ne sort non plus, et la vignette ne change pas.
    await user.keyboard('{ArrowUp}we+0');
    expect(shown()).toBe(t(fr.media.tiles.camera, { name: 'Zoé' }));
    window.removeEventListener('keydown', listen);
    window.removeEventListener('keyup', listen);
    expect(seen.filter((event) => event.startsWith('keydown'))).toEqual([]);
    // Les relâchements, si : une touche enfoncée avant le plein écran ne reste pas « enfoncée » pour l'avatar.
    expect(seen).toContain('keyup ArrowRight');

    // Tab va d'un bouton de la scène à l'autre, et boucle : jamais vers les vignettes, invisibles derrière.
    const [previous, next, exit] = [fr.media.fullscreen.previous, fr.media.fullscreen.next, fr.media.fullscreen.exit].map((name) => screen.getByRole('button', { name }));
    scene()!.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(exit);
    await user.tab();
    expect(document.activeElement).toBe(previous);
    await user.tab();
    expect(document.activeElement).toBe(next);
    await user.tab();
    expect(document.activeElement).toBe(exit);
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(previous);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(exit);
  });

  test('sortie d\'elle-même (le partage coupé, la personne partie), ou partie de la page : le focus ne reste pas sur la scène cachée, et les touches retournent au jeu', async () => {
    const user = userEvent.setup();
    fakeFullscreen();
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', cam: true, screen: true }));
    const prevented: boolean[] = [];
    const listen = (event: KeyboardEvent) => prevented.push(event.defaultPrevented);
    window.addEventListener('keydown', listen);

    // Bob coupe son partage : le bouton d'où l'on était parti s'en va avec sa vignette ; le focus va à la caméra de Bob.
    await user.click(screen.getByRole('button', { name: t(fr.media.fullscreen.screen, { name: 'Bob' }) }));
    expect(document.activeElement).toBe(scene());
    act(() => client.updateRemote('bob', { screen: false }));
    expect(document.fullscreenElement).toBeNull();
    expect(document.activeElement).toBe(tile('Vidéo de Bob'));
    await user.keyboard('{ArrowUp}');

    // Bob part pendant le plein écran de sa caméra : plus rien de lui, le focus revient à la page.
    await user.click(enterButton('Bob'));
    act(() => client.addRemote({ id: 'zoe', name: 'Zoé', cam: true }));
    act(() => client.removeRemote('bob'));
    expect(document.fullscreenElement).toBeNull();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard('{ArrowUp}');
    window.removeEventListener('keydown', listen);
    expect(prevented).toEqual([false, false]);

    // Un clic qui ne donne pas le focus au bouton (Safari, Firefox sur macOS : il reste sur la page) : la sortie l'y ramène, hors de la scène.
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(enterButton('Zoé'));
    expect(document.activeElement).toBe(scene());
    fireEvent.click(exitButton()!);
    expect(document.fullscreenElement).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  test('les boutons s\'effacent quand rien ne bouge ; un toucher sans glisser (un écran tactile) les fait revenir, sans actionner celui qu\'on ne voyait pas', async () => {
    fakeFullscreen();
    const { client } = await inRoom();
    act(() => client.addRemote({ id: 'bob', name: 'Bob', cam: true }));
    vi.useFakeTimers();
    try {
      fireEvent.click(enterButton('Bob'));
      expect(scene()!.hasAttribute('data-idle')).toBe(false);
      act(() => vi.advanceTimersByTime(2500));
      expect(scene()!.hasAttribute('data-idle')).toBe(true);
      // Un toucher là où est « Quitter », effacé : la scène reçoit l'appui (le bouton effacé ne prend pas le pointeur), et le navigateur
      // donne le clic au bouton réapparu. Les boutons reviennent ; on reste en plein écran.
      fireEvent.pointerDown(scene()!);
      expect(scene()!.hasAttribute('data-idle')).toBe(false);
      fireEvent.click(exitButton()!, { detail: 1 });
      expect(document.fullscreenElement).toBe(scene());
      // Le toucher suivant, sur le bouton qu'on voit, sort.
      fireEvent.pointerDown(exitButton()!);
      fireEvent.click(exitButton()!, { detail: 1 });
      expect(document.fullscreenElement).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
