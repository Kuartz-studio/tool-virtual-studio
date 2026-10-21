import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { SceneId } from './catalog';
import type { EngineSnapshot } from './engine';
import { loadAudioPrefs, saveAudioPrefs, type AudioPrefs } from './prefs';
import { OUTSIDE_SCENE } from './scene-at';

// Ce que l'interface (React) sait du son : les réglages de la personne (gardés dans le navigateur), l'état du moteur (AudioEngine), et
// l'ambiance que le lieu demande. AudioDirector fait le lien entre ce magasin, le moteur et le bureau ; le panneau Son le lit et l'écrit.
export interface AudioState {
  prefs: AudioPrefs;
  // Ce que dit le moteur : `locked` tant que le navigateur n'a pas laissé démarrer le son, `unsupported` sans Web Audio.
  status: EngineSnapshot['status'];
  // L'ambiance qu'on entend (ou qui monte) ; null quand la musique est coupée.
  playing: SceneId | null;
  // L'ambiance que demande l'endroit où l'on est (scene-at.ts), quand la personne a laissé le choix à « auto ».
  place: SceneId;
  // Change des réglages (et les enregistre).
  setPrefs(patch: Partial<AudioPrefs>): void;
  setPlace(scene: SceneId): void;
  setEngine(snapshot: EngineSnapshot): void;
}

// L'ambiance à jouer : aucune quand la musique est coupée ; sinon celle que la personne a choisie, ou celle du lieu.
export function selectWantedScene(state: Pick<AudioState, 'prefs' | 'place'>): SceneId | null {
  if (!state.prefs.musicOn) return null;
  return state.prefs.scene === 'auto' ? state.place : state.prefs.scene;
}

// Un magasin neuf (les tests en créent un chacun) ; l'appli utilise useAudioStore.
export function createAudioStore(): UseBoundStore<StoreApi<AudioState>> {
  return create<AudioState>()((set, get) => ({
    prefs: loadAudioPrefs(),
    status: 'locked',
    playing: null,
    place: OUTSIDE_SCENE,

    setPrefs: (patch) => {
      const prefs = { ...get().prefs, ...patch };
      saveAudioPrefs(prefs);
      set({ prefs });
    },
    setPlace: (place) => set((state) => (state.place === place ? state : { place })),
    setEngine: ({ status, playing }) => set((state) => (state.status === status && state.playing === playing ? state : { status, playing })),
  }));
}

export const useAudioStore: UseBoundStore<StoreApi<AudioState>> = createAudioStore();
