import type { GroupingState } from '@bureau/shared';
import type { ArenaController } from '../arena/arena-controller';
import type { MediaBackend } from '../media/livekit';
import { createAudioLibrary, type AudioLibrary } from './audio-library';
import { SimBots, type SimBotsDeps } from './bots';
import { createSimBackend } from './sim-backend';
import { Sparring } from './sparring';

// Ce que le faux live (SIM=1) met en place, et que se partagent l'application (les routes /api/sim) et le temps réel (le monde, les
// groupes, les rooms). Les routes sont montées avant le temps réel, qui a besoin du serveur HTTP : `bots` reste donc null jusqu'à start().
export interface SimHost {
  /** Le faux LiveKit, que le coordinateur des rooms utilise à la place du vrai. */
  readonly backend: MediaBackend;
  readonly audio: AudioLibrary;
  /** Les personnes fictives : null tant que le temps réel n'est pas là. */
  bots: SimBots | null;
  /** Le sparring de l'octogone : null tant que le temps réel n'est pas là. */
  sparring: Sparring | null;
  /** Le temps réel est attaché : les personnes fictives peuvent entrer dans son monde. */
  start(d: Omit<SimBotsDeps, 'audio'> & { arena: ArenaController }): void;
  /** Les groupes viennent d'être recalculés. */
  onGroups(state: GroupingState): void;
  stop(): void;
}

export function createSimHost(env: { SIM_AUDIO_DIR: string }): SimHost {
  const host: SimHost = {
    backend: createSimBackend(),
    audio: createAudioLibrary(env.SIM_AUDIO_DIR),
    bots: null,
    sparring: null,
    start(d) {
      host.bots = new SimBots({ ...d, audio: host.audio });
      host.bots.start();
      host.sparring = new Sparring({ bots: host.bots, arena: d.arena, world: d.world, now: d.now, logger: d.logger });
      host.sparring.start();
    },
    onGroups(state) {
      host.bots?.onGroups(state);
    },
    stop() {
      host.sparring?.stop();
      host.bots?.stop();
    },
  };
  return host;
}
