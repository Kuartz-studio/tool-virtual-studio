import { DIRECTIONS, type Direction } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { user } from '../db/schema';

// La dernière position de chaque personne, en base (colonnes lastX, lastY et lastDir du compte) : enregistrée au départ, toutes
// les POSITION_SAVE_INTERVAL_MS et à l'arrêt du serveur ; relue à l'arrivée suivante, même après un redémarrage.
//
// Chaque enregistrement inscrit aussi l'heure de dernière présence (colonne lastSeenAt), que montre la liste des membres : l'heure de
// la coupure au départ, l'heure de l'enregistrement sinon. Pendant une longue session, elle avance donc avec la sauvegarde périodique :
// un serveur qui tombe sans s'arrêter laisse une heure juste à POSITION_SAVE_INTERVAL_MS près, pas l'heure de l'arrivée.

const isDirection = (value: string | null): value is Direction => (DIRECTIONS as readonly (string | null)[]).includes(value);

// Une mise à jour par ligne, l'une après l'autre (une poignée de personnes à la fois). Un identifiant inconnu ne change rien.
// `seenAt` : l'heure de présence inscrite avec chaque position (maintenant, sans autre précision).
export async function savePositions(db: Db, rows: Array<{ id: string; x: number; y: number; dir: Direction }>, seenAt = new Date()): Promise<void> {
  for (const row of rows) {
    await db.update(user).set({ lastX: row.x, lastY: row.y, lastDir: row.dir, lastSeenAt: seenAt }).where(eq(user.id, row.id));
  }
}

// null si la personne n'a jamais eu de position enregistrée (ou si le compte n'existe pas). Une direction illisible vaut « down ».
export async function loadPosition(db: Db, userId: string): Promise<{ x: number; y: number; dir: Direction } | null> {
  const [row] = await db.select({ x: user.lastX, y: user.lastY, dir: user.lastDir }).from(user).where(eq(user.id, userId));
  if (!row || row.x === null || row.y === null) return null;
  return { x: row.x, y: row.y, dir: isDirection(row.dir) ? row.dir : 'down' };
}
