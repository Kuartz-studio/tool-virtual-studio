import { MAX_LEVEL, TODO_DAILY_XP, TODO_XP, levelOf, levelProgress, type TaskView } from '@bureau/shared';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { ApiError } from '../lib/api';
import { completeTask, createTodo, declineMission, deleteTodo, fetchMyProgress, markMissionsSeen, updateTodo } from '../lib/progress-api';
import { Alert } from '../pages/AuthLayout';
import { selectNewMissions, useOfficeStore } from '../state/office-store';
import { CharacterSheet } from './CharacterSheet';
import { CheckIcon, ChevronRightIcon, KuartzonIcon, StreakIcon, TrashIcon } from './icons';
import { formatNumber, gradeLabel, kuartzonsText, shareText, tierLabel } from './progress-format';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { Drawer } from './ui/Drawer';
import { LevelBadge, TierPips, XpBar } from './ui/ProgressBits';
import { Segmented, type SegmentedOption } from './ui/Segmented';

export type QuestTab = 'todo' | 'sheet';

// Sa progression, en tête du panneau : la pastille du niveau, le grade, la barre de l'XP et ce qu'il reste avant le niveau suivant, puis ses kuartzons et sa série.
function ProgressCard() {
  const progress = useOfficeStore((state) => state.progress);
  const xp = progress?.xp ?? 0;
  const level = levelOf(xp);
  const { into, size } = levelProgress(xp);
  return (
    <div className="quest-card">
      <LevelBadge level={level} size="large" />
      <div className="quest-card-text">
        <span className="quest-card-title">
          {t(fr.progress.level, { level })} · {gradeLabel(level)}
        </span>
        <XpBar xp={xp} />
        <span className="quest-card-next">{level >= MAX_LEVEL ? fr.progress.maxed : t(fr.progress.toNext, { left: formatNumber(size - into), next: level + 1 })}</span>
      </div>
      <div className="quest-card-side">
        <span className="quest-chip" title={fr.shop.wallet}>
          <KuartzonIcon />
          {kuartzonsText(progress?.kuartzons ?? 0)}
        </span>
        {(progress?.streak ?? 0) > 0 && (
          <span className="quest-chip" title={fr.sheet.streak}>
            <StreakIcon />
            {progress!.streak === 1 ? fr.sheet.streakDay : t(fr.sheet.streakDays, { count: progress!.streak })}
          </span>
        )}
      </div>
    </div>
  );
}

// Une mission reçue : qui la confie, son intitulé et ses précisions, sa difficulté (les crans, son nom, son XP et ce qu'elle représente), et deux gestes :
// la terminer, ou la rendre (après confirmation).
function MissionCard({ task, onFinish, onGiveBack, busy }: { task: TaskView; onFinish(): void; onGiveBack(): void; busy: boolean }) {
  const players = useOfficeStore((state) => state.players);
  const [confirming, setConfirming] = useState(false);
  const giver = task.giver;
  return (
    <li className="mission" data-task={task.id} data-new={task.seen ? undefined : true}>
      <div className="mission-from">
        {giver && <AvatarPortrait avatarKey={players[giver.id]?.avatarKey ?? null} name={giver.name} size={22} />}
        <span>{giver ? t(fr.missions.from, { name: giver.name }) : fr.missions.fromGone}</span>
        {!task.seen && <span className="mission-new">{fr.missions.new}</span>}
      </div>
      <p className="mission-title">{task.title}</p>
      {task.notes && <p className="mission-notes">{task.notes}</p>}
      {task.tier !== null && (
        <div className="mission-reward">
          <TierPips tier={task.tier} />
          <span className="mission-tier">{t(fr.progress.tierOf, { tier: task.tier })} · {tierLabel(task.tier)}</span>
          <span className="mission-xp" title={shareText(task.xp)}>
            +{formatNumber(task.xp)} XP
          </span>
        </div>
      )}
      {confirming ? (
        <div className="mission-actions">
          <span className="mission-confirm">{t(fr.missions.giveBackConfirm, { name: giver?.name ?? '' })}</span>
          <button type="button" className="bar-button" data-sfx="cancel" onClick={() => setConfirming(false)}>
            {fr.missions.keep}
          </button>
          <button type="button" className="bar-button is-danger" disabled={busy} onClick={onGiveBack}>
            {fr.missions.giveBackYes}
          </button>
        </div>
      ) : (
        <div className="mission-actions">
          <button type="button" className="bar-button" disabled={busy} onClick={() => setConfirming(true)}>
            {fr.missions.giveBack}
          </button>
          <button type="button" className="bar-button is-primary" disabled={busy} aria-label={t(fr.missions.finishLabel, { title: task.title })} data-sfx="none" onClick={onFinish}>
            <CheckIcon />
            {fr.missions.finish}
          </button>
        </div>
      )}
    </li>
  );
}

