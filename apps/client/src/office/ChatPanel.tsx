import { CHAT_MAX_LENGTH, type ChatAck, type ChatChannel, type ChatMessage } from '@bureau/shared';
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type UIEvent } from 'react';
import { fr } from '../i18n/fr';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { linkify } from './linkify';
import { CloseIcon } from './icons';

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

// Un message : son auteur, son heure, son texte. Le texte passe par linkify, qui n'en fait que du texte et des liens.
const ChatMessageItem = memo(function ChatMessageItem({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const sentAt = formatSentAt(message.sentAt);
  return (
    <li className="chat-message" data-own={mine ? 'true' : undefined}>
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
      <p className="chat-text">{linkify(message.text)}</p>
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

// Le panneau Chat (spec §9) : deux onglets, « Tout le monde » (conservé, les 200 derniers messages se chargent avec l'`init`) et « À
// proximité » (la conversation en cours, rien n'est gardé), la liste des messages, et le champ du message.
//
// - Les messages sont ceux du magasin (state/office-store.ts) ; celui qu'on envoie n'y est pas ajouté à la main : le serveur le renvoie à
//   tout le monde, l'émetteur compris (`chat:message`).
// - Entrée envoie (`chat:send`, avec accusé de réception et 5 s pour répondre). Le champ ne se vide qu'à `{ ok: true }` ; sinon le texte
//   reste, avec la raison. Rien ne part tant que la connexion n'est pas prête (store.ready : elle est tombée, ou le serveur n'a pas dit
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
  const ready = useOfficeStore((state) => state.ready);
  const markChatRead = useOfficeStore((state) => state.markChatRead);

  const [tab, setTab] = useState<ChatChannel>('all');
  const [drafts, setDrafts] = useState<Record<ChatChannel, string>>({ all: '', nearby: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uid = useId();
  const titleId = `${uid}-titre`;
  const tabpanelId = `${uid}-messages`;
  const tabId = (channel: ChatChannel) => `${uid}-onglet-${channel}`;

  const input = useRef<HTMLInputElement>(null);
  const tabButtons = useRef<Partial<Record<ChatChannel, HTMLButtonElement | null>>>({});
  const log = useRef<HTMLDivElement>(null);
  // La liste suit le bas : un nouveau message la fait défiler jusqu'à lui.
  const followLog = useRef(true);

  const messages = tab === 'all' ? chatAll : chatNearby;
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
  // (game/input.ts), et le focus laissé sur l'onglet, taper ferait marcher l'avatar. Au clavier (Entrée ou Espace sur l'onglet : un
  // clic sans pointeur, detail 0), le focus reste sur les onglets, comme avec les flèches.
  function clickTab(channel: ChatChannel, event: MouseEvent<HTMLButtonElement>) {
    if (!tabEnabled(channel)) return;
    selectTab(channel);
    if (event.detail > 0) input.current?.focus();
  }

  // Les onglets : ← → passent de l'un à l'autre, Début et Fin vont au premier et au dernier, le focus avec la sélection. Les flèches sont
  // aussi celles de l'avatar : prises ici, il ne les voit pas.
  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = CHANNELS.filter(tabEnabled);
    const index = enabled.indexOf(tab);
    let next: ChatChannel | undefined;
    switch (event.key) {
      case 'ArrowRight':
        next = enabled[(index + 1) % enabled.length];
        break;
      case 'ArrowLeft':
        next = enabled[(index - 1 + enabled.length) % enabled.length];
        break;
      case 'Home':
        next = enabled[0];
        break;
      case 'End':
        next = enabled.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next === undefined) return;
    selectTab(next);
    tabButtons.current[next]?.focus();
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

  function onPanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Échap dans une composition (clavier à touches mortes, méthode de saisie) l'annule : il ne ferme pas le panneau.
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  return (
    <aside id={id} className="chat-panel" aria-labelledby={titleId} onKeyDown={onPanelKeyDown}>
      <header className="chat-panel-header">
        <h2 id={titleId}>{fr.chat.title}</h2>
        <button type="button" className="bar-button" aria-label={fr.chat.close} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="chat-tabs" role="tablist" aria-label={fr.chat.tabsLabel} onKeyDown={onTabKeyDown}>
        {CHANNELS.map((channel) => (
          <button
            key={channel}
            ref={(element) => {
              tabButtons.current[channel] = element;
            }}
            type="button"
            role="tab"
            id={tabId(channel)}
            className="chat-tab"
            aria-selected={tab === channel}
            aria-controls={tabpanelId}
            // Seul l'onglet choisi est dans l'ordre de tabulation : les flèches mènent aux autres.
            tabIndex={tab === channel ? 0 : -1}
            disabled={!tabEnabled(channel)}
            title={tabEnabled(channel) ? undefined : fr.chat.nearbyUnavailable}
            onClick={(event) => clickTab(channel, event)}
          >
            {fr.chat.tabs[channel]}
          </button>
        ))}
      </div>
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
              {messages.map((message) => (
                <ChatMessageItem key={message.id} message={message} mine={message.userId === selfId} />
              ))}
            </ul>
          )}
        </div>
        <form className="chat-form" onSubmit={submit}>
          {error && <Alert>{error}</Alert>}
          {hint && (
            <p className="chat-hint" role="status">
              {hint}
            </p>
          )}
          <div className="chat-compose">
            <input
              ref={input}
              type="text"
              aria-label={fr.chat.input[tab]}
              placeholder={fr.chat.placeholder}
              maxLength={CHAT_MAX_LENGTH}
              autoComplete="off"
              enterKeyHint="send"
              value={draft}
              onChange={(event) => {
                const value = event.target.value;
                setError(null);
                setDrafts((current) => ({ ...current, [tab]: value }));
              }}
            />
            <button type="submit" className="bar-button" disabled={!canSend}>
              {fr.chat.send}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
