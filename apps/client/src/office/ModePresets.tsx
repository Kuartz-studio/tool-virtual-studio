import { NORMAL_COLOR, PRESET_MODES, type ActivityState } from '@bureau/shared';
import type { CSSProperties, ReactNode } from 'react';
import { fr } from '../i18n/fr';
import { ActivityMark } from './ActivityMark';
import { PlusIcon } from './icons';

export interface ModePresetsProps {
  // Le mode qu'on a pris (un mode tout prêt, ou l'un des siens) ; null : Normal, aucun mode.
  activity: ActivityState | null;
  // Ses propres modes, dans l'ordre où elle les a créés.
  myStates: readonly ActivityState[];
  // La connexion est prête : rien ne part au serveur sans elle.
  enabled: boolean;
  // Choisir ce mode (null : Normal).
  onChoose(state: ActivityState | null): void;
  // Ouvrir le panneau où l'on crée et modifie ses modes.
  onManage(): void;
}

// Une tuile ronde à la manière d'Apple : un disque de la couleur du mode, avec son icône, et son nom dessous ; la tuile choisie est cerclée de sa couleur (le CSS
// lit `--tile`). Les tuiles sont des boutons radio d'un menu (celui de la puce « Moi » : MeMenu les parcourt aux flèches), dont un seul est coché.
function Tile({ color, label, hint, checked, enabled, onClick, children }: { color: string; label: string; hint?: string; checked: boolean; enabled: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} tabIndex={-1} className="mode-tile" style={{ '--tile': color } as CSSProperties} title={hint} disabled={!enabled} onClick={onClick}>
      <span className="mode-tile-disc">{children}</span>
      <span className="mode-tile-name">{label}</span>
    </button>
  );
}

// Les modes de la puce « Moi » : « Normal » (aucun mode, la tuile verte), les modes tout prêts (Concentration, Sport), puis « Mes modes » : les siens, et une tuile « + » pour en
// créer. Choisir un mode le prend (le serveur le confirme) ; Normal revient au statut ordinaire.
export function ModePresets({ activity, myStates, enabled, onChoose, onManage }: ModePresetsProps) {
  return (
    <>
      <div className="mode-tiles">
        <Tile color={NORMAL_COLOR} label={fr.modes.normal} hint={fr.modes.normalHint} checked={activity === null} enabled={enabled} onClick={() => onChoose(null)}>
          <ActivityMark activity={{ id: 'normal', color: NORMAL_COLOR, icon: 'check' }} />
        </Tile>
        {PRESET_MODES.map((mode) => (
          <Tile key={mode.id} color={mode.color} label={mode.label} hint={mode.id === 'preset:sport' ? fr.modes.presetHints.sport : fr.modes.presetHints.focus} checked={activity?.id === mode.id} enabled={enabled} onClick={() => onChoose(mode)}>
            <ActivityMark activity={mode} />
          </Tile>
        ))}
      </div>
      <div className="me-label">
        <span>{fr.modes.mine}</span>
      </div>
      <div className="mode-tiles">
        {myStates.map((state) => (
          <Tile key={state.id} color={state.color} label={state.label} hint={state.label} checked={activity?.id === state.id} enabled={enabled} onClick={() => onChoose(state)}>
            <ActivityMark activity={state} />
          </Tile>
        ))}
        <button type="button" role="menuitem" tabIndex={-1} className="mode-tile is-add" aria-label={fr.modes.create} title={fr.modes.create} disabled={!enabled} onClick={onManage}>
          <span className="mode-tile-disc">
            <PlusIcon />
          </span>
          <span className="mode-tile-name" aria-hidden="true">
            {fr.modes.create}
          </span>
        </button>
      </div>
    </>
  );
}
