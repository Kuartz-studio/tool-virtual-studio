import { useId, useRef, useState, type ReactNode } from 'react';
import { fr } from '../i18n/fr';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { PeoplePanel } from './PeoplePanel';
import { ReplacedScreen } from './ReplacedScreen';
import { StatusMenu } from './StatusMenu';

interface OfficeShellProps {
  // Le compte connecté : son nom s'affiche avant que le serveur ait dit le sien (`init`).
  user: { name: string };
  // La connexion au bureau, que la page ouvre (null avant).
  socket: OfficeSocket | null;
  onSignOut(): void;
  signingOut: boolean;
  // « Utiliser ici » : relance la connexion, qu'un autre onglet avait prise.
  onUseHere(): void;
  // « Connexion au bureau… », en attendant le premier état du serveur.
  connecting: boolean;
  // Ce qui n'a pas marché (connexion refusée, déconnexion impossible…), à montrer.
  errors: string[];
  // Le jeu : le canevas de Phaser, qui occupe toute la page.
  children: ReactNode;
}

// La page du bureau : le jeu en plein écran, et par-dessus (`.office-ui`, qui laisse passer la souris hors de ses éléments) :
// - en haut, l'emplacement des vignettes vidéo (vide : tâche 20) ;
// - à droite, les panneaux (pour l'instant Personnes) ;
// - en bas, la barre : ton nom, ton statut, puis les commandes (au milieu, la place de celles de la tâche 20), Personnes et la
//   déconnexion.
// Rien de cela ne prend de place au jeu : les éléments sont posés sur lui, et ouvrir un panneau ne redimensionne pas le canevas (ni
// ne change le zoom de la caméra).
//
// Quand un autre onglet prend la place de celui-ci, l'écran « Ouvert dans un autre onglet » couvre tout et la couche est inerte : le
// clavier n'atteint plus la barre qui est dessous.
export function OfficeShell({ user, socket, onSignOut, signingOut, onUseHere, connecting, errors, children }: OfficeShellProps) {
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

  return (
    <main className="office">
      <h1 className="visually-hidden">{fr.common.appName}</h1>
      {children}
      <div className="office-ui" inert={replaced}>
        <div className="office-top" data-slot="video-tiles" />
        {connecting && (
          <p className="office-connecting" role="status">
            {fr.office.connecting}
          </p>
        )}
        {errors.length > 0 && (
          <div className="office-banners">
            {errors.map((error) => (
              <Alert key={error}>{error}</Alert>
            ))}
          </div>
        )}
        <div className="office-side">{peopleOpen && <PeoplePanel id={peopleId} onClose={closePeople} />}</div>
        <div className="office-bar" role="group" aria-label={fr.office.barLabel}>
          <div className="office-bar-start">
            <span className="office-user" title={name}>
              {name}
            </span>
            <StatusMenu socket={socket} />
          </div>
          <div className="office-bar-center" data-slot="controls" />
          <div className="office-bar-end">
            <button
              ref={peopleToggle}
              type="button"
              className="bar-button"
              aria-expanded={peopleOpen}
              aria-controls={peopleOpen ? peopleId : undefined}
              disabled={!knowsWhoIsHere}
              onClick={() => (peopleOpen ? closePeople() : setPeopleOpen(true))}
            >
              {fr.office.people.toggle}
            </button>
            <button type="button" className="bar-button" onClick={onSignOut} disabled={signingOut}>
              {signingOut ? fr.office.signingOut : fr.office.signOut}
            </button>
          </div>
        </div>
      </div>
      {replaced && <ReplacedScreen onUseHere={onUseHere} />}
    </main>
  );
}
