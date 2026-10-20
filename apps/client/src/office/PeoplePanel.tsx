import type { Status } from '@bureau/shared';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { api } from '../lib/api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { sortPeople, type Person } from './people';
import { StatusDot } from './StatusDot';

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

// Le panneau Personnes (spec §10) : les membres en ligne, puis ceux hors ligne, chacun avec son point de statut et son statut écrit.
//
// Qui est en ligne et avec quel statut, c'est le magasin (ce que le serveur dit en direct) : les personnes en ligne sont affichées dès
// l'ouverture, sans attendre la liste des membres (GET /api/members, chargée à l'ouverture), qui apporte les hors ligne. Une personne en
// ligne que cette liste ne connaît pas (un compte créé depuis son chargement) la fait recharger, une fois par personne : elle serait
// sinon absente des hors ligne quand elle repart.
//
// Le focus va au titre à l'ouverture (le lecteur d'écran l'annonce, et Tab entre dans le panneau) ; Échap ferme.
export function PeoplePanel({ id, onClose }: { id?: string; onClose(): void }) {
  const self = useOfficeStore((state) => state.self);
  const players = useOfficeStore((state) => state.players);
  const { members, failed, reload } = useMembers();
  const titleId = useId();
  const onlineTitleId = useId();
  const offlineTitleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

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

  const { online, offline, statuses } = useMemo(() => {
    const people = new Map<string, Person>();
    for (const member of members ?? []) people.set(member.id, member);
    // Le nom en ligne est celui que le serveur vient de dire, pas celui de la liste chargée à l'ouverture.
    for (const p of present) people.set(p.id, p);
    const sorted = sortPeople([...people.values()], new Set(present.map((p) => p.id)));
    return { ...sorted, statuses: new Map<string, Status>(present.map((p) => [p.id, p.status])) };
  }, [members, present]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  const row = (person: Person) => {
    const status = statuses.get(person.id) ?? null;
    return (
      <li key={person.id} className="person">
        <StatusDot status={status} userId={person.id} />
        <span className="person-name">{person.name}</span>
        {self?.id === person.id && <span className="person-you">{fr.office.people.you}</span>}
        {status && <span className="person-status">{fr.status[status]}</span>}
      </li>
    );
  };

  return (
    <aside id={id} className="people-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="people-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {fr.office.people.title}
        </h2>
        <button type="button" className="bar-button" aria-label={fr.office.people.close} onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <div className="people-lists">
        {online.length > 0 && (
          <section className="people-group" aria-labelledby={onlineTitleId}>
            <h3 id={onlineTitleId}>{t(fr.office.people.online, { count: online.length })}</h3>
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
            <h3 id={offlineTitleId}>{t(fr.office.people.offline, { count: offline.length })}</h3>
            <ul className="people-list">{offline.map(row)}</ul>
          </section>
        )}
      </div>
    </aside>
  );
}
