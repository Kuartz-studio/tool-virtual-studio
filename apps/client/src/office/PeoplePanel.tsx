import { timezoneOrDefault, type ActivityState, type Status } from '@bureau/shared';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { fr, t } from '../i18n/fr';
import { api } from '../lib/api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { ActivityMark } from './ActivityMark';
import { AudioLinesIcon, ChevronRightIcon, LastSeenIcon, PlaceIcon } from './icons';
import { LastSeen } from './LastSeen';
import { useLocalTimeHover } from './LocalTime';
import { sortPeople, type Person } from './people';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { Drawer } from './ui/Drawer';
import { LevelBadge } from './ui/ProgressBits';
import { Segmented, type SegmentedOption } from './ui/Segmented';
import { usePlaces } from './use-here';

// Un membre, tel que GET /api/members le dit (les membres actifs, sans adresse ni rôle). lastSeenAt : sa dernière connexion (ISO 8601),
// null s'il n'est jamais venu au bureau. timezone : son fuseau horaire (absent d'un serveur d'avant la colonne : l'heure de Paris).
interface Member {
  id: string;
  name: string;
  avatarKey: string | null;
  lastSeenAt: string | null;
  // Son niveau (absent d'un serveur d'avant la progression : 0).
  level?: number;
  timezone?: string;
}

interface Members {
  // null tant que la liste n'est pas arrivée.
  members: Member[] | null;
  // Le premier chargement a échoué (un rechargement qui échoue, lui, garde la liste déjà là).
  failed: boolean;
  reload(): Promise<void>;
}

