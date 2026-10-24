import { MEDIA_PARK_MS, type MediaJoinPayload } from '@bureau/shared';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { FakeMediaClient } from './fake-media-client';
import type { MediaSnapshot } from './media-client';

// La logique du client média (MediaSession), éprouvée par le faux client : la même, branchée sur un faux LiveKit qui tient un journal
// (`journal` pour les rooms, `deviceLog` pour les périphériques).

const payload = (room: string): MediaJoinPayload => ({ url: 'wss://livekit.test', room, token: `jeton-${room}` });

// Laisse le client avancer aussi loin qu'il peut (le faux LiveKit n'attend que des promesses, ou ce que retient le test).
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const me = (patch: Partial<MediaSnapshot['participants'][number]> = {}) => ({
  id: 'moi',
  name: 'Moi',
  isLocal: true,
  mic: false,
  cam: false,
  screen: false,
  speaking: false,
  ...patch,
});

describe('avant d\'entrer dans une room', () => {
  test('rien n\'est demandé aux périphériques : ni à la création, ni en changeant micro, caméra, préférences ou partage', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    await client.setMic(false);
    await client.setCam(false);
    await client.setPrefs({ mic: true, cam: true, audioInput: 'micro-usb' });
    await client.setScreenShare(true);
    await client.leave();
    expect(client.deviceLog).toEqual([]);
    expect(client.journal).toEqual([]);
    expect(client.getSnapshot()).toEqual({ room: null, participants: [], local: { mic: true, cam: true, screen: false }, error: null, audioBlocked: false });
  });

  test('l\'état local suit les préférences, puis les changements : il servira en entrant', async () => {
    const client = new FakeMediaClient({ mic: false, cam: true });
    expect(client.getSnapshot().local).toEqual({ mic: false, cam: true, screen: false });
    await client.setMic(true);
    await client.setCam(false);
    expect(client.getSnapshot().local).toEqual({ mic: true, cam: false, screen: false });

    await client.join(payload('r1'));
    expect(client.deviceLog).toEqual(['mic:on']);
  });
});

