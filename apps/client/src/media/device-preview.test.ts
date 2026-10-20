import { describe, expect, test } from 'vitest';
import { DevicePreview, type PreviewState } from './device-preview';
import { FakeMediaDevices, FakePermissions } from '../test/fake-media-devices';

// L'aperçu de l'écran d'entrée : il demande le micro et la caméra voulus, garde leurs pistes, et les arrête quand on n'en veut plus.

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(devices = new FakeMediaDevices(), permissions = new FakePermissions()) {
  const states: PreviewState[] = [];
  const preview = new DevicePreview(devices, permissions, (s) => states.push(s));
  const last = () => states.at(-1)!;
  return { devices, permissions, preview, states, last };
}

describe('la demande', () => {
  test('micro et caméra voulus : une seule demande pour les deux (une seule question du navigateur), en attente puis allumés', async () => {
    const { devices, preview, last } = setup();
    const answer = devices.holdAnswers();
    preview.want({ mic: true, cam: true });
    await flush();
    expect(last()).toEqual({ audio: null, video: null, mic: 'pending', cam: 'pending' });
    answer();
    await preview.idle();
    expect(devices.calls).toEqual([{ audio: true, video: true }]);
    expect(last()).toEqual({ audio: devices.tracks[0], video: devices.tracks[1], mic: 'on', cam: 'on' });
  });

  test('les périphériques choisis sont demandés (idéalement : un périphérique débranché laisse place à celui du système)', async () => {
    const { devices, preview } = setup();
    preview.want({ mic: true, cam: true, audioInput: 'micro-usb', videoInput: 'webcam' });
    await preview.idle();
    expect(devices.calls).toEqual([{ audio: { deviceId: { ideal: 'micro-usb' } }, video: { deviceId: { ideal: 'webcam' } } }]);
  });

  test('rien de voulu : rien de demandé', async () => {
    const { devices, preview, last } = setup();
    preview.want({ mic: false, cam: false });
    await preview.idle();
    expect(devices.calls).toEqual([]);
    expect(last()).toEqual({ audio: null, video: null, mic: 'off', cam: 'off' });
  });
});

describe('les changements', () => {
  test('couper la caméra : sa piste s\'arrête, le micro reste, sans nouvelle demande ; la rallumer ne redemande qu\'elle', async () => {
    const { devices, preview, last } = setup();
    preview.want({ mic: true, cam: true });
    await preview.idle();
    const [audio, video] = devices.tracks;
    preview.want({ mic: true, cam: false });
    await preview.idle();
    expect(video!.stopped).toBe(true);
    expect(audio!.stopped).toBe(false);
    expect(last()).toEqual({ audio, video: null, mic: 'on', cam: 'off' });

    preview.want({ mic: true, cam: true });
    await preview.idle();
    expect(devices.calls).toEqual([{ audio: true, video: true }, { audio: false, video: true }]);
    expect(last()).toMatchObject({ audio, mic: 'on', cam: 'on' });
  });

  test('changer de micro : seule sa piste est redemandée, avec ce périphérique, et l\'ancienne arrêtée ; la caméra ne bouge pas', async () => {
    const { devices, preview, last } = setup();
    preview.want({ mic: true, cam: true });
    await preview.idle();
    const [oldAudio, video] = devices.tracks;
    preview.want({ mic: true, cam: true, audioInput: 'micro-usb' });
    await preview.idle();
    expect(devices.calls.at(-1)).toEqual({ audio: { deviceId: { ideal: 'micro-usb' } }, video: false });
    expect(oldAudio!.stopped).toBe(true);
    expect(video!.stopped).toBe(false);
    expect(last()).toEqual({ audio: devices.tracks.at(-1), video, mic: 'on', cam: 'on' });
  });

  test('une piste qui se termine (périphérique débranché, ou pris par une autre appli) : failed', async () => {
    const { devices, preview, last } = setup();
    preview.want({ mic: true, cam: true });
    await preview.idle();
    devices.tracks[1]!.end();
    expect(last()).toMatchObject({ video: null, mic: 'on', cam: 'failed' });
  });
});

