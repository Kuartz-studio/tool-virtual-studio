import { useEffect } from 'react';
import { EventBus } from '../game/EventBus';
import { loadPrefs } from '../media/prefs';
import { listenOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { audioEngine } from './audio';
import { selectWantedScene, useAudioStore } from './audio-store';
import type { SceneId } from './catalog';
import type { AudioEngine } from './engine';
import { OUTSIDE_SCENE, sceneAt } from './scene-at';
import { bindSfx } from './sfx-events';
import { useSingleTab } from './single-tab';

// Combien de temps il faut rester dans un autre endroit pour que l'ambiance change : une personne qui longe un mur, ou qui traverse une
// porte sans s'arrêter, ne fait pas changer la musique.
export const PLACE_SETTLE_MS = 700;
// Après la dernière voix, la musique attend ce délai avant de remonter : entre deux phrases, elle ne pompe pas.
export const DUCK_HOLD_MS = 1200;

// Le chef d'orchestre du son, monté une fois pour toute l'appli (AppLayout), sans rien afficher. Il relie le moteur (AudioEngine) à
// ce qui se passe :
//   - le geste : chaque clic ou touche débloque le son (le navigateur ne le permet pas avant) ;
//   - les réglages : volumes et coupures, et l'ambiance (celle du lieu, ou celle que la personne a choisie) ; rien ne joue dans un onglet que
//     le serveur a remplacé par un autre (« Ouvert dans un autre onglet »), ni dans un onglet que la personne a quitté pour un autre onglet
//     de l'appli (un seul onglet joue à la fois, single-tab.ts) ;
//   - le lieu : tant qu'on n'est pas au bureau (connexion, écran d'entrée), la salle d'attente ; au bureau, l'ambiance de l'endroit où
//     l'on se trouve, qui change quand on y reste (PLACE_SETTLE_MS) ;
//   - la voix : quand quelqu'un parle dans la conversation, soi-même compris, la musique baisse ;
//   - les effets : les clics, les arrivées, les messages… (sfx-events.ts) ;
//   - la sortie du son choisie à l'écran d'entrée.
export function AudioDirector({ engine = audioEngine }: { engine?: AudioEngine }) {
  useUnlockOnGesture(engine);
  useEngineSettings(engine);
  useEngineState(engine);
  usePlaceScene();
  useDucking(engine);
  useEffect(() => bindSfx(engine, { bus: EventBus, store: useOfficeStore }), [engine]);
  useOutputDevice(engine);
  return null;
}

// Les gestes qui, pour un navigateur, permettent de démarrer le son. Le moteur ne fait rien de plus quand le son marche déjà.
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;

function useUnlockOnGesture(engine: AudioEngine): void {
  useEffect(() => {
    const unlock = () => engine.unlock();
    for (const type of GESTURES) window.addEventListener(type, unlock, { capture: true, passive: true });
    return () => {
      for (const type of GESTURES) window.removeEventListener(type, unlock, { capture: true });
    };
  }, [engine]);
}

// Les réglages de la personne, et l'ambiance voulue, vont au moteur. Avant le premier geste, il les retient. Un onglet remplacé, ou laissé
// pour un autre onglet de l'appli, ne joue rien : ni musique, ni effets.
function useEngineSettings(engine: AudioEngine): void {
  const prefs = useAudioStore((state) => state.prefs);
  const wanted = useAudioStore(selectWantedScene);
  const replaced = useOfficeStore((state) => state.replaced);
  const elsewhere = useSingleTab();
  const silent = replaced || elsewhere;
  useEffect(() => engine.setMusicLevel(prefs.musicVolume), [engine, prefs.musicVolume]);
  useEffect(() => engine.setSfxLevel(prefs.sfxVolume), [engine, prefs.sfxVolume]);
  useEffect(() => engine.setSfxEnabled(prefs.sfxOn && !silent), [engine, prefs.sfxOn, silent]);
  useEffect(() => engine.setMusic(silent ? null : wanted), [engine, wanted, silent]);
}

// Ce que dit le moteur (le son est-il lancé ? quelle ambiance joue ?) va au magasin, que lit le panneau Son.
function useEngineState(engine: AudioEngine): void {
  useEffect(() => {
    const sync = () => useAudioStore.getState().setEngine(engine.getSnapshot());
    sync();
    return engine.subscribe(sync);
  }, [engine]);
}

// L'ambiance du lieu. Hors du bureau (pas de carte : la connexion, l'écran d'entrée, le jeu qui charge), la salle d'attente. Au bureau, celle de
// l'endroit où sont les pieds de la personne : tout de suite à l'arrivée, puis seulement quand elle est restée un moment dans un autre.
function usePlaceScene(): void {
  const map = useOfficeStore((state) => state.officeMap);
  useEffect(() => {
    const { setPlace } = useAudioStore.getState();
    if (map === null) {
      setPlace(OUTSIDE_SCENE);
      return;
    }
    const start = useOfficeStore.getState().self ?? map.spawn;
    let settled: SceneId = sceneAt(map, start.x, start.y);
    setPlace(settled);

    let pending: { scene: SceneId; timer: ReturnType<typeof setTimeout> } | null = null;
    const moveTo = (x: number, y: number) => {
      const scene = sceneAt(map, x, y);
      if (pending?.scene === scene) return;
      if (pending !== null) clearTimeout(pending.timer);
      pending = null;
      if (scene === settled) return;
      pending = {
        scene,
        timer: setTimeout(() => {
          pending = null;
          settled = scene;
          setPlace(scene);
        }, PLACE_SETTLE_MS),
      };
    };
    const off = listenOnBus(EventBus, 'local:move', (move) => moveTo(move.x, move.y));
    return () => {
      off();
      if (pending !== null) clearTimeout(pending.timer);
    };
  }, [map]);
}

// Qui parle (soi-même compris) baisse la musique ; elle remonte un peu après la dernière voix.
function useDucking(engine: AudioEngine): void {
  useEffect(() => {
    let release: ReturnType<typeof setTimeout> | undefined;
    const off = listenOnBus(EventBus, 'media:speaking', (ids) => {
      clearTimeout(release);
      if (ids.length > 0) engine.setDucked(true);
      else release = setTimeout(() => engine.setDucked(false), DUCK_HOLD_MS);
    });
    return () => {
      off();
      clearTimeout(release);
      engine.setDucked(false);
    };
  }, [engine]);
}

// La sortie du son choisie à l'écran d'entrée (préférences du média) : relue à l'arrivée au bureau, une fois l'écran d'entrée passé.
function useOutputDevice(engine: AudioEngine): void {
  const ready = useOfficeStore((state) => state.ready);
  useEffect(() => {
    engine.setOutputDevice(loadPrefs().audioOutput);
  }, [engine, ready]);
}