describe('entrer dans une room', () => {
  test('micro et caméra suivent les préférences, avec les périphériques choisis', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false, audioInput: 'micro-usb', videoInput: 'webcam', audioOutput: 'casque' });
    await client.join(payload('r1'));
    expect(client.journal).toEqual(['join:r1']);
    expect(client.devices).toEqual({ audioInput: 'micro-usb', videoInput: 'webcam', audioOutput: 'casque' });
    expect(client.deviceLog).toEqual(['mic:on']);
    expect(client.getSnapshot()).toEqual({
      room: 'r1',
      participants: [me({ mic: true })],
      local: { mic: true, cam: false, screen: false },
      error: null,
      audioBlocked: false,
    });
  });

  test('micro et caméra refusés (ou absents) : on entre quand même, en réception seule, avec permission_denied', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    client.denyDevices('mic', 'cam');
    client.addRemote({ id: 'ana', name: 'Ana', mic: true, cam: true });
    await client.join(payload('r1'));
    expect(client.getSnapshot()).toEqual({
      room: 'r1',
      participants: [me(), { id: 'ana', name: 'Ana', isLocal: false, mic: true, cam: true, screen: false, speaking: false }],
      local: { mic: false, cam: false, screen: false },
      error: 'permission_denied',
      audioBlocked: false,
    });
  });

  test('seule la caméra refusée : le micro marche, et permission_denied quand même', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    client.denyDevices('cam');
    await client.join(payload('r1'));
    expect(client.getSnapshot()).toMatchObject({ participants: [me({ mic: true })], local: { mic: true, cam: false }, error: 'permission_denied' });
  });

  test('seul le micro refusé : la caméra marche, et l\'erreur reste (elle n\'est pas effacée par la caméra qui suit)', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    client.denyDevices('mic');
    await client.join(payload('r1'));
    expect(client.getSnapshot()).toMatchObject({ participants: [me({ cam: true })], local: { mic: false, cam: true }, error: 'permission_denied' });
  });

  test('après un refus, rien n\'est redemandé en changeant de room ; rallumer le micro redemande, et efface l\'erreur si c\'est accepté', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    client.denyDevices('mic', 'cam');
    await client.join(payload('r1'));
    await client.join(payload('r2'));
    expect(client.deviceLog).toEqual(['mic:on', 'cam:on']);

    await client.setMic(true);
    expect(client.getSnapshot()).toMatchObject({ local: { mic: false, cam: false }, error: 'permission_denied' });
    client.allowDevices();
    await client.setMic(true);
    expect(client.deviceLog).toEqual(['mic:on', 'cam:on', 'mic:on', 'mic:on']);
    expect(client.getSnapshot()).toMatchObject({ participants: [me({ mic: true })], local: { mic: true, cam: false }, error: null });
  });

  test('connexion impossible : room null et connection_failed ; le join suivant réessaie, et l\'erreur s\'efface', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    client.failConnections();
    await client.join(payload('r1'));
    expect(client.getSnapshot()).toEqual({ room: null, participants: [], local: { mic: true, cam: false, screen: false }, error: 'connection_failed', audioBlocked: false });
    expect(client.deviceLog).toEqual([]);

    client.failConnections(false);
    await client.join(payload('r1'));
    expect(client.journal).toEqual(['join:r1', 'join:r1']);
    expect(client.getSnapshot()).toMatchObject({ room: 'r1', error: null });
  });

  test('connexion impossible, puis media:leave : l\'erreur s\'efface (cette room n\'est plus attendue), sans rien quitter', async () => {
    const client = new FakeMediaClient();
    client.failConnections();
    await client.join(payload('r1'));
    await client.leave();
    expect(client.journal).toEqual(['join:r1']);
    expect(client.getSnapshot()).toMatchObject({ room: null, error: null });
  });

  test('une room rejointe pendant qu\'on la rejoint déjà, ou rejointe à nouveau : une seule connexion', async () => {
    const client = new FakeMediaClient();
    const release = client.holdConnections();
    const first = client.join(payload('r1'));
    const second = client.join(payload('r1'));
    release();
    await Promise.all([first, second]);
    await client.join(payload('r1'));
    expect(client.journal).toEqual(['join:r1']);
  });

  test('couper le micro pendant la connexion : il n\'est jamais allumé', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    const release = client.holdConnections();
    const joined = client.join(payload('r1'));
    const muted = client.setMic(false);
    expect(client.getSnapshot().local.mic).toBe(false);
    release();
    await Promise.all([joined, muted]);
    expect(client.deviceLog).not.toContain('mic:on');
    expect(client.getSnapshot()).toMatchObject({ participants: [me({ cam: true })], local: { mic: false, cam: true } });
  });

  test('les opérations passent dans l\'ordre des appels ; la room rendue caduque pendant sa connexion n\'allume ni micro ni caméra', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    const release = client.holdConnections();
    const done = [client.join(payload('r1')), client.leave(), client.join(payload('r2'))];
    release();
    await Promise.all(done);
    expect(client.journal).toEqual(['join:r1', 'leave', 'join:r2']);
    // Micro et caméra une fois chacun, pour r2 : r1, quittée avant d'avoir été rejointe, n'a rien reçu.
    expect(client.deviceLog).toEqual(['mic:on', 'cam:on']);
    expect(client.getSnapshot()).toMatchObject({ room: 'r2', participants: [me({ mic: true, cam: true })], error: null });
  });

  test('media:leave pendant la connexion : elle est annulée tout de suite, sans attendre qu\'elle aboutisse, et sans erreur', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    const errors: Array<MediaSnapshot['error']> = [];
    client.subscribe((s) => errors.push(s.error));
    client.holdConnections();   // jamais relâchée : la connexion n'aboutirait pas d'elle-même
    const joined = client.join(payload('r1'));
    await client.leave();
    await joined;
    expect(client.journal).toEqual(['join:r1', 'leave']);
    expect(client.deviceLog).toEqual([]);
    expect(client.getSnapshot()).toEqual({ room: null, participants: [], local: { mic: true, cam: true, screen: false }, error: null, audioBlocked: false });
    // L'annulation n'est pas un échec : connection_failed n'est jamais annoncé, même un instant.
    expect(errors).not.toContain('connection_failed');
  });

  test('un join encore dans la file quand arrive media:leave : il ne se fait pas', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    const release = client.holdConnections();
    const done = [client.join(payload('r0')), client.join(payload('r1')), client.leave()];
    release();
    await Promise.all(done);
    expect(client.journal).toEqual(['join:r0', 'leave']);
    expect(client.deviceLog).toEqual([]);
    expect(client.getSnapshot()).toMatchObject({ room: null, error: null });
  });

  test('changer de room, puis media:leave aussitôt (pendant le départ de l\'ancienne) : la nouvelle n\'est pas rejointe', async () => {
    const client = new FakeMediaClient({ mic: false, cam: false });
    await client.join(payload('r0'));
    await Promise.all([client.join(payload('r1')), client.leave()]);
    expect(client.journal).toEqual(['join:r0', 'leave']);
    expect(client.getSnapshot()).toMatchObject({ room: null, error: null });
  });

  test('media:join d\'une autre room pendant que le micro s\'allume (accès demandé, caméra qui chauffe) : l\'ancienne est quittée tout de suite, rien n\'y est publié, la nouvelle n\'attend pas', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    const release = client.holdDevices();
    const first = client.join(payload('r1'));
    await flush();
    expect(client.deviceLog).toEqual(['mic:on']);

    const second = client.join(payload('r2'));
    await flush();
    expect(client.journal).toEqual(['join:r1', 'leave', 'join:r2']);
    // Le micro de r2 attend à son tour ; celui de r1 a été abandonné, sans rien publier ni demander la caméra.
    expect(client.deviceLog).toEqual(['mic:on', 'mic:on']);

    release();
    await Promise.all([first, second]);
    expect(client.deviceLog).toEqual(['mic:on', 'mic:on', 'cam:on']);
    expect(client.getSnapshot()).toMatchObject({ room: 'r2', participants: [me({ mic: true, cam: true })], local: { mic: true, cam: true }, error: null });
  });
});

