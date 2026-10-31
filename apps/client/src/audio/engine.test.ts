import { beforeEach, describe, expect, test } from 'vitest';
import { createFakeAudio, type FakeAudio, FakeBuffer, type FakeSource } from '../test/fake-audio';
import { NATURE, SCENES, SFX } from './catalog';
import { AudioEngine, DUCK_LEVEL, levelToGain, MUSIC_FADE_S, MUSIC_STOP_FADE_S } from './engine';
import { NATURE_LOOP_MARGIN_S, SILENT_NATURE, type NatureMix } from './nature';

// Laisse aller jusqu'au bout les téléchargements et décodages (des promesses) que le moteur a lancés.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let audio: FakeAudio;
let engine: AudioEngine;

beforeEach(() => {
  audio = createFakeAudio();
  engine = new AudioEngine(audio.runtime);
});

// Le moteur dans l'état où tout marche : le geste de la personne est fait, et le navigateur a laissé le son démarrer.
async function startEngine(): Promise<void> {
  engine.unlock();
  audio.context.run();
  await settle();
}

// Les circuits, dans l'ordre où le moteur les crée : le volume de la musique, la baisse quand on parle, le volume des effets.
const buses = () => {
  const [music, duck, sfx] = audio.context.gains;
  return { music: music!, duck: duck!, sfx: sfx! };
};

// Les boucles lancées, leurs gains (après les trois circuits : aucun effet n'est lancé dans les tests de la musique), et ce qu'elles jouent
// (le faux réseau rend le texte de l'adresse).
const voices = (): FakeSource[] => audio.context.sources.filter((source) => source.loop);
const voiceGains = () => audio.context.gains.slice(3);
const playing = (source: FakeSource) => (source.buffer as FakeBuffer).url;
const fetchedMusic = () => audio.fetched.filter((url) => url.includes('/music/'));

// Le dernier point du dernier fondu d'un gain : là où il va.
const fadeTarget = (gain: { gain: { events: Array<{ type: string; curve?: Float32Array }> } }): number => {
  const curves = gain.gain.events.filter((event) => event.type === 'curve');
  return curves.at(-1)!.curve!.at(-1)!;
};

describe('avant le geste de la personne', () => {
  test('rien n\'est créé : pas de contexte audio, pas de téléchargement, et le choix de l\'ambiance est retenu', () => {
    engine.setMusic('focus');
    engine.playSfx('click');
    expect(audio.context.gains).toHaveLength(0);
    expect(audio.fetched).toEqual([]);
    expect(engine.getSnapshot()).toEqual({ status: 'locked', playing: null });
  });

  test('unlock crée le contexte une seule fois, le remet en marche, et lance l\'ambiance retenue', async () => {
    engine.setMusic('focus');
    engine.unlock();
    expect(audio.context.resumeCalls).toBe(1);
    audio.context.run();
    await settle();
    expect(engine.getSnapshot()).toEqual({ status: 'running', playing: 'focus' });
    expect(voices()).toHaveLength(1);
    // Un second clic ne refait rien : le son marche.
    engine.unlock();
    expect(audio.context.gains).toHaveLength(3 + 1);
    expect(audio.context.resumeCalls).toBe(1);
  });

  test('un navigateur qui endort le contexte (onglet resté en arrière-plan) : le moteur le dit, et unlock le relance', async () => {
    await startEngine();
    audio.context.suspend();
    expect(engine.getSnapshot().status).toBe('locked');
    engine.unlock();
    expect(audio.context.resumeCalls).toBe(2);
    audio.context.run();
    expect(engine.getSnapshot().status).toBe('running');
  });

  test('sans Web Audio : « unsupported », et plus rien ne fait quoi que ce soit', () => {
    const none = createFakeAudio({ supported: false });
    const quiet = new AudioEngine(none.runtime);
    expect(quiet.getSnapshot().status).toBe('unsupported');
    quiet.setMusic('focus');
    quiet.unlock();
    quiet.playSfx('click');
    expect(none.context.gains).toHaveLength(0);
    expect(none.fetched).toEqual([]);
    expect(quiet.getSnapshot().status).toBe('unsupported');
  });
});

