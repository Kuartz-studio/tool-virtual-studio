import { useAudioStore } from '../audio/audio-store';
import { fr } from '../i18n/fr';
import { MusicIcon } from './icons';
import { IconButton } from './ui/IconButton';

// Le bouton de la musique des pages sans barre du bureau (connexion, invitation, écran d'entrée), dans l'en-tête de leur carte : une note, rien
// d'autre à l'écran, nommée « Musique » (son nom est aussi son infobulle). La salle d'attente y joue dès le premier clic, et la personne doit pouvoir
// la couper sans entrer. Il garde le même réglage que le juke-box du bureau : enfoncé quand la musique joue, et, coupée, sa note est barrée et lui en
// retrait.
export function MusicToggle() {
  const musicOn = useAudioStore((state) => state.prefs.musicOn);
  const setPrefs = useAudioStore((state) => state.setPrefs);
  return (
    <IconButton label={fr.sound.music.label} pressed={musicOn} tip="bottom" className={musicOn ? 'music-toggle' : 'music-toggle is-muted'} onClick={() => setPrefs({ musicOn: !musicOn })}>
      <MusicIcon off={!musicOn} />
    </IconButton>
  );
}
