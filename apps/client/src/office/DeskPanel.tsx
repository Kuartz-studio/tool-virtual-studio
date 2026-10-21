import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { DeskCommand } from '@bureau/shared';
import { fr, t } from '../i18n/fr';
import { sendDeskCommand } from '../net/desk-commands';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { selectDeskOf, useOfficeStore } from '../state/office-store';
import { deskErrorText, deskTitle, occupantsOf } from './desks';

// Le panneau Mon bureau : chacun a son bureau, qu'il nomme, dont il ferme la porte et dont il exclut qui il veut.
// - sans bureau : les places libres, à prendre ;
// - avec un bureau : son nom, la déco (l'éditeur du décor, DecorPanel), la porte (fermée, seuls ceux qu'on laisse entrer entrent, ceux qui sont déjà dedans restent), aller à son
//   bureau, qui est dans la pièce (avec « Exclure »), ceux qu'on a exclus (« Réadmettre »), changer de place, rendre le bureau.
// Chaque bouton envoie une commande (`desk:do`) et montre l'erreur que le serveur renvoie, s'il y en a une. Le focus va au titre à
// l'ouverture ; Échap ferme.
export function DeskPanel({ id, socket, onClose, onDecorate }: { id?: string; socket: OfficeSocket | null; onClose(): void; onDecorate(): void }) {
  const selfId = useOfficeStore((state) => state.selfId);
  const desks = useOfficeStore((state) => state.desks);
  const bans = useOfficeStore((state) => state.deskBans);
  const map = useOfficeStore((state) => state.officeMap);
  const players = useOfficeStore((state) => state.players);
  const ready = useOfficeStore((state) => state.ready);
  const mine = useMemo(() => selectDeskOf({ desks }, selfId), [desks, selfId]);
  const free = useMemo(() => desks.filter((desk) => desk.ownerId === null), [desks]);

  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Les positions des autres changent dix fois par seconde sans prévenir React : elles sont relues deux fois par seconde tant que le
  // panneau est ouvert.
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refresh((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  const occupants = mine ? occupantsOf(mine.key, map, players, useOfficeStore.getState().positions) : [];

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(command: DeskCommand, saved?: string): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    const ack = await sendDeskCommand(socket, command);
    setBusy(false);
    setError(ack.ok ? null : deskErrorText(ack));
    if (ack.ok && saved) setNotice(saved);
    return ack.ok;
  }

  // Le nom : un brouillon, enregistré à l'envoi du formulaire. Il repart du nom du serveur quand celui-ci change.
  const serverName = mine?.name ?? '';
  const [draft, setDraft] = useState(serverName);
  useEffect(() => setDraft(serverName), [serverName]);
  function saveName(event: FormEvent) {
    event.preventDefault();
    void run({ type: 'rename', name: draft }, fr.desk.nameSaved);
  }

  const [moving, setMoving] = useState(false);
  function take(key: string) {
    void run({ type: 'claim', key }).then((ok) => ok && setMoving(false));
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  const freeList = (
    <ul className="desk-list">
      {free.map((desk) => (
        <li key={desk.key}>
          <button type="button" className="bar-button" disabled={busy || !ready} onClick={() => take(desk.key)}>
            {t(fr.desk.take, { key: desk.key })}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <aside id={id} className="people-panel desk-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="people-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {fr.desk.title}
        </h2>
        <button type="button" className="bar-button" aria-label={fr.desk.close} onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <div className="people-lists desk-body">
        {error && <Alert>{error}</Alert>}
        {mine === undefined ? (
          <section>
            <p>{fr.desk.none}</p>
            <h3 className="desk-subtitle">{fr.desk.pickTitle}</h3>
            {free.length === 0 ? <p className="desk-hint">{fr.desk.pickEmpty}</p> : freeList}
          </section>
        ) : (
          <>
            <form className="desk-name" onSubmit={saveName}>
              <label htmlFor={`${titleId}-name`}>{fr.desk.nameLabel}</label>
              <div className="desk-name-row">
                <input
                  id={`${titleId}-name`}
                  type="text"
                  value={draft}
                  maxLength={40}
                  placeholder={deskTitle({ ...mine, name: null })}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button type="submit" className="bar-button" disabled={busy || !ready || draft.trim() === serverName}>
                  {fr.desk.nameSave}
                </button>
              </div>
              {notice && (
                <p className="desk-hint" role="status">
                  {notice}
                </p>
              )}
            </form>

            <section className="desk-door">
              <button
                type="button"
                className="bar-button desk-lock"
                aria-pressed={mine.locked}
                disabled={busy || !ready}
                onClick={() => void run({ type: 'lock', locked: !mine.locked })}
              >
                {mine.locked ? fr.desk.unlock : fr.desk.lock}
              </button>
              <p className="desk-hint">{mine.locked ? fr.desk.lockHint : fr.desk.openHint}</p>
              {mine.closedByState && <p className="desk-hint">{fr.desk.closedByState}</p>}
            </section>

            <button type="button" className="bar-button" disabled={busy || !ready} onClick={() => void run({ type: 'goto' })}>
              {fr.desk.goto}
            </button>

            <section>
              <button type="button" className="bar-button desk-decorate" disabled={!ready} onClick={onDecorate}>
                {fr.desk.decorate}
              </button>
              <p className="desk-hint">{fr.desk.decorateHint}</p>
            </section>

            <section aria-labelledby={`${titleId}-inside`}>
              <h3 id={`${titleId}-inside`} className="desk-subtitle">
                {fr.desk.insideTitle}
              </h3>
              {occupants.length === 0 ? (
                <p className="desk-hint">{fr.desk.insideEmpty}</p>
              ) : (
                <ul className="desk-list">
                  {occupants.map((person) => (
                    <li key={person.id} className="desk-row">
                      <span className="person-name" title={person.name}>
                        {person.name}
                      </span>
                      <button
                        type="button"
                        className="bar-button"
                        aria-label={t(fr.desk.kickLabel, { name: person.name })}
                        disabled={busy || !ready}
                        onClick={() => void run({ type: 'kick', userId: person.id })}
                      >
                        {fr.desk.kick}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {bans.length > 0 && (
              <section aria-labelledby={`${titleId}-bans`}>
                <h3 id={`${titleId}-bans`} className="desk-subtitle">
                  {fr.desk.bannedTitle}
                </h3>
                <ul className="desk-list">
                  {bans.map((ban) => (
                    <li key={ban.id} className="desk-row">
                      <span className="person-name" title={ban.name}>
                        {ban.name}
                      </span>
                      <button
                        type="button"
                        className="bar-button"
                        aria-label={t(fr.desk.unbanLabel, { name: ban.name })}
                        disabled={busy || !ready}
                        onClick={() => void run({ type: 'unban', userId: ban.id })}
                      >
                        {fr.desk.unban}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <button type="button" className="bar-button" aria-expanded={moving} onClick={() => setMoving((open) => !open)}>
                {fr.desk.moveTitle}
              </button>
              {moving && (free.length === 0 ? <p className="desk-hint">{fr.desk.pickEmpty}</p> : freeList)}
            </section>

            <button type="button" className="bar-button" disabled={busy || !ready} onClick={() => void run({ type: 'release' })}>
              {fr.desk.release}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