describe('la musique', () => {
  test('une ambiance est une boucle (l\'ogg d\'abord), qui monte en fondu jusqu\'à son niveau mesuré', async () => {
    await startEngine();
    engine.setMusic('dusk');
    await settle();
    expect(fetchedMusic()).toEqual(['/assets/audio/music/dusk.ogg']);
    const [source] = voices();
    expect(source!.loop).toBe(true);
    expect(source!.startedAt).toBe(0);
    const voice = voiceGains()[0]!;
    expect(voice.gain.events.find((event) => event.type === 'curve')!.duration).toBe(MUSIC_FADE_S);
    expect(fadeTarget(voice)).toBeCloseTo(SCENES.dusk.gain, 5);
    // Elle passe par la baisse « on parle », puis le volume de la musique.
    expect(source!.connections.size).toBe(1);
    expect(buses().duck.connections.has(buses().music)).toBe(true);
    expect(engine.getSnapshot().playing).toBe('dusk');
  });

  test('le fondu est à puissance constante : à mi-parcours, la voix est déjà aux sept dixièmes de son niveau', async () => {
    await startEngine();
    engine.setMusic('focus');
    await settle();
    const curve = voiceGains()[0]!.gain.events.find((event) => event.type === 'curve')!.curve!;
    expect(curve[0]).toBe(0);
    // sin(π/4) ≈ 0,707 : la moitié de la puissance, comme cos(π/4) pour la voix qui s'éteint. Elle ne dépasse jamais son niveau.
    expect(curve[Math.floor(curve.length / 2)]! / SCENES.focus.gain).toBeCloseTo(Math.SQRT1_2, 1);
    expect(Math.max(...curve)).toBeCloseTo(SCENES.focus.gain, 5);
  });

  test('changer d\'ambiance : la nouvelle monte pendant que l\'ancienne s\'éteint, puis l\'ancienne est défaite', async () => {
    await startEngine();
    engine.setMusic('focus');
    await settle();
    audio.context.currentTime = 10;
    engine.setMusic('sunny');
    await settle();
    const [first, second] = voices();
    expect(playing(first!)).toBe('/assets/audio/music/focus.ogg');
    expect(playing(second!)).toBe('/assets/audio/music/sunny.ogg');
    expect(second!.startedAt).toBe(10);
    // L'ancienne descend à 0 pendant le même fondu, et s'arrête juste après.
    expect(fadeTarget(voiceGains()[0]!)).toBeCloseTo(0, 5);
    expect(fadeTarget(voiceGains()[1]!)).toBeCloseTo(SCENES.sunny.gain, 5);
    expect(first!.stoppedAt).toBeCloseTo(10 + MUSIC_FADE_S + 0.1, 5);
    expect(engine.getSnapshot().playing).toBe('sunny');
    first!.end();
    expect(first!.disconnected).toBe(true);
  });

  test('redemander l\'ambiance qui joue déjà ne fait rien', async () => {
    await startEngine();
    engine.setMusic('focus');
    await settle();
    engine.setMusic('focus');
    await settle();
    expect(voices()).toHaveLength(1);
    expect(fetchedMusic()).toHaveLength(1);
  });

  test('la couper : fondu de sortie, plus d\'ambiance ; la rallumer relance la boucle (déjà chargée, sans retéléchargement)', async () => {
    await startEngine();
    engine.setMusic('focus');
    await settle();
    audio.context.currentTime = 5;
    engine.setMusic(null);
    expect(engine.getSnapshot().playing).toBeNull();
    const [source] = voices();
    expect(source!.stoppedAt).toBeCloseTo(5 + MUSIC_STOP_FADE_S + 0.1, 5);
    engine.setMusic('focus');
    await settle();
    expect(voices()).toHaveLength(2);
    expect(fetchedMusic()).toHaveLength(1);
    expect(engine.getSnapshot().playing).toBe('focus');
  });

  test('changer d\'avis pendant un chargement : l\'ambiance abandonnée ne démarre jamais', async () => {
    await startEngine();
    engine.setMusic('focus');
    await settle();
    // B se charge ; avant son arrivée, on revient à A, qui joue déjà.
    engine.setMusic('sunny');
    engine.setMusic('focus');
    await settle();
    expect(voices()).toHaveLength(1);
    expect(playing(voices()[0]!)).toBe('/assets/audio/music/focus.ogg');
    expect(engine.getSnapshot().playing).toBe('focus');
  });

  test('couper la musique pendant un chargement : l\'ambiance qui arrive ensuite ne démarre pas', async () => {
    await startEngine();
    engine.setMusic('focus');
    engine.setMusic(null);
    await settle();
    expect(voices()).toHaveLength(0);
    expect(engine.getSnapshot().playing).toBeNull();
  });

  test('Safari, qui ne lit pas l\'ogg : l\'AAC passe en premier, et l\'ogg ne se télécharge pas', async () => {
    audio.playable.delete('audio/ogg; codecs="vorbis"');
    await startEngine();
    engine.setMusic('quest');
    await settle();
    expect(fetchedMusic()).toEqual(['/assets/audio/music/quest.m4a']);
    expect(engine.getSnapshot().playing).toBe('quest');
  });

  test('un navigateur qui se trompe sur ce qu\'il lit (l\'ogg ne se décode pas) : l\'autre copie prend le relais', async () => {
    audio.context.undecodable.add('/assets/audio/music/quest.ogg');
    await startEngine();
    engine.setMusic('quest');
    await settle();
    expect(fetchedMusic()).toEqual(['/assets/audio/music/quest.ogg', '/assets/audio/music/quest.m4a']);
    expect(playing(voices()[0]!)).toBe('/assets/audio/music/quest.m4a');
  });

  test('un fichier qui manque : pas de son, pas d\'erreur, et le prochain essai recharge', async () => {
    audio.missing.add('/assets/audio/music/focus.ogg').add('/assets/audio/music/focus.m4a');
    await startEngine();
    engine.setMusic('focus');
    await settle();
    expect(voices()).toHaveLength(0);
    expect(engine.getSnapshot().playing).toBeNull();
    audio.missing.clear();
    engine.setMusic('sunny');
    engine.setMusic('focus');
    await settle();
    expect(playing(voices()[0]!)).toBe('/assets/audio/music/focus.ogg');
  });

  test('les ambiances décodées pèsent lourd : seules la courante et la précédente sont gardées, et une plus ancienne se recharge', async () => {
    await startEngine();
    for (const scene of ['focus', 'sunny', 'dusk', 'drift'] as const) {
      engine.setMusic(scene);
      await settle();
    }
    expect(fetchedMusic()).toHaveLength(4);
    // Le retour dans la pièce qu'on vient de quitter ne recharge rien.
    engine.setMusic('dusk');
    await settle();
    expect(fetchedMusic().filter((url) => url.includes('dusk'))).toHaveLength(1);
    engine.setMusic('sunny');
    await settle();
    // « sunny » était plus ancienne : elle a été oubliée, il faut la recharger.
    expect(fetchedMusic().filter((url) => url.includes('sunny'))).toHaveLength(2);
  });

  test('le volume de la musique suit le curseur au carré, et rien ne change pour les effets', async () => {
    await startEngine();
    engine.setMusicLevel(0.5);
    expect(buses().music.gain.value).toBeCloseTo(0.25, 5);
    expect(buses().sfx.gain.value).toBeCloseTo(levelToGain(0.8), 5);
    engine.setMusicLevel(7);
    expect(buses().music.gain.value).toBe(1);
    engine.setMusicLevel(-1);
    expect(buses().music.gain.value).toBe(0);
  });

  test('un réglage fait avant le geste vaut dès la création du contexte', () => {
    engine.setMusicLevel(0.5);
    engine.setSfxLevel(0.2);
    engine.setDucked(true);
    engine.unlock();
    expect(buses().music.gain.value).toBeCloseTo(0.25, 5);
    expect(buses().sfx.gain.value).toBeCloseTo(0.04, 5);
    expect(buses().duck.gain.value).toBe(DUCK_LEVEL);
  });

  test('on parle : la musique baisse, et remonte ensuite', async () => {
    await startEngine();
    engine.setDucked(true);
    expect(buses().duck.gain.value).toBe(DUCK_LEVEL);
    engine.setDucked(false);
    expect(buses().duck.gain.value).toBe(1);
  });
});

