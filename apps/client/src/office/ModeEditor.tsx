import { ACTIVITY_ICONS, ACTIVITY_LABEL_MAX_LENGTH, ACTIVITY_MAX_PER_USER, type ActivityIcon, type ActivityInput, type ActivityState, type OfficeMap } from '@bureau/shared';
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { ApiError } from '../lib/api';
import { createActivityState, deleteActivityState, updateActivityState } from '../lib/activity-api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { ActivityMark } from './ActivityMark';
import { ACTIVITY_ICON_COMPONENTS } from './activity-icons';
import { BackIcon, TrashIcon } from './icons';
import { PlacePicker } from './PlacePicker';

// Les couleurs toutes prêtes d'un mode (la couleur libre reste possible : le sélecteur du navigateur). Elles évitent celles des statuts (vert, orange, gris, rouge),
// qu'un mode ne se confonde pas avec Disponible, Occupé, Absent ou Ne pas déranger.
export const MODE_SWATCHES = ['#6d28d9', '#2f5fd0', '#0ea5e9', '#0d9488', '#ec4899', '#f97316', '#a16207', '#475569'] as const;

const NEW_MODE: ActivityInput = { label: '', color: MODE_SWATCHES[1], allowEntry: true, hear: true, heard: true };

// Pourquoi une requête sur les modes a échoué, en toutes lettres.
function errorText(err: unknown): string {
  if (err instanceof ApiError && err.error === 'limit') return t(fr.states.errors.limit, { max: ACTIVITY_MAX_PER_USER });
  if (err instanceof ApiError && err.error === 'invalid') return fr.states.errors.invalid;
  if (err instanceof ApiError && err.error === 'not_found') return fr.states.errors.not_found;
  return fr.states.errors.generic;
}

// Le formulaire d'un mode existant : ses champs, sans son identifiant. Un emplacement qui n'est pas une destination de cette carte (un mode venu d'une autre carte)
// en part : la route le refuserait, et le mode ne conduirait nulle part ici.
function formOf(state: ActivityState, map: OfficeMap | null): ActivityInput {
  const { id: _id, icon, place, ...rest } = state;
  const reachable = place !== undefined && map?.places.some((candidate) => candidate.key === place && candidate.destination) === true;
  return { ...rest, ...(icon && { icon }), ...(reachable && { place }) };
}

export interface ModeEditorProps {
  // Le mode à modifier, ou null : un nouveau.
  state: ActivityState | null;
  map: OfficeMap | null;
  // Fini (enregistré, supprimé ou abandonné) : la liste revient, le focus sur ce mode (son identifiant), ou sur « Nouveau mode » (null).
  onClose(focusId: string | null): void;
}