describe('la room qui se termine pendant qu\'un micro ou une caméra s\'allume', () => {
  test.each(['removed', 'lost'] as const)('terminée par LiveKit (%s) : le micro voulu reste allumé, et la room suivante n\'attend pas', async (reason) => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    const release = client.holdDevices();
    const first = client.join(payload('r1'));
    await flush();
    client.dropConnection(reason);
    await first;
    expect(client.getSnapshot()).toEqual({
      room: null,
      participants: [],
      local: { mic: true, cam: false, screen: false },
      error: reason === 'lost' ? 'connection_failed' : null,
      audioBlocked: false,
    });

    const second = client.join(payload('r2'));
    await flush();
    expect(client.journal).toEqual(['join:r1', 'join:r2']);
    release();
    await second;
    expect(client.deviceLog).toEqual(['mic:on', 'mic:on']);
    expect(client.getSnapshot()).toMatchObject({ room: 'r2', participants: [me({ mic: true })], local: { mic: true }, error: null });
  });

  test('l\'appel échoue après coup (la publication que LiveKit abandonne dans une room fermée) : la caméra voulue reste, sans erreur', async () => {
    const client = new FakeMediaClient({ mic: false, cam: true });
    client.holdDevices('fail');
    const joined = client.join(payload('r1'));
    await flush();
    client.dropConnection('removed');
    await joined;
    expect(client.getSnapshot()).toEqual({ room: null, participants: [], local: { mic: false, cam: true, screen: false }, error: null, audioBlocked: false });
  });

  test('rallumer la caméra, et la room retirée pendant ce temps : la caméra voulue reste, sans erreur', async () => {
    const client = new FakeMediaClient({ mic: false, cam: false });
    await client.join(payload('r1'));
    client.holdDevices('fail');
    const turnedOn = client.setCam(true);
    await flush();
    client.dropConnection('removed');
    await turnedOn;
    expect(client.getSnapshot()).toMatchObject({ room: null, local: { cam: true }, error: null });
  });

  test('quitter pendant que le partage d\'écran attend le choix de l\'écran : le départ ne l\'attend pas', async () => {
    const client = new FakeMediaClient({ mic: false, cam: false });
    await client.join(payload('r1'));
    client.holdDevices();
    const shared = client.setScreenShare(true);
    await flush();
    await client.leave();
    await shared;
    expect(client.journal).toEqual(['join:r1', 'leave']);
    expect(client.getSnapshot()).toMatchObject({ room: null, local: { screen: false }, error: null });
  });
});