describe('les effets', () => {
  async function ready(): Promise<void> {
    await startEngine();
    // Les effets se chargent dès le geste (preload) : ils sont là.
    await settle();
  }

  test('ils se chargent dès le geste de la personne, une seule fois chacun', async () => {
    await ready();
    const sfx = audio.fetched.filter((url) => url.includes('/sfx/'));
    expect(sfx).toContain('/assets/audio/sfx/click.wav');
    expect(new Set(sfx).size).toBe(sfx.length);
    expect(sfx).toHaveLength(Object.keys(SFX).length);
  });

  test('un effet part avec son propre gain, par le circuit des effets', async () => {
    await ready();
    engine.playSfx('knock');
    const source = audio.context.sources.find((s) => !s.loop)!;
    expect((source.buffer as FakeBuffer).url).toBe('/assets/audio/sfx/knock.wav');
    expect(source.startedAt).toBe(0);
    const gain = [...source.connections][0] as unknown as { gain: { value: number }; connections: Set<unknown> };
    expect(gain.gain.value).toBe(SFX.knock.gain);
    expect(gain.connections.has(buses().sfx)).toBe(true);
  });

  test('la vitesse, le volume en plus et le délai demandés sont appliqués', async () => {
    await ready();
    audio.context.currentTime = 3;
    engine.playSfx('arrive', { rate: 0.8, level: 0.5, delayMs: 250 });
    const source = audio.context.sources.find((s) => !s.loop)!;
    expect(source.playbackRate.value).toBe(0.8);
    expect(source.startedAt).toBeCloseTo(3.25, 5);
    const gain = [...source.connections][0] as unknown as { gain: { value: number } };
    expect(gain.gain.value).toBeCloseTo(SFX.arrive.gain * 0.5, 5);
  });

  test('le même effet deux fois de suite : une seule lecture dans son délai de repos', async () => {
    await ready();
    engine.playSfx('message');
    engine.playSfx('message');
    audio.advance(SFX.message.cooldownMs - 1);
    engine.playSfx('message');
    expect(audio.context.sources.filter((s) => !s.loop)).toHaveLength(1);
    audio.advance(1);
    engine.playSfx('message');
    expect(audio.context.sources.filter((s) => !s.loop)).toHaveLength(2);
  });

  test('au plus huit effets à la fois : les suivants sont perdus, et la place revient quand un son se termine', async () => {
    await ready();
    const ids = ['click', 'toggle-on', 'toggle-off', 'panel-open', 'panel-close', 'cancel', 'welcome', 'arrive', 'message', 'success'] as const;
    for (const id of ids) engine.playSfx(id);
    const played = audio.context.sources.filter((s) => !s.loop);
    expect(played).toHaveLength(8);
    played[0]!.end();
    engine.playSfx('error');
    expect(audio.context.sources.filter((s) => !s.loop)).toHaveLength(9);
  });

  test('un effet fini est défait', async () => {
    await ready();
    engine.playSfx('click');
    const source = audio.context.sources.find((s) => !s.loop)!;
    source.end();
    expect(source.disconnected).toBe(true);
  });

  test('effets coupés : rien ne part ; rallumés, ils repartent', async () => {
    await ready();
    engine.setSfxEnabled(false);
    engine.playSfx('click');
    expect(audio.context.sources.filter((s) => !s.loop)).toHaveLength(0);
    engine.setSfxEnabled(true);
    engine.playSfx('click');
    expect(audio.context.sources.filter((s) => !s.loop)).toHaveLength(1);
  });

  test('contexte endormi : pas d\'effet', async () => {
    await ready();
    audio.context.suspend();
    engine.playSfx('click');
    expect(audio.context.sources.filter((s) => !s.loop)).toHaveLength(0);
  });

  test('un effet demandé avant d\'être chargé part dès qu\'il arrive, s\'il arrive à temps', async () => {
    engine.setSfxEnabled(false);
    await startEngine();
    engine.setSfxEnabled(true);
    engine.playSfx('welcome');
    await settle();
    expect(audio.context.sources.filter((s) => !s.loop)).toHaveLength(1);
  });

  test('un effet qui manque ne fait pas de bruit, ni d\'erreur, et n\'est pas redemandé sans fin', async () => {
    audio.missing.add('/assets/audio/sfx/click.wav');
    await ready();
    engine.playSfx('click');
    await settle();
    engine.playSfx('click');
    await settle();
    expect(audio.context.sources.filter((s) => !s.loop)).toHaveLength(0);
    expect(audio.fetched.filter((url) => url.endsWith('click.wav'))).toHaveLength(1);
  });
});

