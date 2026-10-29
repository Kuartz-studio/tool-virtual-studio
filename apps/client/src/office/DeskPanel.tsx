import {
  DEFAULT_FLOOR_THEME,
  DEFAULT_WALL_THEME,
  DESK_NAME_MAX_LENGTH,
  floorTheme,
  wallTheme,
  type DeskBan,
  type DeskCommand,
  type DeskInfo,
  type PublicPlayer,
} from '@bureau/shared';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { fr, t } from '../i18n/fr';
import { sendDeskCommand } from '../net/desk-commands';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { selectDeskOf, useOfficeStore } from '../state/office-store';
import { deskErrorText, deskTitle, occupantsOf } from './desks';
import { CloseIcon, DecorIcon, DoorOpenIcon, KickIcon, LockIcon, MoveIcon, PlaceIcon, RenameIcon, SmallCheckIcon, UnbanIcon } from './icons';
import { FloorSwatch, WallSwatch } from './sprites';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { IconButton } from './ui/IconButton';
import { useInMyDesk } from './use-here';

// Le panneau Mon bureau : chacun a son bureau, qu'il nomme, dont il ferme la porte et dont il exclut qui il veut. Peu de texte, des états
// visibles :
// - sans bureau : le plan des places, dont on prend une libre d'un clic ;
// - avec un bureau : en tête, la pièce en petit (ses murs et son sol) et son nom, modifiable sur place ; la porte, un interrupteur qui dit son
//   état, et ceux qu'on a exclus ; trois tuiles (y aller, décorer, déménager : le plan des places s'ouvre dessous) ; qui est dans la pièce, en
//   portraits (exclure d'un clic) ; enfin, à part et discret, « Rendre mon bureau », qui demande confirmation.
// Chaque geste envoie une commande (`desk:do`) et montre l'erreur que le serveur renvoie, s'il y en a une. Le focus va au titre à l'ouverture ;
// Échap ferme (dans le champ du nom modifié, ou dans la confirmation, il annule d'abord).
type Run = (command: DeskCommand) => Promise<boolean>;

export function DeskPanel({ id, socket, onClose, onDecorate }: { id?: string; socket: OfficeSocket | null; onClose(): void; onDecorate(): void }) {
  const selfId = useOfficeStore((state) => state.selfId);
  const desks = useOfficeStore((state) => state.desks);
  const bans = useOfficeStore((state) => state.deskBans);
  const map = useOfficeStore((state) => state.officeMap);
  const players = useOfficeStore((state) => state.players);
  const ready = useOfficeStore((state) => state.ready);
  const mine = useMemo(() => selectDeskOf({ desks }, selfId), [desks, selfId]);
  const inside = useInMyDesk();

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
  const [busy, setBusy] = useState(false);
  const run: Run = async (command) => {
    setBusy(true);
    const ack = await sendDeskCommand(socket, command);
    setBusy(false);
    setError(ack.ok ? null : deskErrorText(ack));
    return ack.ok;
  };
  const idle = !busy && ready;

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

  const places = <PlaceGrid desks={desks} players={players} selfId={selfId} disabled={!idle} onTake={take} />;

  return (
    <aside id={id} className="people-panel desk-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="people-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {fr.desk.title}
        </h2>
        <button type="button" className="bar-button" aria-label={fr.desk.close} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="people-lists desk-body">
        {error && <Alert>{error}</Alert>}
        {mine === undefined ? (
          <section className="desk-empty" aria-labelledby={`${titleId}-pick`}>
            <span className="desk-empty-icon" aria-hidden="true">
              <PlaceIcon />
            </span>
            <p className="desk-empty-text">{fr.desk.none}</p>
            <h3 id={`${titleId}-pick`} className="desk-subtitle">
              {fr.desk.pickTitle}
            </h3>
            {places}
          </section>
        ) : (
          <>
            <DeskHero desk={mine} idle={idle} run={run} />

            <DeskDoor desk={mine} bans={bans} players={players} idle={idle} run={run} labelId={`${titleId}-bans`} />

            <div className="desk-tiles">
              <button type="button" className="desk-tile" data-here={inside || undefined} disabled={!idle || inside} onClick={() => void run({ type: 'goto' })}>
                <span className="desk-tile-icon" aria-hidden="true">
                  {inside ? <PlaceIcon /> : <DoorOpenIcon />}
                </span>
                {inside ? fr.desk.here : fr.desk.gotoShort}
              </button>
              <button type="button" className="desk-tile" aria-label={fr.desk.decorate} disabled={!ready} onClick={onDecorate}>
                <span className="desk-tile-icon" aria-hidden="true">
                  <DecorIcon />
                </span>
                {fr.desk.decorateShort}
              </button>
              <button type="button" className="desk-tile" aria-expanded={moving} onClick={() => setMoving((open) => !open)}>
                <span className="desk-tile-icon" aria-hidden="true">
                  <MoveIcon />
                </span>
                {fr.desk.moveTitle}
              </button>
            </div>

            {moving && (
              <section className="desk-move" aria-labelledby={`${titleId}-move`}>
                <h3 id={`${titleId}-move`} className="desk-subtitle">
                  {fr.desk.moveHint}
                </h3>
                {places}
              </section>
            )}

            <section aria-labelledby={`${titleId}-inside`}>
              <h3 id={`${titleId}-inside`} className="desk-subtitle">
                {fr.desk.insideTitle}
              </h3>
              {occupants.length === 0 ? (
                <p className="desk-hint">{fr.desk.insideEmpty}</p>
              ) : (
                <ul className="desk-people">
                  {occupants.map((person) => (
                    <PersonChip key={person.id} name={person.name} avatarKey={person.avatarKey} status={person.status} activity={person.activity}>
                      <IconButton
                        small
                        label={t(fr.desk.kickLabel, { name: person.name })}
                        disabled={!idle}
                        onClick={() => void run({ type: 'kick', userId: person.id })}
                      >
                        <KickIcon />
                      </IconButton>
                    </PersonChip>
                  ))}
                </ul>
              )}
            </section>

            <DeskRelease idle={idle} run={run} />
          </>
        )}
      </div>
    </aside>
  );
}

