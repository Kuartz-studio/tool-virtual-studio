import { DEFAULT_ROOM_MUSIC, MUSIC_SCENES, type MusicScene, type RoomMusic } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { roomMusic, user } from '../db/schema';
import { oneAtATimePerKey } from '../one-at-a-time';

// Ce qu'une demande change : `on` (allumée ou éteinte) et/ou `scene` (null : l'ambiance par défaut de la pièce). Ce qui n'y est pas ne change pas.
export interface MusicPatch {
  on?: boolean;
  scene?: MusicScene | null;
}

export interface MusicServiceOptions {
  /** L'heure d'un changement, en ms depuis 1970 : Date.now par défaut (les tests en passent une réglée à leur main). */
  clock?: () => number;
}

const isScene = (value: string | null): value is MusicScene => value !== null && (MUSIC_SCENES as readonly string[]).includes(value);

const copyOf = (state: RoomMusic): RoomMusic => ({ ...state, by: state.by && { ...state.by } });

// La musique de chaque pièce : une par lieu qui a une enceinte, la même pour tous ceux qui y sont. L'état vit en mémoire (une seule instance de serveur) et la
// table `room_music` le garde d'un redémarrage à l'autre ; il n'y a de ligne que pour les pièces qu'on a réglées, les autres sont allumées avec leur ambiance par
// défaut. Les changements d'une même pièce passent l'un après l'autre : deux personnes qui l'éteignent en même temps ne le font qu'une fois, la seconde trouve la
// pièce déjà éteinte et ne change rien. Ce service ne sait pas quelles pièces existent ni qui peut les régler : c'est l'affaire de la gestion de `music:set`.
export class MusicService {
  private readonly states = new Map<string, RoomMusic>();
  private readonly serial = oneAtATimePerKey();
  private readonly clock: () => number;

  /** Résolue quand la musique des pièces est lue en base ; rejetée si elle est illisible. Les changements l'attendent. */
  readonly ready: Promise<void>;

  constructor(
    private readonly db: Db,
    options: MusicServiceOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.ready = this.load();
    // L'échec est pour ceux qui attendent `ready` ; sans eux, il ne doit pas rester une promesse rejetée que personne n'attrape.
    this.ready.catch(() => {});
  }

  static async create(db: Db, options: MusicServiceOptions = {}): Promise<MusicService> {
    const service = new MusicService(db, options);
    await service.ready;
    return service;
  }

  // Lit les pièces réglées, et le nom actuel de celui qui a fait chaque réglage (null si son compte n'existe plus). Une ambiance que cette version ne connaît plus
  // revient à celle par défaut.
  private async load(): Promise<void> {
    const rows = await this.db
      .select({ placeKey: roomMusic.placeKey, on: roomMusic.on, scene: roomMusic.scene, changedBy: roomMusic.changedBy, changedAt: roomMusic.changedAt, name: user.name })
      .from(roomMusic)
      .leftJoin(user, eq(user.id, roomMusic.changedBy));
    for (const row of rows) {
      const by = row.changedBy !== null && row.name !== null ? { id: row.changedBy, name: row.name } : null;
      this.states.set(row.placeKey, { on: row.on, scene: isScene(row.scene) ? row.scene : null, by, at: row.changedAt.getTime() });
    }
  }

  /** La musique de cette pièce : une copie, qu'on peut garder. Une pièce que personne n'a réglée est allumée, avec son ambiance par défaut. */
  get(place: string): RoomMusic {
    return copyOf(this.states.get(place) ?? DEFAULT_ROOM_MUSIC);
  }

  /** Les pièces qu'on a réglées, par clé de lieu : des copies. Les autres n'y sont pas. */
  all(): Record<string, RoomMusic> {
    return Object.fromEntries([...this.states].map(([place, state]) => [place, copyOf(state)]));
  }

  /** Cette demande changerait-elle quelque chose à cette pièce ? Faux : elle est déjà ainsi (la demande est ignorée, elle ne compte pas dans une limite). */
  wouldChange(place: string, patch: MusicPatch): boolean {
    const current = this.states.get(place) ?? DEFAULT_ROOM_MUSIC;
    return (patch.on !== undefined && patch.on !== current.on) || (patch.scene !== undefined && patch.scene !== current.scene);
  }

  /**
   * Règle la musique d'une pièce : l'état voulu, non une bascule. Rend le nouvel état, ou null s'il n'y a rien à changer (la pièce est déjà ainsi). L'état n'est
   * changé qu'une fois la base à jour : une écriture qui échoue rejette la promesse, et la pièce reste comme elle était.
   */
  set(place: string, patch: MusicPatch, by: { id: string; name: string }): Promise<RoomMusic | null> {
    return this.serial(place, async () => {
      await this.ready;
      if (!this.wouldChange(place, patch)) return null;
      const current = this.states.get(place) ?? DEFAULT_ROOM_MUSIC;
      const at = this.clock();
      const next: RoomMusic = { on: patch.on ?? current.on, scene: patch.scene === undefined ? current.scene : patch.scene, by: { id: by.id, name: by.name }, at };
      const change = { on: next.on, scene: next.scene, changedBy: by.id, changedAt: new Date(at) };
      await this.db.insert(roomMusic).values({ placeKey: place, ...change }).onConflictDoUpdate({ target: roomMusic.placeKey, set: change });
      this.states.set(place, next);
      return copyOf(next);
    });
  }
}
