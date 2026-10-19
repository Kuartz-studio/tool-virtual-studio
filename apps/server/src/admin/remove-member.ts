import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { session, user } from '../db/schema';
import type { ServerEvents } from '../server-events';

export type RemoveOutcome = 'removed' | 'self' | 'last_admin' | 'not_found';

// Retire un membre : son compte est désactivé (et non supprimé), toutes ses sessions sont supprimées, puis `member:removed` part
// pour que ses connexions au bureau soient coupées sur-le-champ. Le compte désactivé ne peut plus ouvrir de session
// (auth.ts) et ses sessions éventuelles sont refusées (require-session.ts).
//
// Refus : on ne se retire pas soi-même (`self`) ; on ne retire pas le dernier admin actif (`last_admin`) ; un compte inconnu ou
// déjà retiré (`not_found`). Seuls les admins actifs comptent : un admin désactivé ne laisse personne pour administrer.
// Cette vérification n'est pas atomique avec le retrait : l'appelant (admin-routes.ts) passe les retraits l'un après l'autre.
export async function removeMember(
  d: { db: Db; events: ServerEvents },
  { actorId, targetId }: { actorId: string; targetId: string },
): Promise<RemoveOutcome> {
  if (targetId === actorId) return 'self';

  const [target] = await d.db
    .select({ role: user.role })
    .from(user)
    .where(and(eq(user.id, targetId), isNull(user.disabledAt)));
  if (!target) return 'not_found';
  if (target.role === 'admin') {
    const otherAdmins = await d.db.$count(user, and(eq(user.role, 'admin'), isNull(user.disabledAt), ne(user.id, targetId)));
    if (otherAdmins === 0) return 'last_admin';
  }

  // Ensemble : jamais un compte désactivé qui garde des sessions à cause d'une panne entre les deux écritures.
  await d.db.transaction(async (tx) => {
    await tx.update(user).set({ disabledAt: new Date() }).where(eq(user.id, targetId));
    await tx.delete(session).where(eq(session.userId, targetId));
  });
  d.events.emit('member:removed', targetId);
  return 'removed';
}
