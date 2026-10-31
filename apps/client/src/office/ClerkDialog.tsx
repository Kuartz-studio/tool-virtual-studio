import { MISSION_TIERS, TASK_NOTES_MAX_LENGTH, TASK_TITLE_MAX_LENGTH, missionXp, propByKey, type MissionAck, type MissionTier, type TaskView } from '@bureau/shared';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { fr, t } from '../i18n/fr';
import { api } from '../lib/api';
import { cancelMission, listGivenMissions } from '../lib/progress-api';
import { EventBus } from '../game/EventBus';
import { sendMission } from '../net/mission-commands';
import { emitOnBus } from '../net/office-connection';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { CloseIcon, SearchIcon } from './icons';
import { formatNumber, shareText, tierLabel } from './progress-format';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { IconButton } from './ui/IconButton';
import { LevelBadge, TierPips } from './ui/ProgressBits';

// Les administratrices de l'accueil (leur clé sur la carte) et l'image de chacune : les deux blondes aux bouts, la brune au milieu.
const SPRITES: Record<string, string> = { margot: 'receptionist', ines: 'receptionist-2', lucie: 'receptionist' };
// Le portrait : le haut de la première image de sa planche (la tête et les épaules), agrandi trois fois, sans lissage.
const PORTRAIT = { top: 8, height: 30, scale: 3 } as const;
// La machine à écrire : tant de caractères toutes les TYPE_TICK_MS (environ 190 caractères par seconde : une réplique s'écrit en moins d'une seconde).
const TYPE_TICK_MS = 16;
const TYPE_STEP = 3;
// Sa voix pendant qu'elle écrit : un petit bip toutes les CLERK_VOICE_MS ms (audio/sfx-events.ts, chacun à sa hauteur), du premier caractère au dernier.
const CLERK_VOICE_MS = 75;

// Un membre, tel que GET /api/members le dit.
interface Member {
  id: string;
  name: string;
  avatarKey: string | null;
  level?: number;
}

type Step = 'menu' | 'who' | 'what' | 'tier' | 'confirm' | 'sent' | 'given';

// Ce que dit l'administratrice, lettre après lettre, comme dans un jeu (tout d'un coup avec prefers-reduced-motion). Un clic sur la bulle finit la phrase.
function useTypewriter(text: string): [string, () => void] {
  const [shown, setShown] = useState(text.length);
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const timer = setInterval(() => {
      setShown((count) => {
        if (count >= text.length) clearInterval(timer);
        return Math.min(text.length, count + TYPE_STEP);
      });
    }, TYPE_TICK_MS);
    return () => clearInterval(timer);
  }, [text]);
  // Tant que la phrase s'écrit, sa voix ; finie (ou un clic qui la finit), elle se tait.
  const typing = shown < text.length;
  useEffect(() => {
    if (!typing) return;
    emitOnBus(EventBus, 'clerk:voice');
    const voice = setInterval(() => emitOnBus(EventBus, 'clerk:voice'), CLERK_VOICE_MS);
    return () => clearInterval(voice);
  }, [typing, text]);
  return [text.slice(0, shown), () => setShown(text.length)];
}

function ClerkPortrait({ clerk }: { clerk: string }) {
  const prop = propByKey(SPRITES[clerk] ?? 'receptionist');
  if (!prop) return null;
  const { scale, top, height } = PORTRAIT;
  const style = {
    width: prop.frameWidth * scale,
    height: height * scale,
    backgroundImage: `url(${prop.sheet})`,
    backgroundSize: `${prop.frameWidth * prop.frames * scale}px ${prop.frameHeight * scale}px`,
    backgroundPosition: `0 ${-top * scale}px`,
  } satisfies CSSProperties;
  return <span className="clerk-portrait" style={style} aria-hidden="true" />;
}

// Une réplique : la bulle de l'administratrice, et sous elle les réponses possibles (des boutons, ou un formulaire).
function Line({ text, children }: { text: string; children?: ReactNode }) {
  const [shown, finish] = useTypewriter(text);
  return (
    <>
      <p className="clerk-speech" aria-live="polite" onClick={finish}>
        <span className="clerk-speech-full" aria-hidden="true">
          {text}
        </span>
        <span aria-hidden="true">{shown}</span>
        <span className="visually-hidden">{text}</span>
      </p>
      {children}
    </>
  );
}

