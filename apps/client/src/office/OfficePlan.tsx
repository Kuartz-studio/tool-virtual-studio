import { JOIN_DISTANCE_PX, zoneAt, type ActivityState, type OfficeMap, type Status } from '@bureau/shared';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { EventBus } from '../game/EventBus';
import { isTypingField } from '../game/input';
import { fr } from '../i18n/fr';
import { emitOnBus, listenOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { CloseIcon, LockIcon, MapIcon } from './icons';
import { useMapStore } from './map-store';
import { planRooms, planSite, planTables, toMapPoint, type PlanRoom } from './office-plan';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { IconButton } from './ui/IconButton';
import { useFeetRef } from './use-here';

// Les positions des autres changent dix fois par seconde sans prévenir React (le magasin les tient à part) : la carte les relit cinq fois par seconde, et
// chaque tête glisse d'une lecture à l'autre (une transition CSS de la même durée).
const REFRESH_MS = 200;
// La taille d'une tête à l'écran, quelle que soit la taille du plan.
const HEAD_PX = 26;

// La carte du bureau : la touche M (hors d'un champ de saisie, sans Ctrl, Alt ni ⌘), ou « Carte » dans le menu « Plus ». Toujours montée, pour la touche et pour
// suivre les pas de l'avatar (useFeetRef) depuis l'arrivée : ouverte plus tard, la carte sait où il est.
export function OfficePlan() {
  const open = useMapStore((state) => state.open);
  const map = useOfficeStore((state) => state.officeMap);
  const feet = useFeetRef();

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key !== 'm' && event.key !== 'M') return;
      if (isTypingField(event.target) || isTypingField(document.activeElement)) return;
      if (useOfficeStore.getState().officeMap === null) return;
      const from = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      useMapStore.getState().toggle(from);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // La page du bureau part (déconnexion, autre onglet) : la carte se ferme avec elle.
  useEffect(() => () => useMapStore.getState().hide(), []);

  if (!open || map === null) return null;
  return <PlanDialog map={map} feet={feet} />;
}

interface PlanPerson {
  id: string;
  name: string;
  avatarKey: string | null;
  status: Status;
  activity: ActivityState | null;
  x: number;
  y: number;
  self: boolean;
}

// Tout le monde sur la carte, soi en dernier (dessiné par-dessus) : les autres à leur dernière position reçue, soi à ses pieds.
function usePlanPeople(feet: RefObject<{ x: number; y: number } | null>): PlanPerson[] {
  const players = useOfficeStore((state) => state.players);
  const self = useOfficeStore((state) => state.self);
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  const positions = useOfficeStore.getState().positions;
  const people: PlanPerson[] = Object.values(players).map((player) => {
    const at = positions.get(player.id) ?? player;
    return { id: player.id, name: player.name, avatarKey: player.avatarKey, status: player.status, activity: player.activity ?? null, x: at.x, y: at.y, self: false };
  });
  const mine = feet.current ?? self;
  if (self && mine) people.push({ id: self.id, name: self.name, avatarKey: self.avatarKey, status: self.status, activity: self.activity ?? null, x: mine.x, y: mine.y, self: true });
  return people;
}

