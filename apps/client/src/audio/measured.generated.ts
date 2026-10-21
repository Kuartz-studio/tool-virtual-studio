// Généré par `pnpm --filter @bureau/client gen:audio` (scripts/audio/build-audio.ts) : ne pas modifier à la main.
// gain : le rapport d'amplitude qui ramène le son au niveau visé (1 = inchangé) ; seconds : sa durée.

export const MEASURED_MUSIC = {
  focus: { gain: 0.759, seconds: 53.333 },
  drift: { gain: 0.902, seconds: 32.842 },
  sunny: { gain: 0.871, seconds: 21.818 },
  lobby: { gain: 0.603, seconds: 24.304 },
  dusk: { gain: 0.813, seconds: 36.852 },
  quest: { gain: 0.733, seconds: 15 },
} as const;

export const MEASURED_SFX = {
  click: { gain: 3.413, seconds: 0.177 },
  'toggle-on': { gain: 0.546, seconds: 0.476 },
  'toggle-off': { gain: 0.457, seconds: 0.43 },
  'panel-open': { gain: 0.516, seconds: 0.232 },
  'panel-close': { gain: 0.427, seconds: 0.221 },
  'conversation-start': { gain: 0.526, seconds: 0.186 },
  'conversation-end': { gain: 0.377, seconds: 0.29 },
  cancel: { gain: 0.571, seconds: 0.152 },
  welcome: { gain: 1.061, seconds: 3.022 },
  arrive: { gain: 1.777, seconds: 1.29 },
  message: { gain: 1.54, seconds: 1.365 },
  success: { gain: 0.925, seconds: 2.299 },
  error: { gain: 1.79, seconds: 1.498 },
  lost: { gain: 0.489, seconds: 1.862 },
  knock: { gain: 0.251, seconds: 0.372 },
} as const;