describe('les refus', () => {
  test('tout refusé : failed pour les deux ; pas de nouvel essai tant que le choix ne change pas ; recocher la caméra réessaie', async () => {
    const { devices, preview, last } = setup();
    devices.refuse.add('audio').add('video');
    preview.want({ mic: true, cam: true });
    await preview.idle();
    expect(last()).toEqual({ audio: null, video: null, mic: 'failed', cam: 'failed' });
    // Le même choix (un autre réglage a changé, comme le haut-parleur) ne redemande rien : ce serait une nouvelle question du
    // navigateur.
    preview.want({ mic: true, cam: true });
    await preview.idle();
    expect(devices.calls).toHaveLength(1);

    devices.refuse.clear();
    preview.want({ mic: true, cam: false });
    preview.want({ mic: true, cam: true });
    await preview.idle();
    expect(devices.calls.at(-1)).toEqual({ audio: false, video: true });
    expect(last()).toMatchObject({ mic: 'failed', cam: 'on' });
  });

  test('pas de caméra sur cet ordinateur (la demande à deux échoue) : chacun est redemandé seul, et le micro marche', async () => {
    const { devices, preview, last } = setup();
    devices.missing.add('video');
    preview.want({ mic: true, cam: true });
    await preview.idle();
    expect(devices.calls).toEqual([{ audio: true, video: true }, { audio: true, video: false }, { audio: false, video: true }]);
    expect(last()).toMatchObject({ mic: 'on', cam: 'failed' });
  });

  test('refus à deux, mais le micro déjà permis : lui seul est redemandé (sans nouvelle question)', async () => {
    const { devices, permissions, preview, last } = setup();
    devices.refuse.add('video');
    permissions.states.set('microphone', 'granted');
    permissions.states.set('camera', 'denied');
    preview.want({ mic: true, cam: true });
    await preview.idle();
    expect(devices.calls).toEqual([{ audio: true, video: true }, { audio: true, video: false }]);
    expect(last()).toMatchObject({ mic: 'on', cam: 'failed' });
  });

  test('refus à deux, sans permission connue (question fermée, ou Permissions indisponible) : rien n\'est redemandé', async () => {
    const { devices, permissions, preview, last } = setup();
    devices.refuse.add('audio').add('video');
    permissions.failQueries = true;
    preview.want({ mic: true, cam: true });
    await preview.idle();
    expect(devices.calls).toHaveLength(1);
    expect(last()).toMatchObject({ mic: 'failed', cam: 'failed' });
  });

  test('sans navigator.mediaDevices (page non sécurisée, navigateur ancien) : failed, sans erreur', async () => {
    const states: PreviewState[] = [];
    const preview = new DevicePreview(undefined, undefined, (s) => states.push(s));
    preview.want({ mic: true, cam: true });
    await preview.idle();
    expect(states.at(-1)).toEqual({ audio: null, video: null, mic: 'failed', cam: 'failed' });
  });
});

describe('la fin', () => {
  test('close : toutes les pistes s\'arrêtent, et plus rien n\'est demandé ni annoncé', async () => {
    const { devices, preview, states } = setup();
    preview.want({ mic: true, cam: true });
    await preview.idle();
    const count = states.length;
    preview.close();
    expect(devices.tracks.every((track) => track.stopped)).toBe(true);
    preview.want({ mic: true, cam: true, audioInput: 'micro-usb' });
    await preview.idle();
    expect(states).toHaveLength(count);
    expect(devices.calls).toHaveLength(1);
  });

  test('une réponse arrivée après close (la question encore ouverte à l\'entrée) : ses pistes sont arrêtées aussitôt', async () => {
    const { devices, preview, states } = setup();
    const answer = devices.holdAnswers();
    preview.want({ mic: true, cam: true });
    await flush();
    expect(devices.calls).toHaveLength(1);
    const count = states.length;
    preview.close();
    answer();
    await preview.idle();
    expect(devices.tracks).toHaveLength(2);
    expect(devices.tracks.every((track) => track.stopped)).toBe(true);
    expect(states).toHaveLength(count);
  });
});