describe('la sortie du son', () => {
  test('rien n\'est demandé au navigateur tant qu\'aucune sortie n\'est choisie', async () => {
    await startEngine();
    expect(audio.context.sinkIds).toEqual([]);
  });

  test('la sortie choisie à l\'écran d\'entrée s\'applique au contexte, et « celle du système » la remet par défaut', async () => {
    engine.setOutputDevice('casque');
    await startEngine();
    expect(audio.context.sinkIds).toEqual(['casque']);
    engine.setOutputDevice(undefined);
    expect(audio.context.sinkIds).toEqual(['casque', '']);
  });
});

test('les abonnés sont prévenus à chaque changement d\'état, et d\'eux seuls', async () => {
  const seen: string[] = [];
  const stop = engine.subscribe(() => seen.push(`${engine.getSnapshot().status}/${engine.getSnapshot().playing}`));
  engine.setMusic('focus');
  engine.unlock();
  // Le navigateur laisse démarrer le son, puis l'ambiance est chargée.
  audio.context.run();
  await settle();
  expect(seen).toEqual(['running/null', 'running/focus']);
  const count = seen.length;
  stop();
  engine.setMusic(null);
  expect(seen).toHaveLength(count);
});

test('dispose ferme le contexte : plus de son', async () => {
  await startEngine();
  engine.setMusic('focus');
  await settle();
  engine.dispose();
  expect(audio.context.closed).toBe(true);
  expect(engine.getSnapshot()).toEqual({ status: 'locked', playing: null });
  engine.playSfx('click');
  expect(audio.context.sources.filter((s) => !s.loop)).toHaveLength(0);
});

