import type { ActivityState, Status } from '@bureau/shared';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { fr, t } from '../i18n/fr';
import { api } from '../lib/api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { ActivityMark } from './ActivityMark';
import { AudioLinesIcon, ChevronRightIcon, PlaceIcon } from './icons';
import { sortPeople, type Person } from './people';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { Drawer } from './ui/Drawer';
import { Segmented, type SegmentedOption } from './ui/Segmented';
import { usePlace, usePlaces } from './use-here';

// Un membre, tel que GET /api/members le dit (les membres actifs, sans adresse ni rôle).
interface Member {
  id: string;
  name: string;
  avatarKey: string | null;
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

// Une personne, telle que la liste la montre : son nom et son personnage, et pour celle qui est en ligne son statut et son état d'activité.
interface Row extends Person {
  avatarKey: string | null;
  // null : hors ligne.
  status: Status | null;
  activity: ActivityState | null;
}

type View = 'here' | 'all';

// Le panneau Personnes (spec §10), dans la coque des panneaux (Drawer) : un sélecteur à deux positions, « Ici » (ceux qui sont dans le même lieu que
// soi, soi compris : placeAt, la même règle que la puce du lieu) et « Tout le bureau » (tous ceux qui sont en ligne, puis les hors ligne, repliés sous
// leur compte). Chaque ligne : le portrait de 38 px avec la pastille de son statut, le nom (et « toi » pour soi), et dessous ce qu'elle fait : son
// mode (l'icône et le nom de l'état d'activité), sinon « Parle avec toi » si elle est dans notre conversation (`talkingWith` : ses identifiants), sinon
// son lieu. Le statut est dit aux lecteurs d'écran, la pastille ne leur dit rien.
//
// Qui est en ligne et avec quel statut, c'est le magasin (ce que le serveur dit en direct) : les personnes en ligne sont affichées dès
// l'ouverture, sans attendre la liste des membres (GET /api/members, chargée à l'ouverture), qui apporte les hors ligne. Une personne en
// ligne que cette liste ne connaît pas (un compte créé depuis son chargement) la fait recharger, une fois par personne : elle serait
// sinon absente des hors ligne quand elle repart.
//
// Le focus va au titre à l'ouverture (le lecteur d'écran l'annonce, et Tab entre dans le panneau) ; Échap ferme.
export function PeoplePanel({ id, onClose, talkingWith = NOBODY }: { id?: string; onClose(): void; talkingWith?: readonly string[] }) {
  const self = useOfficeStore((state) => state.self);
  const players = useOfficeStore((state) => state.players);
  const { members, failed, reload } = useMembers();
  const place = usePlace();
  const places = usePlaces();
  const [view, setView] = useState<View>('here');
  const [offlineOpen, setOfflineOpen] = useState(false);
  const uid = useId();
  const panelId = `${uid}-liste`;
  const tabId = (which: View) => `${uid}-onglet-${which}`;
  const offlineTitleId = `${uid}-hors-ligne`;
  const offlineListId = `${uid}-hors-ligne-liste`;

  // Les personnes en ligne : soi-même et les autres joueurs du bureau.
  const present = useMemo(() => (self ? [self, ...Object.values(players)] : Object.values(players)), [self, players]);

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

  const { online, offline } = useMemo(() => {
    const people = new Map<string, Row>();
    for (const member of members ?? []) people.set(member.id, { ...member, status: null, activity: null });
    // Le nom en ligne est celui que le serveur vient de dire, pas celui de la liste chargée à l'ouverture.
    for (const p of present) people.set(p.id, { id: p.id, name: p.name, avatarKey: p.avatarKey, status: p.status, activity: p.activity ?? null });
    const sorted = sortPeople([...people.values()], new Set(present.map((p) => p.id)));
    // Soi-même d'abord : c'est la ligne qu'on cherche en premier.
    return { online: [...sorted.online.filter((p) => p.id === self?.id), ...sorted.online.filter((p) => p.id !== self?.id)], offline: sorted.offline };
  }, [members, present, self?.id]);

  // Ceux d'ici : soi, et ceux dont le lieu est le sien. Sans carte (le jeu n'est pas encore là), on n'a pas de lieu : soi seul.
  const here = useMemo(() => online.filter((p) => p.id === self?.id || (place !== null && places.get(p.id) === place)), [online, self?.id, place, places]);
  const talking = useMemo(() => new Set(talkingWith), [talkingWith]);

  // Ce que fait la personne, sous son nom : son mode, sinon la conversation, sinon son lieu (le sien, pour soi : la puce du lieu).
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
    if (where === null) return null;
    return (
      <>
        <PlaceIcon />
        <span>{where}</span>
      </>
    );
  }

  const options: SegmentedOption<View>[] = [
    { id: 'here', label: fr.office.people.here, count: here.length },
    { id: 'all', label: fr.office.people.all, count: online.length },
  ];

  const row = (person: Row) => {
    const mine = person.id === self?.id;
    const sub = person.status === null ? null : doing(person);
    return (
      <li key={person.id} className="person" data-user={person.id} data-status={person.status ?? undefined}>
        <AvatarPortrait avatarKey={person.avatarKey} name={person.name} size={38} status={person.status} />
        <span className="person-text">
          <span className="person-head">
            {/* Un nom trop long est coupé (« … ») : l'infobulle le donne en entier. */}
            <span className="person-name" title={person.name}>
              {person.name}
            </span>
            {mine && <span className="person-you">{fr.office.people.you}</span>}
          </span>
          {sub && <span className="person-sub">{sub}</span>}
        </span>
        {person.status && <span className="visually-hidden">{fr.status[person.status]}</span>}
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
    </Drawer>
  );
}
