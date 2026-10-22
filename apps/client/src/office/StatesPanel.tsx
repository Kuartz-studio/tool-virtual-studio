import { ACTIVITY_ICONS, ACTIVITY_LABEL_MAX_LENGTH, ACTIVITY_MAX_PER_USER, PRESET_MODES, type ActivityIcon, type ActivityInput, type ActivityState } from '@bureau/shared';
import { useId, useState, type FormEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { ApiError } from '../lib/api';
import { createActivityState, deleteActivityState, updateActivityState } from '../lib/activity-api';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { ActivityMark } from './ActivityMark';
import { ACTIVITY_ICON_COMPONENTS } from './activity-icons';
import { PlacePicker } from './PlacePicker';
import { Drawer } from './ui/Drawer';

// Des couleurs toutes prêtes pour le point (la couleur libre reste possible : le sélecteur du navigateur).
export const ACTIVITY_SWATCHES = ['#22c55e', '#f59e0b', '#ef4444', '#6d28d9', '#2f5fd0', '#0ea5e9', '#ec4899', '#9ca3af'] as const;

const EMPTY_FORM: ActivityInput = { label: '', color: ACTIVITY_SWATCHES[3], allowEntry: true, hear: true, heard: true };

// Pourquoi une requête sur les états a échoué, en toutes lettres.
function errorText(err: unknown): string {
  if (err instanceof ApiError && err.error === 'limit') return t(fr.states.errors.limit, { max: ACTIVITY_MAX_PER_USER });
  if (err instanceof ApiError && err.error === 'invalid') return fr.states.errors.invalid;
  if (err instanceof ApiError && err.error === 'not_found') return fr.states.errors.not_found;
  return fr.states.errors.generic;
}

// Ce qu'un état change, en quelques mots : porte, oreilles, voix, et la pièce où il conduit quand il en a une (`placeName` en donne le nom).
function summaryOf(state: ActivityInput, placeName: (key: string) => string): string {
  return [
    state.allowEntry ? fr.states.summaryOpen : fr.states.summaryClosed,
    state.hear ? fr.states.summaryHear : fr.states.summaryDeaf,
    state.heard ? fr.states.summaryHeard : fr.states.summaryMuted,
    ...(state.place === undefined ? [] : [t(fr.modes.placeIn, { place: placeName(state.place) })]),
  ].join(' · ');
}

// Le panneau Mes états d'activité : la liste de ses propres états (prendre, modifier, supprimer), les modes prêts à l'emploi (Concentration, Sport : on les copie en
// mode perso d'un clic, on ne les modifie ni ne les supprime) et le formulaire pour en créer. Un état : un nom, la couleur de son point, une icône (facultative : sans
// elle, c'est le point qu'on montre), un emplacement (facultatif : la pièce où il conduit, choisie sur une mini-carte) et trois interrupteurs (laisser entrer dans son
// bureau, entendre, être entendu). Chaque action passe par l'API, puis le
// magasin ; la prise d'un état passe par le serveur (`state:set`), comme celle d'un statut. Le focus va au titre à l'ouverture ; Échap ferme.
export function StatesPanel({ id, socket, onClose }: { id?: string; socket: OfficeSocket | null; onClose(): void }) {
  const myStates = useOfficeStore((state) => state.myStates);
  const activity = useOfficeStore((state) => state.self?.activity ?? null);
  const ready = useOfficeStore((state) => state.ready);
  const map = useOfficeStore((state) => state.officeMap);
  const uid = useId();
  // Le nom d'un lieu de la carte, ou sa clé si la carte ne le connaît plus.
  const placeName = (key: string) => map?.places.find((place) => place.key === key)?.label ?? key;

  // Le formulaire : celui d'un nouvel état, ou la modification de l'état `editing`.
  const [form, setForm] = useState<ActivityInput>(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const full = myStates.length >= ACTIVITY_MAX_PER_USER && editing === null;
  const labelValid = form.label.trim().length > 0;

  function startEditing(state: ActivityState) {
    setEditing(state.id);
    setForm({ label: state.label, color: state.color, ...(state.icon && { icon: state.icon }), ...(state.place && { place: state.place }), allowEntry: state.allowEntry, hear: state.hear, heard: state.heard });
    setError(null);
    setNotice(null);
  }

  function stopEditing() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  // L'icône choisie : choisir celle qui l'est déjà la retire (le champ part alors du formulaire : l'état n'a plus d'icône).
  function chooseIcon(icon: ActivityIcon) {
    const { icon: _chosen, ...rest } = form;
    setForm(form.icon === icon ? rest : { ...rest, icon });
  }

  // Crée un état (`replacing` nul), ou remplace celui-là, puis le range au magasin. `input` vient du formulaire, ou d'une suggestion.
  async function save(input: ActivityInput, replacing: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = replacing === null ? await createActivityState(input) : await updateActivityState(replacing, input);
      useOfficeStore.getState().upsertMyState(saved);
      stopEditing();
      setNotice(fr.states.saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!labelValid || full) return;
    void save({ ...form, label: form.label.trim() }, editing);
  }

  // Copie un mode prêt à l'emploi dans ses propres modes : même nom, même icône, mêmes réglages, même emplacement ; il se modifie ensuite comme les autres.
  function duplicate({ id: _id, ...input }: ActivityState) {
    void save(input, null);
  }

  // L'emplacement choisi sur la mini-carte : choisir celui qui l'est déjà le retire (le champ part alors du formulaire).
  function choosePlace(place: string | undefined) {
    const { place: _chosen, ...rest } = form;
    setForm(place === undefined ? rest : { ...rest, place });
  }

  async function remove(state: ActivityState) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteActivityState(state.id);
      useOfficeStore.getState().removeMyState(state.id);
      if (editing === state.id) stopEditing();
    } catch (err) {
      // Déjà supprimé ailleurs : il n'est plus à montrer.
      if (err instanceof ApiError && err.error === 'not_found') useOfficeStore.getState().removeMyState(state.id);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function take(state: ActivityState) {
    useOfficeStore.getState().setChosenActivity(state.id);
    useOfficeStore.getState().setChosenStatus(null);
    socket?.emit('state:set', state.id);
  }

  const switches: Array<{ key: 'allowEntry' | 'hear' | 'heard'; label: string }> = [
    { key: 'allowEntry', label: fr.states.allowEntry },
    { key: 'hear', label: fr.states.hear },
    { key: 'heard', label: fr.states.heard },
  ];

  return (
    <Drawer title={fr.states.title} onClose={onClose} id={id} className="states-drawer">
      <div className="desk-body">
        <p className="desk-hint">{fr.states.intro}</p>
        {error && <Alert>{error}</Alert>}
        {notice && (
          <p className="desk-hint" role="status">
            {notice}
          </p>
        )}

        <section aria-labelledby={`${uid}-list`}>
          <h3 id={`${uid}-list`} className="desk-subtitle">
            {fr.states.listTitle}
          </h3>
          {myStates.length === 0 ? (
            <p className="desk-hint">{fr.states.empty}</p>
          ) : (
            <ul className="desk-list">
              {myStates.map((state) => (
                <li key={state.id} className="state-row" data-current={activity?.id === state.id ? '' : undefined}>
                  <div className="state-row-head">
                    <ActivityMark activity={state} />
                    <span className="person-name" title={state.label}>
                      {state.label}
                    </span>
                    {activity?.id === state.id && <span className="person-you">{fr.states.current}</span>}
                  </div>
                  <p className="desk-hint state-summary">{summaryOf(state, placeName)}</p>
                  <div className="state-actions">
                    {activity?.id !== state.id && (
                      <button
                        type="button"
                        className="bar-button"
                        aria-label={t(fr.states.takeLabel, { label: state.label })}
                        disabled={!ready}
                        onClick={() => take(state)}
                      >
                        {fr.states.take}
                      </button>
                    )}
                    <button type="button" className="bar-button" aria-label={t(fr.states.editLabel, { label: state.label })} onClick={() => startEditing(state)}>
                      {fr.states.edit}
                    </button>
                    <button
                      type="button"
                      className="bar-button"
                      aria-label={t(fr.states.removeLabel, { label: state.label })}
                      disabled={busy}
                      onClick={() => void remove(state)}
                    >
                      {fr.states.remove}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby={`${uid}-presets`}>
          <h3 id={`${uid}-presets`} className="desk-subtitle">
            {fr.modes.presetsTitle}
          </h3>
          <p className="desk-hint">{fr.modes.presetsIntro}</p>
          {/* Pas de liste (<li>) : ce ne sont pas ses états, la liste du dessus est la seule. Ni « Modifier » ni « Supprimer » : un mode prêt à l'emploi n'est pas à elle. */}
          <div className="state-presets" role="group" aria-label={fr.modes.presetsTitle}>
            {PRESET_MODES.map((preset) => (
              <div key={preset.id} className="state-row" data-preset={preset.id}>
                <div className="state-row-head">
                  <ActivityMark activity={preset} />
                  <span className="person-name" title={preset.label}>
                    {preset.label}
                  </span>
                </div>
                <p className="desk-hint state-summary">{summaryOf(preset, placeName)}</p>
                <div className="state-actions">
                  <button type="button" className="bar-button" aria-label={t(fr.modes.duplicateLabel, { label: preset.label })} disabled={busy || full} onClick={() => duplicate(preset)}>
                    {fr.modes.duplicate}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <form className="state-form" onSubmit={submit} aria-labelledby={`${uid}-form`}>
          <h3 id={`${uid}-form`} className="desk-subtitle">
            {editing === null ? fr.states.formCreate : fr.states.formEdit}
          </h3>
          <div className="state-field">
            <label htmlFor={`${uid}-label`}>{fr.states.label}</label>
            <input
              id={`${uid}-label`}
              type="text"
              value={form.label}
              maxLength={ACTIVITY_LABEL_MAX_LENGTH}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
            <span className="desk-hint">{fr.states.labelHint}</span>
          </div>

          <fieldset className="state-field state-icons">
            <legend>{fr.states.icon}</legend>
            <div className="state-icon-grid">
              {ACTIVITY_ICONS.map((name) => {
                const Icon = ACTIVITY_ICON_COMPONENTS[name];
                return (
                  <button key={name} type="button" className="state-icon-button" aria-label={fr.states.icons[name]} title={fr.states.icons[name]} aria-pressed={form.icon === name} onClick={() => chooseIcon(name)}>
                    <Icon />
                  </button>
                );
              })}
            </div>
            <span className="desk-hint">{fr.states.iconHint}</span>
          </fieldset>

          <fieldset className="state-field state-colors">
            <legend>{fr.states.color}</legend>
            <div className="state-swatches">
              {ACTIVITY_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="state-swatch"
                  style={{ backgroundColor: color }}
                  aria-label={t(fr.states.colorPick, { color })}
                  aria-pressed={form.color === color}
                  onClick={() => setForm({ ...form, color })}
                />
              ))}
              <input
                type="color"
                className="state-color-input"
                aria-label={fr.states.colorCustom}
                value={form.color}
                onChange={(event) => setForm({ ...form, color: event.target.value.toLowerCase() })}
              />
            </div>
          </fieldset>

          {map !== null && map.places.some((place) => place.destination) && (
            <fieldset className="state-field state-place">
              <legend>{fr.modes.place}</legend>
              <PlacePicker map={map} value={form.place} onChange={choosePlace} />
              <span className="desk-hint">{fr.modes.placeHint}</span>
            </fieldset>
          )}

          <fieldset className="state-field state-switches">
            <legend>{fr.states.switchesTitle}</legend>
            {switches.map(({ key, label }) => (
              <label key={key} className="state-switch">
                <input type="checkbox" role="switch" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />
                <span>{label}</span>
              </label>
            ))}
            {!form.hear && !form.heard && <p className="desk-hint">{fr.states.cutOff}</p>}
          </fieldset>

          <div className="state-actions">
            <button type="submit" className="bar-button state-submit" disabled={busy || !labelValid || full}>
              {editing === null ? fr.states.create : fr.states.save}
            </button>
            {editing !== null && (
              <button type="button" className="bar-button" onClick={stopEditing}>
                {fr.states.cancel}
              </button>
            )}
          </div>
          {full && <p className="desk-hint">{t(fr.states.errors.limit, { max: ACTIVITY_MAX_PER_USER })}</p>}
        </form>
      </div>
    </Drawer>
  );
}