describe('ce qui compte comme un refus (permission_denied)', () => {
  test.each(['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError', 'SecurityError'])(
    '%s (getUserMedia) : éteint, avec permission_denied',
    async (name) => {
      const client = new FakeMediaClient({ mic: true, cam: false });
      client.failDevices(new DOMException('refusé', name), 'mic');
      await client.join(payload('r1'));
      expect(client.getSnapshot()).toMatchObject({ room: 'r1', local: { mic: false }, error: 'permission_denied' });
    },
  );

  test.each([
    ['PublishTrackError (LiveKit)', Object.assign(new Error('publishing rejected as engine not connected within timeout'), { name: 'PublishTrackError' })],
    ['UnexpectedConnectionState (LiveKit)', Object.assign(new Error('cannot publish track when not connected'), { name: 'UnexpectedConnectionState' })],
    ['TypeError', new TypeError('constraints')],
  ])('un autre échec (%s) : éteint (le micro ne marche pas), sans permission_denied', async (_, error) => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    client.failDevices(error, 'mic');
    await client.join(payload('r1'));
    expect(client.getSnapshot()).toMatchObject({ room: 'r1', local: { mic: false }, error: null });
  });
});

describe('dans une room', () => {
  test('micro et caméra : allumés et éteints à la demande', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    await client.join(payload('r1'));
    await client.setMic(false);
    await client.setCam(false);
    await client.setCam(true);
    expect(client.deviceLog).toEqual(['mic:on', 'cam:on', 'mic:off', 'cam:off', 'cam:on']);
    expect(client.getSnapshot()).toMatchObject({ participants: [me({ cam: true })], local: { mic: false, cam: true } });
  });

  test('rallumer la caméra toujours refusée : elle reste éteinte, avec permission_denied', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    await client.join(payload('r1'));
    client.denyDevices('cam');
    await client.setCam(true);
    expect(client.getSnapshot()).toMatchObject({ participants: [me({ mic: true })], local: { mic: true, cam: false }, error: 'permission_denied' });
  });

  test('setPrefs : les nouveaux périphériques, et micro et caméra qui suivent', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    await client.join(payload('r1'));
    await client.setPrefs({ audioInput: 'micro-usb', videoInput: 'webcam', mic: false, cam: true });
    expect(client.deviceLog).toEqual(['mic:on', 'cam:on', 'devices:{"audioInput":"micro-usb","videoInput":"webcam"}', 'mic:off', 'cam:on']);
    expect(client.devices).toEqual({ audioInput: 'micro-usb', videoInput: 'webcam' });
    expect(client.getSnapshot()).toMatchObject({ participants: [me({ cam: true })], local: { mic: false, cam: true } });
  });

  test('partage d\'écran : allumé et éteint ; arrêté par le navigateur (« Arrêter le partage »)', async () => {
    const client = new FakeMediaClient({ mic: false, cam: false });
    await client.join(payload('r1'));
    await client.setScreenShare(true);
    expect(client.getSnapshot()).toMatchObject({ participants: [me({ screen: true })], local: { screen: true } });
    await client.setScreenShare(false);
    expect(client.getSnapshot()).toMatchObject({ participants: [me()], local: { screen: false } });

    await client.setScreenShare(true);
    client.endScreenShare();
    expect(client.getSnapshot()).toMatchObject({ participants: [me()], local: { screen: false } });
    expect(client.deviceLog).toEqual(['screen:on', 'screen:off', 'screen:on']);
  });

  test('partage d\'écran refusé ou annulé (choix de l\'écran fermé) : rien ne change, et ce n\'est pas une erreur', async () => {
    const client = new FakeMediaClient({ mic: false, cam: false });
    await client.join(payload('r1'));
    client.refuseScreenShare();
    await client.setScreenShare(true);
    expect(client.getSnapshot()).toMatchObject({ local: { screen: false }, error: null });
  });

  test('quitter : les pistes s\'arrêtent, le partage d\'écran avec ; micro et caméra voulus restent pour la room suivante', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    await client.join(payload('r1'));
    await client.setScreenShare(true);
    await client.leave();
    expect(client.getSnapshot()).toEqual({ room: null, participants: [], local: { mic: true, cam: true, screen: false }, error: null, audioBlocked: false });
    await client.join(payload('r2'));
    expect(client.deviceLog).toEqual(['mic:on', 'cam:on', 'screen:on', 'mic:on', 'cam:on']);
  });

  test('connexion perdue (LiveKit renonce à se reconnecter) : room null, personne, connection_failed ; le même join reconnecte', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    await client.join(payload('r1'));
    client.addRemote({ id: 'ana', name: 'Ana' });
    await client.setScreenShare(true);
    client.dropConnection();
    expect(client.getSnapshot()).toEqual({ room: null, participants: [], local: { mic: true, cam: false, screen: false }, error: 'connection_failed', audioBlocked: false });

    await client.join(payload('r1'));
    expect(client.journal).toEqual(['join:r1', 'join:r1']);
    expect(client.getSnapshot()).toMatchObject({ room: 'r1', error: null });
  });

  test('retiré de la room exprès (le serveur, à un changement de groupe ; un autre onglet) : plus de room, mais pas d\'erreur', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    await client.join(payload('r1'));
    await client.setScreenShare(true);
    client.dropConnection('removed');
    expect(client.getSnapshot()).toEqual({ room: null, participants: [], local: { mic: true, cam: false, screen: false }, error: null, audioBlocked: false });

    // Le media:leave qui suit (ou qui croisait le retrait) ne trouve plus rien à quitter ; le join suivant rejoint.
    await client.leave();
    await client.join(payload('r2'));
    expect(client.journal).toEqual(['join:r1', 'join:r2']);
    expect(client.getSnapshot()).toMatchObject({ room: 'r2', error: null });
  });

  // Un retrait inexpliqué (le serveur ne retire plus personne d'une room où il le renvoie : c'est une sûreté). Le serveur, pour qui elle est
  // dans la room, ne redira rien : sans erreur, elle resterait seule, sans conversation et sans « Reconnecter ».
  describe('retiré, et la room toujours voulue 2 s plus tard', () => {
    test('ni media:leave ni autre media:join : connection_failed (« Reconnecter »)', async () => {
      const client = new FakeMediaClient({ mic: true, cam: false });
      await client.join(payload('r1'));
      vi.useFakeTimers();
      try {
        client.dropConnection('removed');
        expect(client.getSnapshot()).toMatchObject({ room: null, error: null });
        vi.advanceTimersByTime(1999);
        expect(client.getSnapshot().error).toBeNull();
        vi.advanceTimersByTime(1);
        expect(client.getSnapshot()).toMatchObject({ room: null, error: 'connection_failed' });
      } finally {
        vi.useRealTimers();
      }
      // « Reconnecter » : le serveur redit la consigne (avec un jeton neuf), qui rejoint et efface l'erreur.
      await client.join(payload('r1'));
      expect(client.getSnapshot()).toMatchObject({ room: 'r1', error: null });
    });

    test.each([
      ['media:leave', (client: FakeMediaClient) => client.leave()],
      ['media:join d\'une autre room', (client: FakeMediaClient) => client.join(payload('r2'))],
      ['media:join de la même room (rejointe de nouveau)', (client: FakeMediaClient) => client.join(payload('r1'))],
    ])('une consigne arrivée entre-temps (%s) : pas d\'erreur', async (_name, instruction) => {
      const client = new FakeMediaClient({ mic: true, cam: false });
      await client.join(payload('r1'));
      vi.useFakeTimers();
      try {
        client.dropConnection('removed');
        vi.advanceTimersByTime(500);
        void instruction(client);
        await vi.advanceTimersByTimeAsync(5000);
        expect(client.getSnapshot().error).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    test('perdue (lost) : connection_failed tout de suite, comme avant', async () => {
      const client = new FakeMediaClient({ mic: true, cam: false });
      await client.join(payload('r1'));
      client.dropConnection('lost');
      expect(client.getSnapshot().error).toBe('connection_failed');
    });
  });

  test('participants : soi-même d\'abord, puis les autres dans leur ordre d\'arrivée, avec ce qu\'ils publient et qui parle', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    await client.join(payload('r1'));
    client.addRemote({ id: 'zoe', name: 'Zoé', cam: true });
    client.addRemote({ id: 'ana', name: 'Ana', mic: true, screen: true });
    client.setSpeaking('ana', 'moi');
    expect(client.getSnapshot().participants).toEqual([
      me({ mic: true, speaking: true }),
      { id: 'zoe', name: 'Zoé', isLocal: false, mic: false, cam: true, screen: false, speaking: false },
      { id: 'ana', name: 'Ana', isLocal: false, mic: true, cam: false, screen: true, speaking: true },
    ]);
    client.removeRemote('zoe');
    expect(client.getSnapshot().participants.map((p) => p.id)).toEqual(['moi', 'ana']);
  });
});

