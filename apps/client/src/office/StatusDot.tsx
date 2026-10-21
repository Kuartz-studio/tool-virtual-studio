import type { ActivityState, Status } from '@bureau/shared';
import { statusCssColor } from '../lib/status';

// Le point de statut du menu « Moi » (statuts, modes) et du panneau Personnes : de la couleur du statut (STATUS_COLORS, celle de l'étiquette
// au-dessus d'un avatar), ou de celle de l'état d'activité que la personne a pris (`activity`, que le serveur a validée : « #rrggbb »). Sans
// statut (hors ligne, ou pas encore connu), un anneau vide. Il ne dit rien aux lecteurs d'écran : le statut s'écrit aussi en toutes lettres à
// côté. `data-status` (et `data-user`, de qui est ce point) servent aux tests de bout en bout ; `data-activity`, l'identifiant de l'état.
export function StatusDot({ status, userId, activity }: { status: Status | null; userId?: string; activity?: Pick<ActivityState, 'id' | 'color'> | null }) {
  const color = activity ? activity.color : status ? statusCssColor(status) : undefined;
  return (
    <span
      className="status-dot"
      aria-hidden="true"
      data-user={userId}
      data-status={status ?? undefined}
      data-activity={activity?.id}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