// Les membres du serveur, chargés à l'ouverture du panneau. reload() recharge ; seule la réponse à la demande la plus récente compte
// (deux demandes en vol, StrictMode ou un nouvel essai, ne se marchent pas dessus).
function useMembers(): Members {
  const [state, setState] = useState<{ members: Member[] | null; failed: boolean }>({ members: null, failed: false });
  const latest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    // Un nouvel essai après un échec : « Chargement… » de nouveau.
    setState((previous) => (previous.failed ? { members: null, failed: false } : previous));
    try {
      const members = await api<Member[]>('/api/members');
      if (mounted.current && request === latest.current) setState({ members, failed: false });
    } catch {
      // Un rechargement en arrière-plan qui échoue laisse la liste déjà là ; seul le premier chargement a un message d'échec.
      if (mounted.current && request === latest.current) setState((previous) => (previous.members ? previous : { members: null, failed: true }));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}

// Ceux qu'on ne connaît que par leur identifiant : personne n'est en conversation avec soi tant que l'appelant ne le dit pas.
const NOBODY: readonly string[] = [];

// Une personne, telle que la liste la montre : son nom et son personnage, pour celle qui est en ligne son statut et son état d'activité,
// pour celle qui ne l'est pas sa dernière connexion.
interface Row extends Person {
  avatarKey: string | null;
  // null : hors ligne.
  status: Status | null;
  activity: ActivityState | null;
  // En millisecondes ; null : jamais venue (ou en ligne, où elle ne sert pas).
  seenAt: number | null;
  level: number;
  // Son fuseau horaire : l'heure qu'il est chez elle, au survol de sa ligne.
  timezone: string;
}

type View = 'here' | 'all';

// Le panneau Personnes (spec §10), dans la coque des panneaux (Drawer) : un sélecteur à deux positions, « Tout le bureau » (tous ceux qui sont en ligne,
// puis les hors ligne, dépliés sous leur compte, qu'un clic replie), choisi à chaque ouverture, et « Ici » (ceux qui sont dans le même lieu que soi, soi
// compris : `place`, le lieu que la coque suit et donne aussi à la puce du lieu ; celui de chacun des autres est celui de placeAt). Chaque ligne : le
// portrait de 38 px avec la pastille de son statut, le nom (et « toi » pour soi), et dessous ce qu'elle fait : son
// mode (l'icône et le nom de l'état d'activité), sinon « Parle avec toi » si elle est dans notre conversation (`talkingWith` : ses identifiants), sinon
// son lieu, sinon « En ligne ». Hors ligne, dessous : sa dernière connexion (« Il y a 3 h », LastSeen), rafraîchie chaque minute. Le statut
// est dit aux lecteurs d'écran, la pastille ne leur dit rien. Au survol d'une ligne, ou à son focus (chaque ligne en prend un), la carte de l'heure
// qu'il est chez la personne (useLocalTimeHover : son fuseau, en direct, et l'écart avec le sien), en ligne ou non.
//
// Qui est en ligne et avec quel statut, c'est le magasin (ce que le serveur dit en direct) : les personnes en ligne sont affichées dès
// l'ouverture, sans attendre la liste des membres (GET /api/members, chargée à l'ouverture), qui apporte les hors ligne. Une personne en
// ligne que cette liste ne connaît pas (un compte créé depuis son chargement) la fait recharger, une fois par personne : elle serait
// sinon absente des hors ligne quand elle repart. Une personne qui part la fait recharger aussi : le serveur a enregistré sa dernière
// connexion avant d'annoncer son départ, et la liste chargée à l'ouverture ne la connaît pas.
//
// Le focus va au titre à l'ouverture (le lecteur d'écran l'annonce, et Tab entre dans le panneau) ; Échap ferme.
// Le niveau de chacun, à côté de son nom (celui du temps réel pour qui est en ligne, celui de la liste pour les autres) ; un clic sur une ligne ouvre ses
// caractéristiques (`onOpenSheet`), les siennes comprises.
export function PeoplePanel({
  id,
  place,
  onClose,
  talkingWith = NOBODY,
  onOpenSheet,
}: {
  id?: string;
  place: string | null;
  onClose(): void;
  talkingWith?: readonly string[];
  onOpenSheet?(userId: string): void;
}) {
  const self = useOfficeStore((state) => state.self);
  const players = useOfficeStore((state) => state.players);
  const { members, failed, reload } = useMembers();
  const places = usePlaces();
  const [view, setView] = useState<View>('all');
  const [offlineOpen, setOfflineOpen] = useState(true);
  const uid = useId();
  const panelId = `${uid}-liste`;
  const tabId = (which: View) => `${uid}-onglet-${which}`;
  const offlineTitleId = `${uid}-hors-ligne`;
  const offlineListId = `${uid}-hors-ligne-liste`;

  // Les personnes en ligne : soi-même et les autres joueurs du bureau.
  const present = useMemo(() => (self ? [self, ...Object.values(players)] : Object.values(players)), [self, players]);
  const presentIds = useMemo(() => new Set(present.map((p) => p.id)), [present]);

  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (members === null) return;
    const known = new Set(members.map((member) => member.id));
    const unknown = present.filter((p) => !known.has(p.id) && !requested.current.has(p.id));
    if (unknown.length === 0) return;
    // Une fois par personne : si le serveur ne la connaît pas davantage après ce rechargement, on n'insiste pas.
    for (const p of unknown) requested.current.add(p.id);
    void reload();
  }, [members, present, reload]);

  // Quelqu'un est parti depuis le dernier rendu : la liste rechargée donne sa dernière connexion.
  const wasPresent = useRef(presentIds);
  useEffect(() => {
    const someoneLeft = [...wasPresent.current].some((id) => !presentIds.has(id));
    wasPresent.current = presentIds;
    if (someoneLeft) void reload();
  }, [presentIds, reload]);

  const { online, offline } = useMemo(() => {
    const people = new Map<string, Row>();
    for (const { lastSeenAt, level, timezone, ...member } of members ?? []) {
      people.set(member.id, { ...member, status: null, activity: null, seenAt: lastSeenAt ? Date.parse(lastSeenAt) : null, level: level ?? 0, timezone: timezoneOrDefault(timezone) });
    }
    // Le nom, le niveau et le fuseau en ligne sont ceux que le serveur vient de dire, pas ceux de la liste chargée à l'ouverture.
    for (const p of present) {
      const timezone = timezoneOrDefault(p.timezone ?? people.get(p.id)?.timezone);
      people.set(p.id, { id: p.id, name: p.name, avatarKey: p.avatarKey, status: p.status, activity: p.activity ?? null, seenAt: null, level: p.level ?? 0, timezone });
    }
    const sorted = sortPeople([...people.values()], presentIds);
    // Soi-même d'abord : c'est la ligne qu'on cherche en premier.
    return { online: [...sorted.online.filter((p) => p.id === self?.id), ...sorted.online.filter((p) => p.id !== self?.id)], offline: sorted.offline };
  }, [members, present, presentIds, self?.id]);

  // Ceux d'ici : soi, et ceux dont le lieu est le sien. Sans carte (le jeu n'est pas encore là), on n'a pas de lieu : soi seul.
  const here = useMemo(() => online.filter((p) => p.id === self?.id || (place !== null && places.get(p.id) === place)), [online, self?.id, place, places]);
  const talking = useMemo(() => new Set(talkingWith), [talkingWith]);

  // L'heure qu'il est chez chacun, au survol de sa ligne : la carte lit, à chaque rendu, le fuseau et le nom du moment.
  const byId = useMemo(() => new Map([...online, ...offline].map((person) => [person.id, person])), [online, offline]);
  const timeHover = useLocalTimeHover((id) => {
    const person = byId.get(id);
    return person && { timezone: person.timezone, name: person.name, self: person.id === self?.id };
  });

  // Ce que fait la personne, sous son nom : son mode, sinon la conversation, sinon son lieu (le sien, pour soi : la puce du lieu), sinon
  // qu'elle est en ligne (le lieu n'est connu qu'avec la carte).
  function doing(person: Row) {
    if (person.activity) {
      return (
        <>
          <ActivityMark activity={person.activity} />
          <span>{person.activity.label}</span>
        </>
      );
    }
    if (talking.has(person.id)) {
      return (
        <>
          <AudioLinesIcon />
          <span>{fr.office.people.talking}</span>
        </>
      );
    }
    const where = person.id === self?.id ? place : (places.get(person.id) ?? null);
    if (where === null) return <span>{fr.office.people.seen.online}</span>;
    return (
      <>
        <PlaceIcon />
        <span>{where}</span>
      </>
    );
  }

  const options: SegmentedOption<View>[] = [
    { id: 'all', label: fr.office.people.all, count: online.length },
    { id: 'here', label: fr.office.people.here, count: here.length },
  ];

  // Ce qu'on sait d'une personne hors ligne : depuis quand on ne l'a plus vue. Jamais venue, rien.
  const lastSeen = (person: Row) =>
    person.seenAt === null ? null : (
      <>
        <LastSeenIcon />
        <LastSeen at={person.seenAt} />
      </>
    );

  const row = (person: Row) => {
    const mine = person.id === self?.id;
    const sub = person.status === null ? lastSeen(person) : doing(person);
    return (
      <li key={person.id} className="person" data-user={person.id} data-status={person.status ?? undefined} {...timeHover.bind(person.id)}>
        <AvatarPortrait avatarKey={person.avatarKey} name={person.name} size={38} status={person.status} />
        <span className="person-text">
          <span className="person-head">
            {/* Un nom trop long est coupé (« … ») : l'infobulle le donne en entier. */}
            <span className="person-name" title={person.name}>
              {person.name}
            </span>
            {mine && <span className="person-you">{fr.office.people.you}</span>}
            <LevelBadge level={person.level} />
          </span>
          {sub && <span className="person-sub">{sub}</span>}
        </span>
        {person.status && <span className="visually-hidden">{fr.status[person.status]}</span>}
        {onOpenSheet && (
          // Toute la ligne ouvre ses caractéristiques : un bouton étendu par-dessus (styles.css), que le clavier atteint comme les autres.
          <button type="button" className="person-open" aria-label={t(fr.sheet.open, { name: person.name })} onClick={() => onOpenSheet(person.id)} />
        )}
      </li>
    );
  };

  return (
    <Drawer title={fr.office.people.title} onClose={onClose} id={id}>
      <Segmented
        label={fr.office.people.tabsLabel}
        value={view}
        panelId={panelId}
        tabId={tabId}
        options={options}
        onSelect={(which) => setView(which)}
      />
      <div id={panelId} className="people-body" role="tabpanel" aria-labelledby={tabId(view)}>
        {view === 'here' ? (
          <section className="people-group" aria-label={t(fr.office.people.hereList, { count: here.length })}>
            <ul className="people-list">{here.map(row)}</ul>
            {here.length <= 1 && <p className="people-empty">{fr.office.people.nobodyHere}</p>}
          </section>
        ) : (
          <>
            {online.length > 0 && (
              <section className="people-group" aria-label={t(fr.office.people.online, { count: online.length })}>
                <ul className="people-list">{online.map(row)}</ul>
              </section>
            )}
            {members === null && !failed && <p className="people-loading">{fr.common.loading}</p>}
            {failed && (
              <div className="people-failed">
                <Alert>{fr.office.people.loadFailed}</Alert>
                <button type="button" className="bar-button" onClick={() => void reload()}>
                  {fr.common.retry}
                </button>
              </div>
            )}
            {offline.length > 0 && (
              <section className="people-group" aria-labelledby={offlineTitleId}>
                <h3 id={offlineTitleId} className="people-fold">
                  <button type="button" aria-expanded={offlineOpen} aria-controls={offlineListId} data-sfx="click" onClick={() => setOfflineOpen((wasOpen) => !wasOpen)}>
                    <ChevronRightIcon />
                    {t(fr.office.people.offline, { count: offline.length })}
                  </button>
                </h3>
                {offlineOpen && (
                  <ul id={offlineListId} className="people-list">
                    {offline.map(row)}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
      {timeHover.card}
    </Drawer>
  );
}
