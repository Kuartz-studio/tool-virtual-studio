import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import type { MediaPrefs } from '../media/media-client';
import { loadPrefs, savePrefs } from '../media/prefs';
import { FakeMediaDevices, FakePermissions, installMediaDevices } from '../test/fake-media-devices';
import { DeviceCheck } from './DeviceCheck';

let devices: FakeMediaDevices;
let uninstall: () => void;

beforeEach(() => {
  localStorage.clear();
  devices = new FakeMediaDevices();
  uninstall = installMediaDevices(devices);
});

afterEach(() => {
  uninstall();
});

function renderCheck() {
  const onEnter = vi.fn<(prefs: MediaPrefs) => void>();
  const view = render(<DeviceCheck onEnter={onEnter} />);
  return { onEnter, view };
}

const toggle = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const preview = () => screen.queryByLabelText(fr.media.check.preview) as HTMLVideoElement | null;
// La demande au navigateur a eu sa réponse, et l'écran l'a prise en compte.
const answered = () => waitFor(() => expect(screen.queryByText(fr.media.check.asking)).toBeNull());

test('l\'écran : son titre, l\'aperçu de la caméra (en miroir, muet), micro et caméra demandés ensemble (une seule question)', async () => {
  renderCheck();
  expect(screen.getByRole('heading', { level: 1, name: fr.media.check.title })).toBeTruthy();
  await waitFor(() => expect(preview()).not.toBeNull());
  expect(devices.calls).toEqual([{ audio: true, video: true }]);
  const video = preview()!;
  expect((video.srcObject as MediaStream).getVideoTracks()).toEqual([devices.tracks[1]]);
  expect(video.muted).toBe(true);
  expect(video.classList.contains('device-preview-mirrored')).toBe(true);
  expect(screen.getByRole('button', { name: fr.media.check.enter })).toBeTruthy();
});

test('pendant la question du navigateur : « Autorise… » ; on peut déjà entrer', async () => {
  const answer = devices.holdAnswers();
  const { onEnter } = renderCheck();
  expect(await screen.findByText(fr.media.check.asking)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: fr.media.check.enter }));
  expect(onEnter).toHaveBeenCalledWith({ mic: true, cam: true });
  answer();
  // La réponse arrivée après l'entrée : ses pistes sont arrêtées aussitôt.
  await waitFor(() => expect(devices.tracks).toHaveLength(2));
  await waitFor(() => expect(devices.tracks.every((track) => track.stopped)).toBe(true));
});

describe('« Entrer »', () => {
  test('onEnter reçoit les préférences, et les pistes de l\'aperçu sont arrêtées (LiveKit demandera les siennes)', async () => {
    const user = userEvent.setup();
    const { onEnter } = renderCheck();
    await answered();
    await user.click(screen.getByRole('button', { name: fr.media.check.enter }));
    expect(onEnter).toHaveBeenCalledExactlyOnceWith({ mic: true, cam: true });
    expect(devices.tracks.every((track) => track.stopped)).toBe(true);
  });

  test('démonté sans entrer (la page se ferme) : les pistes s\'arrêtent aussi', async () => {
    const { view } = renderCheck();
    await answered();
    view.unmount();
    expect(devices.tracks.every((track) => track.stopped)).toBe(true);
  });
});

describe('micro et caméra refusés', () => {
  test('tous les deux : le message et « Entrer quand même » ; on entre sans eux, et le choix reste pour la prochaine fois', async () => {
    const user = userEvent.setup();
    devices.refuse.add('audio').add('video');
    const { onEnter } = renderCheck();
    expect((await screen.findByRole('status')).textContent).toBe(fr.media.permissionDenied);
    expect(screen.queryByRole('button', { name: fr.media.check.enter })).toBeNull();
    await user.click(screen.getByRole('button', { name: fr.media.check.enterAnyway }));
    expect(onEnter).toHaveBeenCalledWith({ mic: false, cam: false });
    // Le refus ne s'enregistre pas : la prochaine fois, micro et caméra seront de nouveau demandés.
    expect(loadPrefs()).toMatchObject({ mic: true, cam: true });
  });

  test('seul le micro : son message ; on entre avec la caméra', async () => {
    const user = userEvent.setup();
    const permissions = new FakePermissions();
    permissions.states.set('camera', 'granted');
    uninstall();
    uninstall = installMediaDevices(devices, permissions);
    devices.refuse.add('audio');
    const { onEnter } = renderCheck();
    expect((await screen.findByRole('status')).textContent).toBe(fr.media.micDenied);
    await user.click(screen.getByRole('button', { name: fr.media.check.enterAnyway }));
    expect(onEnter).toHaveBeenCalledWith({ mic: false, cam: true });
  });

  test('pas de caméra sur l\'ordinateur : son message, et le micro marche', async () => {
    devices.missing.add('video');
    renderCheck();
    expect((await screen.findByRole('status')).textContent).toBe(fr.media.camDenied);
    expect(screen.getByText(fr.media.check.camUnavailable)).toBeTruthy();
  });

  test('le micro refusé et la caméra coupée par la personne : le message général', async () => {
    savePrefs({ mic: true, cam: false });
    devices.refuse.add('audio');
    renderCheck();
    expect((await screen.findByRole('status')).textContent).toBe(fr.media.permissionDenied);
  });

  test('sans navigator.mediaDevices (page non sécurisée) : le message, et « Entrer quand même »', async () => {
    uninstall();
    uninstall = installMediaDevices(undefined);
    renderCheck();
    expect((await screen.findByRole('status')).textContent).toBe(fr.media.permissionDenied);
    expect(screen.getByRole('button', { name: fr.media.check.enterAnyway })).toBeTruthy();
  });

  test('rallumer la caméra après un refus la redemande ; acceptée, le message s\'en va', async () => {
    const user = userEvent.setup();
    devices.refuse.add('audio').add('video');
    renderCheck();
    await screen.findByRole('status');
    devices.refuse.clear();
    await user.click(toggle(fr.media.check.cam));
    await user.click(toggle(fr.media.check.cam));
    await waitFor(() => expect(preview()).not.toBeNull());
    expect((await screen.findByRole('status')).textContent).toBe(fr.media.micDenied);
  });
});