// La carte ouverte : une fenêtre posée en bas à droite, au-dessus de la barre, d'où elle se déplie (le menu « Plus » est là), aux couleurs de la lumière du
// bureau (claire, sombre une fois éteinte). Le jeu reste visible et l'on peut toujours marcher (le clavier de l'avatar écoute la page) : sa tête avance sur le
// plan. Un double-clic sur le plan y fait courir l'avatar (`local:walk-to`), sur une tête jusqu'à côté de la personne ; une marque reste à l'endroit visé tant
// qu'il y court. Elle se ferme par M, Échap, la croix, ou un clic à côté (sur le jeu, la barre…).
function PlanDialog({ map, feet }: { map: OfficeMap; feet: RefObject<{ x: number; y: number } | null> }) {
  const size = { width: map.widthTiles * map.tileSize, height: map.heightTiles * map.tileSize };
  const desks = useOfficeStore((state) => state.desks);
  const rooms = useMemo(() => planRooms(map, desks), [map, desks]);
  const tables = useMemo(() => planTables(map), [map]);
  const site = useMemo(() => planSite(map), [map]);
  // Le sol du bâtiment en un seul chemin : deux rectangles voisins dessinés à part laisseraient voir un fil du jardin entre eux.
  const floor = useMemo(() => site.building.map((rect) => `M${rect.x} ${rect.y}h${rect.width}v${rect.height}h${-rect.width}z`).join(''), [site]);
  const people = usePlanPeople(feet);
  const me = people.find((person) => person.self) ?? null;
  // Ce que l'on entend : dans une pièce ou un bureau, toute la pièce (telle que le plan la dessine) ; dehors, un cercle de JOIN_DISTANCE_PX autour de soi.
  const zone = me ? zoneAt(map, me.x, me.y) : null;
  const hearing = zone ? (rooms.find((room) => room.source.x === zone.x && room.source.y === zone.y && room.source.width === zone.width && room.source.height === zone.height)?.rect ?? zone) : null;

  const titleId = useId();
  const hatchId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // L'endroit visé d'un double-clic, tant que l'avatar y court : le jeu dit quand la course s'arrête (arrivé, interrompu, pas de chemin).
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  useEffect(
    () =>
      listenOnBus(EventBus, 'walk:state', (state) => {
        if (!state.walking || state.to !== 'point') setTarget(null);
      }),
    [],
  );

  // Un appui hors de la carte la ferme.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!dialog.current?.contains(event.target as Node)) useMapStore.getState().hide();
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, []);

  // À l'ouverture, le focus va à la carte ; à la fermeture, il revient à ce qui l'avait (le bouton « Plus »).
  useEffect(() => {
    dialog.current?.focus();
    return () => {
      const from = useMapStore.getState().from;
      if (from?.isConnected) from.focus();
    };
  }, []);

  const close = () => useMapStore.getState().hide();
  const pct = (value: number, length: number) => `${(value / length) * 100}%`;

  // Courir là : un point du plan (sous la souris), ou une personne (à côté d'elle). Sur soi, ou hors du plan, rien.
  function runTo(event: MouseEvent, person: PlanPerson | null) {
    event.preventDefault();
    event.stopPropagation();
    if (person?.self) return;
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    const point = person ?? toMapPoint(event.clientX, event.clientY, box, size);
    if (!(point.x >= 0 && point.y >= 0 && point.x < size.width && point.y < size.height)) return;
    setTarget({ x: point.x, y: point.y });
    emitOnBus(EventBus, 'local:walk-to', { x: point.x, y: point.y, near: person !== null });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  return (
    <div ref={dialog} role="dialog" aria-labelledby={titleId} tabIndex={-1} className="plan" onKeyDown={onKeyDown} onContextMenu={(event) => event.preventDefault()}>
      <header className="plan-head">
        <MapIcon />
        <h2 id={titleId}>{fr.officeMap.title}</h2>
        <p className="plan-help">
          {fr.officeMap.help}
          <kbd>{fr.officeMap.shortcut}</kbd>
        </p>
        <IconButton label={fr.officeMap.close} shortcut={fr.officeMap.shortcut} small tip="bottom" className="plan-close" data-sfx="none" onClick={close}>
          <CloseIcon />
        </IconButton>
      </header>
      <div
        ref={frame}
        className="plan-frame"
        data-garden={site.outside.length > 0 || undefined}
        style={{ '--plan-ratio': size.width / size.height } as CSSProperties}
        onDoubleClick={(event) => runTo(event, null)}
      >
        <svg className="plan-svg" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width="18" height="18" patternTransform="rotate(45)">
              <rect width="18" height="18" className="plan-hatch-ground" />
              <line x1="0" y1="0" x2="0" y2="18" className="plan-hatch-line" />
            </pattern>
          </defs>
          {site.outside
            .filter((piece) => piece.deck)
            .map((piece) => (
              <rect key={piece.key} className="plan-deck" x={piece.rect.x} y={piece.rect.y} width={piece.rect.width} height={piece.rect.height} />
            ))}
          {site.waters.map((water, i) => (
            <rect key={i} className="plan-water" x={water.x} y={water.y} width={water.width} height={water.height} rx={map.tileSize} />
          ))}
          <path className="plan-floor" d={floor} />
          {rooms.map((room) => (
            <rect
              key={room.key}
              className="plan-room"
              data-kind={room.kind}
              data-locked={room.locked || undefined}
              x={room.rect.x}
              y={room.rect.y}
              width={room.rect.width}
              height={room.rect.height}
              style={room.locked ? { fill: `url(#${CSS.escape(hatchId)})` } : undefined}
            />
          ))}
          {site.ring && <rect className="plan-table" x={site.ring.x} y={site.ring.y} width={site.ring.width} height={site.ring.height} />}
          {tables.map((table, i) => (
            <rect key={i} className="plan-table" x={table.x} y={table.y} width={table.width} height={table.height} />
          ))}
          <path className="plan-walls" d={site.walls} />
          {hearing && <rect className="plan-hearing" x={hearing.x} y={hearing.y} width={hearing.width} height={hearing.height} />}
          {site.outside.map((piece) => (
            <PlanLabel key={piece.key} label={piece} kind={piece.deck ? 'deck' : 'outside'} />
          ))}
          {rooms.map((room) => (
            <PlanLabel key={room.key} label={room} kind={room.kind} />
          ))}
        </svg>
        {rooms
          .filter((room) => room.locked)
          .map((room) => (
            <span
              key={room.key}
              className="plan-lock"
              style={{ left: pct(room.labelAt.x, size.width), top: pct(room.labelAt.y + room.fontSize * (room.lines.length * 0.5 + 1.1), size.height) }}
            >
              <LockIcon />
            </span>
          ))}
        {me && hearing === null && (
          <span className="plan-range" style={{ left: pct(me.x, size.width), top: pct(me.y, size.height), width: pct(2 * JOIN_DISTANCE_PX, size.width) }} aria-hidden="true" />
        )}
        {target && <span className="plan-pin" style={{ left: pct(target.x, size.width), top: pct(target.y, size.height) }} aria-hidden="true" />}
        {people.map((person) => (
          <div
            key={person.id}
            className="plan-person"
            data-self={person.self || undefined}
            style={{ left: pct(person.x, size.width), top: pct(person.y, size.height) }}
            onDoubleClick={(event) => runTo(event, person)}
          >
            <span className="plan-name">{person.name}</span>
            <span className="plan-head">
              <AvatarPortrait avatarKey={person.avatarKey} name={person.name} size={HEAD_PX} status={person.status} activity={person.activity} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Le nom d'un lieu sur le plan, centré sur son point, ses lignes autour du milieu. `kind` en donne la couleur (le dehors en vert, les terrasses en brun).
function PlanLabel({ label, kind }: { label: Pick<PlanRoom, 'lines' | 'fontSize' | 'labelAt'>; kind: string }) {
  if (label.lines.length === 0) return null;
  return (
    <text className="plan-label" data-kind={kind} x={label.labelAt.x} y={label.labelAt.y} fontSize={label.fontSize}>
      {label.lines.map((line, i) => (
        <tspan key={i} x={label.labelAt.x} dy={i === 0 ? `${0.36 - (label.lines.length - 1) * 0.5}em` : '1em'}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
