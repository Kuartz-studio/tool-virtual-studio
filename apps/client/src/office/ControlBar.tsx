import { useAudioStore } from '../audio/audio-store';
import { fr } from '../i18n/fr';
import type { MediaClient, MediaSnapshot } from '../media/media-client';
import type { OfficeSocket } from '../net/socket';
import { DeskIcon, LogOutIcon, ShirtIcon, VolumeIcon } from './icons';
import { MediaDock } from './MediaDock';
import type { PanelControls } from './panels';
import { SocialDock, type MoreEntry } from './SocialDock';
import { StatusMenu } from './StatusMenu';
import { ZoomDock } from './ZoomDock';

interface ControlBarProps {
  // Le nom de la personne, tel que le serveur le dit (ou celui de la session avant).
  name: string;
  // La connexion au bureau (le menu des statuts lui parle), null avant que la page l'ouvre.
  socket: OfficeSocket | null;
  client: MediaClient;
  snapshot: MediaSnapshot;
  // Comment ouvrir et fermer les panneaux (la coque les tient : un seul est ouvert à la fois).
  panels: PanelControls;
  // Le nom de l'état d'activité qui coupe le micro (on n'y est pas entendu) : le bouton Micro est alors éteint et inactif. null : aucun.
  micCutBy?: string | null;
  onSignOut(): void;
  signingOut: boolean;
}

// La barre du bas, en docks : à gauche ton nom et ton statut ; au milieu le micro, la caméra, le partage d'écran et les réactions ; à droite
// le zoom, puis le chat, les personnes et le menu « Plus ». Chaque dock est une surface pleine posée sur le jeu ; la barre elle-même ne
// prend aucune place (elle laisse passer la souris entre les docks).
//
// En attendant la puce « Moi » (qui prendra le dock de gauche), le menu « Plus » garde aussi ce qui n'a plus de bouton : Mon bureau,
// Personnage, Son, et Se déconnecter. Elles sont dans le menu « Plus » et non dans celui des statuts : celui-ci est inactif tant que le serveur
// n'a pas répondu, et on doit pouvoir se déconnecter, et couper le son, sans lui.
export function ControlBar({ name, socket, client, snapshot, panels, micCutBy = null, onSignOut, signingOut }: ControlBarProps) {
  // Le haut-parleur du Son est barré quand ni la musique ni les effets ne sonnent.
  const silent = useAudioStore((state) => !state.prefs.musicOn && !state.prefs.sfxOn);

  const extras: MoreEntry[] = [
    { key: 'desk', label: fr.desk.toggle, icon: <DeskIcon />, disabled: !panels.ready, panel: true, run: (opener) => panels.show('desk', opener) },
    { key: 'character', label: fr.character.toggle, icon: <ShirtIcon />, disabled: !panels.ready, panel: true, run: (opener) => panels.show('character', opener) },
    { key: 'sound', label: fr.sound.toggle, icon: <VolumeIcon off={silent} />, panel: true, run: (opener) => panels.show('sound', opener) },
    { key: 'sign-out', label: signingOut ? fr.office.signingOut : fr.office.signOut, icon: <LogOutIcon />, disabled: signingOut, run: () => onSignOut() },
  ];

  return (
    <div className="office-bar" role="group" aria-label={fr.office.barLabel}>
      <div className="dock dock-me">
        <span className="office-user" title={name}>
          {name}
        </span>
        <StatusMenu socket={socket} onManage={(opener) => panels.show('states', opener)} />
      </div>
      <MediaDock client={client} snapshot={snapshot} micCutBy={micCutBy} />
      <div className="office-bar-end">
        <ZoomDock />
        <SocialDock panels={panels} extras={extras} />
      </div>
    </div>
  );
}
