import { vi } from 'vitest';

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

// Une réponse JSON du serveur.
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Remplace `fetch` (celui qu'utilise api()) par un faux serveur : chaque clé est « MÉTHODE /chemin », par exemple
// « GET /api/invitations/tok ». Une requête que le test n'a pas prévue échoue. Le vrai `fetch` revient après chaque test
// (`unstubGlobals` dans vite.config.ts).
export function fakeApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const route = `${init?.method ?? 'GET'} ${String(input)}`;
    const handler = routes[route];
    if (!handler) throw new Error(`Requête inattendue dans le test : ${route}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Le corps JSON de la première requête « MÉTHODE /chemin » reçue par le faux `fetch`.
export function sentBody(fetchMock: ReturnType<typeof fakeApi>, route: string): unknown {
  const call = fetchMock.mock.calls.find(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}` === route);
  if (!call) throw new Error(`Aucune requête ${route}`);
  return JSON.parse(String(call[1]?.body));
}
