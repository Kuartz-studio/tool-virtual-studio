import { MOVE_JITTER_MS, MOVE_SEGMENT_STEP_PX, MOVE_TOLERANCE, NORMAL_MAX_SPEED_PX_PER_S } from '../constants';
import type { OfficeMap } from '../map/parse-map';
import { isWalkablePoint } from '../map/queries';

export type MoveRejection = 'out_of_bounds' | 'too_fast' | 'blocked';

// Le serveur vérifie le mouvement que le client a décidé : de `from`, la dernière position acceptée, à `to`, celle qu'il vient de
// recevoir. x et y sont les pieds de l'avatar, en pixels ; `at` est l'heure (ms) à laquelle le serveur a reçu chaque position, jamais
// une heure donnée par le client. Trois contrôles, dans cet ordre, le premier qui échoue donne la raison :
// 1. out_of_bounds : `to` n'est pas dans la carte ;
// 2. too_fast : la distance dépasse `maxSpeed` (par défaut NORMAL_MAX_SPEED_PX_PER_S, la course ; MAX_SPEED_PX_PER_S sous café) × (dt + MOVE_JITTER_MS) / 1000
//    × MOVE_TOLERANCE, avec dt = to.at − from.at. La gigue (MOVE_JITTER_MS) absorbe les paquets qui arrivent groupés ou en retard ; la tolérance est
//    une marge de plus ;
// 3. blocked : le segment entier, de `from` à `to`, passe sur des cases praticables.
//
// Les contrôles sont écrits pour échouer du bon côté : une valeur qui n'est pas un nombre (NaN) est refusée, jamais acceptée.
export function validateMove(
  m: OfficeMap,
  from: { x: number; y: number; at: number },
  to: { x: number; y: number; at: number },
  maxSpeed: number = NORMAL_MAX_SPEED_PX_PER_S,
): { ok: true } | { ok: false; reason: MoveRejection } {
  if (!(to.x >= 0 && to.x < m.widthTiles * m.tileSize && to.y >= 0 && to.y < m.heightTiles * m.tileSize)) {
    return { ok: false, reason: 'out_of_bounds' };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  // Une horloge qui recule ne doit pas figer le joueur : avec dt négatif, dt + MOVE_JITTER_MS pourrait être négatif et plus aucun
  // mouvement, même sur place, ne passerait. Le temps écoulé est alors compté pour nul.
  const dt = Math.max(0, to.at - from.at);
  const allowed = ((maxSpeed * (dt + MOVE_JITTER_MS)) / 1000) * MOVE_TOLERANCE;
  if (!(distance <= allowed)) return { ok: false, reason: 'too_fast' };

  // Des échantillons régulièrement espacés d'au plus MOVE_SEGMENT_STEP_PX, du départ (compris) à l'arrivée (comprise). Une case
  // bloquante fait une case entière, bien plus que le pas : un segment parallèle à un axe, comme ceux d'un client qui marche et
  // envoie un `move` à chaque changement de direction, ne la traverse jamais sans qu'un échantillon y tombe. Seul un segment en
  // biais qui n'effleure que l'angle d'une case, sur moins d'un pas, peut passer entre deux échantillons : c'est la limite de
  // l'échantillonnage voulu par la spec.
  // La case d'un point est floor(x / tileSize), floor(y / tileSize), comme chez le client (isWalkablePoint) : un bord haut ou gauche
  // appartient à la case. L'arrivée est testée telle quelle, sans interpolation, donc sans arrondi ; et (dx * i) / steps est exact
  // quand son résultat est entier (coordonnées entières, voir moveSchema), si bien qu'un échantillon posé pile sur un bord de case
  // ne bascule pas dans la case voisine.
  const steps = Math.max(1, Math.ceil(distance / MOVE_SEGMENT_STEP_PX));
  for (let i = 0; i < steps; i++) {
    if (!isWalkablePoint(m, from.x + (dx * i) / steps, from.y + (dy * i) / steps)) return { ok: false, reason: 'blocked' };
  }
  return isWalkablePoint(m, to.x, to.y) ? { ok: true } : { ok: false, reason: 'blocked' };
}