describe('l\'état, pour l\'interface', () => {
  test('subscribe : l\'état tout de suite, puis chaque changement une fois ; plus rien après le désabonnement', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    const seen: MediaSnapshot[] = [];
    const unsubscribe = client.subscribe((s) => seen.push(s));
    expect(seen).toEqual([client.getSnapshot()]);

    await client.setMic(false);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.local.mic).toBe(false);
    // Rien de changé : rien d'annoncé.
    await client.setMic(false);
    await client.leave();
    expect(seen).toHaveLength(2);

    unsubscribe();
    await client.setMic(true);
    expect(seen).toHaveLength(2);
  });

  test('un abonné qui lève ne prive pas les autres de l\'état ni n\'arrête l\'opération ; son erreur est relancée à part', async () => {
    vi.useFakeTimers();
    try {
      const client = new FakeMediaClient({ mic: true, cam: true });
      let armed = false;
      client.subscribe(() => {
        if (armed) throw new Error('abonné en panne');
      });
      const rooms: Array<string | null> = [];
      client.subscribe((s) => rooms.push(s.room));
      armed = true;

      await client.join(payload('r1'));
      expect(rooms.at(-1)).toBe('r1');
      expect(client.deviceLog).toEqual(['mic:on', 'cam:on']);
      expect(client.getSnapshot().participants).toEqual([me({ mic: true, cam: true })]);
      expect(() => vi.runAllTimers()).toThrow('abonné en panne');
    } finally {
      vi.useRealTimers();
    }
  });

  test('getSnapshot rend le même objet tant que rien ne change (pour useSyncExternalStore), un nouveau à chaque changement', async () => {
    const client = new FakeMediaClient();
    await client.join(payload('r1'));
    const before = client.getSnapshot();
    client.setSpeaking();
    client.updateRemote('personne', { mic: true });
    expect(client.getSnapshot()).toBe(before);
    client.setSpeaking('moi');
    expect(client.getSnapshot()).not.toBe(before);
    expect(before.participants[0]!.speaking).toBe(false);
  });

  test('attach : passé au transport (qui suit la piste de la personne), et la fonction rendue détache', async () => {
    const client = new FakeMediaClient();
    const video = document.createElement('video');
    const detach = client.attach(video, 'ana', 'screen');
    expect(client.attachments).toEqual([{ el: video, participantId: 'ana', source: 'screen' }]);
    detach();
    expect(client.attachments).toEqual([]);
  });
});

