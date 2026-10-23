import { ACTIVITY_MAX_PER_USER, type ActivityState, type OfficeMap, type Status } from '@bureau/shared';
import type { CSSProperties, ReactNode } from 'react';
import { fr, t } from '../i18n/fr';
import { statusCssColor } from '../lib/status';
import { ActivityMark } from './ActivityMark';
import { CheckIcon, PencilIcon, PlaceIcon, PlusIcon } from './icons';
import { StatusDot } from './StatusDot';

export interface ModeListProps {
  // Le statut en cours (null : pas encore connu), et le mode qu'on a pris (null : aucun).
  status: Status | null;
  activity: ActivityState | null;
  // Ses modes, ceux par défaut compris, dans l'ordre où ils ont été créés.
  myStates: readonly ActivityState[];
  // La carte, pour le nom de la pièce où un mode conduit.
  map: OfficeMap | null;
  // La connexion est prête : rien ne part au serveur sans elle.
  enabled: boolean;
  onStatus(status: Status): void;
  onMode(state: ActivityState): void;
  // Ouvrir l'éditeur, dans le menu même : pour ce mode, ou pour un nouveau.
  onEdit(state: ActivityState): void;
  onCreate(): void;
}

// Une ligne : la marque (un carré arrondi de la couleur du mode), le nom, la pièce où le mode conduit, et la coche quand c'est elle qui est prise. C'est un bouton
// radio du menu (MeMenu le parcourt aux flèches), nommé par le seul nom du mode. Un mode a, à droite, son crayon : une ligne du menu elle aussi, qui ouvre l'éditeur.
function Row({ id, label, color, mark, place, checked, enabled, onPick, onEdit }: {
  id: string;
  label: string;
  color: string;
  mark: ReactNode;
  place?: string | undefined;
  checked: boolean;
  enabled: boolean;
  onPick(): void;
  onEdit?(): void;
}) {
  return (
    <div className="mode-row" data-mode={id} data-checked={checked ? '' : undefined}>
      <button type="button" role="menuitemradio" aria-checked={checked} aria-label={label} tabIndex={-1} className="mode-pick" disabled={!enabled} onClick={onPick}>
        <span className="mode-mark" style={{ '--mode': color } as CSSProperties}>
          {mark}
        </span>
        <span className="mode-name" title={label}>
          {label}
        </span>
        {place !== undefined && (
          <span className="mode-place" title={t(fr.modes.placeIn, { place })}>
            <PlaceIcon />
            <span>{place}</span>
          </span>
        )}
        {checked && (
          <span className="mode-check">
            <CheckIcon />
          </span>
        )}
      </button>
      {onEdit && (
        <button type="button" role="menuitem" tabIndex={-1} className="mode-edit" aria-label={t(fr.modes.edit, { label })} title={t(fr.modes.edit, { label })} disabled={!enabled} onClick={onEdit}>
          <PencilIcon />
        </button>
      )}
    </div>
  );
}

// Les modes du menu « Moi », en une seule liste : d'abord Disponible, l'état normal (aucun mode), qui ne se modifie pas, puis ses modes (Manger, Sport,
// Concentration, que le compte a reçus, et ceux qu'il a créés : tous se modifient et se suppriment, au crayon), et « Nouveau mode ». Occupé, Absent et Ne pas
// déranger ne s'y choisissent plus : un statut laissé par une version d'avant se lit encore (sur la puce, au-dessus de la tête) et Disponible le quitte. Une seule
// ligne est cochée : le mode pris, sinon Disponible quand c'est le statut. Prendre Disponible quitte le mode (le serveur l'efface).
export function ModeList({ status, activity, myStates, map, enabled, onStatus, onMode, onEdit, onCreate }: ModeListProps) {
  // Le nom de la pièce où ce mode conduit : une destination de cette carte, sinon rien (il ne conduit nulle part ici).
  const placeOf = (state: ActivityState) => (state.place === undefined ? undefined : map?.places.find((place) => place.key === state.place && place.destination)?.label);
  const full = myStates.length >= ACTIVITY_MAX_PER_USER;
  return (
    <div className="mode-list">
      <Row
        id="status:available"
        label={fr.status.available}
        color={statusCssColor('available')}
        mark={<StatusDot status="available" />}
        checked={activity === null && status === 'available'}
        enabled={enabled}
        onPick={() => onStatus('available')}
      />
      {myStates.map((state) => (
        <Row
          key={state.id}
          id={state.id}
          label={state.label}
          color={state.color}
          mark={<ActivityMark activity={state} />}
          place={placeOf(state)}
          checked={activity?.id === state.id}
          enabled={enabled}
          onPick={() => onMode(state)}
          onEdit={() => onEdit(state)}
        />
      ))}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="mode-pick mode-new"
        disabled={!enabled || full}
        title={full ? t(fr.states.errors.limit, { max: ACTIVITY_MAX_PER_USER }) : undefined}
        onClick={onCreate}
      >
        <span className="mode-mark">
          <PlusIcon />
        </span>
        <span className="mode-name">{fr.modes.create}</span>
      </button>
    </div>
  );
}
