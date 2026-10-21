import { fr } from '../i18n/fr';
import type { MediaClient, MediaSnapshot } from '../media/media-client';
import type { OfficeSocket } from '../net/socket';
import { MeChip } from './MeChip';
import { MediaDock } from './MediaDock';
import type { PanelControls } from './panels';
import { SocialDock } from './SocialDock';
import { ZoomDock } from './ZoomDock';

interface ControlBarProps {
  // Le nom de la personne, tel que le serveur le dit (ou celui de la session avant), et son e-mail.
  name: string;
  email: string;
  // La connexion au bureau (le menu « Moi » lui parle), null avant que la page l'ouvre.
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

// La barre du bas, en docks : à gauche la puce « Moi » (ton portrait, ton nom, ton mode ou ton statut, et son menu) ; au milieu le micro, la
// caméra et le partage d'écran, puis la musique (le juke-box) et le bouton du bureau ; à droite le zoom, puis le chat, les personnes et le menu
// « Plus ». Chaque dock est une surface pleine posée sur le jeu ; la barre elle-même ne prend aucune place (elle laisse passer la souris entre
// les docks).
//
// L'apparence, le statut, le mode et la déconnexion sont dans le menu de la puce « Moi », et non dans « Plus » : celui-ci s'ouvre sans le serveur,
// pour qu'on puisse se déconnecter avant qu'il ait répondu (MeMenu n'éteint que ce qui en dépend). Le son et le bureau sont dans le dock du milieu.
export function ControlBar({ name, email, socket, client, snapshot, panels, micCutBy = null, onSignOut, signingOut }: ControlBarProps) {
  return (
    <div className="office-bar" role="group" aria-label={fr.office.barLabel}>
      <MeChip name={name} email={email} socket={socket} panels={panels} onSignOut={onSignOut} signingOut={signingOut} />
      <MediaDock client={client} snapshot={snapshot} panels={panels} micCutBy={micCutBy} />
      <div className="office-bar-end">
        <ZoomDock />
        <SocialDock panels={panels} />
      </div>
    </div>
  );
}