describe('un abonné qui change de room pendant l\'annonce de la connexion', () => {
  // doJoin annonce la room (room: r1) avant de se connecter : un abonné peut alors quitter la room, ou en demander une autre, dans
  // l'appel même. La connexion de r1 ne doit plus partir : son départ (dropUnwantedRoom) a déjà eu lieu, et rien ne la quitterait.
  test('leave dans l\'abonné qui voit « room: r1 » : la connexion à r1 ne part pas (pas de room laissée ouverte)', async () => {
    const client = new FakeMediaClient({ mic: false, cam: false });
    client.subscribe((s) => {
      if (s.room === 'r1') void client.leave();
    });
    await client.join(payload('r1'));
    await client.idle();
    // Le départ demandé au transport (rien n'y était encore connecté), et aucune connexion à r1.
    expect(client.journal).toEqual(['leave']);
    expect(client.getSnapshot()).toMatchObject({ room: null, participants: [], error: null });
  });

  test('join d\'une autre room dans l\'abonné : seule la seconde se connecte', async () => {
    const client = new FakeMediaClient({ mic: false, cam: false });
    let first = true;
    client.subscribe((s) => {
      if (s.room === 'r1' && first) {
        first = false;
        void client.join(payload('r2'));
      }
    });
    await client.join(payload('r1'));
    await client.idle();
    expect(client.journal).toEqual(['leave', 'join:r2']);
    expect(client.getSnapshot()).toMatchObject({ room: 'r2', participants: [me()] });
  });
});

