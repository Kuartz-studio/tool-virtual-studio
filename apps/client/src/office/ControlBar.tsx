import type { ReactNode, Ref } from 'react';
import { useAudioStore } from '../audio/audio-store';
import { fr, t } from '../i18n/fr';
import type { MediaClient, MediaSnapshot } from '../media/media-client';
import type { OfficeSocket } from '../net/socket';
import { CameraIcon, LogOutIcon, MicIcon, ScreenIcon, VolumeIcon } from './icons';
import { StatusMenu } from './StatusMenu';

// Le bouton d'un panneau de droite (Chat, Personnes, et Admin pour un admin) : il dit si le panneau est ouvert, et le bascule.
export interface PanelToggle {
  label: string;
  // L'icône du bouton (décorative : le libellé dit tout), à gauche de son texte.
  icon?: ReactNode;
  // Un panneau qu'on ouvre moins souvent : quand la barre manque de place, son bouton n'a plus que son icône (le nom reste en infobulle).
  secondary?: boolean;
  open: boolean;
  onToggle(): void;
  disabled?: boolean;
  // L'id du panneau, quand il est ouvert (aria-controls).
  panelId?: string;
  // Pour rendre le focus au bouton quand le panneau se ferme.
  buttonRef?: Ref<HTMLButtonElement>;
  // Un compteur sur le bouton (les messages non lus du chat), à partir de 1 : `count` s'affiche (« 99+ » au-delà de 99), et `label`
  // est ce qu'un lecteur d'écran en entend (« 3 nouveaux messages »), ajouté au nom du bouton.
  badge?: { count: number; label: string };
}

// Le plus grand nombre écrit sur un compteur.
const BADGE_MAX = 99;

interface ControlBarProps {
  // Le nom de la personne, tel que le serveur le dit (ou celui de la session avant).
  name: string;
  // La connexion au bureau (le menu des statuts lui parle), null avant que la page l'ouvre.
  socket: OfficeSocket | null;
  client: MediaClient;
  snapshot: MediaSnapshot;
  // Les panneaux, dans l'ordre de leurs boutons.
  panels: PanelToggle[];
  // Le panneau Son, dont le bouton est à côté du micro et de la caméra.
  sound?: PanelToggle;
  // « Mes états d'activité… », au bas du menu des statuts : ouvre le panneau où l'on crée ses états.
  onManageStates?(): void;
  // Le nom de l'état d'activité qui coupe le micro (on n'y est pas entendu) : le bouton Micro est alors éteint et inactif. null : aucun.
  micCutBy?: string | null;
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
export function ControlBar({ name, socket, client, snapshot, panels, sound, onManageStates, micCutBy = null, onSignOut, signingOut }: ControlBarProps) {
  const { mic, cam, screen } = snapshot.local;
  // Le bouton Son montre un haut-parleur barré quand ni la musique ni les effets ne sonnent.
  const silent = useAudioStore((state) => !state.prefs.musicOn && !state.prefs.sfxOn);
  // Les participants n'arrivent qu'une fois la room rejointe : avant (hors conversation, ou pendant la connexion), pas de partage.
  const inConversation = snapshot.participants.length > 0;
  const screenTitle = !inConversation ? fr.media.controls.screenUnavailable : screen ? fr.media.controls.screenStopHint : fr.media.controls.screenHint;

  return (
    <div className="office-bar" role="group" aria-label={fr.office.barLabel}>
      <div className="office-bar-start">
        <span className="office-user" title={name}>
          {name}
        </span>
        <StatusMenu socket={socket} onManage={onManageStates} />
      </div>
      <div className="office-bar-center">
        <div className="media-controls" role="group" aria-label={fr.media.controls.label}>
          <button
            type="button"
            className="bar-button media-button"
            aria-pressed={mic}
            title={micCutBy !== null ? t(fr.states.micCut, { label: micCutBy }) : mic ? fr.media.controls.micOnHint : fr.media.controls.micOffHint}
            disabled={micCutBy !== null}
            onClick={() => void client.setMic(!mic)}
          >
            <MicIcon off={!mic} />
            <span className="bar-label">{fr.media.controls.mic}</span>
          </button>
          <button
            type="button"
            className="bar-button media-button"
            aria-pressed={cam}
            title={cam ? fr.media.controls.camOnHint : fr.media.controls.camOffHint}
            onClick={() => void client.setCam(!cam)}
          >
            <CameraIcon off={!cam} />
            <span className="bar-label">{fr.media.controls.cam}</span>
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
            <span className="bar-label">{fr.media.controls.screen}</span>
          </button>
        </div>
        {sound && (
          <div className="media-controls" role="group" aria-label={fr.sound.title}>
            <button
              ref={sound.buttonRef}
              type="button"
              className="bar-button media-button"
              title={sound.label}
              aria-expanded={sound.open}
              aria-controls={sound.open ? sound.panelId : undefined}
              onClick={sound.onToggle}
            >
              <VolumeIcon off={silent} />
              <span className="bar-label">{sound.label}</span>
            </button>
          </div>
        )}
      </div>
      <div className="office-bar-end">
        {panels.map((panel) => {
          const badge = panel.badge && panel.badge.count > 0 ? panel.badge : null;
          return (
            <button
              key={panel.label}
              ref={panel.buttonRef}
              type="button"
              className={panel.secondary ? 'bar-button bar-button-secondary' : 'bar-button'}
              title={panel.label}
              aria-expanded={panel.open}
              aria-controls={panel.open ? panel.panelId : undefined}
              aria-label={badge ? `${panel.label}, ${badge.label}` : undefined}
              disabled={panel.disabled}
              onClick={panel.onToggle}
            >
              {panel.icon}
              <span className="bar-label">{panel.label}</span>
              {/* Décoratif : le nom du bouton dit déjà le nombre. */}
              {badge && (
                <span className="bar-badge" aria-hidden="true">
                  {badge.count > BADGE_MAX ? `${BADGE_MAX}+` : badge.count}
                </span>
              )}
            </button>
          );
        })}
        <button type="button" className="bar-button bar-button-quiet" title={fr.office.signOut} onClick={onSignOut} disabled={signingOut}>
          <LogOutIcon />
          <span className="bar-label">{signingOut ? fr.office.signingOut : fr.office.signOut}</span>
        </button>
      </div>
    </div>
  );
}
