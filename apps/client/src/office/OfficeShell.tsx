import type { Role } from '@bureau/shared';
import { Activity, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { GamePanel } from '../games/GamePanel';
import { fr } from '../i18n/fr';
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
import { CoffeePill } from './CoffeePill';
import { DecorPanel } from './DecorPanel';
import { ControlBar } from './ControlBar';
import { DeskPanel } from './DeskPanel';
import type { PanelControls, PanelId } from './panels';
import { PeoplePanel } from './PeoplePanel';
import { ReplacedScreen } from './ReplacedScreen';
import { Toasts } from './Toasts';
import { usePlace } from './use-here';
import { VideoStrip } from './VideoStrip';
import { WhereChip } from './WhereChip';

// La hauteur réelle de la barre du bas, posée sur la couche d'interface (--bar-size) : les panneaux et les messages s'arrêtent au-dessus d'elle,
// qu'elle tienne sur une ligne ou, dans une fenêtre étroite, sur plusieurs.
function useBarSize(layer: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const element = layer.current;
    const bar = element?.querySelector('.office-bar');
    if (!element || !bar || typeof ResizeObserver === 'undefined') return;
    const apply = () => element.style.setProperty('--bar-size', `${bar.getBoundingClientRect().height}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [layer]);
}

interface OfficeShellProps {
  // Le compte connecté : son nom s'affiche avant que le serveur ait dit le sien (`init`), et son e-mail en haut du menu « Moi ». Son rôle décide
  // du panneau Admin (sa ligne du menu « Plus » et le panneau n'existent que pour un admin) ; son identifiant, de la ligne « (toi) » de ce
  // panneau, qui n'a pas de bouton Retirer.
  user: { id: string; name: string; email: string; role: Role };
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
// - en haut à gauche, le lieu où l'on est et ceux qui y sont (WhereChip), avec dessous la pastille du café quand on en a un (CoffeePill), et en haut au
//   milieu les vignettes de la conversation (VideoStrip) ;
// - sous elles, les messages passagers (Toasts) : un toc toc à la porte de son bureau, une porte fermée ;
// - à droite, un seul panneau à la fois (Personnes, Chat, Mon bureau, Admin pour un admin…) : en ouvrir un ferme celui d'avant ;
// - en bas, la barre (ControlBar) : des docks à icônes (la puce « Moi » avec ton statut, le micro, la caméra, la musique et le bureau, le zoom, le
//   chat et les personnes).
//   Une seule lumière pour tout le bureau : éteinte, la couche prend les couleurs de la nuit (`data-theme`, `data-lights`).
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
  // La lumière du bureau (une pour tous, que le serveur annonce) : allumée, le jour ; éteinte, la nuit, dont les jetons de couleur sont ceux
  // de `.office-ui[data-theme='night']` (styles.css). `data-lights` dit la même chose pour qui n'a pas besoin du mot « thème ».
  const lightsOn = useOfficeStore((state) => state.lights.on);
  // Le son des autres baisse avec la distance dans un espace ouvert : ceux qu'on n'entend plus n'ont plus de vignette.
  const inaudible = useSpatialAudio(media.client, media.snapshot);

  const layer = useRef<HTMLDivElement>(null);
  useBarSize(layer);

  // Le panneau ouvert, s'il y en a un. `opener` est ce qui l'a ouvert (un bouton) : à la fermeture, le focus lui revient.
  const [panel, setPanel] = useState<PanelId | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const idOf = (id: PanelId) => `${baseId}-${id}`;

  function show(id: PanelId, from: HTMLElement | null) {
    opener.current = from;
    setPanel(id);
  }

  function close() {
    setPanel(null);
    opener.current?.focus();
    opener.current = null;
  }

  // Les messages « Tout le monde » des autres que le panneau, fermé, n'a pas montrés : le badge du bouton.
  const unread = useOfficeStore(selectChatUnread);

  // Le panneau Admin envoie tout à l'API (rien au bureau en temps réel) ; du bureau, il ne lit que qui est là, pour relire ses listes quand
  // quelqu'un d'inconnu arrive : sa ligne du menu « Plus » n'attend pas l'`init`. Un membre n'a ni la ligne ni le panneau, et rien ne part vers
  // /api/admin.
  const isAdmin = user.role === 'admin';
  // Le mode d'envoi du serveur, lu (une fois pour la page) à la première ouverture du panneau Admin : sans e-mail, ses membres ont
  // « Lien de mot de passe ». Inconnu tant qu'il n'est pas lu, ou s'il ne se lit pas : le panneau est celui des e-mails.
  const mail = useMailMode(isAdmin && panel === 'admin');

  // Ses états d'activité, lus à chaque (re)connexion prête : ils servent au menu « Moi » (« Mode »).
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

  // Ceux de la conversation où l'on est (la room audio et vidéo), sans soi : « Parle avec toi », sur leur ligne du panneau Personnes.
  const participants = media.snapshot.participants;
  const talkingWith = useMemo(() => participants.filter((participant) => !participant.isLocal).map((participant) => participant.id), [participants]);

  // Le lieu où l'on est (placeAt, d'après les pieds de l'avatar). C'est la coque, toujours là, qui le suit : le panneau Personnes, qui n'existe
  // qu'ouvert, ne saurait où l'on a marché avant son ouverture. La puce du lieu et le filtre « Ici » le prennent d'elle : un seul lieu pour les deux.
  const place = usePlace();

  // Le panneau d'une table de jeu : le magasin le demande (la touche E devant une table, « Accepter » une invitation), la coque l'ouvre à la place de celui d'avant ; il se ferme avec
  // le panneau (un autre panneau qui s'ouvre, « Fermer »), et le magasin n'en demande plus.
  const gameOpen = useOfficeStore((state) => state.gameOpen);
  useEffect(() => {
    if (gameOpen !== null) show('game', null);
    // Seulement quand une table est demandée : `show` change à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOpen]);
  useEffect(() => {
    if (panel !== 'game' && useOfficeStore.getState().gameOpen !== null) useOfficeStore.getState().openGame(null);
  }, [panel]);

  const panels: PanelControls = {
    open: panel,
    toggle: (id, from) => (panel === id ? close() : show(id, from)),
    show,
    idOf,
    ready: knowsWhoIsHere,
    unread,
    admin: isAdmin,
    sim: __SIM__,
  };

  return (
    <main className="office">
      <h1 className="visually-hidden">{fr.common.appName}</h1>
      {children}
      <div ref={layer} className="office-ui" data-theme={lightsOn ? 'day' : 'night'} data-lights={lightsOn ? 'on' : 'off'} inert={replaced}>
        <WhereChip place={place} />
        <CoffeePill />
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
        <div className="office-side" data-panel={panel ?? undefined}>
          {panel === 'people' && <PeoplePanel id={idOf('people')} place={place} talkingWith={talkingWith} onClose={close} />}
          {panel === 'character' && <CharacterBuilder id={idOf('character')} onClose={close} />}
          {panel === 'desk' && <DeskPanel id={idOf('desk')} socket={socket} onClose={close} onDecorate={() => setPanel('decor')} />}
          {panel === 'decor' && <DecorPanel id={idOf('decor')} socket={socket} onClose={close} />}
          {panel === 'game' && gameOpen !== null && <GamePanel id={idOf('game')} socket={socket} onClose={close} />}
          {isAdmin && panel === 'admin' && <AdminPanel id={idOf('admin')} selfId={user.id} mail={mail} onClose={close} />}
          {__SIM__ && panel === 'sim' && <SimPanel id={idOf('sim')} onClose={close} />}
          {/* Le panneau Chat reste monté fermé, caché : le brouillon et l'onglet choisi sont là à la réouverture. Caché, ses effets sont
              arrêtés : il ne prend pas le focus, et ne lit rien. À l'affichage, ils reprennent (focus dans le champ, messages lus). */}
          <Activity mode={panel === 'chat' ? 'visible' : 'hidden'}>
            <ChatPanel id={idOf('chat')} socket={socket} room={media.snapshot.room} onClose={close} />
          </Activity>
        </div>
        <Toasts socket={socket} />
        <ControlBar name={name} email={user.email} socket={socket} client={media.client} snapshot={media.snapshot} panels={panels} micCutBy={micCutBy} onSignOut={onSignOut} signingOut={signingOut} />
      </div>
      {replaced && <ReplacedScreen onUseHere={onUseHere} />}
    </main>
  );
}