describe('les choix', () => {
  test('couper le micro et la caméra : boutons bascule ; rien n\'est demandé pour eux, et le choix est gardé', async () => {
    const user = userEvent.setup();
    const { onEnter } = renderCheck();
    await answered();
    expect(toggle(fr.media.check.mic).getAttribute('aria-pressed')).toBe('true');
    await user.click(toggle(fr.media.check.mic));
    await user.click(toggle(fr.media.check.cam));
    expect(toggle(fr.media.check.mic).getAttribute('aria-pressed')).toBe('false');
    expect(toggle(fr.media.check.cam).getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(devices.tracks.every((track) => track.stopped)).toBe(true));
    expect(preview()).toBeNull();
    expect(screen.getByText(fr.media.check.camOff)).toBeTruthy();
    expect(loadPrefs()).toEqual({ mic: false, cam: false });
    await user.click(screen.getByRole('button', { name: fr.media.check.enter }));
    expect(onEnter).toHaveBeenCalledWith({ mic: false, cam: false });
  });

  test('les préférences gardées sont reprises : micro coupé à la dernière visite, coupé ici, et pas demandé', async () => {
    savePrefs({ mic: false, cam: true });
    renderCheck();
    await answered();
    expect(toggle(fr.media.check.mic).getAttribute('aria-pressed')).toBe('false');
    expect(devices.calls).toEqual([{ audio: false, video: true }]);
  });

  test('les listes : les périphériques du système, avec leurs noms une fois l\'accès accordé', async () => {
    renderCheck();
    await answered();
    const micro = (await screen.findByLabelText(fr.media.check.audioInput)) as HTMLSelectElement;
    await waitFor(() => expect([...micro.options].map((o) => o.textContent)).toEqual([fr.media.check.systemDefault, 'Micro USB']));
    const camera = screen.getByLabelText(fr.media.check.videoInput) as HTMLSelectElement;
    expect([...camera.options].map((o) => o.textContent)).toEqual([fr.media.check.systemDefault, 'Webcam']);
  });

  test('choisir un micro : il est demandé, gardé, et passé à onEnter', async () => {
    const user = userEvent.setup();
    const { onEnter } = renderCheck();
    await answered();
    const micro = screen.getByLabelText(fr.media.check.audioInput);
    await waitFor(() => expect((micro as HTMLSelectElement).options).toHaveLength(2));
    await user.selectOptions(micro, 'micro-usb');
    await waitFor(() => expect(devices.calls.at(-1)).toEqual({ audio: { deviceId: { ideal: 'micro-usb' } }, video: false }));
    expect(loadPrefs()).toMatchObject({ audioInput: 'micro-usb' });
    await user.click(screen.getByRole('button', { name: fr.media.check.enter }));
    expect(onEnter).toHaveBeenCalledWith({ mic: true, cam: true, audioInput: 'micro-usb' });
  });

  test('revenir à « Celui du système » efface le choix', async () => {
    const user = userEvent.setup();
    savePrefs({ mic: true, cam: true, audioInput: 'micro-usb' });
    renderCheck();
    await answered();
    const micro = screen.getByLabelText(fr.media.check.audioInput);
    await waitFor(() => expect((micro as HTMLSelectElement).value).toBe('micro-usb'));
    await user.selectOptions(micro, '');
    expect(loadPrefs()).toEqual({ mic: true, cam: true });
  });

  test('les haut-parleurs ne se choisissent que si le navigateur sait changer la sortie du son (setSinkId)', async () => {
    const prototype = HTMLMediaElement.prototype as unknown as { setSinkId?: unknown };
    const original = Object.getOwnPropertyDescriptor(prototype, 'setSinkId');
    try {
      // Firefox ancien, Safari : pas de setSinkId.
      delete prototype.setSinkId;
      const { view } = renderCheck();
      await answered();
      expect(screen.queryByLabelText(fr.media.check.audioOutput)).toBeNull();
      view.unmount();

      prototype.setSinkId = () => Promise.resolve();
      renderCheck();
      const output = (await screen.findByLabelText(fr.media.check.audioOutput)) as HTMLSelectElement;
      await waitFor(() => expect([...output.options].map((o) => o.textContent)).toEqual([fr.media.check.systemDefault, 'Casque']));
    } finally {
      delete prototype.setSinkId;
      if (original) Object.defineProperty(prototype, 'setSinkId', original);
    }
  });

  test('un périphérique branché ou débranché : la liste suit', async () => {
    renderCheck();
    await answered();
    const camera = screen.getByLabelText(fr.media.check.videoInput) as HTMLSelectElement;
    await waitFor(() => expect(camera.options).toHaveLength(2));
    devices.list.push({ kind: 'videoinput', deviceId: 'camera-usb', label: 'Caméra USB' });
    act(() => devices.change());
    await waitFor(() => expect([...camera.options].map((o) => o.textContent)).toEqual([fr.media.check.systemDefault, 'Webcam', 'Caméra USB']));
  });
});