// La pièce en petit : une rangée de murs sur une rangée de sol, aux couleurs de sa déco (un thème inconnu prend celui par défaut). Assez de
// colonnes pour la largeur du panneau ; ce qui dépasse est coupé.
const SCENE_COLUMNS = Array.from({ length: 12 }, (_, index) => index);

// L'en-tête : la pièce, la place, et le nom, modifiable sur place. Le nom est un brouillon, enregistré quand on quitte le champ (Entrée le
// quitte) s'il a changé ; vide, le serveur rend le nom par défaut, montré en indice. Échap rend le nom du serveur. Le brouillon repart du nom du
// serveur quand celui-ci change (un autre onglet l'a renommé). « Nom enregistré. » s'affiche un instant.
const SAVED_MS = 2500;

function DeskHero({ desk, idle, run }: { desk: DeskInfo; idle: boolean; run: Run }) {
  const inputId = useId();
  const serverName = desk.name ?? '';
  const [draft, setDraft] = useState(serverName);
  useEffect(() => setDraft(serverName), [serverName]);

  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  function save() {
    if (!idle || draft.trim() === serverName) return;
    setSaved(false);
    void run({ type: 'rename', name: draft }).then(setSaved);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.currentTarget.querySelector('input')?.blur();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape' || draft === serverName) return;
    event.preventDefault();
    event.stopPropagation();
    setDraft(serverName);
  }

  const floor = floorTheme(desk.floor) ?? floorTheme(DEFAULT_FLOOR_THEME)!;
  const wall = wallTheme(desk.wall) ?? wallTheme(DEFAULT_WALL_THEME)!;

  return (
    <section className="desk-hero">
      <div className="desk-scene" aria-hidden="true">
        <div className="desk-scene-row">
          {SCENE_COLUMNS.map((column) => (
            <WallSwatch key={column} top={wall.top} bottom={wall.bottom} column={column} />
          ))}
        </div>
        <div className="desk-scene-row">
          {SCENE_COLUMNS.map((column) => (
            <FloorSwatch key={column} gid={floor.gid} column={column} />
          ))}
        </div>
      </div>
      <span className="desk-key">{t(fr.desk.place, { key: desk.key })}</span>
      <form className="desk-name" onSubmit={onSubmit}>
        <label htmlFor={inputId} className="visually-hidden">
          {fr.desk.nameLabel}
        </label>
        <input
          id={inputId}
          type="text"
          value={draft}
          maxLength={DESK_NAME_MAX_LENGTH}
          placeholder={deskTitle({ ...desk, name: null })}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={onKeyDown}
        />
        <span className="desk-name-pen" aria-hidden="true">
          <RenameIcon />
        </span>
      </form>
      <p className="desk-saved" role="status">
        {saved && (
          <>
            <SmallCheckIcon />
            {fr.desk.nameSaved}
          </>
        )}
      </p>
    </section>
  );
}

