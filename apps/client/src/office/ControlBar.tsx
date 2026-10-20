import type { Ref } from 'react';
import { fr } from '../i18n/fr';
import type { MediaClient, MediaSnapshot } from '../media/media-client';
import type { OfficeSocket } from '../net/socket';
import { CameraIcon, MicIcon, ScreenIcon } from './icons';
import { StatusMenu } from './StatusMenu';

// Le bouton d'un panneau de droite (Personnes ; le chat et l'admin viendront) : il dit si le panneau est ouvert, et le bascule.
export interface PanelToggle {
  label: string;
  open: boolean;
  onToggle(): void;
  disabled?: boolean;
  // L'id du panneau, quand il est ouvert (aria-controls).
  panelId?: string;
  // Pour rendre le focus au bouton quand le panneau se ferme.
  buttonRef?: Ref<HTMLButtonElement>;
}

interface ControlBarProps {
  // Le nom de la personne, tel que le serveur le dit (ou celui de la session avant).
  name: string;
  // La connexion au bureau (le menu des statuts lui parle), null avant que la page l'ouvre.
  socket: OfficeSocket | null;
  client: MediaClient;
  snapshot: MediaSnapshot;
  // Les panneaux, dans l'ordre de leurs boutons.
  panels: PanelToggle[];
  onSignOut(): void;
  signingOut: boolean;
}

// La barre de commandes, en bas du bureau : ton nom et ton statut à gauche ; au milieu le micro, la caméra et le partage d'écran ; à
// droite les panneaux et la déconnexion.
// - Micro et caméra sont des boutons bascule (aria-pressed) : enfoncés quand ils sont allumés. Hors conversation, ils règlent l'état
//   voulu pour la suivante (le serveur le montre aux autres) ; rien n'est demandé aux périphériques avant.
// - Le partage d'écran ne se fait que dans une conversation. Le clic l'appelle tout de suite : le navigateur n'ouvre le choix de
//   l'écran que pendant un geste de la personne.
// L'état affiché est celui du client (snapshot), qui décide : un micro refusé dans la room repasse à « coupé ».
export function ControlBar({ name, socket, client, snapshot, panels, onSignOut, signingOut }: ControlBarProps) {
  const { mic, cam, screen } = snapshot.local;
  // Les participants n'arrivent qu'une fois la room rejointe : avant (hors conversation, ou pendant la connexion), pas de partage.
  const inConversation = snapshot.participants.length > 0;
  const screenTitle = !inConversation ? fr.media.controls.screenUnavailable : screen ? fr.media.controls.screenStopHint : fr.media.controls.screenHint;

  return (
    <div className="office-bar" role="group" aria-label={fr.office.barLabel}>
      <div className="office-bar-start">
        <span className="office-user" title={name}>
          {name}
        </span>
        <StatusMenu socket={socket} />
      </div>
      <div className="office-bar-center">
        <div className="media-controls" role="group" aria-label={fr.media.controls.label}>
          <button
            type="button"
            className="bar-button media-button"
            aria-pressed={mic}
            title={mic ? fr.media.controls.micOnHint : fr.media.controls.micOffHint}
            onClick={() => void client.setMic(!mic)}
          >
            <MicIcon off={!mic} />
            <span>{fr.media.controls.mic}</span>
          </button>
          <button
            type="button"
            className="bar-button media-button"
            aria-pressed={cam}
            title={cam ? fr.media.controls.camOnHint : fr.media.controls.camOffHint}
            onClick={() => void client.setCam(!cam)}
          >
            <CameraIcon off={!cam} />
            <span>{fr.media.controls.cam}</span>
          </button>
          <button
            type="button"
            className="bar-button media-button media-share"
            aria-pressed={screen}
            title={screenTitle}
            disabled={!inConversation}
            onClick={() => void client.setScreenShare(!screen)}
          >
            <ScreenIcon />
            <span>{fr.media.controls.screen}</span>
          </button>
        </div>
      </div>
      <div className="office-bar-end">
        {panels.map((panel) => (
          <button
            key={panel.label}
            ref={panel.buttonRef}
            type="button"
            className="bar-button"
            aria-expanded={panel.open}
            aria-controls={panel.open ? panel.panelId : undefined}
            disabled={panel.disabled}
            onClick={panel.onToggle}
          >
            {panel.label}
          </button>
        ))}
        <button type="button" className="bar-button" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? fr.office.signingOut : fr.office.signOut}
        </button>
      </div>
    </div>
  );
}
