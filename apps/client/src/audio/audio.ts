import type { AudioDebug } from '../game/debug';
import type { SfxId } from './catalog';
import { AudioEngine, type AudioRuntime } from './engine';

// Le moteur de l'appli : un seul pour tous les écrans, comme le bus d'événements du jeu (game/EventBus.ts). AudioDirector l'alimente.
function browserRuntime(): AudioRuntime {
  const Context = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  return {
    supported: Context !== undefined,
    // 44,1 kHz, comme tous les fichiers : le navigateur ne les rééchantillonne pas au décodage (une boucle rééchantillonnée d'un bloc peut
    // claquer à son raccord), et adapte seulement la sortie, en continu, à la carte son.
    createContext: () => {
      try {
        return new Context!({ latencyHint: 'interactive', sampleRate: 44100 });
      } catch {
        return new Context!({ latencyHint: 'interactive' });
      }
    },
    fetchBytes: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return response.arrayBuffer();
    },
    // Rien n'est joué dans cet élément : il sert seulement à demander au navigateur ce qu'il sait lire.
    canPlay: (mime) => document.createElement('audio').canPlayType(mime) !== '',
    nowMs: () => performance.now(),
  };
}

export const audioEngine = new AudioEngine(browserRuntime());

// Dans le build des tests de bout en bout (VITE_E2E=1), window.__audio montre ce que fait le son (game/debug.ts).
if (import.meta.env.VITE_E2E === '1' && typeof window !== 'undefined') {
  const requested: SfxId[] = [];
  const play = audioEngine.playSfx.bind(audioEngine);
  audioEngine.playSfx = (id, options) => {
    requested.push(id);
    play(id, options);
  };
  const debug: AudioDebug = {
    status: () => audioEngine.getSnapshot().status,
    playing: () => audioEngine.getSnapshot().playing,
    sfx: () => [...requested],
  };
  window.__audio = debug;
}
