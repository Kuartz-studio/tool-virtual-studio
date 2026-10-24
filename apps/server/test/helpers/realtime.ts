import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CLOSE_RANGE_GROUPING, type ClientToServerEvents, type ServerToClientEvents } from '@bureau/shared';
import { io as ioClient, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import { onTestFinished, vi } from 'vitest';
import type { Env } from '../../src/env';
import { attachRealtime, loadOfficeMap, type RealtimeDeps } from '../../src/realtime/io';
import { createTestApp } from './test-app';

// Une socket du client, typée par le protocole (paquet partagé).
export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Les réglages de startTestServer par défaut : un délai de grâce de 200 ms et une sauvegarde des positions par seconde.
export const TEST_GRACE_MS = 200;
export const TEST_SAVE_MS = 1000;

// Ce qu'un test peut régler : les options du temps réel (délais, horloge, zones occupées, journal, backend audio/vidéo `media`…) et
// des variables d'environnement.
export type TestServerOptions = Partial<Omit<RealtimeDeps, 'auth' | 'db' | 'map' | 'mapKey' | 'events' | 'env'>> & { env?: Partial<Env> };

type Running = { server: HttpServer; realtime: ReturnType<typeof attachRealtime> };

function listen(server: HttpServer, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

// Le serveur complet dans le processus du test : l'application (createTestApp, base PGlite `memory://` neuve), le temps réel avec la
// carte de développement (lue comme le fait index.ts), sur un port libre choisi par le système (jamais 3000).
//
// - `inviteAndLogin(email)` crée le compte par la vraie route d'invitation et renvoie son cookie de session ;
// - `connect(cookie?)` ouvre une socket.io-client avec ce cookie (WebSocket seulement, reconnexion rapide), tout de suite : les
//   écouteurs posés juste après l'appel ne manquent aucun événement ;
// - `restart()` arrête le temps réel et le serveur HTTP (stop() enregistre les positions), puis en démarre de nouveaux sur le même
//   port et la même base : le monde en mémoire repart de zéro, les clients se reconnectent seuls ;
// - `close()` ferme les clients puis le serveur. Appelée d'office à la fin du test (avant la fermeture de la base, inscrite plus tôt).
//
// `realtime` est toujours l'instance en cours (elle change à chaque restart) : io, world, socketsOf, stop.
export async function startTestServer(o: TestServerOptions = {}) {
  const { env, ...options } = o;
  const t = await createTestApp({ env, logger: o.logger, sim: o.sim });
  const map = loadOfficeMap(t.env);

  function attach(server: HttpServer) {
    return attachRealtime(server, {
      auth: t.auth,
      db: t.db,
      map,
      mapKey: t.env.MAP_KEY,
      events: t.events,
      env: t.env,
      graceMs: TEST_GRACE_MS,
      saveMs: TEST_SAVE_MS,
      // Les scènes des tests tiennent dans la petite carte de développement : le cercle serré d'origine (3 cases, à l'arrêt) les y garde
      // lisibles. La règle du bureau (OPEN_SPACE_GROUPING) est celle des tests qui la demandent (grouping).
      grouping: CLOSE_RANGE_GROUPING,
      // Le pointage du jour enverrait un `progress:mine` après chaque première arrivée : les tests qui comptent les événements reçus ne l'attendent pas. Ceux de la
      // progression le rallument (checkIn: true).
      checkIn: false,
      ...options,
    });
  }

  async function start(port: number): Promise<Running & { port: number }> {
    const server = createServer(t.app);
    const realtime = attach(server);
    try {
      return { server, realtime, port: await listen(server, port) };
    } catch (err) {
      await realtime.stop();
      throw err;
    }
  }

  let current = await start(0);
  const { port } = current;
  const url = `http://127.0.0.1:${port}`;
  const clients = new Set<ClientSocket>();

  async function inviteAndLogin(email: string): Promise<string> {
    return (await t.inviteAndAccept(email)).cookie;
  }

  function connect(cookie?: string, opts: Partial<ManagerOptions & SocketOptions> = {}): ClientSocket {
    const socket: ClientSocket = ioClient(url, {
      forceNew: true,
      transports: ['websocket'],
      reconnectionDelay: 20,
      reconnectionDelayMax: 100,
      ...(cookie ? { extraHeaders: { cookie } } : {}),
      ...opts,
    });
    clients.add(socket);
    return socket;
  }

  async function restart(): Promise<void> {
    await current.realtime.stop();
    current = await start(port);
  }

  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      // Les clients d'abord : arrêtés après le serveur, ils tenteraient de se reconnecter en boucle.
      for (const socket of clients) socket.disconnect();
      await current.realtime.stop();
    })();
    return closing;
  }
  try {
    onTestFinished(() => close());
  } catch {
    // Hors d'un test (beforeAll) : l'appelant ferme le serveur lui-même.
  }

  return {
    url,
    app: t.app,
    db: t.db,
    env: t.env,
    auth: t.auth,
    events: t.events,
    mailer: t.mailer,
    map,
    get realtime() {
      return current.realtime;
    },
    inviteAndLogin,
    connect,
    restart,
    close,
  };
}

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;

