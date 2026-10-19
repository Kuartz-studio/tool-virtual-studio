import { createHash, randomBytes } from 'node:crypto';
import { INVITATION_TTL_MS, type Role } from '@bureau/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { invitation } from '../db/schema';

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  invitedBy: string | null;   // id de l'admin qui invite ; null quand l'invitation vient de la commande admin:invite
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export type InvitationStatus = 'valid' | 'expired' | 'used' | 'revoked' | 'unknown';
export type InvitationCheck = { status: 'valid'; invitation: Invitation } | { status: Exclude<InvitationStatus, 'valid'> };
export type InvitationService = ReturnType<typeof createInvitationService>;

// renew() sur une invitation inconnue, déjà acceptée ou révoquée.
export class InvitationNotPendingError extends Error {
  constructor(id: string) {
    super(`L'invitation ${id} n'existe pas, ou a déjà été acceptée ou révoquée.`);
    this.name = 'InvitationNotPendingError';
  }
}

// Les colonnes d'une Invitation : tout sauf l'empreinte du jeton, qui ne sort jamais du service.
const columns = {
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
  invitedBy: invitation.invitedBy,
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
  acceptedAt: invitation.acceptedAt,
  revokedAt: invitation.revokedAt,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Le jeton du lien : 32 octets aléatoires en base64url. La base n'en garde que l'empreinte sha256, en hexadécimal.
function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

// `now` fixe l'heure de référence (création, expiration) : les tests s'en servent pour vieillir une invitation.
export function createInvitationService(db: Db, now: () => Date = () => new Date()) {
  const expiresFrom = (date: Date) => new Date(date.getTime() + INVITATION_TTL_MS);
  // Une invitation qui attend encore son acceptation (expirée ou non).
  const pending = (id: string) => and(eq(invitation.id, id), isNull(invitation.acceptedAt), isNull(invitation.revokedAt));

  return {
    async create(i: { email: string; role: Role; invitedBy: string | null }): Promise<{ invitation: Invitation; token: string }> {
      const { token, tokenHash } = newToken();
      const createdAt = now();
      const [created] = await db
        .insert(invitation)
        .values({ email: i.email.trim().toLowerCase(), tokenHash, role: i.role, invitedBy: i.invitedBy, createdAt, expiresAt: expiresFrom(createdAt) })
        .returning(columns);
      return { invitation: created, token };
    },

    // Une invitation acceptée reste « used », même révoquée ensuite ; une invitation révoquée reste « revoked », même expirée.
    async check(token: string): Promise<InvitationCheck> {
      const [found] = await db.select(columns).from(invitation).where(eq(invitation.tokenHash, hashToken(token)));
      if (!found) return { status: 'unknown' };
      if (found.acceptedAt) return { status: 'used' };
      if (found.revokedAt) return { status: 'revoked' };
      if (found.expiresAt.getTime() <= now().getTime()) return { status: 'expired' };
      return { status: 'valid', invitation: found };
    },

    async markAccepted(id: string): Promise<void> {
      if (!UUID.test(id)) return;
      await db.update(invitation).set({ acceptedAt: now() }).where(and(eq(invitation.id, id), isNull(invitation.acceptedAt)));
    },

    // Sans effet sur une invitation déjà acceptée, déjà révoquée, ou inconnue.
    async revoke(id: string): Promise<void> {
      if (!UUID.test(id)) return;
      await db.update(invitation).set({ revokedAt: now() }).where(pending(id));
    },

    // Nouveau jeton et nouvelle expiration (y compris pour une invitation expirée) : l'ancien jeton devient inconnu.
    async renew(id: string): Promise<{ token: string }> {
      const { token, tokenHash } = newToken();
      const renewed = UUID.test(id)
        ? await db.update(invitation).set({ tokenHash, expiresAt: expiresFrom(now()) }).where(pending(id)).returning({ id: invitation.id })
        : [];
      if (renewed.length === 0) throw new InvitationNotPendingError(id);
      return { token };
    },

    // Les invitations ni acceptées ni révoquées, expirées comprises (on peut les relancer), les plus récentes d'abord.
    async listPending(): Promise<Invitation[]> {
      return db
        .select(columns)
        .from(invitation)
        .where(and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
        .orderBy(desc(invitation.createdAt));
    },
  };
}