describe('la nature', () => {
  const POND: NatureMix = { ...SILENT_NATURE, outside: true, water: { open: 1, wall: 0, pan: -0.3 }, birds: 1, wind: 1 };

  test('rien n\'est créé tant qu\'il n\'y a rien à entendre ; puis l\'eau tourne en boucle sur sa période (entre les marges du fichier), par le volume des effets', async () => {
    await startEngine();
    engine.setNature(SILENT_NATURE);
    expect(audio.context.gains).toHaveLength(3);

    engine.setNature(POND);
    await settle();
    const water = audio.context.sources.filter((source) => (source.buffer as FakeBuffer).url === '/assets/audio/nature/water.ogg');
    expect(water).toHaveLength(1);
    for (const source of water) {
      expect(source.loop).toBe(true);
      expect(source.loopStart).toBe(NATURE_LOOP_MARGIN_S);
      expect(source.loopEnd).toBeCloseTo(NATURE_LOOP_MARGIN_S + NATURE.water.seconds, 9);
    }
    // La nature sort sur le circuit des effets, et lui seul.
    const out = audio.context.gains[3]!;
    expect(out.connections.has(buses().sfx)).toBe(true);
    expect(audio.context.gains.filter((gain) => gain.connections.has(buses().sfx))).toEqual([out]);
  });

  test('les effets coupés la font taire (en fondu) ; rallumés, elle revient', async () => {
    await startEngine();
    engine.setNature(POND);
    await settle();
    // Les gains du lecteur, dans l'ordre : sa sortie, l'eau, l'eau à l'air libre, à travers le mur, les insectes, les oiseaux, le vent.
    const [, , open, , , birds] = audio.context.gains.slice(3);
    expect(open!.gain.value).toBe(1);
    expect(birds!.gain.value).toBe(1);
    engine.setSfxEnabled(false);
    expect(open!.gain.value).toBe(0);
    expect(birds!.gain.value).toBe(0);
    engine.setSfxEnabled(true);
    expect(open!.gain.value).toBe(1);
  });
});
