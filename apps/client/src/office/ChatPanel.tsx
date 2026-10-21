import { CHAT_MAX_LENGTH, type ChatAck, type ChatChannel, type ChatMessage } from '@bureau/shared';
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type UIEvent } from 'react';
import { fr } from '../i18n/fr';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { groupMessages } from './chat-groups';
import { SendIcon } from './icons';
import { linkify } from './linkify';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { Drawer } from './ui/Drawer';
import { IconButton } from './ui/IconButton';
import { Segmented } from './ui/Segmented';

const CHANNELS: readonly ChatChannel[] = ['all', 'nearby'];

// Le temps que le serveur a pour répondre à un message : au-delà, on le dit (son accusé de réception n'est peut-être jamais venu).
const ACK_TIMEOUT_MS = 5000;

// Le message de chaque refus du serveur (ChatAck). Le texte du message reste dans le champ : on peut réessayer.
const ACK_ERRORS: Record<Extract<ChatAck, { ok: false }>['error'], string> = {
  invalid: fr.chat.invalid,
  rate_limited: fr.chat.rateLimited,
  no_group: fr.chat.noGroup,
  unavailable: fr.chat.unavailable,
};

// La liste suit le bas tant qu'on en est à moins de ça (en pixels) ; plus haut, on lit l'ancien, et un nouveau message ne la fait pas
// sauter.
const FOLLOW_TOLERANCE_PX = 40;
// De combien une flèche (haut ou bas) fait défiler la liste.
const ARROW_SCROLL_PX = 40;

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayAndTimeFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fullFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'medium' });

// L'heure d'un message : « 14:32 » le jour même, « 19 oct., 14:32 » un autre jour (l'historique en garde 200), et la date entière en
// infobulle. null si la date du serveur est illisible.
function formatSentAt(sentAt: string): { label: string; title: string } | null {
  const date = new Date(sentAt);
  if (Number.isNaN(date.getTime())) return null;
  const today = date.toDateString() === new Date().toDateString();
  return { label: (today ? timeFormat : dayAndTimeFormat).format(date), title: fullFormat.format(date) };
}

// Un message : son texte, qui passe par linkify (du texte et des liens, rien d'autre). Le premier d'un groupe (chat-groups.ts : même auteur, à moins de
// 3 minutes du message d'avant) porte aussi le portrait de l'auteur, son nom et l'heure ; les suivants n'ont qu'un renfoncement à la place du
// portrait, et l'heure en infobulle. L'auteur, que l'écran n'écrit plus, reste dit aux lecteurs d'écran (le journal annonce chaque message).
const ChatMessageItem = memo(function ChatMessageItem({ message, first, mine, avatarKey }: { message: ChatMessage; first: boolean; mine: boolean; avatarKey: string | null }) {
  const sentAt = formatSentAt(message.sentAt);
  return (
    <li className="chat-message" data-own={mine ? 'true' : undefined} data-first={first ? 'true' : undefined} title={first ? undefined : sentAt?.title}>
      {first ? <AvatarPortrait avatarKey={avatarKey} name={message.name} size={28} /> : <span className="chat-gutter" aria-hidden="true" />}
      <div className="chat-body">
        {first ? (
          <div className="chat-message-head">
            {/* Un nom trop long est coupé (« … ») : l'infobulle le donne en entier. */}
            <span className="chat-author" title={message.name}>
              {message.name}
            </span>
            {mine && <span className="chat-you">{fr.chat.you}</span>}
            {sentAt && (
              <time className="chat-time" dateTime={message.sentAt} title={sentAt.title}>
                {sentAt.label}
              </time>
            )}
          </div>
        ) : (
          <span className="visually-hidden">{message.name}</span>
        )}
        <p className="chat-text">{linkify(message.text)}</p>
      </div>
    </li>
  );
});

interface ChatPanelProps {
  id?: string;
  // La connexion au bureau, null avant que la page l'ouvre.
  socket: OfficeSocket | null;
  // La room audio/vidéo où l'on est (MediaSnapshot.room), null hors conversation : l'onglet « À proximité » en dépend.
  room: string | null;
  onClose(): void;
}

