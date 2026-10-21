import { useAudioStore } from '../audio/audio-store';
import { fr } from '../i18n/fr';
import { MusicIcon } from './icons';

// Un interrupteur de la musique, pour les pages sans barre du bureau (connexion, invitation, écran d'entrée) : la salle d'attente y joue
// dès le premier clic, et la personne doit pouvoir la couper sans entrer. Il garde le même réglage que le panneau Son.
export function MusicToggle() {
  const musicOn = useAudioStore((state) => state.prefs.musicOn);
  const setPrefs = useAudioStore((state) => state.setPrefs);
  return (
    <button type="button" className="music-toggle" aria-pressed={musicOn} onClick={() => setPrefs({ musicOn: !musicOn })}>
      <MusicIcon off={!musicOn} />
      <span>{fr.sound.music.label}</span>
    </button>
  );
}
