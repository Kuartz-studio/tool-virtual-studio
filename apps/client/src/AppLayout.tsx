import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { AudioDirector } from './audio/AudioDirector';
import { fr } from './i18n/fr';
import { reloadPage } from './lib/reload';

// Ce qui entoure toutes les pages (router.tsx) : la page elle-même, l'avis d'une nouvelle version, et le son (AudioDirector : la musique
// et les effets suivent l'appli d'une page à l'autre, sans s'interrompre).
export function AppLayout() {
  return (
    <>
      <Outlet />
      <NewVersionPrompt />
      <AudioDirector />
    </>
  );
}

// Après un déploiement, les fichiers compilés changent de nom (leur empreinte), et le serveur n'a plus les anciens : un onglet ouvert
// avant ne peut plus charger ce qu'il charge à la demande (le jeu, LiveKit). Vite le dit par l'événement `vite:preloadError`. L'avis
// propose de recharger, sans le faire de lui-même : la personne est peut-être en pleine conversation.
function NewVersionPrompt() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const onPreloadError = () => setAvailable(true);
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => window.removeEventListener('vite:preloadError', onPreloadError);
  }, []);

  if (!available) return null;
  return (
    <div className="new-version" role="alert">
      <p>
        <strong>{fr.app.newVersion}</strong> — {fr.app.newVersionHint}
      </p>
      <button type="button" className="button" onClick={reloadPage}>
        {fr.app.reload}
      </button>
    </div>
  );
}

// La page d'erreur de toutes les pages (errorElement de la route racine) : une page qui lève en s'affichant, par exemple le jeu,
// chargé à la demande, qui n'est plus sur le serveur après un déploiement. Au lieu de la page de React Router, en anglais.
export function AppError() {
  return (
    <main className="page-message">
      <h1>{fr.app.error.title}</h1>
      <p>{fr.app.error.message}</p>
      <button type="button" className="button" onClick={reloadPage}>
        {fr.app.reload}
      </button>
    </main>
  );
}
