import { ACTIVITY_ICONS, ACTIVITY_LABEL_MAX_LENGTH, ACTIVITY_MAX_PER_USER, type ActivityIcon, type ActivityInput, type ActivityState } from '@bureau/shared';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { ApiError } from '../lib/api';
import { createActivityState, deleteActivityState, updateActivityState } from '../lib/activity-api';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { ActivityMark } from './ActivityMark';
import { ACTIVITY_ICON_COMPONENTS } from './activity-icons';
import { CloseIcon } from './icons';

// Des couleurs toutes prêtes pour le point (la couleur libre reste possible : le sélecteur du navigateur).
export const ACTIVITY_SWATCHES = ['#22c55e', '#f59e0b', '#ef4444', '#6d28d9', '#2f5fd0', '#0ea5e9', '#ec4899', '#9ca3af'] as const;

const EMPTY_FORM: ActivityInput = { label: '', color: ACTIVITY_SWATCHES[3], allowEntry: true, hear: true, heard: true };

// Trois états tout prêts, pour qui n'en a encore aucun : un clic les crée. Le nom, l'icône et la couleur disent ce que c'est ; les interrupteurs,
// ce que ça change. Concentration (le casque) : porte fermée, et on n'entend ni n'est entendu (on sort des conversations) ; Réunion : porte
// fermée, mais on parle avec ceux qui y sont ; Pause : tout reste ouvert. Chacun se modifie ensuite, comme les autres.
const SUGGESTIONS = [
  { key: 'focus', icon: 'headphones', color: ACTIVITY_SWATCHES[3], allowEntry: false, hear: false, heard: false },
  { key: 'meeting', icon: 'users', color: ACTIVITY_SWATCHES[2], allowEntry: false, hear: true, heard: true },
  { key: 'break', icon: 'coffee', color: ACTIVITY_SWATCHES[1], allowEntry: true, hear: true, heard: true },
] as const satisfies ReadonlyArray<{ key: keyof typeof fr.states.suggestions } & Omit<ActivityInput, 'label'>>;

// Pourquoi une requête sur les états a échoué, en toutes lettres.
function errorText(err: unknown): string {
  if (err instanceof ApiError && err.error === 'limit') return t(fr.states.errors.limit, { max: ACTIVITY_MAX_PER_USER });
  if (err instanceof ApiError && err.error === 'invalid') return fr.states.errors.invalid;
  if (err instanceof ApiError && err.error === 'not_found') return fr.states.errors.not_found;
  return fr.states.errors.generic;
}

// Ce qu'un état change, en quelques mots : porte, oreilles, voix.
function summaryOf(state: ActivityInput): string {
  return [
    state.allowEntry ? fr.states.summaryOpen : fr.states.summaryClosed,
    state.hear ? fr.states.summaryHear : fr.states.summaryDeaf,
    state.heard ? fr.states.summaryHeard : fr.states.summaryMuted,
  ].join(' · ');
}

// Le panneau Mes états d'activité : la liste de ses propres états (prendre, modifier, supprimer) et le formulaire pour en créer. Un état :
// un nom, la couleur de son point, une icône (facultative : sans elle, c'est le point qu'on montre), et trois interrupteurs (laisser entrer dans
// son bureau, entendre, être entendu). Sans aucun état, trois suggestions en créent un d'un clic. Chaque action passe par l'API, puis le
// magasin ; la prise d'un état passe par le serveur (`state:set`), comme celle d'un statut. Le focus va au titre à l'ouverture ; Échap ferme.
export function StatesPanel({ id, socket, onClose }: { id?: string; socket: OfficeSocket | null; onClose(): void }) {
  const myStates = useOfficeStore((state) => state.myStates);
  const activity = useOfficeStore((state) => state.self?.activity ?? null);
  const ready = useOfficeStore((state) => state.ready);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

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
    setForm({ label: state.label, color: state.color, ...(state.icon && { icon: state.icon }), allowEntry: state.allowEntry, hear: state.hear, heard: state.heard });
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

  function suggest({ key, ...input }: (typeof SUGGESTIONS)[number]) {
    void save({ label: fr.states.suggestions[key], ...input }, null);
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

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  const switches: Array<{ key: 'allowEntry' | 'hear' | 'heard'; label: string }> = [
    { key: 'allowEntry', label: fr.states.allowEntry },
    { key: 'hear', label: fr.states.hear },
    { key: 'heard', label: fr.states.heard },
  ];

  return (
    <aside id={id} className="people-panel states-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="people-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {fr.states.title}
        </h2>
        <button type="button" className="bar-button" aria-label={fr.states.close} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="people-lists desk-body">
        <p className="desk-hint">{fr.states.intro}</p>
        {error && <Alert>{error}</Alert>}
        {notice && (
          <p className="desk-hint" role="status">
            {notice}
          </p>
        )}

        <section aria-labelledby={`${titleId}-list`}>
          <h3 id={`${titleId}-list`} className="desk-subtitle">
            {fr.states.listTitle}
          </h3>
          {myStates.length === 0 ? (
            <>
              <p className="desk-hint">{fr.states.empty}</p>
              <div className="state-suggestions" role="group" aria-label={fr.states.suggestionsLabel}>
                {SUGGESTIONS.map((suggestion) => {
                  const Icon = ACTIVITY_ICON_COMPONENTS[suggestion.icon];
                  const label = fr.states.suggestions[suggestion.key];
                  return (
                    <button
                      key={suggestion.key}
                      type="button"
                      className="bar-button state-suggestion"
                      aria-label={t(fr.states.suggestionLabel, { label })}
                      disabled={busy}
                      onClick={() => suggest(suggestion)}
                    >
                      <Icon />
                      {label}
                    </button>
                  );
                })}
              </div>
            </>
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
                  <p className="desk-hint state-summary">{summaryOf(state)}</p>
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

        <form className="state-form" onSubmit={submit} aria-labelledby={`${titleId}-form`}>
          <h3 id={`${titleId}-form`} className="desk-subtitle">
            {editing === null ? fr.states.formCreate : fr.states.formEdit}
          </h3>
          <div className="state-field">
            <label htmlFor={`${titleId}-label`}>{fr.states.label}</label>
            <input
              id={`${titleId}-label`}
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
    </aside>
  );
}