// La conversation avec une administratrice de l'accueil (la touche E devant elle, ou un clic) : une boîte de dialogue en bas de l'écran, à la manière d'un jeu de
// rôle — son portrait, son nom, ce qu'elle dit lettre après lettre, et les réponses possibles :
// - « Confier une mission » : à qui (soi en tête, « Moi », puis les membres, une recherche), quoi (un intitulé, des précisions), quelle difficulté (de 1 à 10 : son
//   nom, son ordre de grandeur, son XP et ce qu'elle représente), un récapitulatif, puis l'envoi (`mission:give` : le serveur vérifie qu'on est encore au comptoir) ;
// - « Les missions que j'ai confiées » : celles de la semaine, leur état, et « Retirer » pour celles qui ne sont pas faites ;
// - « La boutique » et « Mes caractéristiques » ouvrent leur panneau (la conversation se ferme) ;
// - « Au revoir », Échap, ou s'éloigner du comptoir (le jeu le dit au magasin) la ferment.
export function ClerkDialog({ socket, onOpenPanel }: { socket: OfficeSocket | null; onOpenPanel(panel: 'shop' | 'missions'): void }) {
  const clerk = useOfficeStore((state) => state.clerk);
  const selfName = useOfficeStore((state) => state.self?.name ?? '');
  if (clerk === null) return null;
  // Une conversation neuve à chaque administratrice : la clé remet tout à zéro.
  return <Conversation key={clerk} clerk={clerk} selfName={selfName} socket={socket} onOpenPanel={onOpenPanel} />;
}

