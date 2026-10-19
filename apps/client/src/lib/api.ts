// L'échec d'un appel à l'API. `error` est le code que l'API renvoie ({ error: 'expired' }, par exemple), 'network' quand le
// serveur n'a pas répondu (status 0), ou 'unexpected' pour une réponse sans code (la page d'erreur d'un relais).
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
  ) {
    super(`API : ${status} ${error}`);
    this.name = 'ApiError';
  }
}

// Appelle l'API du serveur (même origine, avec les cookies de session) et renvoie son corps JSON. Un corps envoyé est du JSON :
// `body: JSON.stringify(…)`. Lève ApiError pour toute réponse hors 2xx, et quand le serveur ne répond pas.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers });
  } catch {
    throw new ApiError(0, 'network');
  }

  const text = await res.text().catch(() => '');
  let body: unknown;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const code = (body as { error?: unknown } | undefined)?.error;
    throw new ApiError(res.status, typeof code === 'string' ? code : 'unexpected');
  }
  return body as T;
}