// Une tâche de sa liste : la case à cocher, l'intitulé (un clic le modifie : Entrée enregistre, Échap renonce), l'XP qu'elle rapportera (`xp` : 0 une fois le
// plafond du jour atteint), et la corbeille.
function TodoRow({ task, xp, busy, onCheck, onRename, onRemove }: { task: TaskView; xp: number; busy: boolean; onCheck(): void; onRename(title: string): void; onRemove(): void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.title);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const next = value.trim();
      setEditing(false);
      if (next !== '' && next !== task.title) onRename(next);
      else setValue(task.title);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
      setValue(task.title);
    }
  }

  return (
    <li className="todo" data-task={task.id}>
      <input type="checkbox" className="todo-check" checked={false} disabled={busy} aria-label={t(fr.missions.check, { title: task.title })} data-sfx="none" onChange={onCheck} />
      {editing ? (
        <input className="todo-edit" value={value} maxLength={120} autoFocus onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown} onBlur={() => setEditing(false)} />
      ) : (
        <button type="button" className="todo-title" data-sfx="none" onClick={() => setEditing(true)}>
          {task.title}
        </button>
      )}
      <span className="todo-xp" data-capped={xp === 0 || undefined}>
        {xp === 0 ? '0 XP' : t(fr.missions.todoXp, { xp })}
      </span>
      <button type="button" className="todo-remove" aria-label={t(fr.missions.remove, { title: task.title })} disabled={busy} onClick={onRemove}>
        <TrashIcon />
      </button>
    </li>
  );
}

// Une tâche fermée (faite, rendue, retirée) : son intitulé, et ce qu'elle a donné.
function ClosedRow({ task }: { task: TaskView }) {
  const status =
    task.status === 'done' ? (task.xp > 0 ? `+${formatNumber(task.xp)} XP` : fr.missions.statusDone) : task.status === 'declined' ? fr.missions.statusDeclined : fr.missions.statusCancelled;
  return (
    <li className="todo is-closed" data-task={task.id} data-status={task.status}>
      <span className="todo-done-mark" aria-hidden="true">
        {task.status === 'done' && <CheckIcon />}
      </span>
      <span className="todo-title">{task.title}</span>
      <span className="todo-xp">{status}</span>
    </li>
  );
}

