import { Activity, useId, useRef, useState, type ReactNode } from 'react';
import { fr, t } from '../i18n/fr';
import type { MediaClient, MediaSnapshot } from '../media/media-client';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { selectChatUnread, useOfficeStore } from '../state/office-store';
import { ChatPanel } from './ChatPanel';
import { ControlBar } from './ControlBar';
import { PeoplePanel } from './PeoplePanel';
import { ReplacedScreen } from './ReplacedScreen';
import { VideoStrip } from './VideoStrip';

interface OfficeShellProps {
  // Le compte connecté : son nom s'affiche avant que le serveur ait dit le sien (`init`).
  user: { name: string };
  // La connexion au bureau, que la page ouvre (null avant).
  socket: OfficeSocket | null;
  // L'audio et la vidéo : le client, et son état (useMedia).
  media: { client: MediaClient; snapshot: MediaSnapshot };
  // « Reconnecter », après un échec de la connexion audio et vidéo : relance la connexion au bureau.
  onReconnect(): void;
  onSignOut(): void;
  signingOut: boolean;
  // « Utiliser ici » : relance la connexion, qu'un autre onglet avait prise.
  onUseHere(): void;
  // « Connexion au bureau… », en attendant le premier état du serveur.
  connecting: boolean;
  // « Connexion perdue, reconnexion… » : la connexion au bureau est tombée après l'arrivée, et n'est pas encore revenue.
  reconnecting: boolean;
  // Ce qui n'a pas marché (connexion refusée, déconnexion impossible…), à montrer.
  errors: string[];
  // Le jeu : le canevas de Phaser, qui occupe toute la page.
  children: ReactNode;
}

// La page du bureau : le jeu en plein écran, et par-dessus (`.office-ui`, qui laisse passer la souris hors de ses éléments) :
// - en haut, les vignettes de la conversation (VideoStrip) ;
// - à droite, les panneaux (Personnes, Chat), qui peuvent être ouverts ensemble : Personnes au-dessus ;
// - en bas, la barre de commandes (ControlBar) : ton nom, ton statut, micro, caméra et partage d'écran, Chat, Personnes et la
//   déconnexion.
// Rien de cela ne prend de place au jeu : les éléments sont posés sur lui, et ouvrir un panneau ne redimensionne pas le canevas (ni
// ne change le zoom de la caméra).
//
// Quand un autre onglet prend la place de celui-ci, l'écran « Ouvert dans un autre onglet » couvre tout et la couche est inerte : le
// clavier n'atteint plus la barre qui est dessous.
export function OfficeShell({
  user,
  socket,
  media,
  onReconnect,
  onSignOut,
  signingOut,
  onUseHere,
  connecting,
  reconnecting,
  errors,
  children,
}: OfficeShellProps) {
  const name = useOfficeStore((state) => state.self?.name ?? user.name);
  // Le serveur a dit qui est là : avant, le panneau Personnes ne saurait pas qui est en ligne.
  const knowsWhoIsHere = useOfficeStore((state) => state.self !== null);
  const replaced = useOfficeStore((state) => state.replaced);

  const [peopleOpen, setPeopleOpen] = useState(false);
  const peopleToggle = useRef<HTMLButtonElement>(null);
  const peopleId = useId();

  function closePeople() {
    setPeopleOpen(false);
    peopleToggle.current?.focus();
  }

  const [chatOpen, setChatOpen] = useState(false);
  const chatToggle = useRef<HTMLButtonElement>(null);
  const chatId = useId();
  // Les messages « Tout le monde » des autres que le panneau, fermé, n'a pas montrés : le badge du bouton.
  const unread = useOfficeStore(selectChatUnread);

  function closeChat() {
    setChatOpen(false);
    chatToggle.current?.focus();
  }

  return (
    <main className="office">
      <h1 className="visually-hidden">{fr.common.appName}</h1>
      {children}
      <div className="office-ui" inert={replaced}>
        <div className="office-top">
          <VideoStrip snapshot={media.snapshot} client={media.client} onReconnect={onReconnect} />
        </div>
        {connecting && (
          <p className="office-connecting" role="status">
            {fr.office.connecting}
          </p>
        )}
        {(reconnecting || errors.length > 0) && (
          <div className="office-banners">
            {reconnecting && (
              <p className="office-reconnecting" role="status">
                {fr.office.reconnecting}
              </p>
            )}
            {errors.map((error) => (
              <Alert key={error}>{error}</Alert>
            ))}
          </div>
        )}
        <div className="office-side" data-chat-open={chatOpen ? 'true' : undefined}>
          {peopleOpen && <PeoplePanel id={peopleId} onClose={closePeople} />}
          {/* Le panneau Chat reste monté fermé, caché : le brouillon et l'onglet choisi sont là à la réouverture. Caché, ses effets sont
              arrêtés : il ne prend pas le focus, et ne lit rien. À l'affichage, ils reprennent (focus dans le champ, messages lus). */}
          <Activity mode={chatOpen ? 'visible' : 'hidden'}>
            <ChatPanel id={chatId} socket={socket} room={media.snapshot.room} onClose={closeChat} />
          </Activity>
        </div>
        <ControlBar
          name={name}
          socket={socket}
          client={media.client}
          snapshot={media.snapshot}
          panels={[
            {
              label: fr.chat.toggle,
              open: chatOpen,
              disabled: !knowsWhoIsHere,
              panelId: chatId,
              buttonRef: chatToggle,
              onToggle: () => (chatOpen ? closeChat() : setChatOpen(true)),
              // Ouvert, il n'y a rien de non lu à signaler : le panneau montre tout.
              badge:
                !chatOpen && unread > 0 ? { count: unread, label: t(unread === 1 ? fr.chat.unreadOne : fr.chat.unreadMany, { count: unread }) } : undefined,
            },
            {
              label: fr.office.people.toggle,
              open: peopleOpen,
              disabled: !knowsWhoIsHere,
              panelId: peopleId,
              buttonRef: peopleToggle,
              onToggle: () => (peopleOpen ? closePeople() : setPeopleOpen(true)),
            },
          ]}
          onSignOut={onSignOut}
          signingOut={signingOut}
        />
      </div>
      {replaced && <ReplacedScreen onUseHere={onUseHere} />}
    </main>
  );
}
