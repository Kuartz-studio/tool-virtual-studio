import type { Status } from '@bureau/shared';
import { statusCssColor } from '../lib/status';

// Le point de statut du menu des statuts et du panneau Personnes : de la couleur du statut (STATUS_COLORS, celle de l'étiquette au-dessus
// d'un avatar). Sans statut (hors ligne, ou pas encore connu), un anneau vide. Il ne dit rien aux lecteurs d'écran : le statut s'écrit
// aussi en toutes lettres à côté. `data-status` (et `data-user`, de qui est ce point) servent aux tests de bout en bout.
export function StatusDot({ status, userId }: { status: Status | null; userId?: string }) {
  return (
    <span
      className="status-dot"
      aria-hidden="true"
      data-user={userId}
      data-status={status ?? undefined}
      style={status ? { backgroundColor: statusCssColor(status) } : undefined}
    />
  );
}
