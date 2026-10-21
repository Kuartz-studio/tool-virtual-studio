import type { Role } from '@bureau/shared';
import { Activity, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { fr, t } from '../i18n/fr';
import { listActivityStates } from '../lib/activity-api';
import { useMailMode } from '../lib/config';
import type { MediaClient, MediaSnapshot } from '../media/media-client';
import { useSpatialAudio } from '../media/spatial-audio';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { SimPanel } from '../sim/SimPanel';
import { selectChatUnread, useOfficeStore } from '../state/office-store';
import { AdminPanel } from './AdminPanel';
import { ChatPanel } from './ChatPanel';
import { CharacterBuilder } from './CharacterBuilder';
import { DecorPanel } from './DecorPanel';
import { ControlBar } from './ControlBar';
import { DeskKnocks } from './DeskKnocks';
import { DeskPanel } from './DeskPanel';
import { PeoplePanel } from './PeoplePanel';
import { StatesPanel } from './StatesPanel';
import { ReplacedScreen } from './ReplacedScreen';
import { VideoStrip } from './VideoStrip';

interface OfficeShellProps {
  // Le compte connecté : son nom s'affiche avant que le serveur ait dit le sien (`init`). Son rôle décide du panneau Admin (bouton et
  // panneau n'existent que pour un admin) ; son identifiant, de la ligne « (toi) » de ce panneau, qui n'a pas de bouton Retirer.
  user: { id: string; name: string; role: Role };
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
// - à droite, les panneaux (Personnes, Admin pour un admin, Chat), qui peuvent être ouverts ensemble : de haut en bas, dans cet ordre ;
// - en bas, la barre de commandes (ControlBar) : ton nom, ton statut, micro, caméra et partage d'écran, Chat, Personnes, Admin (pour un
//   admin) et la déconnexion.
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
  // Le son des autres baisse avec la distance dans un espace ouvert : ceux qu'on n'entend plus n'ont plus de vignette.
  const inaudible = useSpatialAudio(media.client, media.snapshot);

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

  // Le panneau Admin envoie tout à l'API (rien au bureau en temps réel) ; du bureau, il ne lit que qui est là, pour relire ses listes quand
  // quelqu'un d'inconnu arrive : son bouton n'attend pas l'`init`. Un membre n'a ni le bouton ni le panneau, et rien ne part vers /api/admin.
  const isAdmin = user.role === 'admin';
  const [adminOpen, setAdminOpen] = useState(false);
  // Le mode d'envoi du serveur, lu (une fois pour la page) à la première ouverture du panneau Admin : sans e-mail, ses membres ont
  // « Lien de mot de passe ». Inconnu tant qu'il n'est pas lu, ou s'il ne se lit pas : le panneau est celui des e-mails.
  const mail = useMailMode(isAdmin && adminOpen);
  const adminToggle = useRef<HTMLButtonElement>(null);
  const adminId = useId();

  function closeAdmin() {
    setAdminOpen(false);
    adminToggle.current?.focus();
  }

  // Le panneau Mes états d'activité : on y crée ses propres états (nom, couleur, entrée au bureau, entendre, être entendu).
  const [statesOpen, setStatesOpen] = useState(false);
  const statesId = useId();

  function closeStates() {
    setStatesOpen(false);
    // Le focus revient au bouton du statut, d'où le panneau s'est ouvert.
    document.querySelector<HTMLButtonElement>('.status-menu > button')?.focus();
  }

  // Ses états d'activité, lus à chaque (re)connexion prête : ils servent au menu des statuts.
  const ready = useOfficeStore((state) => state.ready);
  useEffect(() => {
    if (!ready) return;
    let current = true;
    listActivityStates().then(
      (states) => current && useOfficeStore.getState().setMyStates(states),
      () => {
        // Illisibles : le menu n'a que les statuts ordinaires, et le panneau le dit à l'ouverture.
      },
    );
    return () => {
      current = false;
    };
  }, [ready]);

  // Un état d'activité où l'on n'est pas entendu coupe le micro : le serveur ne laisse rien publier (jeton sans micro), et le bouton ne
  // le rallume pas tant que l'état dure.
  const activity = useOfficeStore((state) => state.self?.activity ?? null);
  const micCutBy = activity !== null && !activity.heard ? activity.label : null;
  const micOn = media.snapshot.local.mic;
  useEffect(() => {
    if (micCutBy !== null && micOn) void media.client.setMic(false);
  }, [micCutBy, micOn, media.client]);

  // Le panneau Mon bureau : nom, porte, exclusions, changement de place.
  const [deskOpen, setDeskOpen] = useState(false);
  const deskToggle = useRef<HTMLButtonElement>(null);
  const deskId = useId();

  function closeDesk() {
    setDeskOpen(false);
    deskToggle.current?.focus();
  }

  // L'éditeur de déco : il remplace le panneau Mon bureau (qui le lance), dans la même colonne. Fermé, le focus revient au bouton Mon bureau.
  const [decorOpen, setDecorOpen] = useState(false);
  const decorId = useId();

  function openDecor() {
    setDeskOpen(false);
    setDecorOpen(true);
  }

  function closeDecor() {
    setDecorOpen(false);
    deskToggle.current?.focus();
  }

  // Le builder de personnage.
  const [characterOpen, setCharacterOpen] = useState(false);
  const characterToggle = useRef<HTMLButtonElement>(null);
  const characterId = useId();

  function closeCharacter() {
    setCharacterOpen(false);
    characterToggle.current?.focus();
  }

  // Le faux live (pnpm dev:sim) : le panneau Bac à sable, pour tout le monde. Absent d'un build normal.
  const [simOpen, setSimOpen] = useState(false);
  const simToggle = useRef<HTMLButtonElement>(null);
  const simId = useId();

  function closeSim() {
    setSimOpen(false);
    simToggle.current?.focus();
  }

  return (
    <main className="office">
      <h1 className="visually-hidden">{fr.common.appName}</h1>
      {children}
      <div className="office-ui" inert={replaced}>
        <div className="office-top">
          <VideoStrip snapshot={media.snapshot} client={media.client} hidden={inaudible} onReconnect={onReconnect} />
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
        <div
          className="office-side"
          data-chat-open={chatOpen ? 'true' : undefined}
          data-admin-open={isAdmin && adminOpen ? 'true' : undefined}
          data-decor-open={decorOpen ? 'true' : undefined}
        >
          {peopleOpen && <PeoplePanel id={peopleId} onClose={closePeople} />}
          {characterOpen && <CharacterBuilder id={characterId} onClose={closeCharacter} />}
          {deskOpen && <DeskPanel id={deskId} socket={socket} onClose={closeDesk} onDecorate={openDecor} />}
          {decorOpen && <DecorPanel id={decorId} socket={socket} onClose={closeDecor} />}
          {statesOpen && <StatesPanel id={statesId} socket={socket} onClose={closeStates} />}
          {isAdmin && adminOpen && <AdminPanel id={adminId} selfId={user.id} mail={mail} onClose={closeAdmin} />}
          {__SIM__ && simOpen && <SimPanel id={simId} onClose={closeSim} />}
          {/* Le panneau Chat reste monté fermé, caché : le brouillon et l'onglet choisi sont là à la réouverture. Caché, ses effets sont
              arrêtés : il ne prend pas le focus, et ne lit rien. À l'affichage, ils reprennent (focus dans le champ, messages lus). */}
          <Activity mode={chatOpen ? 'visible' : 'hidden'}>
            <ChatPanel id={chatId} socket={socket} room={media.snapshot.room} onClose={closeChat} />
          </Activity>
        </div>
        <DeskKnocks socket={socket} />
        <ControlBar
          name={name}
          socket={socket}
          client={media.client}
          snapshot={media.snapshot}
          onManageStates={() => setStatesOpen(true)}
          micCutBy={micCutBy}
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
            {
              label: fr.character.toggle,
              open: characterOpen,
              disabled: !knowsWhoIsHere,
              panelId: characterId,
              buttonRef: characterToggle,
              onToggle: () => (characterOpen ? closeCharacter() : setCharacterOpen(true)),
            },
            {
              label: fr.desk.toggle,
              open: deskOpen || decorOpen,
              disabled: !knowsWhoIsHere,
              panelId: decorOpen ? decorId : deskId,
              buttonRef: deskToggle,
              onToggle: () => (decorOpen ? closeDecor() : deskOpen ? closeDesk() : setDeskOpen(true)),
            },
            ...(isAdmin
              ? [
                  {
                    label: fr.admin.toggle,
                    open: adminOpen,
                    panelId: adminId,
                    buttonRef: adminToggle,
                    onToggle: () => (adminOpen ? closeAdmin() : setAdminOpen(true)),
                  },
                ]
              : []),
            ...(__SIM__
              ? [
                  {
                    label: fr.sim.toggle,
                    open: simOpen,
                    panelId: simId,
                    buttonRef: simToggle,
                    onToggle: () => (simOpen ? closeSim() : setSimOpen(true)),
                  },
                ]
              : []),
          ]}
          onSignOut={onSignOut}
          signingOut={signingOut}
        />
      </div>
      {replaced && <ReplacedScreen onUseHere={onUseHere} />}
    </main>
  );
}