// La porte : un interrupteur (allumé : fermée à clé, seuls ceux qu'on laisse entrer entrent, ceux qui sont déjà dedans restent) qui montre son
// état, une porte ouverte ou un cadenas. Dessous, la porte fermée par l'état d'activité du moment, et ceux qu'on a exclus, à réadmettre d'un clic.
function DeskDoor({
  desk,
  bans,
  players,
  idle,
  run,
  labelId,
}: {
  desk: DeskInfo;
  bans: DeskBan[];
  players: Record<string, PublicPlayer>;
  idle: boolean;
  run: Run;
  labelId: string;
}) {
  const { locked } = desk;
  return (
    <section className="desk-door-block">
      <button
        type="button"
        role="switch"
        aria-checked={locked}
        aria-label={fr.desk.lockSwitch}
        className="desk-door"
        disabled={!idle}
        onClick={() => void run({ type: 'lock', locked: !locked })}
      >
        <span className="desk-door-icon" aria-hidden="true">
          {locked ? <LockIcon /> : <DoorOpenIcon />}
        </span>
        <span className="desk-door-text">
          <span className="desk-door-state">{locked ? fr.desk.doorLocked : fr.desk.doorOpen}</span>
          <span className="desk-door-hint">{locked ? fr.desk.lockHint : fr.desk.openHint}</span>
        </span>
        <span className="switch-track" aria-hidden="true" />
      </button>
      {desk.closedByState && <p className="desk-note">{fr.desk.closedByState}</p>}
      {bans.length > 0 && (
        <section className="desk-bans" aria-labelledby={labelId}>
          <h3 id={labelId} className="desk-subtitle">
            {fr.desk.bannedTitle}
          </h3>
          <ul className="desk-people">
            {bans.map((ban) => (
              <PersonChip key={ban.id} name={ban.name} avatarKey={players[ban.id]?.avatarKey ?? null}>
                <IconButton small label={t(fr.desk.unbanLabel, { name: ban.name })} disabled={!idle} onClick={() => void run({ type: 'unban', userId: ban.id })}>
                  <UnbanIcon />
                </IconButton>
              </PersonChip>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

// Une personne en pastille : son portrait (et le point de son statut, ou de son mode, si on le connaît), son nom, et un geste (exclure, réadmettre).
function PersonChip({
  name,
  avatarKey,
  status,
  activity,
  children,
}: {
  name: string;
  avatarKey: string | null;
  status?: PublicPlayer['status'];
  activity?: PublicPlayer['activity'];
  children: ReactNode;
}) {
  return (
    <li className="desk-person">
      <AvatarPortrait avatarKey={avatarKey} name={name} size={26} status={status} activity={activity} />
      <span className="desk-person-name" title={name}>
        {name}
      </span>
      {children}
    </li>
  );
}

// Le plan des places, toutes, dans l'ordre de leurs clés : une libre se prend d'un clic ; une prise montre le portrait de qui l'a, et la sienne
// « Toi ». Sans place libre, on le dit.
function PlaceGrid({
  desks,
  players,
  selfId,
  disabled,
  onTake,
}: {
  desks: DeskInfo[];
  players: Record<string, PublicPlayer>;
  selfId: string | null;
  disabled: boolean;
  onTake(key: string): void;
}) {
  const sorted = useMemo(() => [...desks].sort((a, b) => a.key.localeCompare(b.key, 'fr', { numeric: true })), [desks]);
  if (!sorted.some((desk) => desk.ownerId === null)) return <p className="desk-hint">{fr.desk.pickEmpty}</p>;
  return (
    <ul className="desk-places">
      {sorted.map((desk) => (
        <li key={desk.key}>
          {desk.ownerId === null ? (
            <button type="button" className="desk-place" aria-label={t(fr.desk.take, { key: desk.key })} disabled={disabled} onClick={() => onTake(desk.key)}>
              <span className="desk-place-key">{desk.key}</span>
              <span className="desk-place-who">{fr.desk.free}</span>
            </button>
          ) : desk.ownerId === selfId ? (
            <span className="desk-place" data-mine="true" role="img" aria-label={t(fr.desk.yours, { key: desk.key })}>
              <span className="desk-place-key">{desk.key}</span>
              <span className="desk-place-who">{fr.desk.you}</span>
            </span>
          ) : (
            <span className="desk-place" data-taken="true" role="img" aria-label={t(fr.desk.takenBy, { key: desk.key, name: desk.ownerName ?? '' })}>
              <span className="desk-place-key">{desk.key}</span>
              <AvatarPortrait avatarKey={players[desk.ownerId]?.avatarKey ?? null} name={desk.ownerName ?? ''} size={20} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// Rendre son bureau, à part et discret. Le premier clic demande confirmation (le focus passe sur « Annuler ») ; Échap ou « Annuler » y renonce
// (le focus revient au bouton), « Oui, le rendre » rend la place (le nom et la porte partent, la déco suit sa propriétaire).
function DeskRelease({ idle, run }: { idle: boolean; run: Run }) {
  const confirmId = useId();
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asking) cancel.current?.focus();
    else if (asked.current) trigger.current?.focus();
    asked.current = asking;
  }, [asking]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setAsking(false);
  }

  if (!asking) {
    return (
      <button ref={trigger} type="button" className="desk-release" disabled={!idle} onClick={() => setAsking(true)}>
        {fr.desk.release}
      </button>
    );
  }
  return (
    <div className="desk-confirm" role="group" aria-labelledby={confirmId} onKeyDown={onKeyDown}>
      <p id={confirmId} className="desk-confirm-title">
        {fr.desk.releaseConfirm}
      </p>
      <p className="desk-hint">{fr.desk.releaseHint}</p>
      <div className="desk-confirm-actions">
        <button ref={cancel} type="button" className="bar-button" onClick={() => setAsking(false)}>
          {fr.desk.releaseNo}
        </button>
        <button type="button" className="bar-button bar-button-danger" disabled={!idle} onClick={() => void run({ type: 'release' })}>
          {fr.desk.releaseYes}
        </button>
      </div>
    </div>
  );
}
