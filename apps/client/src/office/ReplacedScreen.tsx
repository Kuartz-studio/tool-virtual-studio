import { useEffect, useId, useRef } from 'react';
import { fr } from '../i18n/fr';

// « Ouvert dans un autre onglet » (spec §7.5) : le serveur n'accepte qu'une connexion par personne, et un autre onglet a pris la
// place de celui-ci. Il l'a déconnecté, sans reconnexion automatique : « Utiliser ici » la relance (onUseHere), ce qui, à son tour,
// remplace l'autre onglet.
//
// Un écran qui couvre toute la page, et la barre et les panneaux de dessous sont inertes (OfficeShell) : c'est une boîte de dialogue
// modale, nommée par son titre. Le focus est sur le bouton dès l'affichage. Le bouton reste utilisable après un clic : si la
// reconnexion échoue, on réessaie, et l'écran ne disparaît qu'à l'`init` du serveur (le magasin repasse `replaced` à false).
export function ReplacedScreen({ onUseHere }: { onUseHere(): void }) {
  const titleId = useId();
  const hintId = useId();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    button.current?.focus();
  }, []);

  return (
    <div className="replaced-screen" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={hintId}>
      <div className="replaced-card">
        <h2 id={titleId}>{fr.office.replaced}</h2>
        <p id={hintId}>{fr.office.replacedHint}</p>
        <button ref={button} type="button" className="button" onClick={onUseHere}>
          {fr.office.useHere}
        </button>
      </div>
    </div>
  );
}
