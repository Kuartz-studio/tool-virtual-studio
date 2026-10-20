import type { ServerToClientEvents } from '@bureau/shared';
import type { OfficeSocket } from '../net/socket';

type Listener = (...args: never[]) => void;

// Un message envoyé avec un accusé de réception (`socket.timeout(ms).emit(événement, charge, rappel)`), dont le serveur n'a pas encore
// répondu. Le rappel suit Socket.io : `(erreur, ...réponse)`, l'erreur étant null quand le serveur répond.
export interface PendingAck {
  event: string;
  payload: unknown;
  // Le délai demandé à Socket.io (`socket.timeout(ms)`).
  timeoutMs: number;
  callback: (error: Error | null, ...response: unknown[]) => void;
}

// Une fausse socket du bureau, pour les tests : elle retient ce que le client envoie (`sent`), et les tests jouent le serveur
// (`receive`, `serverAccepts`, `serverRefuses`, `serverAcks`…). `connected` et `active` suivent les règles de socket.io-client :
// - active : la socket est ouverte ou essaie de l'être (après connect(), et tant que Socket.io réessaie seul après une panne du
//   réseau) ; un refus du serveur (connect_error d'un middleware) ou une déconnexion voulue (par le serveur ou par le client) la
//   rend inactive : plus rien ne se fait sans un nouvel appel à connect() ;
// - connected : la poignée de main a réussi.
export class FakeSocket {
  connected = false;
  active = false;
  connectCalls = 0;
  disconnectCalls = 0;
  // Le nombre d'écouteurs posés au moment de chaque connect() : ils doivent l'être avant le premier message du serveur.
  readonly listenersAtConnect: number[] = [];
  readonly sent: Array<[event: string, payload: unknown]> = [];
  // Les accusés de réception en attente, du plus ancien au plus récent (serveur qui n'a pas répondu, ni délai écoulé).
  readonly pendingAcks: PendingAck[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, payload?: unknown): this {
    this.sent.push([event, payload]);
    return this;
  }

  // `socket.timeout(ms).emit(événement, charge, rappel)` : le message part comme avec emit() (il est dans `sent`), et son rappel attend
  // le serveur (serverAcks) ou le délai (ackTimesOut).
  timeout(timeoutMs: number): { emit(event: string, payload: unknown, callback: PendingAck['callback']): boolean } {
    return {
      emit: (event, payload, callback) => {
        this.sent.push([event, payload]);
        this.pendingAcks.push({ event, payload, timeoutMs, callback });
        return true;
      },
    };
  }

  connect(): this {
    this.connectCalls++;
    this.listenersAtConnect.push(this.listenerCount());
    this.active = true;
    return this;
  }

  disconnect(): this {
    this.disconnectCalls++;
    const wasConnected = this.connected;
    this.active = false;
    this.connected = false;
    if (wasConnected) this.fire('disconnect', 'io client disconnect');
    return this;
  }

  // Le nombre d'écouteurs posés, tous événements confondus.
  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  // ---- Le serveur ----

  // Un événement du serveur.
  receive<E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
    this.fire(event, ...args);
  }

  // La poignée de main réussit.
  serverAccepts(): void {
    this.connected = true;
    this.active = true;
    this.fire('connect');
  }

  // Le middleware du serveur refuse la connexion (err.message) : Socket.io ne réessaie pas.
  serverRefuses(message: string): void {
    this.connected = false;
    this.active = false;
    this.fire('connect_error', new Error(message));
  }

  // Le réseau ne répond pas : Socket.io réessaiera seul (la socket reste active).
  networkFails(): void {
    this.connected = false;
    this.fire('connect_error', new Error('xhr poll error'));
  }

  // La connexion tombe (réseau, redémarrage du serveur) : Socket.io se reconnecte seul.
  connectionDrops(): void {
    this.connected = false;
    this.fire('disconnect', 'transport close');
  }

  // Le serveur ferme la connexion exprès (socket.disconnect(true)) : Socket.io ne se reconnecte pas.
  serverDisconnects(): void {
    this.connected = false;
    this.active = false;
    this.fire('disconnect', 'io server disconnect');
  }

  // Le serveur répond à l'accusé en attente le plus ancien de cet événement (sans en attendre un : le test s'est trompé).
  serverAcks(event: string, ...response: unknown[]): void {
    this.takeAck(event).callback(null, ...response);
  }

  // Le délai de l'accusé en attente le plus ancien de cet événement s'écoule sans réponse : Socket.io appelle le rappel avec une erreur.
  ackTimesOut(event: string): void {
    this.takeAck(event).callback(new Error('operation has timed out'));
  }

  // Ce que le client a envoyé pour cet événement, dans l'ordre.
  sentOf(event: string): unknown[] {
    return this.sent.filter(([name]) => name === event).map(([, payload]) => payload);
  }

  asSocket(): OfficeSocket {
    return this as unknown as OfficeSocket;
  }

  private takeAck(event: string): PendingAck {
    const index = this.pendingAcks.findIndex((ack) => ack.event === event);
    if (index === -1) throw new Error(`Aucun accusé de « ${event} » n'attend de réponse.`);
    return this.pendingAcks.splice(index, 1)[0]!;
  }

  private fire(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) (fn as (...a: unknown[]) => void)(...args);
  }
}

// Un bus d'événements minimal (celui du jeu est l'EventEmitter de Phaser, que les tests ne chargent pas : il lui faut un canevas).
export class FakeBus {
  readonly emitted: Array<[event: string, payload: unknown]> = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    this.emitted.push([event, args[0]]);
    const set = this.listeners.get(event);
    for (const fn of [...(set ?? [])]) (fn as (...a: unknown[]) => void)(...args);
    return (set?.size ?? 0) > 0;
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  emittedOf(event: string): unknown[] {
    return this.emitted.filter(([name]) => name === event).map(([, payload]) => payload);
  }
}
