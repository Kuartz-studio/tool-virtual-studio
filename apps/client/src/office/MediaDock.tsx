import { useId, useRef, useState } from 'react';
import { useAudioStore } from '../audio/audio-store';
import { fr, t } from '../i18n/fr';
import type { MediaClient, MediaSnapshot } from '../media/media-client';
import { DeskButton } from './DeskButton';
import { CameraIcon, MicIcon, MusicIcon, ScreenIcon } from './icons';
import type { PanelControls } from './panels';
import { SoundPopover } from './SoundPopover';
import { IconButton } from './ui/IconButton';

// Le dock du milieu : micro, caméra et partage d'écran, puis après un trait la musique et le bureau.
// - Micro et caméra sont des boutons bascule (aria-pressed) : rouges quand ils sont coupés. Hors conversation, ils règlent l'état voulu pour la
//   suivante (le serveur le montre aux autres) ; rien n'est demandé aux périphériques avant.
// - Le partage d'écran ne se fait que dans une conversation. Le clic l'appelle tout de suite : le navigateur n'ouvre le choix de l'écran que
//   pendant un geste de la personne.
// L'état affiché est celui du client (snapshot), qui décide : un micro refusé dans la room repasse à « coupé ». `micCutBy` : le nom de l'état
// d'activité qui coupe le micro (on n'y est pas entendu) ; le bouton Micro est alors éteint et inactif, avec la raison.
// - La musique ouvre le juke-box (SoundPopover), au-dessus du bouton : enfoncé tant qu'il est ouvert, et barré (en retrait) quand la musique est
//   coupée. Son et ambiances ne sont plus un panneau.
// - Le bouton du bureau (DeskButton) : « Aller à mon bureau » dehors, « Réglages du bureau » dedans ; absent sans bureau.
export function MediaDock({ client, snapshot, panels, micCutBy = null }: { client: MediaClient; snapshot: MediaSnapshot; panels: PanelControls; micCutBy?: string | null }) {
  const { mic, cam, screen } = snapshot.local;
  const musicOn = useAudioStore((state) => state.prefs.musicOn);
  const [jukeOpen, setJukeOpen] = useState(false);
  const jukeId = useId();
  const music = useRef<HTMLButtonElement>(null);
  // Les participants n'arrivent qu'une fois la room rejointe : avant (hors conversation, ou pendant la connexion), pas de partage.
  const inConversation = snapshot.participants.length > 0;
  const screenHint = !inConversation ? fr.media.controls.screenUnavailable : screen ? fr.media.controls.screenStopHint : undefined;
  return (
    <div className="dock dock-media" role="group" aria-label={fr.media.controls.label}>
      <IconButton
        label={fr.media.controls.mic}
        hint={micCutBy !== null ? t(fr.states.micCut, { label: micCutBy }) : undefined}
        pressed={mic}
        tone={mic ? 'default' : 'danger'}
        disabled={micCutBy !== null}
        onClick={() => void client.setMic(!mic)}
      >
        <MicIcon off={!mic} />
      </IconButton>
      <IconButton label={fr.media.controls.cam} pressed={cam} tone={cam ? 'default' : 'danger'} onClick={() => void client.setCam(!cam)}>
        <CameraIcon off={!cam} />
      </IconButton>
      <IconButton
        label={fr.media.controls.screen}
        hint={screenHint}
        pressed={screen}
        tone={screen ? 'accent' : 'default'}
        disabled={!inConversation}
        onClick={() => void client.setScreenShare(!screen)}
      >
        <ScreenIcon />
      </IconButton>
      <span className="dock-rule" aria-hidden="true" />
      <IconButton
        ref={music}
        label={fr.sound.toggle}
        pressed={jukeOpen}
        tone={jukeOpen ? 'accent' : 'default'}
        className={musicOn ? undefined : 'is-muted'}
        aria-haspopup="dialog"
        aria-controls={jukeOpen ? jukeId : undefined}
        data-sfx={jukeOpen ? 'panel-close' : 'panel-open'}
        onClick={() => setJukeOpen((wasOpen) => !wasOpen)}
      >
        <MusicIcon off={!musicOn} />
      </IconButton>
      <DeskButton panels={panels} />
      <SoundPopover open={jukeOpen} onClose={() => setJukeOpen(false)} anchorRef={music} id={jukeId} />
    </div>
  );
}