// Le panneau Chat (spec §9), dans la coque des panneaux (Drawer) : un sélecteur à deux positions, « Tout le monde » (conservé, les 200 derniers
// messages se chargent avec l'`init`) et « À proximité » (la conversation en cours, rien n'est gardé), la liste des messages, et le champ du
// message, collé en bas du panneau : la liste prend la place qui reste et défile, le champ ne se coupe jamais.
//
// - Les messages sont ceux du magasin (state/office-store.ts) ; celui qu'on envoie n'y est pas ajouté à la main : le serveur le renvoie à
//   tout le monde, l'émetteur compris (`chat:message`). Ils sont groupés par auteur (chat-groups.ts : 3 minutes au plus entre deux) : le
//   portrait de 28 px, le nom et l'heure sont en tête du groupe. Le portrait est celui que le magasin connaît (le sien, celui d'une personne en
//   ligne) ; d'une personne partie, ses initiales.
// - Entrée envoie (`chat:send`, avec accusé de réception et 5 s pour répondre), Maj+Entrée va à la ligne (le champ grandit, jusqu'à cinq lignes) ;
//   pendant une composition (touche morte, méthode de saisie), Entrée la valide et n'envoie rien. Le champ ne se vide qu'à `{ ok: true }` ; sinon
//   le texte reste, avec la raison. Rien ne part tant que la connexion n'est pas prête (store.ready : elle est tombée, ou le serveur n'a pas dit
//   où l'on est), ni tant qu'un message attend son accusé, ni pour un champ vide.
// - L'onglet « À proximité » ne se choisit qu'en conversation. S'il est déjà choisi quand elle finit, il reste : on y lit encore ce qui
//   s'est dit, mais on n'y écrit plus (jamais de message envoyé à tout le monde par l'onglet qui change sous les doigts). Chaque onglet
//   a son brouillon, pour la même raison.
// - Le focus va au champ à l'ouverture, et après un clic sur un onglet ; Échap ferme. Les touches de l'avatar (ZQSD, flèches : game/input.ts) sont ignorées dans un
//   champ de saisie : taper n'ennuie pas l'avatar. Celles qui servent ici sans être dans un champ (flèches des onglets et de la liste)
//   sont prises (preventDefault), et l'avatar ne les voit pas.
// - Le panneau lit « Tout le monde » : tant qu'il est affiché sur cet onglet, ses messages sont lus (store.chatReadId). Fermé, il peut
//   rester monté (OfficeShell, <Activity>) pour garder brouillons et onglet ; ses effets sont alors arrêtés, et rien n'est lu.
export function ChatPanel({ id, socket, room, onClose }: ChatPanelProps) {
  const chatAll = useOfficeStore((state) => state.chatAll);
  const chatNearby = useOfficeStore((state) => state.chatNearby);
  const selfId = useOfficeStore((state) => state.selfId);
  const self = useOfficeStore((state) => state.self);
  const players = useOfficeStore((state) => state.players);
  const ready = useOfficeStore((state) => state.ready);
  const markChatRead = useOfficeStore((state) => state.markChatRead);

  const [tab, setTab] = useState<ChatChannel>('all');
  const [drafts, setDrafts] = useState<Record<ChatChannel, string>>({ all: '', nearby: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uid = useId();
  const tabpanelId = `${uid}-messages`;
  const tabId = (channel: ChatChannel) => `${uid}-onglet-${channel}`;

  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  // La liste suit le bas : un nouveau message la fait défiler jusqu'à lui.
  const followLog = useRef(true);

  const messages = tab === 'all' ? chatAll : chatNearby;
  const rows = useMemo(() => groupMessages(messages), [messages]);
  // Le personnage de l'auteur d'un message : celui du compte, ou d'une personne en ligne ; inconnu (partie), null.
  const avatarKeyOf = (userId: string) => (self?.id === userId ? self.avatarKey : (players[userId]?.avatarKey ?? null));
  const draft = drafts[tab];
  const inConversation = room !== null;
  // On n'ouvre « À proximité » qu'en conversation ; choisi, il reste ouvert à sa fin.
  const tabEnabled = (channel: ChatChannel) => channel === 'all' || inConversation || channel === tab;
  const canWrite = tab === 'all' || inConversation;
  const canSend = socket !== null && ready && canWrite && !sending && draft.trim() !== '';
  const hint = !ready ? fr.chat.reconnecting : !canWrite ? fr.chat.noConversation : null;

  // À l'ouverture, le focus va au champ du message. (À chaque affichage : fermé, le panneau reste monté, et ses effets reprennent.)
  useEffect(() => {
    input.current?.focus();
  }, []);

  // Le champ grandit avec ses lignes (le CSS en borne la hauteur : au-delà, il défile). Caché (le panneau fermé reste monté), il n'a pas de taille à lire.
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = 'auto';
    if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight}px`;
  }, [draft, tab]);

  // Ce que l'onglet « Tout le monde » affiche est lu, ce qui arrive tant qu'il l'est aussi.
  const lastAllId = chatAll.at(-1)?.id;
  useEffect(() => {
    if (tab === 'all') markChatRead();
  }, [tab, lastAllId, markChatRead]);

  // À l'affichage, la liste est en bas, sur le dernier message ; puis elle le suit, sauf si on est remonté.
  useLayoutEffect(() => {
    followLog.current = true;
  }, []);
  const lastShownId = messages.at(-1)?.id;
  useLayoutEffect(() => {
    const list = log.current;
    if (list && followLog.current) list.scrollTop = list.scrollHeight;
  }, [tab, lastShownId, messages.length]);

  // Redimensionnée (la fenêtre change, l'autre panneau s'ouvre, une erreur s'affiche sous elle), la liste qui suit le bas y reste : sinon
  // le dernier message sortirait de la vue. (Une liste neuve à chaque onglet : on l'observe de nouveau.)
  useEffect(() => {
    const list = log.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followLog.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [tab]);

  function selectTab(channel: ChatChannel) {
    if (!tabEnabled(channel)) return;
    followLog.current = true;
    setError(null);
    setTab(channel);
  }

  // Un clic sur un onglet le choisit, et met le focus dans le champ du message : un bouton n'est pas un champ de saisie pour l'avatar
  // (game/input.ts), et le focus laissé sur l'onglet, taper ferait marcher l'avatar. Au clavier (les flèches, ou Entrée et Espace sur l'onglet : un
  // clic sans pointeur), le focus reste sur les onglets (Segmented).
  function onSelectTab(channel: ChatChannel, how: 'pointer' | 'keyboard') {
    selectTab(channel);
    if (how === 'pointer' && tabEnabled(channel)) input.current?.focus();
  }

  function onLogScroll(event: UIEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    followLog.current = list.scrollHeight - list.scrollTop - list.clientHeight <= FOLLOW_TOLERANCE_PX;
  }

  // La liste prend le focus, pour qu'on la lise au clavier. Ses flèches la font défiler au lieu de faire marcher l'avatar (qui laisse
  // passer une touche qu'un autre a prise).
  function onLogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowUp':
        event.currentTarget.scrollTop -= ARROW_SCROLL_PX;
        break;
      case 'ArrowDown':
        event.currentTarget.scrollTop += ARROW_SCROLL_PX;
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // Entrée envoie ; Maj+Entrée va à la ligne. Pendant une composition (touche morte, méthode de saisie), Entrée la valide : rien ne part.
  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }

  function send() {
    if (!socket || !canSend) return;
    const channel = tab;
    const sent = draft;
    setSending(true);
    setError(null);
    followLog.current = true;
    // Un clic sur « Envoyer » a pris le focus : on rend le champ à qui enchaîne.
    input.current?.focus();
    socket.timeout(ACK_TIMEOUT_MS).emit('chat:send', { channel, text: sent.trim() }, (timedOut, ack) => {
      setSending(false);
      if (timedOut || !ack) return setError(fr.chat.timeout);
      // Le champ se vide si on n'y a pas touché depuis l'envoi (ce qui a été tapé pendant l'attente reste).
      if (ack.ok) return setDrafts((current) => (current[channel] === sent ? { ...current, [channel]: '' } : current));
      setError(ACK_ERRORS[ack.error] ?? fr.chat.unavailable);
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send();
  }

  return (
    <Drawer title={fr.chat.title} onClose={onClose} id={id} className="chat-drawer">
      <Segmented
        label={fr.chat.tabsLabel}
        value={tab}
        panelId={tabpanelId}
        tabId={tabId}
        options={CHANNELS.map((channel) => ({
          id: channel,
          label: fr.chat.tabs[channel],
          disabled: !tabEnabled(channel),
          title: tabEnabled(channel) ? undefined : fr.chat.nearbyUnavailable,
        }))}
        onSelect={onSelectTab}
      />
      <div id={tabpanelId} className="chat-tabpanel" role="tabpanel" aria-labelledby={tabId(tab)}>
        {/* Un journal : les nouveaux messages sont annoncés. Une liste neuve à chaque onglet (key), pour qu'on n'y entende pas, d'un coup,
            tous les messages de l'autre. */}
        <div
          key={tab}
          ref={log}
          className="chat-log"
          role="log"
          aria-label={fr.chat.log[tab]}
          tabIndex={0}
          onScroll={onLogScroll}
          onKeyDown={onLogKeyDown}
        >
          {messages.length === 0 ? (
            <p className="chat-empty">{fr.chat.empty[tab]}</p>
          ) : (
            <ul className="chat-messages">
              {rows.map(({ message, first }) => (
                <ChatMessageItem key={message.id} message={message} first={first} mine={message.userId === selfId} avatarKey={avatarKeyOf(message.userId)} />
              ))}
            </ul>
          )}
        </div>
        <form className="chat-form" onSubmit={onSubmit}>
          {error && <Alert>{error}</Alert>}
          {hint && (
            <p className="chat-hint" role="status">
              {hint}
            </p>
          )}
          <div className="chat-compose">
            <textarea
              ref={input}
              rows={1}
              aria-label={fr.chat.input[tab]}
              placeholder={fr.chat.placeholder}
              maxLength={CHAT_MAX_LENGTH}
              autoComplete="off"
              enterKeyHint="send"
              value={draft}
              onKeyDown={onInputKeyDown}
              onChange={(event) => {
                const value = event.target.value;
                setError(null);
                setDrafts((current) => ({ ...current, [tab]: value }));
              }}
            />
            <IconButton type="submit" label={fr.chat.send} className="chat-send" disabled={!canSend}>
              <SendIcon />
            </IconButton>
          </div>
        </form>
      </div>
    </Drawer>
  );
}