function Conversation({ clerk, selfName, socket, onOpenPanel }: { clerk: string; selfName: string; socket: OfficeSocket | null; onOpenPanel(panel: 'shop' | 'missions'): void }) {
  const selfId = useOfficeStore((state) => state.selfId);
  const self = useOfficeStore((state) => state.self);
  const players = useOfficeStore((state) => state.players);
  const given = useOfficeStore((state) => state.given);
  const name = fr.clerks.names[clerk as keyof typeof fr.clerks.names] ?? clerk;
  const greeting = fr.clerks.greetings[clerk as keyof typeof fr.clerks.greetings] ?? fr.clerks.greetings.margot;

  const [step, setStep] = useState<Step>('menu');
  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersFailed, setMembersFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<Member | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tier, setTier] = useState<MissionTier>(3);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const uid = useId();

  const close = () => useOfficeStore.getState().openClerk(null);

  // À chaque étape, le focus va à la première réponse (ou au premier champ) : le clavier suit la conversation.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-autofocus], .clerk-options button, input, textarea')?.focus();
  }, [step]);

  // Les membres, à la première étape qui en a besoin.
  useEffect(() => {
    if (step !== 'who' || members !== null) return;
    let current = true;
    api<Member[]>('/api/members').then(
      (list) => current && setMembers(list),
      () => current && setMembersFailed(true),
    );
    return () => {
      current = false;
    };
  }, [step, members]);

  // Les missions qu'on a confiées, à l'ouverture de leur liste (le temps réel la tient ensuite à jour).
  useEffect(() => {
    if (step !== 'given') return;
    let current = true;
    listGivenMissions().then(
      (list) => current && useOfficeStore.getState().setGiven(list),
      () => current && setError(fr.clerks.errors.unavailable),
    );
    return () => {
      current = false;
    };
  }, [step]);

  // Ceux à qui l'on peut confier une mission : soi d'abord (« Moi » : on peut se donner une mission), puis les autres membres, ceux qui sont là d'abord, puis par
  // nom ; filtrés par la recherche (sans accents ; « moi » trouve soi).
  const candidates = useMemo(() => {
    const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const query = fold(search.trim());
    const matches = (member: Member) => query === '' || fold(member.name).includes(query) || (member.id === selfId && fold(fr.clerks.me).includes(query));
    return (members ?? [])
      .filter(matches)
      .sort(
        (a, b) =>
          Number(b.id === selfId) - Number(a.id === selfId) ||
          Number(Object.hasOwn(players, b.id)) - Number(Object.hasOwn(players, a.id)) ||
          a.name.localeCompare(b.name, 'fr'),
      );
  }, [members, search, selfId, players]);
  // La mission est pour soi : la conversation le dit autrement.
  const forSelf = target !== null && target.id === selfId;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function pick(member: Member) {
    setTarget(member);
    setError(null);
    setStep('what');
  }

  function toTier(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === '') return;
    setStep('tier');
  }

  async function send() {
    if (!target || sending) return;
    setSending(true);
    setError(null);
    const ack: MissionAck = await sendMission(socket, { to: target.id, title: title.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}), tier });
    setSending(false);
    if (!ack.ok) {
      setError(ack.error === 'limit' && forSelf ? fr.clerks.limitSelf : fr.clerks.errors[ack.error]);
      return;
    }
    // Une mission qu'on se donne arrive dans sa liste (`task:assigned`) ; elle n'est pas de celles qu'on a confiées aux autres.
    if (!forSelf) useOfficeStore.getState().upsertGiven(ack.task);
    setStep('sent');
  }

  function another() {
    setTarget(null);
    setTitle('');
    setNotes('');
    setTier(3);
    setSearch('');
    setStep('who');
  }

  async function withdraw(task: TaskView) {
    try {
      useOfficeStore.getState().upsertGiven(await cancelMission(task.id));
    } catch {
      setError(fr.clerks.errors.unavailable);
    }
  }

  function open(panel: 'shop' | 'missions') {
    close();
    onOpenPanel(panel);
  }

  const back = (to: Step) => (
    <button type="button" className="bar-button" data-sfx="cancel" onClick={() => setStep(to)}>
      {fr.clerks.back}
    </button>
  );

  let content: ReactNode;
  switch (step) {
    case 'menu':
      content = (
        <Line text={t(greeting, { name: selfName })}>
          <div className="clerk-options">
            <button type="button" onClick={() => setStep('who')}>
              {fr.clerks.menu.give}
            </button>
            <button type="button" onClick={() => setStep('given')}>
              {fr.clerks.menu.given}
            </button>
            <button type="button" onClick={() => open('shop')}>
              {fr.clerks.menu.shop}
            </button>
            <button type="button" onClick={() => open('missions')}>
              {fr.clerks.menu.sheet}
            </button>
            <button type="button" data-sfx="none" onClick={close}>
              {fr.clerks.menu.bye}
            </button>
          </div>
        </Line>
      );
      break;
    case 'who':
      content = (
        <Line text={fr.clerks.who}>
          <div className="clerk-search">
            <SearchIcon />
            <label className="visually-hidden" htmlFor={`${uid}-who`}>
              {fr.clerks.whoSearchLabel}
            </label>
            <input id={`${uid}-who`} type="search" value={search} placeholder={fr.clerks.whoSearch} autoComplete="off" onChange={(event) => setSearch(event.target.value)} />
          </div>
          {members === null && <p className="clerk-note">{membersFailed ? fr.clerks.whoFailed : fr.clerks.whoLoading}</p>}
          {members !== null && candidates.length === 0 && <p className="clerk-note">{fr.clerks.whoEmpty}</p>}
          <ul className="clerk-people">
            {candidates.map((member) => {
              const me = member.id === selfId;
              // Soi n'est pas parmi les autres présents (`players`) : son statut et son niveau sont les siens.
              const here = me ? self : players[member.id];
              return (
                <li key={member.id}>
                  <button type="button" onClick={() => pick(member)} data-user={member.id} data-self={me || undefined}>
                    <AvatarPortrait avatarKey={member.avatarKey} name={member.name} size={28} status={here?.status ?? null} activity={here?.activity} />
                    <span className="clerk-person-name">{me ? fr.clerks.me : member.name}</span>
                    <LevelBadge level={here?.level ?? member.level ?? 0} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="clerk-actions">{back('menu')}</div>
        </Line>
      );
      break;
    case 'what':
      content = (
        <Line text={forSelf ? fr.clerks.whatSelf : t(fr.clerks.what, { name: target?.name ?? '' })}>
          <form className="clerk-form" onSubmit={toTier}>
            <label htmlFor={`${uid}-title`}>{fr.clerks.titleLabel}</label>
            <input id={`${uid}-title`} value={title} maxLength={TASK_TITLE_MAX_LENGTH} placeholder={fr.clerks.titlePlaceholder} autoComplete="off" onChange={(event) => setTitle(event.target.value)} />
            <label htmlFor={`${uid}-notes`}>{fr.clerks.notesLabel}</label>
            <textarea id={`${uid}-notes`} value={notes} rows={3} maxLength={TASK_NOTES_MAX_LENGTH} placeholder={fr.clerks.notesPlaceholder} onChange={(event) => setNotes(event.target.value)} />
            <div className="clerk-actions">
              {back('who')}
              <button type="submit" className="bar-button is-primary" disabled={title.trim() === ''}>
                {fr.clerks.next}
              </button>
            </div>
          </form>
        </Line>
      );
      break;
    case 'tier':
      content = (
        <Line text={fr.clerks.tier}>
          <div className="clerk-tiers" role="radiogroup" aria-label={fr.clerks.tierLabel}>
            {MISSION_TIERS.map((step_) => (
              <button
                key={step_}
                type="button"
                role="radio"
                aria-checked={tier === step_}
                className="clerk-tier"
                data-tier={step_}
                data-autofocus={tier === step_ ? true : undefined}
                onClick={() => setTier(step_)}
                onDoubleClick={() => setStep('confirm')}
              >
                <span className="clerk-tier-n">{step_}</span>
                <span className="clerk-tier-label">{tierLabel(step_)}</span>
                <span className="clerk-tier-hint">{fr.progress.tiers[step_].hint}</span>
                <span className="clerk-tier-xp">+{formatNumber(missionXp(step_))} XP</span>
              </button>
            ))}
          </div>
          <p className="clerk-note">
            <TierPips tier={tier} /> {shareText(missionXp(tier))}
          </p>
          <div className="clerk-actions">
            {back('what')}
            <button type="button" className="bar-button is-primary" onClick={() => setStep('confirm')}>
              {fr.clerks.next}
            </button>
          </div>
        </Line>
      );
      break;
    case 'confirm':
      content = (
        <Line
          text={t(forSelf ? fr.clerks.recapSelf : fr.clerks.recap, {
            name: target?.name ?? '',
            title: title.trim(),
            tier,
            label: tierLabel(tier),
            xp: formatNumber(missionXp(tier)),
            share: shareText(missionXp(tier)),
          })}
        >
          <div className="clerk-actions">
            <button type="button" className="bar-button" data-sfx="cancel" onClick={() => setStep('what')}>
              {fr.clerks.edit}
            </button>
            <button type="button" className="bar-button is-primary" data-autofocus disabled={sending} onClick={() => void send()}>
              {sending ? fr.clerks.sending : fr.clerks.confirm}
            </button>
          </div>
        </Line>
      );
      break;
    case 'sent':
      content = (
        <Line text={forSelf ? fr.clerks.sentSelf : t(fr.clerks.sent, { name: target?.name ?? '' })}>
          <div className="clerk-options">
            <button type="button" onClick={another}>
              {fr.clerks.another}
            </button>
            <button type="button" data-sfx="cancel" onClick={close}>
              {fr.clerks.thanks}
            </button>
          </div>
        </Line>
      );
      break;
    case 'given':
      content = (
        <Line text={given === null ? fr.clerks.givenLoading : given.length === 0 ? fr.clerks.givenEmpty : fr.clerks.given}>
          {given !== null && given.length > 0 && (
            <ul className="clerk-given">
              {given.map((task) => (
                <li key={task.id} data-task={task.id} data-status={task.status}>
                  <span className="clerk-given-text">
                    <span className="clerk-given-title">{task.title}</span>
                    <span className="clerk-given-meta">
                      {t(fr.clerks.givenTo, { name: task.owner.name })} · {task.tier !== null ? tierLabel(task.tier) : ''} · {fr.clerks.givenStatus[task.status]}
                    </span>
                  </span>
                  {task.status === 'open' && (
                    <button type="button" className="bar-button" aria-label={t(fr.clerks.cancelLabel, { title: task.title })} onClick={() => void withdraw(task)}>
                      {fr.clerks.cancel}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="clerk-actions">{back('menu')}</div>
        </Line>
      );
      break;
  }

  return (
    <div ref={box} className="clerk-dialog" role="dialog" aria-label={t(fr.clerks.dialogLabel, { name })} data-sfx-hover data-sfx-modal onKeyDown={onKeyDown}>
      <div className="clerk-side">
        <ClerkPortrait clerk={clerk} />
        <span className="clerk-name">{name}</span>
        <span className="clerk-role">{fr.clerks.role}</span>
      </div>
      <div className="clerk-main">
        {error && (
          <p className="clerk-error" role="alert">
            {error}
          </p>
        )}
        {content}
      </div>
      <IconButton label={fr.clerks.close} small tip="bottom" className="clerk-close" data-sfx="none" onClick={close}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}