// Le panneau Missions (bouton du dock de droite, ou « Mes caractéristiques » auprès d'une administratrice) : sa progression en tête, puis deux onglets.
// - « À faire » : une ligne pour ajouter une tâche à sa liste ; les missions reçues (qui les confie, leur difficulté, leur XP ; « Terminer » ou « Rendre ») ; sa
//   liste (une case à cocher, l'XP qu'elle rapportera, ou 0 une fois le plafond du jour atteint) ; et, repliées, les tâches fermées depuis une semaine. Ouvrir cet
//   onglet rend ses missions nouvelles « vues ».
// - « Caractéristiques » : sa fiche (CharacterSheet).
// Les gestes partent à l'API ; la réponse met la liste à jour, et le temps réel annonce les gains (le toast, le son, la montée de niveau).
// `tab` : l'onglet à l'ouverture, et à chaque nouvelle demande (`ask` change), même si c'est le même qu'avant.
export function QuestPanel({ id, tab: initialTab = 'todo', ask = 0, onClose }: { id?: string; tab?: QuestTab; ask?: number; onClose(): void }) {
  const selfId = useOfficeStore((state) => state.selfId);
  const tasks = useOfficeStore((state) => state.tasks);
  const fresh = useOfficeStore(selectNewMissions);
  const [tab, setTab] = useState<QuestTab>(initialTab);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setTab(initialTab), [initialTab, ask]);

  // L'onglet « À faire » ouvert : ses missions nouvelles sont vues (ici tout de suite, au serveur ensuite).
  useEffect(() => {
    if (tab !== 'todo' || fresh === 0) return;
    const store = useOfficeStore.getState();
    store.setTasks((store.tasks ?? []).map((task) => (task.kind === 'mission' && !task.seen ? { ...task, seen: true } : task)));
    markMissionsSeen().catch(() => {
      // Elles redeviendront « nouvelles » au prochain rechargement : rien de grave.
    });
  }, [tab, fresh]);

  const { missions, todos, closed } = useMemo(() => {
    const list = tasks ?? [];
    return {
      missions: list.filter((task) => task.kind === 'mission' && task.status === 'open'),
      todos: list.filter((task) => task.kind === 'todo' && task.status === 'open'),
      closed: list.filter((task) => task.status !== 'open'),
    };
  }, [tasks]);
  // Ce qu'une tâche cochée rapportera : le serveur dit ce qui reste sous le plafond du jour (dans le fuseau de la personne, qu'il connaît).
  const todoXpLeft = useOfficeStore((state) => state.progress?.todoXpLeft ?? TODO_DAILY_XP);
  const todoXp = Math.min(TODO_XP, todoXpLeft);

  // À l'ouverture, sa progression relue : le plafond du jour a pu repartir à zéro depuis la dernière (un nouveau jour, l'onglet resté ouvert).
  useEffect(() => {
    const seq = useOfficeStore.getState().progressSeq;
    fetchMyProgress().then(
      (progress) => useOfficeStore.getState().setProgressSince(progress, seq),
      () => {
        // Illisible : celle qu'on a reste affichée.
      },
    );
  }, []);

  // Un geste sur une tâche : `busy` l'éteint pendant l'appel ; un échec se dit en haut de la liste.
  async function act(taskId: string, work: () => Promise<void>) {
    setBusy((current) => new Set(current).add(taskId));
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError && err.error === 'limit' ? fr.missions.limit : fr.missions.actionFailed);
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  }

  const complete = (task: TaskView) =>
    act(task.id, async () => {
      const seq = useOfficeStore.getState().progressSeq;
      const done = await completeTask(task.id);
      const store = useOfficeStore.getState();
      store.upsertTask(done.task);
      store.setProgressSince(done.progress, seq);
    });

  async function add(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (title === '') return;
    await act('new', async () => {
      useOfficeStore.getState().upsertTask(await createTodo({ title }));
      setDraft('');
    });
    input.current?.focus();
  }

  const options: SegmentedOption<QuestTab>[] = [
    { id: 'todo', label: fr.missions.todo, count: missions.length + todos.length },
    { id: 'sheet', label: fr.missions.sheet },
  ];

  return (
    <Drawer title={fr.missions.title} onClose={onClose} id={id} className="quest-panel">
      <ProgressCard />
      <Segmented label={fr.missions.tabsLabel} value={tab} panelId={`${uid}-panel`} tabId={(which) => `${uid}-tab-${which}`} options={options} onSelect={(which) => setTab(which)} />
      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} className="quest-body">
        {tab === 'sheet' ? (
          selfId && <CharacterSheet userId={selfId} />
        ) : (
          <>
            <form className="todo-add" onSubmit={add}>
              <label className="visually-hidden" htmlFor={`${uid}-add`}>
                {fr.missions.addLabel}
              </label>
              <input ref={input} id={`${uid}-add`} value={draft} maxLength={120} placeholder={fr.missions.addPlaceholder} autoComplete="off" onChange={(event) => setDraft(event.target.value)} />
              <button type="submit" className="bar-button is-primary" disabled={draft.trim() === '' || busy.has('new')}>
                {fr.missions.add}
              </button>
            </form>
            {error && <Alert>{error}</Alert>}
            {tasks === null && <p className="people-loading">{fr.common.loading}</p>}
            {tasks !== null && missions.length + todos.length === 0 && <p className="people-empty">{fr.missions.empty}</p>}

            {missions.length > 0 && (
              <section className="quest-section" aria-label={fr.missions.received}>
                <h3>{fr.missions.received}</h3>
                <ul className="mission-list">
                  {missions.map((task) => (
                    <MissionCard
                      key={task.id}
                      task={task}
                      busy={busy.has(task.id)}
                      onFinish={() => void complete(task)}
                      onGiveBack={() => void act(task.id, async () => useOfficeStore.getState().upsertTask(await declineMission(task.id)))}
                    />
                  ))}
                </ul>
              </section>
            )}

            {todos.length > 0 && (
              <section className="quest-section" aria-label={fr.missions.mine}>
                <h3>{fr.missions.mine}</h3>
                {todoXp === 0 && <p className="quest-hint">{fr.missions.todoCapped}</p>}
                <ul className="todo-list">
                  {todos.map((task) => (
                    <TodoRow
                      key={task.id}
                      task={task}
                      xp={todoXp}
                      busy={busy.has(task.id)}
                      onCheck={() => void complete(task)}
                      onRename={(title) => void act(task.id, async () => useOfficeStore.getState().upsertTask(await updateTodo(task.id, { title })))}
                      onRemove={() =>
                        void act(task.id, async () => {
                          await deleteTodo(task.id);
                          useOfficeStore.getState().removeTask(task.id);
                        })
                      }
                    />
                  ))}
                </ul>
              </section>
            )}

            {closed.length > 0 && (
              <section className="quest-section">
                <h3 className="people-fold">
                  <button type="button" aria-expanded={closedOpen} onClick={() => setClosedOpen((open) => !open)}>
                    <ChevronRightIcon />
                    {t(fr.missions.closed, { count: closed.length })}
                  </button>
                </h3>
                {closedOpen && (
                  <ul className="todo-list">
                    {closed.map((task) => (
                      <ClosedRow key={task.id} task={task} />
                    ))}
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