describe('le son des autres (startAudio, audioBlocked)', () => {
  test('hors room : startAudio ne fait rien (et ne rejette pas), et le son n\'est pas bloqué', async () => {
    const client = new FakeMediaClient();
    await expect(client.startAudio()).resolves.toBeUndefined();
    expect(client.audioStarts).toBe(0);
    expect(client.getSnapshot().audioBlocked).toBe(false);
  });

  test('le navigateur bloque le son (Safari, en réception seule) : audioBlocked ; startAudio, dans un clic, le débloque', async () => {
    const client = new FakeMediaClient();
    await client.join(payload('r1'));
    client.blockAudio();
    expect(client.getSnapshot().audioBlocked).toBe(true);
    await client.startAudio();
    expect(client.audioStarts).toBe(1);
    expect(client.getSnapshot().audioBlocked).toBe(false);
  });

  test('startAudio part tout de suite, hors de la file : le geste de la personne n\'attend pas une opération en cours', async () => {
    const client = new FakeMediaClient({ mic: false, cam: false });
    await client.join(payload('r1'));
    client.blockAudio();
    const release = client.holdDevices();
    const turnedOn = client.setMic(true);   // l'accès au micro attend la réponse de la personne
    const started = client.startAudio();
    expect(client.audioStarts).toBe(1);
    await started;
    expect(client.getSnapshot().audioBlocked).toBe(false);
    release();
    await turnedOn;
  });

  test('startAudio refusé (hors d\'un geste) : le son reste bloqué, sans erreur et sans rejet', async () => {
    const client = new FakeMediaClient();
    await client.join(payload('r1'));
    client.blockAudio();
    client.refuseAudioStart();
    await expect(client.startAudio()).resolves.toBeUndefined();
    expect(client.getSnapshot()).toMatchObject({ audioBlocked: true, error: null });
  });

  test('la room quittée, perdue ou changée : le son n\'est plus bloqué (la room suivante le dira)', async () => {
    const client = new FakeMediaClient();
    await client.join(payload('r1'));
    client.blockAudio();
    await client.leave();
    expect(client.getSnapshot().audioBlocked).toBe(false);

    await client.join(payload('r1'));
    client.blockAudio();
    client.dropConnection('lost');
    expect(client.getSnapshot().audioBlocked).toBe(false);

    await client.join(payload('r1'));
    client.blockAudio();
    await client.join(payload('r2'));
    expect(client.getSnapshot().audioBlocked).toBe(false);
  });
});

