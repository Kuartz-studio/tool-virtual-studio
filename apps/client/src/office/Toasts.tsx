import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';
import { EventBus } from '../game/EventBus';
import { useGameToasts } from '../games/InviteToast';
import { fr, t } from '../i18n/fr';
import { sendDeskCommand } from '../net/desk-commands';
import { deskErrorText } from './desks';
import { listenOnBus } from '../net/office-connection';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { DoorIcon, DoorOpenIcon, FollowIcon, LightbulbIcon, LockIcon, LockOpenIcon } from './icons';
import { AvatarPortrait } from './ui/AvatarPortrait';

// Combien de temps un message passager reste affiché (celui d'une porte, d'un toc toc envoyé).
export const DESK_NOTICE_MS = 4000;
// Combien de temps reste un toast par défaut.
export const DEFAULT_TOAST_TTL = 3500;
// Combien de toasts à la fois : au-delà, les plus anciens partent (un interrupteur qu'on actionne vingt fois ne remplit pas l'écran).
const MAX_TOASTS = 6;

export interface ToastAction {
  label: string;
  // Le nom de ce bouton pour un lecteur d'écran, quand « Laisser entrer » ne dit pas assez (« Laisser entrer Bob »).
  ariaLabel?: string;
  onClick(): void;
}

export interface ToastInput {
  // Un toast qui a une clé en remplace un autre de même clé (qui retoque ne double pas sa ligne), et peut être retiré par elle.
  key?: string;
  // L'icône, de la couleur de l'accent (office/icons).
  icon: ReactNode;
  // Le portrait de qui est à l'origine du message, devant l'icône : sa clé de personnage (nulle : ses initiales, d'après `name`). Absent : pas de portrait.
  avatarKey?: string | null;
  name?: string;
  text: string;
  // Combien de temps il reste, en ms ; `null` : jusqu'à ce qu'on réponde (un toc toc).
  ttl?: number | null;
  // Des réponses possibles, en boutons à droite du texte.
  actions?: ToastAction[];
}

interface ToastItem extends Omit<ToastInput, 'ttl' | 'key'> {
  id: string;
  ttl: number | null;
}

interface ToastsState {
  items: ToastItem[];
  // Affiche un toast ; renvoie son identifiant (sa clé, s'il en a une).
  push(toast: ToastInput): string;
  dismiss(id: string): void;
  clear(): void;
}

let sequence = 0;

