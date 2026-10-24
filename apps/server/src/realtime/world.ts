import {
  MAX_SPEED_PX_PER_S,
  MOVE_JITTER_MS,
  NORMAL_MAX_SPEED_PX_PER_S,
  SPEAKING_TTL_MS,
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
  // Jusqu'à quelle heure (ms, horloge du monde) sa parole tient sans nouveau « je parle » : le serveur éteint la bulle ensuite (expireSpeaking).
  speakingUntil?: number;
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
  // Jusqu'à quelle heure (ms, horloge du monde) chaque personne a un café : sa limite de vitesse est alors celle du café (maxSpeedOf). `announced` :
  // sa fin a déjà été rendue par expireBoosts (la ligne reste MOVE_JITTER_MS de plus, pour la limite de vitesse).
  private readonly boosts = new Map<string, { until: number; announced: boolean }>();
  private entryGuard: EntryGuard = () => true;
  private readonly extraGuards: EntryGuard[] = [];

  constructor(
    private readonly map: OfficeMap,
    private readonly now: () => number,
  ) {}

  // Dit qui peut entrer où (les bureaux). Un seul garde à la fois : le dernier posé remplace le précédent.
  setEntryGuard(guard: EntryGuard): void {
    this.entryGuard = guard;
  }

  // Un garde de plus, qui s'ajoute à celui des bureaux au lieu de le remplacer (la cage de l'octogone) : un pas doit passer tous les gardes.
  addEntryGuard(guard: EntryGuard): void {
    this.extraGuards.push(guard);
  }

  // Fait entrer un joueur à (x, y), à l'arrêt, sans micro, caméra ni partage d'écran, à son niveau (0 si l'appelant ne le dit pas). L'appelant donne une position
  // praticable (chooseSpawn) : join ne la vérifie pas. Son statut est aussi celui dont le monde se souvient. Un second join du même
  // identifiant remplace le joueur : sa position, son heure de référence et son mouvement en attente repartent de zéro.
  join(p: { id: string; name: string; avatarKey: string | null; x: number; y: number; dir: Direction; status: Status; level?: number }): PublicPlayer {
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
      level: p.level ?? 0,
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
    this.boosts.delete(id);
    return copy(entry.player);
  }

  // « Je parle » (true) ou « je me tais » (false) d'une personne présente, pour la bulle au-dessus de son avatar. Chaque « je parle » remet le délai
  // de SPEAKING_TTL_MS à zéro. Rend vrai si l'état a changé (à diffuser), faux s'il était déjà celui-là (le battement du client) ou si la
  // personne n'est pas au monde. La parole ne survit pas à la personne : leave et join la remettent à zéro.
  setSpeaking(id: string, speaking: boolean): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const was = entry.player.speaking === true;
    if (speaking) {
      entry.player.speaking = true;
      entry.speakingUntil = this.now() + SPEAKING_TTL_MS;
    } else {
      delete entry.player.speaking;
      delete entry.speakingUntil;
    }
    return was !== speaking;
  }

  // Éteint la parole de ceux qui n'ont rien redit depuis SPEAKING_TTL_MS, et rend leurs identifiants (à diffuser).
  expireSpeaking(): string[] {
    const now = this.now();
    const expired: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.player.speaking === true && entry.speakingUntil !== undefined && now >= entry.speakingUntil) {
        delete entry.player.speaking;
        delete entry.speakingUntil;
        expired.push(id);
      }
    }
    return expired;
  }

  get(id: string): PublicPlayer | undefined {
    const entry = this.entries.get(id);
    return entry ? this.view(id, entry) : undefined;
  }

  list(): PublicPlayer[] {
    return [...this.entries].map(([id, entry]) => this.view(id, entry));
  }

  // Le joueur tel que get et list le donnent : sa copie, avec ce qu'il lui reste de café (boost) quand il en a un. join, lui, rend le joueur qui arrive.
  private view(id: string, entry: Entry): PublicPlayer {
    const player = copy(entry.player);
    const boost = this.boostRemaining(id);
    if (boost > 0) player.boost = boost;
    return player;
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
    if (!validateMove(this.map, { x: p.x, y: p.y, at: entry.at }, { x: m.x, y: m.y, at }, this.maxSpeedOf(id)).ok || !this.entryGuard(id, p, m) || !this.extraGuards.every((guard) => guard(id, p, m))) {
      return { ok: false, correct: { x: p.x, y: p.y } };
    }
    p.x = m.x;
    p.y = m.y;
    p.dir = m.dir;
    p.moving = m.moving;
    entry.at = at;
    // Une téléportation de la même fenêtre (pas encore diffusée) reste une téléportation pour les autres : ce mouvement la remplace dans le tick,
    // mais l'avatar n'a pas glissé jusqu'à sa nouvelle place.
    const teleported = this.pendingMoves.get(id)?.tp === true;
    this.pendingMoves.set(id, { id, x: m.x, y: m.y, dir: m.dir, moving: m.moving, ...(teleported ? { tp: true as const } : {}) });
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
    this.pendingMoves.set(id, { id, x, y, dir: p.dir, moving: false, tp: true });
    return true;
  }

  // Donne `ms` de café à une personne présente, à partir de maintenant (un nouveau café remet le compte à zéro) ; null le retire tout de suite. Un
  // identifiant qui n'est pas dans le monde est ignoré. Le café ne survit pas au départ de la personne (leave).
  setBoost(id: string, ms: number | null): void {
    if (!this.entries.has(id)) return;
    if (ms === null) this.boosts.delete(id);
    else this.boosts.set(id, { until: this.now() + ms, announced: false });
  }

  // Ce qu'il reste de café à cette personne, en ms : 0 sans café, une fois fini, ou pour un inconnu.
  boostRemaining(id: string): number {
    const boost = this.boosts.get(id);
    return boost ? Math.max(0, boost.until - this.now()) : 0;
  }

  // Ceux dont le café vient de finir (à diffuser, une seule fois chacun). Leur ligne reste MOVE_JITTER_MS de plus, le temps de la limite de vitesse
  // (maxSpeedOf), puis disparaît. Un café retiré avec setBoost(id, null) n'y figure pas : celui qui l'a retiré le dit lui-même.
  expireBoosts(): string[] {
    const now = this.now();
    const ended: string[] = [];
    for (const [id, boost] of this.boosts) {
      if (now >= boost.until && !boost.announced) {
        boost.announced = true;
        ended.push(id);
      }
      if (now > boost.until + MOVE_JITTER_MS) this.boosts.delete(id);
    }
    return ended;
  }

  // La plus grande vitesse que le serveur accepte de cette personne : celle du café jusqu'à MOVE_JITTER_MS après sa fin (les derniers paquets
  // arrivent en retard, leur heure de réception est celle d'après), sinon celle de la course. Un inconnu n'a pas de café.
  maxSpeedOf(id: string): number {
    const boost = this.boosts.get(id);
    return boost !== undefined && this.now() <= boost.until + MOVE_JITTER_MS ? MAX_SPEED_PX_PER_S : NORMAL_MAX_SPEED_PX_PER_S;
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

  // Le niveau d'un joueur présent (sa progression a changé). Rend vrai s'il a changé (à diffuser) ; un identifiant qui n'est pas dans le monde est ignoré.
  setLevel(id: string, level: number): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.player.level === level) return false;
    entry.player.level = level;
    return true;
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