type Payload<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

// Ce qu'on attend d'une socket : un écouteur, le retrait de cet écouteur. Le typage strict de socket.io-client se prête mal à un
// nom d'événement générique.
interface Listenable {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

// Le premier argument de la prochaine occurrence de `event` (réservé ou non) sur cette socket ; échoue après `ms` sans elle.
// `failOn` : des événements qui font échouer l'attente (une connexion acceptée alors qu'on attend un refus, par exemple).
function waitFor<T>(socket: ClientSocket, event: string, ms: number, failOn: string[] = []): Promise<T> {
  const target = socket as unknown as Listenable;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      target.off(event, onEvent);
      for (const other of failOn) target.off(other, onFail[other]!);
    };
    const onEvent = (...args: unknown[]) => {
      cleanup();
      resolve(args[0] as T);
    };
    const onFail: Record<string, () => void> = Object.fromEntries(
      failOn.map((other) => [
        other,
        () => {
          cleanup();
          reject(new Error(`« ${other} » reçu en attendant « ${event} »`));
        },
      ]),
    );
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`« ${event} » non reçu en ${ms} ms`));
    }, ms);
    target.once(event, onEvent);
    for (const other of failOn) target.once(other, onFail[other]!);
  });
}

// La charge utile du prochain `event` du serveur sur cette socket.
export function nextEvent<E extends keyof ServerToClientEvents>(socket: ClientSocket, event: E, ms = 3000): Promise<Payload<E>> {
  return waitFor<Payload<E>>(socket, event, ms);
}

// Le message du prochain refus de connexion (`connect_error`). Une connexion acceptée fait échouer l'attente.
export async function connectError(socket: ClientSocket, ms = 3000): Promise<string> {
  return (await waitFor<Error>(socket, 'connect_error', ms, ['connect'])).message;
}

// La raison de la prochaine déconnexion de cette socket (« io server disconnect » quand le serveur l'a coupée).
export function disconnection(socket: ClientSocket, ms = 3000): Promise<string> {
  return waitFor<string>(socket, 'disconnect', ms);
}

// Tous les événements du serveur reçus par cette socket à partir de maintenant, dans l'ordre, avec tous leurs arguments
// (`payloadsOf` : le premier, la charge utile).
export function record(socket: ClientSocket) {
  const received: Array<{ event: string; args: unknown[] }> = [];
  socket.onAny((event: string, ...args: unknown[]) => {
    received.push({ event, args });
  });
  return {
    received,
    names: () => received.map((r) => r.event),
    payloadsOf: (event: keyof ServerToClientEvents) => received.filter((r) => r.event === event).map((r) => r.args[0]),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// L'`init` que cette socket va recevoir (ou le prochain, après une reconnexion).
export function nextInit(socket: ClientSocket) {
  return nextEvent(socket, 'init');
}

// Ouvre une socket avec ce cookie (et ces options du client) et attend son init.
export async function enter(
  srv: TestServer,
  cookie: string,
  opts: Parameters<TestServer['connect']>[1] = {},
): Promise<{ socket: ClientSocket; id: string; init: Awaited<ReturnType<typeof nextInit>> }> {
  const socket = srv.connect(cookie, opts);
  const init = await nextInit(socket);
  return { socket, id: init.self.id, init };
}

// Une coupure du réseau vue du client : la connexion tombe sans que personne ne l'ait fermée. Le client se reconnecte de lui-même,
// sauf avec `reconnect: false`.
export function cutNetwork(socket: ClientSocket, { reconnect = true } = {}): void {
  if (!reconnect) socket.io.reconnection(false);
  socket.io.engine.close();
}

// Une base lente, pour ouvrir à coup sûr les fenêtres de course : après hold(), les requêtes choisies par `which` (toutes par
// défaut) attendent release(). release() est aussi appelée à la fin du test, avant la fermeture du serveur (qui écrit en base).
// `reached` se résout quand la première requête choisie est retenue : le serveur attend alors vraiment la base.
export function slowDatabase(srv: TestServer, which: (sql: string) => boolean = () => true) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  onTestFinished(() => release());
  const client = (srv.db as unknown as { $client: { query(sql: string, ...rest: unknown[]): Promise<unknown> } }).$client;
  const query = client.query.bind(client);
  return {
    hold(): void {
      vi.spyOn(client, 'query').mockImplementation(async (sql: string, ...rest: unknown[]) => {
        if (which(sql)) {
          reach();
          await held;
        }
        return query(sql, ...rest);
      });
    },
    release,
    reached,
  };
}