// L'éditeur d'un mode, dans le menu « Moi » à la place de la liste (aucun panneau à droite) : le nom, avec l'aperçu de sa marque ; l'icône (facultative : la choisir de
// nouveau la retire) ; la couleur ; la pièce où il conduit, sur la mini-carte (seulement si la carte en a) ; et ce qu'il change, en trois interrupteurs. En bas :
// Supprimer (pour un mode existant, après une confirmation sur place), Annuler, Créer ou Enregistrer. Chaque action passe par l'API, puis le magasin ; le serveur
// dit au bureau un mode modifié ou supprimé qu'on porte. Échap revient à la liste (ou, pendant la confirmation, la retire) sans fermer le menu.
export function ModeEditor({ state, map, onClose }: ModeEditorProps) {
  const uid = useId();
  const [form, setForm] = useState<ActivityInput>(() => (state === null ? NEW_MODE : formOf(state, map)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  const labelValid = form.label.trim().length > 0;
  const back = () => onClose(state?.id ?? null);

  // À l'ouverture, le focus va au nom : on le tape, ou on le corrige.
  useEffect(() => nameInput.current?.focus(), []);

  // La confirmation de la suppression prend la place des boutons : le focus va à « Garder », et revient à la corbeille si on garde le mode.
  useEffect(() => {
    if (confirming) keepButton.current?.focus();
    else if (asked.current) removeButton.current?.focus();
    asked.current = confirming;
  }, [confirming]);

  // L'icône choisie : choisir celle qui l'est déjà la retire (le champ part alors du formulaire : le mode montre le point de sa couleur).
  function chooseIcon(icon: ActivityIcon) {
    const { icon: _chosen, ...rest } = form;
    setForm(form.icon === icon ? rest : { ...rest, icon });
  }

  // L'emplacement choisi sur la mini-carte : choisir celui qui l'est déjà le retire.
  function choosePlace(place: string | undefined) {
    const { place: _chosen, ...rest } = form;
    setForm(place === undefined ? rest : { ...rest, place });
  }

  // Une requête à la fois ; un échec le dit, et l'éditeur reste ouvert.
  async function run(action: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onClose(await action());
    } catch (err) {
      // Déjà supprimé ailleurs : il n'est plus à montrer.
      if (state !== null && err instanceof ApiError && err.error === 'not_found') useOfficeStore.getState().removeMyState(state.id);
      setError(errorText(err));
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!labelValid) return;
    const input = { ...form, label: form.label.trim() };
    void run(async () => {
      const saved = state === null ? await createActivityState(input) : await updateActivityState(state.id, input);
      useOfficeStore.getState().upsertMyState(saved);
      return saved.id;
    });
  }

  function remove() {
    if (state === null) return;
    void run(async () => {
      await deleteActivityState(state.id);
      useOfficeStore.getState().removeMyState(state.id);
      return null;
    });
  }

  // Échap revient à la liste, sans aller jusqu'au menu (qui se fermerait) ; les flèches, hors d'un champ de texte, ne font pas marcher l'avatar (game/input.ts ignore
  // une touche déjà traitée).
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (confirming) setConfirming(false);
      else back();
      return;
    }
    const typing = event.target instanceof HTMLInputElement && event.target.type === 'text';
    if (event.key.startsWith('Arrow') && !typing) event.preventDefault();
  }

  const switches: Array<{ key: 'allowEntry' | 'hear' | 'heard'; label: string }> = [
    { key: 'allowEntry', label: fr.modes.allowEntry },
    { key: 'hear', label: fr.modes.hear },
    { key: 'heard', label: fr.modes.heard },
  ];
  const destinations = map !== null && map.places.some((place) => place.destination);

  return (
    <form className="mode-editor" onSubmit={submit} onKeyDown={onKeyDown} aria-labelledby={`${uid}-title`}>
      <div className="mode-editor-head">
        <button type="button" className="mode-editor-back" aria-label={fr.modes.back} title={fr.modes.back} onClick={back}>
          <BackIcon />
        </button>
        <h2 id={`${uid}-title`}>{state === null ? fr.modes.titleCreate : fr.modes.titleEdit}</h2>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="mode-editor-name">
        <span className="mode-mark" style={{ '--mode': form.color } as CSSProperties} aria-hidden="true">
          <ActivityMark activity={{ id: 'apercu', color: form.color, ...(form.icon && { icon: form.icon }) }} />
        </span>
        <label className="visually-hidden" htmlFor={`${uid}-label`}>
          {fr.modes.label}
        </label>
        <input
          ref={nameInput}
          id={`${uid}-label`}
          type="text"
          value={form.label}
          placeholder={fr.modes.labelPlaceholder}
          maxLength={ACTIVITY_LABEL_MAX_LENGTH}
          autoComplete="off"
          onChange={(event) => setForm({ ...form, label: event.target.value })}
        />
      </div>

      <fieldset className="mode-editor-field">
        <legend>{fr.modes.icon}</legend>
        <div className="mode-editor-icons">
          {ACTIVITY_ICONS.map((name) => {
            const Icon = ACTIVITY_ICON_COMPONENTS[name];
            return (
              <button key={name} type="button" aria-label={fr.states.icons[name]} title={fr.states.icons[name]} aria-pressed={form.icon === name} onClick={() => chooseIcon(name)}>
                <Icon />
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mode-editor-field">
        <legend>{fr.modes.color}</legend>
        <div className="mode-editor-colors">
          {MODE_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              style={{ '--swatch': color } as CSSProperties}
              aria-label={t(fr.modes.colorPick, { color })}
              aria-pressed={form.color === color}
              onClick={() => setForm({ ...form, color })}
            />
          ))}
          <input type="color" aria-label={fr.modes.colorCustom} title={fr.modes.colorCustom} value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value.toLowerCase() })} />
        </div>
      </fieldset>

      {destinations && (
        <fieldset className="mode-editor-field">
          <legend>{fr.modes.place}</legend>
          <PlacePicker map={map} value={form.place} onChange={choosePlace} />
          <p className="mode-editor-hint">{fr.modes.placeHint}</p>
        </fieldset>
      )}

      <fieldset className="mode-editor-field">
        <legend>{fr.modes.switchesTitle}</legend>
        {switches.map(({ key, label }) => (
          <label key={key} className="mode-switch">
            <span>{label}</span>
            <input type="checkbox" role="switch" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />
          </label>
        ))}
        {!form.hear && !form.heard && <p className="mode-editor-hint">{fr.modes.cutOff}</p>}
      </fieldset>

      {confirming && state !== null ? (
        <div className="mode-editor-actions is-confirm" role="group" aria-label={t(fr.modes.removeConfirm, { label: state.label })}>
          <span className="mode-editor-question">{t(fr.modes.removeConfirm, { label: state.label })}</span>
          <button ref={keepButton} type="button" className="bar-button" onClick={() => setConfirming(false)}>
            {fr.modes.removeKeep}
          </button>
          <button type="button" className="bar-button is-danger" disabled={busy} onClick={remove}>
            {fr.modes.removeYes}
          </button>
        </div>
      ) : (
        <div className="mode-editor-actions">
          {state !== null && (
            <button ref={removeButton} type="button" className="mode-editor-remove" aria-label={fr.modes.remove} title={fr.modes.remove} disabled={busy} onClick={() => setConfirming(true)}>
              <TrashIcon />
            </button>
          )}
          <button type="button" className="bar-button" onClick={back}>
            {fr.modes.cancel}
          </button>
          <button type="submit" className="bar-button is-primary" disabled={busy || !labelValid}>
            {state === null ? fr.modes.submitCreate : fr.modes.submitSave}
          </button>
        </div>
      )}
    </form>
  );
}
