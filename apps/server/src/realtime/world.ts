import {
  isWalkablePoint,
  validateMove,
  type ActivityState,
  type Direction,
  type MediaState,
  type MovePayload,
  type OfficeMap,
  type ProximityPlayer,
  type PublicPlayer,
  type Status,
  type WorldTick,
} from '@bureau/shared';

type Move = WorldTick['moves'][number];

// Un joueur du monde, et l'heure (ms, horloge du serveur) de sa dernière position acceptée : le départ de la vérification de vitesse
// du mouvement suivant.
interface Entry {
  player: PublicPlayer;
  at: number;
}

// Ce joueur peut-il se trouver là ? Décide de l'entrée d'un lieu fermé (un bureau dont la porte lui est fermée) : appelé pour chaque
// déplacement accepté, de la dernière position acceptée à la nouvelle. Faux : le déplacement est refusé, comme contre un mur.
export type EntryGuard = (id: string, from: { x: number; y: number }, to: { x: number; y: number }) => boolean;

// Les joueurs qui n'ont pas de micro, de caméra ni de partage d'écran en arrivant.
const noMedia = (): MediaState => ({ mic: false, cam: false, screen: false });

// Ce que World donne à ses appelants : une copie, pour qu'un objet gardé (envoyé plus tard, comparé dans un test) ne change pas
// quand le joueur bouge, et qu'on ne puisse pas modifier le monde de l'extérieur.
const copy = (p: PublicPlayer): PublicPlayer => ({ ...p, media: { ...p.media }, activity: p.activity ? { ...p.activity } : null });

// L'état du monde, en mémoire (une seule instance de serveur) : qui est là, où, avec quel statut, quels médias. Rien de réseau ni de
// base de données ; la présence (tâche 13), les mouvements et les statuts (tâche 14) et les groupes (tâche 17) s'y appuient.
//
// `now` est l'horloge du serveur, en ms : l'heure de réception de chaque mouvement, jamais une heure donnée par le client. Les
// joueurs sont listés dans l'ordre où ils sont arrivés.
export class World {
  private readonly entries = new Map<string, Entry>();
  // Le dernier statut de chaque identifiant vu, y compris de ceux qui sont partis : il survit à la déconnexion.
  private readonly statuses = new Map<string, Status>();
  // De même pour l'état d'activité (null : aucun) : celui que la personne avait en partant, qu'elle retrouve en revenant.
  private readonly activities = new Map<string, ActivityState | null>();
  // Le dernier mouvement accepté de chaque joueur depuis le dernier drainMoves, dans l'ordre du premier mouvement de la fenêtre.
  private readonly pendingMoves = new Map<string, Move>();
  private entryGuard: EntryGuard = () => true;

  constructor(
    private readonly map: OfficeMap,
    private readonly now: () => number,
  ) {}

  // Dit qui peut entrer où (les bureaux). Un seul garde à la fois : le dernier posé remplace le précédent.
  setEntryGuard(guard: EntryGuard): void {
    this.entryGuard = guard;
  }

  // Fait entrer un joueur à (x, y), à l'arrêt, sans micro, caméra ni partage d'écran. L'appelant donne une position praticable
  // (chooseSpawn) : join ne la vérifie pas. Son statut est aussi celui dont le monde se souvient. Un second join du même
  // identifiant remplace le joueur : sa position, son heure de référence et son mouvement en attente repartent de zéro.
  join(p: { id: string; name: string; avatarKey: string | null; x: number; y: number; dir: Direction; status: Status }): PublicPlayer {
    const player: PublicPlayer = {
      id: p.id,
      name: p.name,
      avatarKey: p.avatarKey,
      x: p.x,
      y: p.y,
      dir: p.dir,
      moving: false,
      status: p.status,
      media: noMedia(),
      activity: this.activities.get(p.id) ?? null,
    };
    this.entries.delete(p.id);   // un joueur qui revient prend la dernière place de la liste
    this.entries.set(p.id, { player, at: this.now() });
    this.statuses.set(p.id, p.status);
    this.pendingMoves.delete(p.id);
    return copy(player);
  }