describe('parquer une room, et la reprendre', () => {
  const resumeOf = (room: string, resume = '1'): MediaJoinPayload => ({ ...payload(room), resume });

  test('leave avec park : la room est parquée, pas quittée ; pour l\'interface, c\'est une sortie (plus de room, personne)', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    await client.join(payload('r1'));
    client.addRemote({ id: 'ana' });
    await client.leave({ park: true });
    expect(client.journal).toEqual(['join:r1', 'park:r1']);
    expect(client.parkedRoom).toBe('r1');
    expect(client.micKept).toBe(true);
    expect(client.getSnapshot()).toEqual({ room: null, participants: [], local: { mic: true, cam: true, screen: false }, error: null, audioBlocked: false });
  });

  test('le join de la room parquée, avec resume : elle reprend, sans nouvelle connexion ; le micro gardé est republié, la caméra rallumée', async () => {
    const client = new FakeMediaClient({ mic: true, cam: true });
    await client.join(payload('r1'));
    await client.leave({ park: true });
    await client.join(resumeOf('r1'));
    expect(client.journal).toEqual(['join:r1', 'park:r1', 'resume:r1']);
    expect(client.deviceLog).toEqual(['mic:on', 'cam:on', 'mic:kept', 'cam:on']);
    expect(client.getSnapshot()).toMatchObject({ room: 'r1', participants: [me({ mic: true, cam: true })], error: null });
    expect(client.parkedRoom).toBeNull();
  });

  test('une reprise qui échoue (pas de confirmation) : connexion avec le jeton, et le micro gardé y sert quand même', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    await client.join(payload('r1'));
    await client.leave({ park: true });
    client.failResumes();
    await client.join(resumeOf('r1'));
    expect(client.journal).toEqual(['join:r1', 'park:r1', 'resume:r1', 'unpark', 'join:r1']);
    expect(client.deviceLog).toEqual(['mic:on', 'mic:kept']);
    expect(client.getSnapshot()).toMatchObject({ room: 'r1', error: null });
  });

  test('sans resume (le serveur ne l\'a pas reprise), ou une autre room : la parquée est fermée, nouvelle connexion', async () => {
    const client = new FakeMediaClient({ mic: false, cam: false });
    await client.join(payload('r1'));
    await client.leave({ park: true });
    await client.join(payload('r1'));
    await client.leave({ park: true });
    await client.join(resumeOf('r2'));
    expect(client.journal).toEqual(['join:r1', 'park:r1', 'unpark', 'join:r1', 'park:r1', 'unpark', 'join:r2']);
  });

  test('la fin du délai (MEDIA_PARK_MS) ferme la room parquée et arrête le micro gardé ; une sortie pour de bon aussi', async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const client = new FakeMediaClient({ mic: true, cam: false });
    await client.join(payload('r1'));
    await client.leave({ park: true });
    await vi.advanceTimersByTimeAsync(MEDIA_PARK_MS - 1);
    expect(client.parkedRoom).toBe('r1');
    await vi.advanceTimersByTimeAsync(1);
    expect(client.parkedRoom).toBeNull();
    expect(client.micKept).toBe(false);
    expect(client.journal.at(-1)).toBe('unpark');

    await client.join(payload('r2'));
    await client.leave({ park: true });
    await client.leave();
    expect(client.parkedRoom).toBeNull();
    expect(client.micKept).toBe(false);
    await vi.advanceTimersByTimeAsync(MEDIA_PARK_MS);
    expect(client.journal.filter((entry) => entry === 'unpark')).toHaveLength(2);
  });

  test('une sortie avec park pendant la connexion : on ne parque qu\'une room connectée, celle-ci est quittée', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    const release = client.holdConnections();
    const joined = client.join(payload('r1'));
    await client.leave({ park: true });
    release();
    await joined;
    expect(client.journal).toEqual(['join:r1', 'leave']);
    expect(client.parkedRoom).toBeNull();
  });

  test('une sortie pendant la reprise : elle échoue, rien ne reste ouvert ; le join suivant se connecte', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    await client.join(payload('r1'));
    await client.leave({ park: true });
    const release = client.holdResumes();
    const back = client.join(resumeOf('r1'));
    await flush();
    expect(client.getSnapshot().room).toBe('r1');
    await client.leave({ park: true });
    release();
    await back;
    expect(client.getSnapshot()).toMatchObject({ room: null, error: null });
    expect(client.parkedRoom).toBeNull();
    expect(client.micKept).toBe(false);
    await client.join(resumeOf('r1'));
    expect(client.journal.at(-1)).toBe('join:r1');
  });

  test('couper le micro pendant le parcage arrête le micro gardé (l\'indicateur du navigateur s\'éteint) ; la room reste parquée', async () => {
    const client = new FakeMediaClient({ mic: true, cam: false });
    await client.join(payload('r1'));
    await client.leave({ park: true });
    await client.setMic(false);
    expect(client.deviceLog.at(-1)).toBe('mic:kept-off');
    expect(client.parkedRoom).toBe('r1');
    // Repris, micro coupé : rien n'est publié.
    await client.join(resumeOf('r1'));
    expect(client.getSnapshot()).toMatchObject({ room: 'r1', participants: [me()] });
    expect(client.deviceLog).toEqual(['mic:on', 'mic:kept-off']);
  });
});
