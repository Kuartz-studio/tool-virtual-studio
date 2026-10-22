import { roomSceneOf, type RoomMusic } from '@bureau/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { SceneId } from './catalog';
import type { EngineSnapshot } from './engine';
import { loadAudioPrefs, saveAudioPrefs, type AudioPrefs } from './prefs';
import { OUTSIDE_SCENE } from './scene-at';

// Ce que l'interface (React) sait du son : les réglages de la personne (gardés dans le navigateur), l'état du moteur (AudioEngine), et
// où l'on est (l'ambiance par défaut de l'endroit, et sa pièce réglable). AudioDirector fait le lien entre ce magasin, le moteur et le bureau ; le panneau Son le lit
// et l'écrit. La musique que ceux qui sont dans la pièce ont réglée n'est pas ici : elle est au magasin du bureau (`music`).

export interface AudioState {
  prefs: AudioPrefs;
  // Ce que dit le moteur : `locked` tant que le navigateur n'a pas laissé démarrer le son, `unsupported` sans Web Audio.
  status: EngineSnapshot['status'];
  // L'ambiance qu'on entend (ou qui monte) ; null quand la musique est coupée.
  playing: SceneId | null;
  // L'ambiance par défaut de l'endroit où l'on est (scene-at.ts), quand la personne a laissé le choix à « auto » et que personne n'a réglé la pièce.
  place: SceneId;
  // La pièce où l'on est, si on y règle la musique (elle a une enceinte : `game`, `desk:A1`) ; null sinon, et partout hors du bureau.
  placeKey: string | null;
  // Change des réglages (et les enregistre).
  setPrefs(patch: Partial<AudioPrefs>): void;
  setPlace(scene: SceneId, key?: string | null): void;
  setEngine(snapshot: EngineSnapshot): void;
}

// L'ambiance à jouer : aucune quand la musique est coupée ; sinon celle que la personne a choisie dans le panneau Son (son casque : elle passe avant la pièce, éteinte
// ou non) ; sinon celle de la pièce, telle que ceux qui y sont l'ont réglée (`music`, par clé de lieu) : son ambiance par défaut, la leur, ou le silence si elle est éteinte.
// Un endroit sans enceinte (`placeKey` null) joue toujours son ambiance par défaut.
export function selectWantedScene(state: Pick<AudioState, 'prefs' | 'place' | 'placeKey'>, music: Readonly<Record<string, RoomMusic>>): SceneId | null {
  if (!state.prefs.musicOn) return null;
  if (state.prefs.scene !== 'auto') return state.prefs.scene;
  return roomSceneOf({ scene: state.place, music: state.placeKey !== null }, state.placeKey === null ? undefined : music[state.placeKey]);
}

// Un magasin neuf (les tests en créent un chacun) ; l'appli utilise useAudioStore.
export function createAudioStore(): UseBoundStore<StoreApi<AudioState>> {
  return create<AudioState>()((set, get) => ({
    prefs: loadAudioPrefs(),
    status: 'locked',
    playing: null,
    place: OUTSIDE_SCENE,
    placeKey: null,

    setPrefs: (patch) => {
      const prefs = { ...get().prefs, ...patch };
      saveAudioPrefs(prefs);
      set({ prefs });
    },
    setPlace: (place, placeKey = null) => set((state) => (state.place === place && state.placeKey === placeKey ? state : { place, placeKey })),
    setEngine: ({ status, playing }) => set((state) => (state.status === status && state.playing === playing ? state : { status, playing })),
  }));
}

export const useAudioStore: UseBoundStore<StoreApi<AudioState>> = createAudioStore();
