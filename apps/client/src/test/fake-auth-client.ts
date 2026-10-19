import { vi } from 'vitest';

// Un faux `authClient`, pour les tests de composants : `vi.mock('../lib/auth-client', () => import('../test/fake-auth-client'))`.
// Le vrai client de Better Auth garde sa propre copie de `fetch`, prise à sa création : un `fetch` remplacé dans un test ne
// l'atteindrait pas. Chaque méthode est un vi.fn() avec un comportement par défaut, que resetFakeAuth() rétablit.

export interface FakeUser {
  id: string;
  name: string;
  email: string;
}

// Une erreur telle que la renvoie le client de Better Auth : le statut HTTP et, souvent, le code de Better Auth.
export interface FakeAuthError {
  status: number;
  statusText?: string;
  code?: string;
  message?: string;
}

type Result = Promise<{ data: unknown; error: FakeAuthError | null }>;

// La session que le serveur verrait : getSession la lit, signOut l'efface, setFakeSession la pose.
let session: { user: FakeUser; session: { id: string; userId: string } } | null = null;

export function setFakeSession(user: FakeUser | null): void {
  session = user && { user, session: { id: `session-${user.id}`, userId: user.id } };
}

export const fakeAuth = {
  getSession: vi.fn(async (): Result => ({ data: session, error: null })),
  signOut: vi.fn(async (): Result => {
    session = null;
    return { data: { success: true }, error: null };
  }),
  signInEmail: vi.fn(async (_body: { email: string; password: string }): Result => ({
    data: null,
    error: { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' },
  })),
  requestPasswordReset: vi.fn(async (_body: { email: string; redirectTo?: string }): Result => ({ data: { status: true }, error: null })),
  resetPassword: vi.fn(async (_body: { newPassword: string; token?: string }): Result => ({ data: { status: true }, error: null })),
};

export function resetFakeAuth(): void {
  session = null;
  for (const method of Object.values(fakeAuth)) method.mockReset();
}

// Ce que les composants importent de '../lib/auth-client' une fois le module remplacé.
export const authClient = {
  getSession: fakeAuth.getSession,
  signOut: fakeAuth.signOut,
  signIn: { email: fakeAuth.signInEmail },
  requestPasswordReset: fakeAuth.requestPasswordReset,
  resetPassword: fakeAuth.resetPassword,
};
