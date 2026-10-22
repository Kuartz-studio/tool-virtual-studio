import { afterEach, describe, expect, test, vi } from 'vitest';
import { exposeDebug, type OfficeDebug } from './debug';

const debug = (): OfficeDebug => ({
  ready: true,
  self: null,
  players: {},
  media: { room: null, tiles: 0, speak: () => {} },
  teleport: () => {},
  boost: () => {},
  boosted: () => false,
  speed: () => 0,
  showOthers: () => {},
  bubbles: () => [],
  cups: () => [],
  machineExcited: () => false,
  avatarsOf: () => 0,
  selfAvatar: () => null,
  toScreen: (x, y) => ({ x, y }),
  editorRoom: () => null,
  zoom: () => 2,
  nightLevel: () => 0,
  autoWalking: () => false,
  doors: () => ({}),
});

afterEach(() => {
  delete window.__office;
  vi.unstubAllEnvs();
});

describe('exposeDebug', () => {
  test('dans le build des tests de bout en bout (VITE_E2E=1) : window.__office est l\'objet donné, et il reste vivant', () => {
    vi.stubEnv('VITE_E2E', '1');
    const handle = debug();
    exposeDebug(handle);
    expect(window.__office).toBe(handle);
    // La scène le met à jour au fil du jeu : le test lit toujours l'état du moment.
    handle.ready = false;
    expect(window.__office?.ready).toBe(false);
  });

  test.each(['', '0', 'true', 'yes'])('VITE_E2E=%j : rien n\'est exposé', (value) => {
    vi.stubEnv('VITE_E2E', value);
    exposeDebug(debug());
    expect(window.__office).toBeUndefined();
  });

  test('VITE_E2E absent (build de production) : rien n\'est exposé', () => {
    vi.stubEnv('VITE_E2E', undefined);
    exposeDebug(debug());
    expect(window.__office).toBeUndefined();
  });
});
