import type { ServerToClientEvents } from '@bureau/shared';
import type { OfficeSocket } from '../net/socket';

type Listener = (...args: never[]) => void;

// Une fausse socket du bureau, pour les tests : elle retient ce que le client envoie (`sent`), et les tests jouent le serveur
// (`receive`, `serverAccepts`, `serverRefuses`…). `connected` et `active` suivent les règles de socket.io-client :
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

  // Ce que le client a envoyé pour cet événement, dans l'ordre.
  sentOf(event: string): unknown[] {
    return this.sent.filter(([name]) => name === event).map(([, payload]) => payload);
  }

  asSocket(): OfficeSocket {
    return this as unknown as OfficeSocket;
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
