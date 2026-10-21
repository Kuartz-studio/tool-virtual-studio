import { deskKey, zoneAt, type DeskAck, type DeskInfo, type OfficeMap, type PublicPlayer } from '@bureau/shared';
import { fr, t } from '../i18n/fr';
import type { PlayerPosition } from '../state/office-store';

// Le nom d'un bureau pour l'affichage : celui que son propriétaire lui a donné, sinon « Bureau de <nom> » ; libre, « Place <clé> ».
export function deskTitle(desk: Pick<DeskInfo, 'key' | 'ownerName' | 'name'>): string {
  if (desk.name) return desk.name;
  if (desk.ownerName) return t(fr.desk.defaultName, { name: desk.ownerName });
  return t(fr.desk.place, { key: desk.key });
}

// Pourquoi une commande de bureau a échoué, en toutes lettres.
export function deskErrorText(ack: DeskAck): string {
  if (ack.ok) return '';
  if (ack.error === 'bad_decor') {
    const reasons: Record<string, string> = fr.decor.errors;
    return reasons[ack.reason] ?? fr.desk.errors.bad_decor;
  }
  const errors: Record<string, string> = fr.desk.errors;
  return errors[ack.error] ?? fr.desk.errors.generic;
}

// Les autres personnes qui sont dans la pièce de ce bureau d'après leurs dernières positions connues, dans l'ordre des noms.
export function occupantsOf(
  key: string,
  map: OfficeMap | null,
  players: Record<string, PublicPlayer>,
  positions: ReadonlyMap<string, PlayerPosition>,
): PublicPlayer[] {
  if (map === null) return [];
  return Object.values(players)
    .filter((player) => {
      const at = positions.get(player.id) ?? player;
      const room = zoneAt(map, at.x, at.y, ['desk']);
      return room !== null && deskKey(room) === key;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
