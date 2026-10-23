import { DISPLAY_NAME_MAX_LENGTH, displayNameSchema } from '@bureau/shared';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { fr } from '../i18n/fr';
import { saveDisplayName } from '../lib/profile-api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { BackIcon } from './icons';

// Changer son nom affiché, dans le menu « Moi » (à la place de la liste, comme l'éditeur d'un mode) : un champ prérempli, Enregistrer et Annuler. Le serveur
// valide le nom et l'annonce à tout le bureau (`profile:changed`) ; la réponse est aussi appliquée tout de suite ici, pour que la puce et l'étiquette de l'avatar
// suivent sans attendre. Échap ou la flèche retour reviennent au menu sans rien changer.
export function NameEditor({ name, onClose }: { name: string; onClose(): void }) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = displayNameSchema.safeParse(value).success;
  const unchanged = value.trim() === name;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    if (unchanged) return onClose();
    setBusy(true);
    setError(null);
    try {
      const profile = await saveDisplayName(value.trim());
      useOfficeStore.getState().setProfile(profile);
      onClose();
    } catch {
      setError(fr.me.renameFailed);
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <form className="mode-editor" onSubmit={submit} onKeyDown={onKeyDown} aria-labelledby={`${uid}-title`}>
      <div className="mode-editor-head">
        <button type="button" className="mode-editor-back" aria-label={fr.me.renameBack} title={fr.me.renameBack} onClick={onClose}>
          <BackIcon />
        </button>
        <h2 id={`${uid}-title`}>{fr.me.renameTitle}</h2>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="mode-editor-name">
        <label className="visually-hidden" htmlFor={`${uid}-name`}>
          {fr.me.renameLabel}
        </label>
        <input
          ref={input}
          id={`${uid}-name`}
          type="text"
          value={value}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="nickname"
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <p className="mode-editor-hint">{fr.me.renameHint}</p>

      <div className="mode-editor-actions">
        <button type="button" className="bar-button" onClick={onClose}>
          {fr.modes.cancel}
        </button>
        <button type="submit" className="bar-button is-primary" disabled={busy || !valid}>
          {busy ? fr.me.renameSaving : fr.me.renameSave}
        </button>
      </div>
    </form>
  );
}
