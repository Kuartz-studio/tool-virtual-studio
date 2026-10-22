import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';
import { EventBus } from '../game/EventBus';
import { useGameToasts } from '../games/InviteToast';
import { fr, t } from '../i18n/fr';
import { sendDeskCommand } from '../net/desk-commands';
import { listenOnBus } from '../net/office-connection';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { DoorIcon, LightbulbIcon } from './icons';
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

// La lumière du bureau qui change (`lights:changed` sur le bus : le magasin la dit déjà à jour) : un toast avec le portrait de qui a appuyé sur
// l'interrupteur et l'ampoule, allumée ou barrée. « Fictif 2 a éteint la lumière » pour les autres, « Tu as éteint la lumière » pour celui qui
// a appuyé. Un seul toast pour la lumière : un interrupteur actionné coup sur coup remplace le message au lieu de les empiler. Rien à
// l'arrivée : l'état d'un `init` n'est pas un changement (la connexion n'émet pas `lights:changed` pour lui).
function useLightsToasts(): void {
  useEffect(
    () =>
      listenOnBus(EventBus, 'lights:changed', ({ on, by }) => {
        // Le serveur dit toujours qui a appuyé ; sans auteur, il n'y aurait personne à nommer.
        if (!by) return;
        const { selfId, self, players } = useOfficeStore.getState();
        const mine = by.id === selfId;
        useToasts.getState().push({
          key: 'lights',
          icon: <LightbulbIcon off={!on} />,
          avatarKey: (mine ? self : players[by.id])?.avatarKey ?? null,
          name: by.name,
          text: mine ? (on ? fr.lights.selfOn : fr.lights.selfOff) : t(on ? fr.lights.on : fr.lights.off, { name: by.name }),
        });
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
  useGameToasts(socket);
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
