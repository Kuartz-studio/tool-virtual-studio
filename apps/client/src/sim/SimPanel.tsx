import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { Alert } from '../pages/AuthLayout';
import { simApi, type SimState } from './sim-api';
import { CloseIcon } from '../office/icons';

// Le temps entre deux relectures de l'état : les personnes fictives peuvent venir d'un autre onglet.
const REFRESH_MS = 3000;

// Le panneau « Bac à sable » du faux live (VITE_SIM=1) : on y fait apparaître des personnes fictives, on choisit le fichier audio de
// chacune (joué en boucle chez ceux qui sont dans sa room), on en importe de nouveaux, on les retire. Pour les déplacer, on les
// attrape sur la carte (Office.ts). Tout passe par les routes /api/sim ; le serveur dit l'état, ce panneau le relit après chaque
// action et toutes les REFRESH_MS.
//
// Le focus va au titre à l'ouverture ; Échap ferme.
export function SimPanel({ id, onClose }: { id?: string; onClose(): void }) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SimState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await simApi.state();
      if (mounted.current) setState(next);
    } catch {
      if (mounted.current) setError(fr.sim.loadFailed);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  // Une action, puis l'état relu. Un échec s'écrit dans le panneau.
  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch {
      if (mounted.current) setError(fr.sim.actionFailed);
    }
    await refresh();
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    for (const file of files) await run(() => simApi.uploadAudio(file));
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <aside id={id} className="people-panel sim-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="people-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {fr.sim.title}
        </h2>
        <button type="button" className="bar-button" aria-label={fr.sim.close} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="people-lists sim-body">
        <p className="sim-intro">{fr.sim.intro}</p>
        {error && <Alert>{error}</Alert>}
        <div className="sim-actions">
          <button type="button" className="bar-button" onClick={() => void run(() => simApi.addBot())}>
            {fr.sim.add}
          </button>
          <button type="button" className="bar-button" onClick={() => fileInput.current?.click()}>
            {fr.sim.importAudio}
          </button>
          <input ref={fileInput} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" multiple hidden onChange={(e) => void onImport(e)} />
        </div>
        {state && state.audio.length === 0 && <p className="sim-hint">{fr.sim.noAudio}</p>}
        {state && state.bots.length === 0 && <p className="sim-hint">{fr.sim.empty}</p>}
        <ul className="sim-bots">
          {state?.bots.map((bot) => (
            <li key={bot.id} className="sim-bot">
              <span className="person-name" title={bot.name}>
                {bot.name}
              </span>
              <select
                aria-label={t(fr.sim.audioLabel, { name: bot.name })}
                value={bot.audio ?? ''}
                onChange={(e) => void run(() => simApi.setAudio(bot.id, e.target.value === '' ? null : e.target.value))}
              >
                <option value="">{fr.sim.silence}</option>
                {state.audio.map((file) => (
                  <option key={file.file} value={file.file}>
                    {file.file}
                  </option>
                ))}
                {/* Le fichier d'une personne a pu disparaître du dossier : on le montre quand même. */}
                {bot.audio !== null && !state.audio.some((file) => file.file === bot.audio) && <option value={bot.audio}>{bot.audio}</option>}
              </select>
              <button type="button" className="bar-button" aria-label={t(fr.sim.remove, { name: bot.name })} onClick={() => void run(() => simApi.removeBot(bot.id))}>
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