// La file des toasts : n'importe quel code les pousse (la connexion, un panneau, le jeu), `Toasts` les montre, en haut au milieu.
export const useToasts = create<ToastsState>()((set) => ({
  items: [],
  push: ({ key, ttl = DEFAULT_TOAST_TTL, ...toast }) => {
    const id = key ?? `toast-${++sequence}`;
    set((state) => ({ items: [...state.items.filter((item) => item.id !== id), { ...toast, ttl, id }].slice(-MAX_TOASTS) }));
    return id;
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clear: () => set({ items: [] }),
}));

const KNOCK = 'knock:';

// Ce que les bureaux disent sans qu'on l'ait demandé passe par la file :
// - ceux qui toquent à la porte de son bureau : un toast qui reste jusqu'à la réponse, « Laisser entrer » ou « Ignorer » ;
// - un message passager (une porte fermée contre laquelle on a buté, un toc toc envoyé) : un toast de quelques secondes.
function useDeskToasts(socket: OfficeSocket | null): void {
  const knocks = useOfficeStore((state) => state.deskKnocks);
  const players = useOfficeStore((state) => state.players);
  const notice = useOfficeStore((state) => state.deskNotice);

  useEffect(() => {
    const { push, dismiss, items } = useToasts.getState();
    const waiting = new Set(knocks.map((knock) => `${KNOCK}${knock.userId}`));
    for (const item of items) if (item.id.startsWith(KNOCK) && !waiting.has(item.id)) dismiss(item.id);
    for (const knock of knocks) {
      push({
        key: `${KNOCK}${knock.userId}`,
        icon: <DoorIcon />,
        avatarKey: players[knock.userId]?.avatarKey ?? null,
        name: knock.name,
        text: t(fr.desk.knockToast, { name: knock.name }),
        ttl: null,
        actions: [
          {
            label: fr.desk.admit,
            ariaLabel: t(fr.desk.admitLabel, { name: knock.name }),
            onClick: () => {
              useOfficeStore.getState().dismissDeskKnock(knock.userId);
              void sendDeskCommand(socket, { type: 'admit', userId: knock.userId });
            },
          },
          {
            label: fr.desk.ignore,
            ariaLabel: t(fr.desk.ignoreLabel, { name: knock.name }),
            onClick: () => useOfficeStore.getState().dismissDeskKnock(knock.userId),
          },
        ],
      });
    }
  }, [knocks, players, socket]);

  // Le message passager est repris par la file, qui l'efface au bout de son temps : le magasin n'a plus à le garder (et le même message
  // redit, une porte rouverte contre laquelle on bute encore, s'affiche de nouveau).
  useEffect(() => {
    if (notice === null) return;
    useToasts.getState().push({ key: 'desk-notice', icon: <DoorIcon />, text: notice, ttl: DESK_NOTICE_MS });
    useOfficeStore.getState().setDeskNotice(null);
  }, [notice]);
}

// Le préfixe de la clé d'un toast d'invitation dans un bureau : `desk-invite:<identifiant>`.
export const DESK_INVITE_TOAST = 'desk-invite:';

// Les invitations dans un bureau (celles que dit le magasin), les réponses aux siennes, et la fin d'un « Suivre », par la file de toasts :
// - une invitation reçue : « Léa t'invite dans son bureau », le temps qu'il lui reste à vivre (60 s au départ), avec « Accepter » et « Refuser ». Accepter répond au
//   serveur, qui pose dans la pièce, porte fermée comprise. Le toast disparaît à la réponse, à l'expiration, ou quand le serveur retire l'invitation ;
// - la réponse à ses propres invitations (l'invitée arrive, ou refuse) : un toast de quelques secondes ;
// - l'avatar ne suit plus personne sans qu'on l'ait demandé (la personne est partie, a changé de lieu, une porte s'est fermée) : un toast de quelques secondes.
function usePersonToasts(socket: OfficeSocket | null): void {
  const invites = useOfficeStore((state) => state.deskInvites);

  useEffect(() => {
    const { push, dismiss, items } = useToasts.getState();
    const waiting = new Set(invites.map((invite) => `${DESK_INVITE_TOAST}${invite.id}`));
    for (const item of items) if (item.id.startsWith(DESK_INVITE_TOAST) && !item.id.startsWith(`${DESK_INVITE_TOAST}notice:`) && !waiting.has(item.id)) dismiss(item.id);
    for (const invite of invites) {
      const key = `${DESK_INVITE_TOAST}${invite.id}`;
      if (items.some((item) => item.id === key)) continue;
      const answer = (accept: boolean) => {
        useOfficeStore.getState().removeDeskInvite(invite.id);
        void sendDeskCommand(socket, { type: 'answer', invite: invite.id, accept }).then((ack) => {
          if (!ack.ok) useToasts.getState().push({ key: `${DESK_INVITE_TOAST}notice:refused`, icon: <DoorOpenIcon />, text: deskErrorText(ack) });
        });
      };
      push({
        key,
        icon: <DoorOpenIcon />,
        avatarKey: invite.from.avatarKey,
        name: invite.from.name,
        text: t(fr.person.invited, { name: invite.from.name }),
        ttl: Math.max(0, invite.until - performance.now()),
        actions: [
          { label: fr.person.accept, ariaLabel: t(fr.person.acceptLabel, { name: invite.from.name }), onClick: () => answer(true) },
          { label: fr.person.decline, ariaLabel: t(fr.person.declineLabel, { name: invite.from.name }), onClick: () => answer(false) },
        ],
      });
    }
  }, [invites, socket]);

  // Une invitation dont le temps est écoulé (son toast s'est éteint de lui-même) : le magasin ne la garde pas non plus.
  useEffect(() => {
    const timers = invites.map((invite) => setTimeout(() => useOfficeStore.getState().removeDeskInvite(invite.id), Math.max(0, invite.until - performance.now())));
    return () => timers.forEach(clearTimeout);
  }, [invites]);

  useEffect(() => {
    const offNotice = listenOnBus(EventBus, 'desk:notice', ({ kind, user }) => {
      useToasts.getState().push({
        key: `${DESK_INVITE_TOAST}notice:${user.id}`,
        icon: <DoorOpenIcon />,
        avatarKey: useOfficeStore.getState().players[user.id]?.avatarKey ?? null,
        name: user.name,
        text: t(kind === 'accepted' ? fr.person.accepted : fr.person.declined, { name: user.name }),
      });
    });
    const offLost = listenOnBus(EventBus, 'follow:lost', ({ name, reason }) => {
      useToasts.getState().push({ key: 'follow-lost', icon: <FollowIcon />, text: t(fr.person.lost[reason], { name }) });
    });
    return () => {
      offNotice();
      offLost();
    };
  }, []);
}

// Ce que dit le toast de la lumière, selon l'état où elle passe : pour qui a appuyé, puis pour les autres.
const LIGHT_TEXTS = {
  on: { mine: fr.lights.selfOn, theirs: fr.lights.on },
  dim: { mine: fr.lights.selfDim, theirs: fr.lights.dim },
  off: { mine: fr.lights.selfOff, theirs: fr.lights.off },
} as const;

// La lumière du bureau qui change (`lights:changed` sur le bus : le magasin la dit déjà à jour) : un toast avec le portrait de qui a appuyé sur
// l'interrupteur et l'ampoule, allumée, tamisée ou barrée. « Fictif 2 a éteint la lumière » pour les autres, « Tu as éteint la lumière » pour celui qui
// a appuyé. Un seul toast pour la lumière : un interrupteur actionné coup sur coup remplace le message au lieu de les empiler. Rien à
// l'arrivée : l'état d'un `init` n'est pas un changement (la connexion n'émet pas `lights:changed` pour lui).
function useLightsToasts(): void {
  useEffect(
    () =>
      listenOnBus(EventBus, 'lights:changed', ({ level, by }) => {
        // Le serveur dit toujours qui a appuyé ; sans auteur, il n'y aurait personne à nommer.
        if (!by) return;
        const { selfId, self, players } = useOfficeStore.getState();
        const mine = by.id === selfId;
        useToasts.getState().push({
          key: 'lights',
          icon: <LightbulbIcon level={level} />,
          avatarKey: (mine ? self : players[by.id])?.avatarKey ?? null,
          name: by.name,
          text: mine ? LIGHT_TEXTS[level].mine : t(LIGHT_TEXTS[level].theirs, { name: by.name }),
        });
      }),
    [],
  );
}

// Sa conversation verrouillée qui change (`conversation:lock` sur le bus : le magasin la dit déjà à jour) : un toast avec le cadenas (fermé, ou
// ouvert quand le verrou s'en va), et le portrait de qui l'a fait. « Léa a verrouillé la conversation » pour les autres, « Tu as verrouillé la
// conversation » pour qui a cliqué ; quelqu'un qui en sort ; la conversation qui n'est plus verrouillée faute de monde. Un seul toast pour le
// verrou : des changements coup sur coup se remplacent.
function useConversationToasts(): void {
  useEffect(
    () =>
      listenOnBus(EventBus, 'conversation:lock', ({ cause, by }) => {
        const { selfId, self, players } = useOfficeStore.getState();
        const texts = fr.media.lock.toast;
        const mine = by !== null && by.id === selfId;
        const name = by?.name ?? '';
        const text =
          cause === 'locked'
            ? mine
              ? texts.lockedSelf
              : t(texts.locked, { name })
            : cause === 'unlocked'
              ? mine
                ? texts.unlockedSelf
                : t(texts.unlocked, { name })
              : cause === 'left'
                ? t(texts.left, { name })
                : cause === 'quit'
                  ? texts.quit
                  : texts.ended;
        const author = by !== null && (cause === 'locked' || cause === 'unlocked' || cause === 'left') ? { avatarKey: (mine ? self : players[by.id])?.avatarKey ?? null, name } : {};
        useToasts.getState().push({ key: 'conversation-lock', icon: cause === 'locked' || cause === 'left' ? <LockIcon /> : <LockOpenIcon />, ...author, text });
      }),
    [],
  );
}

// Un toast : le portrait de qui l'a fait, l'icône, le texte, et ses réponses. Il s'efface au bout de son temps (un toast qui en remplace un
// autre, de même clé, repart de zéro).
function Toast({ item }: { item: ToastItem }) {
  const dismiss = useToasts((state) => state.dismiss);

  useEffect(() => {
    if (item.ttl === null) return;
    const timer = setTimeout(() => dismiss(item.id), item.ttl);
    return () => clearTimeout(timer);
  }, [item, dismiss]);

  return (
    <div className="toast">
      {item.avatarKey !== undefined && <AvatarPortrait avatarKey={item.avatarKey} name={item.name} size={28} />}
      <span className="toast-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="toast-text">{item.text}</span>
      {item.actions?.map((action) => (
        <button key={action.label} type="button" className="toast-action" aria-label={action.ariaLabel} onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </div>
  );
}

// Les toasts, en haut au milieu, sous les vignettes. Annoncés aux lecteurs d'écran (role="status"), et absents de la page quand il n'y en a
// aucun.
export function Toasts({ socket }: { socket: OfficeSocket | null }) {
  const items = useToasts((state) => state.items);
  useDeskToasts(socket);
  useLightsToasts();
  useConversationToasts();
  useGameToasts(socket);
  usePersonToasts(socket);
  // Quitter le bureau (la déconnexion, une autre page) vide la file : rien ne reparaît à la prochaine arrivée.
  useEffect(() => () => useToasts.getState().clear(), []);
  if (items.length === 0) return null;
  return (
    <div className="toasts" role="status">
      {items.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  );
}
