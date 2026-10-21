import { useEffect } from 'react';
import { fr, t } from '../i18n/fr';
import { sendDeskCommand } from '../net/desk-commands';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';

// Combien de temps un message passager reste affiché.
export const DESK_NOTICE_MS = 4000;

// Ce que les bureaux ont à dire sans qu'on l'ait demandé, au-dessus de la barre :
// - ceux qui toquent à la porte de son bureau, chacun avec « Laisser entrer » et « Ignorer » ;
// - un message passager : une porte fermée contre laquelle on a buté, un toc toc envoyé.
// Tout est annoncé aux lecteurs d'écran (role="status").
export function DeskKnocks({ socket }: { socket: OfficeSocket | null }) {
  const knocks = useOfficeStore((state) => state.deskKnocks);
  const notice = useOfficeStore((state) => state.deskNotice);

  // Le message passager s'efface au bout de DESK_NOTICE_MS ; un nouveau message repart de zéro.
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => useOfficeStore.getState().setDeskNotice(null), DESK_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (knocks.length === 0 && notice === null) return null;
  return (
    <div className="desk-toasts" role="status">
      {notice !== null && <p className="desk-toast">{notice}</p>}
      {knocks.map((knock) => (
        <div key={knock.userId} className="desk-toast desk-knock">
          <span>{t(fr.desk.knockToast, { name: knock.name })}</span>
          <button
            type="button"
            className="bar-button"
            aria-label={t(fr.desk.admitLabel, { name: knock.name })}
            onClick={() => {
              useOfficeStore.getState().dismissDeskKnock(knock.userId);
              void sendDeskCommand(socket, { type: 'admit', userId: knock.userId });
            }}
          >
            {fr.desk.admit}
          </button>
          <button
            type="button"
            className="bar-button"
            aria-label={t(fr.desk.ignoreLabel, { name: knock.name })}
            onClick={() => useOfficeStore.getState().dismissDeskKnock(knock.userId)}
          >
            {fr.desk.ignore}
          </button>
        </div>
      ))}
    </div>
  );
}