  // Retire le joueur et renvoie ce qu'il était, ou undefined s'il n'était pas là. Son statut reste en mémoire (rememberedStatus) ;
  // son mouvement en attente est abandonné : il ne doit pas réapparaître dans un tick après player:left.
  leave(id: string): PublicPlayer | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    this.pendingMoves.delete(id);
    return copy(entry.player);
  }

  get(id: string): PublicPlayer | undefined {
    const entry = this.entries.get(id);
    return entry ? copy(entry.player) : undefined;
  }

  list(): PublicPlayer[] {
    return [...this.entries.values()].map((entry) => copy(entry.player));
  }

  // Vérifie le mouvement (validateMove, de la dernière position acceptée à celle-ci, à l'heure de réception) et, s'il passe,
  // l'enregistre : position, direction, état « en marche », et heure de référence du suivant. Un mouvement refusé ne change rien
  // (ni la position, ni l'heure de référence) et renvoie la dernière position acceptée : c'est là que le client doit se recaler.
  // Un joueur inconnu (parti entre-temps) n'a pas de position à corriger : refusé aussi, avec le point d'apparition.
  applyMove(id: string, m: MovePayload): { ok: true } | { ok: false; correct: { x: number; y: number } } {
    const entry = this.entries.get(id);
    if (!entry) return { ok: false, correct: { x: this.map.spawn.x, y: this.map.spawn.y } };

    const p = entry.player;
    const at = this.now();
    if (!validateMove(this.map, { x: p.x, y: p.y, at: entry.at }, { x: m.x, y: m.y, at }).ok || !this.entryGuard(id, p, m)) {
      return { ok: false, correct: { x: p.x, y: p.y } };
    }
    p.x = m.x;
    p.y = m.y;
    p.dir = m.dir;
    p.moving = m.moving;
    entry.at = at;
    this.pendingMoves.set(id, { id, x: m.x, y: m.y, dir: m.dir, moving: m.moving });
    return { ok: true };
  }

  // Pose le joueur en (x, y), à l'arrêt, sans contrôle de vitesse ; la case doit être praticable. Le prochain drainMoves le dit
  // aux autres. Sa position et l'heure d'aujourd'hui deviennent la référence des mouvements suivants. false si la case est bloquante
  // ou hors carte, ou si le joueur est inconnu : rien ne change alors.
  teleport(id: string, x: number, y: number): boolean {
    const entry = this.entries.get(id);
    if (!entry || !isWalkablePoint(this.map, x, y)) return false;
    const p = entry.player;
    p.x = x;
    p.y = y;
    p.moving = false;
    entry.at = this.now();
    this.pendingMoves.set(id, { id, x, y, dir: p.dir, moving: false });
    return true;
  }

  // Le statut d'un joueur présent, retenu aussi pour son prochain retour. Un identifiant qui n'est pas dans le monde est ignoré.
  setStatus(id: string, s: Status): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.player.status = s;
    this.statuses.set(id, s);
  }

  // L'état d'activité d'un joueur présent (null : aucun, il retrouve son statut ordinaire), retenu aussi pour son prochain retour. Un
  // identifiant qui n'est pas dans le monde est ignoré.
  setActivity(id: string, activity: ActivityState | null): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.player.activity = activity && { ...activity };
    this.activities.set(id, activity && { ...activity });
  }

  // L'état d'activité qu'on avait en dernier (présent ou parti), ou null.
  rememberedActivity(id: string): ActivityState | null {
    return this.activities.get(id) ?? null;
  }

  // L'état `activityId` de cette personne a été remplacé (`state`) ou supprimé (null) : celui qu'elle a pris, ou qu'elle avait en partant,
  // suit. Rend ce qu'il est devenu si c'était le sien (à rediffuser, si elle est là), undefined s'il n'y a rien à changer.
  editActivity(userId: string, activityId: string, state: ActivityState | null): { activity: ActivityState | null } | undefined {
    if (this.activities.get(userId)?.id !== activityId) return undefined;
    const next = state && { ...state };
    this.activities.set(userId, next);
    const entry = this.entries.get(userId);
    if (entry) entry.player.activity = next && { ...next };
    return { activity: next };
  }

  // Le dernier statut de cet identifiant, même s'il est parti ; « available » s'il n'est jamais venu.
  rememberedStatus(id: string): Status {
    return this.statuses.get(id) ?? 'available';
  }

  setMedia(id: string, m: MediaState): void {
    const entry = this.entries.get(id);
    if (entry) entry.player.media = { mic: m.mic, cam: m.cam, screen: m.screen };
  }

  setProfile(id: string, p: { name: string; avatarKey: string | null }): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.player.name = p.name;
    entry.player.avatarKey = p.avatarKey;
  }

  // Les mouvements à diffuser dans le prochain world:tick : au plus un par joueur, le dernier accepté (ou la téléportation)
  // depuis l'appel précédent, dans l'ordre où chaque joueur a fait son premier mouvement de la fenêtre. Vide la liste.
  drainMoves(): WorldTick['moves'] {
    const moves = [...this.pendingMoves.values()];
    this.pendingMoves.clear();
    return moves;
  }

  // Ce que le calcul des groupes lit de chaque joueur, dans l'ordre d'arrivée.
  proximityPlayers(): ProximityPlayer[] {
    return [...this.entries.values()].map(({ player: p }) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      moving: p.moving,
      status: p.status,
      // Un état d'activité sans entendre ni être entendu : hors de toute conversation.
      excluded: p.activity != null && !p.activity.hear && !p.activity.heard,
    }));
  }
}
