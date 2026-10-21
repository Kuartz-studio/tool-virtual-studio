// Un BroadcastChannel en mémoire : chaque instance reçoit ce que les autres de même nom envoient (pas ce qu'elle envoie elle-même). Les
// instances vivantes sont dans `FakeChannel.all` ; un test le vide avant de commencer.
export class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  posted: unknown[] = [];

  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }

  postMessage(data: unknown): void {
    this.posted.push(data);
    for (const other of FakeChannel.all) if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
  }

  close(): void {
    FakeChannel.all = FakeChannel.all.filter((channel) => channel !== this);
  }
}
