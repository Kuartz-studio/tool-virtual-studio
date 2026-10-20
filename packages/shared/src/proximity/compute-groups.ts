import { GROUP_DEBOUNCE_MS, JOIN_DISTANCE_PX, LEAVE_DISTANCE_PX } from '../constants';
import type { OfficeMap } from '../map/parse-map';
import { zoneAt } from '../map/queries';
import type { ProximityPlayer } from '../protocol';

// Un groupe de conversation : une room LiveKit pour le serveur. Ses membres sont dans l'ordre lexicographique. zoneId : la zone
// isolante (salle de réunion, espace de bureau) dont c'est le groupe, et tous ses membres y sont ; ou null pour un groupe d'espace
// ouvert, dont un membre peut se trouver dans une zone le temps d'attendre le groupe de celle-ci (500 ms après y être entré). C'est la
// zone de la grappe qui a pris son id au dernier calcul, ou, si aucune ne l'a pris, celle qu'il avait.
export interface Group {
  id: string;
  members: string[];
  zoneId: string | null;
}

// Ce que le calcul garde d'un appel au suivant :
// - assignment : le groupe de chaque joueur présent, null s'il n'est dans aucun ;
// - groups : les groupes, par id ;
// - pending : les changements qui attendent leur délai (GROUP_DEBOUNCE_MS). target est le groupe voulu, null pour quitter le
//   sien ; since, l'heure (en ms) depuis laquelle ce changement est voulu sans interruption. Jamais vers le groupe où l'on est ;
// - nextId : le numéro du prochain id créé (g1, g2…) ; un numéro ne sert qu'une fois.
export interface GroupingState {
  assignment: Record<string, string | null>;
  groups: Record<string, Group>;
  pending: Record<string, { target: string | null; since: number }>;
  nextId: number;
}

// L'état de départ. Figé : computeGroups ne modifie jamais l'état reçu, et personne d'autre ne doit modifier celui-ci.
export const EMPTY_GROUPING: GroupingState = Object.freeze({
  assignment: Object.freeze({}),
  groups: Object.freeze({}),
  pending: Object.freeze({}),
  nextId: 1,
});

interface Cluster {
  members: string[];   // dans l'ordre lexicographique
  zoneId: string | null;
}

const JOIN_SQ = JOIN_DISTANCE_PX * JOIN_DISTANCE_PX;
const LEAVE_SQ = LEAVE_DISTANCE_PX * LEAVE_DISTANCE_PX;

// Les groupes de conversation, à partir de l'état de l'appel précédent (prev, jamais modifié) ; now est l'heure en ms. Appelé
// 4 fois par seconde par le serveur. Le résultat est un état neuf, qui ne dépend que des arguments, pas de l'ordre de la liste :
// - dans une zone isolante, tous les éligibles (pas en Ne pas déranger) forment un groupe, à partir de deux ;
// - dans les espaces ouverts, on se relie à moins de 3 cases et à l'arrêt, on reste relié jusqu'à 4 cases, de proche en proche ;
// - un changement ne s'applique qu'après 500 ms, sauf ces cas, immédiats :
//   · passer en Ne pas déranger fait sortir de son groupe ;
//   · se trouver hors de la zone de son groupe quand c'est un groupe de zone fait sortir du groupe : qu'on vienne de quitter la zone,
//     ou que, resté dehors, on voie son groupe d'espace ouvert devenir celui de la zone (sa plus grande partie y est entrée et la
//     grappe de la zone a pris son id). On en sort même si l'on veut rejoindre une autre grappe, qu'on attend alors 500 ms ;
//   · un groupe réduit à un membre, vers qui personne n'est en route, est dissous ;
// - personne hors d'une zone n'est jamais dans le groupe de cette zone ;
// - quand des groupes fusionnent ou se séparent, chaque id va à la grappe qui compte le plus de ses membres (à égalité, à celle qui
//   reste dans la zone du groupe, puis à la plus grande) : la plus grande partie garde sa room, les autres en changent.
export function computeGroups(players: ProximityPlayer[], map: OfficeMap, prev: GroupingState, now: number): GroupingState {
  // Les joueurs présents, dans l'ordre lexicographique de leur id, avec leur zone : zoneOf(p) = zoneAt(map, p.x, p.y)?.id ?? null.
  const present = [...new Map(players.map((p) => [p.id, p])).values()]
    .sort((a, b) => compare(a.id, b.id))
    .map((p) => ({ p, zone: zoneAt(map, p.x, p.y)?.id ?? null }));
  const current = (id: string): string | null => own(prev.assignment, id) ?? null;

  // 1. Les éligibles : tous, sauf les personnes en Ne pas déranger.
  const eligible = present.filter(({ p }) => p.status !== 'dnd');

  // 2. Les grappes. Une par zone qui compte au moins 2 éligibles.
  const clusters: Cluster[] = [];
  const byZone = new Map<string, string[]>();
  for (const { p, zone } of eligible) {
    if (zone !== null) byZone.set(zone, [...(byZone.get(zone) ?? []), p.id]);
  }
  for (const [zoneId, members] of byZone) if (members.length >= 2) clusters.push({ members, zoneId });

  // Dans les espaces ouverts, une arête a–b si a et b sont déjà ensemble et à 4 cases au plus (d ≤ LEAVE), ou s'ils ne le sont pas,
  // à moins de 3 cases (d < JOIN) et tous deux à l'arrêt. Chaque composante connexe d'au moins 2 personnes est une grappe.
  const open = eligible.filter(({ zone }) => zone === null).map(({ p }) => p);
  const neighbours = open.map((): number[] => []);
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i]!;
      const b = open[j]!;
      const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      const group = current(a.id);
      const together = group !== null && group === current(b.id);
      if (together ? d2 <= LEAVE_SQ : d2 < JOIN_SQ && !a.moving && !b.moving) {
        neighbours[i]!.push(j);
        neighbours[j]!.push(i);
      }
    }
  }
  const visited = new Set<number>();
  for (let start = 0; start < open.length; start++) {
    if (visited.has(start)) continue;
    visited.add(start);
    const component: string[] = [];
    for (const queue = [start]; queue.length > 0; ) {
      const i = queue.pop()!;
      component.push(open[i]!.id);
      for (const j of neighbours[i]!) {
        if (!visited.has(j)) {
          visited.add(j);
          queue.push(j);
        }
      }
    }
    if (component.length >= 2) clusters.push({ members: component.sort(compare), zoneId: null });
  }

  // 3. Les identifiants, pris aux voix : un id va à la grappe qui compte le plus de ses membres ; à voix égales, à celle qui garde la
  //    zone du groupe, puis à la plus grande. Les ids des joueurs n'interviennent que sur une égalité complète (mêmes voix, zone gardée
  //    ou non de la même façon, même taille), où la grappe du plus petit id de membre l'emporte, et pour numéroter les nouveaux ids de
  //    grappes de même taille.
  //    a. Ids actuels : chaque paire (grappe, id actuel d'au moins un de ses membres), permise si l'id ne sort pas de sa zone (celui
  //       d'un groupe d'espace ouvert, ou d'un groupe de la zone de la grappe : l'id d'un groupe de zone ne sert jamais hors de sa
  //       zone) ; voix = ses membres qui sont dans ce groupe.
  //    b. Pour les grappes restées sans id : leurs cibles en attente, parmi les ids qui ne sont pas encore des groupes (un groupe qui
  //       se forme garde son id pendant l'attente) ; voix = ses membres qui attendent cet id.
  //    Dans chaque passe, les paires par voix décroissantes, puis d'abord celles qui gardent la zone du groupe (cluster.zoneId ===
  //    prevZone(id) : la même zone, ou un espace ouvert pour un groupe d'espace ouvert ; une cible en attente n'étant pas encore un
  //    groupe, prevZone vaut null pour elle), puis taille de grappe décroissante, puis plus petit id de membre, puis id (ordre
  //    lexicographique) ; une paire n'est retenue que si ni sa grappe ni son id ne le sont déjà.
  //    c. Les grappes restantes reçoivent un nouvel id, `g${nextId++}`, de la plus grande à la plus petite (à égalité : celle du
  //       plus petit id de membre).
  //    claimed : les ids pris par une grappe, avec sa zone.
  clusters.sort((a, b) => b.members.length - a.members.length || compare(a.members[0]!, b.members[0]!));
  let nextId = prev.nextId;
  const claimed = new Map<string, string | null>();
  const idOf = new Map<Cluster, string>();
  const prevZone = (id: string): string | null => own(prev.groups, id)?.zoneId ?? null;
  const claimByVotes = (votesOf: (cluster: Cluster) => Map<string, number>) => {
    const pairs = clusters
      .flatMap((cluster, rank) =>
        idOf.has(cluster) ? [] : [...votesOf(cluster)].map(([id, votes]) => ({ cluster, rank, id, votes, keepsZone: cluster.zoneId === prevZone(id) })),
      )
      .sort((a, b) => b.votes - a.votes || Number(b.keepsZone) - Number(a.keepsZone) || a.rank - b.rank || compare(a.id, b.id));
    for (const { cluster, id } of pairs) {
      if (idOf.has(cluster) || claimed.has(id)) continue;
      idOf.set(cluster, id);
      claimed.set(id, cluster.zoneId);
    }
  };
  claimByVotes((cluster) => votes(cluster.members.map(current), (g) => prevZone(g) === null || prevZone(g) === cluster.zoneId));
  claimByVotes((cluster) => votes(cluster.members.map((m) => own(prev.pending, m)?.target ?? null), (g) => own(prev.groups, g) === undefined));
  for (const cluster of clusters) {
    if (idOf.has(cluster)) continue;
    const id = `g${nextId++}`;
    idOf.set(cluster, id);
    claimed.set(id, cluster.zoneId);
  }
  const wanted = new Map<string, string>();   // voulu, pour les membres d'une grappe ; null pour les autres
  for (const [cluster, id] of idOf) for (const m of cluster.members) wanted.set(m, id);
  // La zone d'un groupe à cet appel : celle de la grappe qui a pris son id, sinon celle qu'il avait. Un groupe d'espace ouvert dont
  // la grappe d'une zone a pris l'id est donc déjà, à cet appel, le groupe de cette zone.
  const zoneOfGroup = (id: string): string | null => (claimed.has(id) ? (claimed.get(id) ?? null) : prevZone(id));

  // 4. Le délai, pour chaque joueur présent. Deux sorties sont immédiates (le joueur passe à null dans cet appel) : passer en Ne pas
  //    déranger, et se trouver hors de la zone de son groupe quand c'est un groupe de zone, quelle que soit la grappe voulue ; s'il en
  //    veut une, il l'attend à partir de maintenant. Tout autre changement attend que la même cible soit voulue depuis
  //    GROUP_DEBOUNCE_MS.
  const assignment = new Map<string, string | null>();
  const pending = new Map<string, { target: string | null; since: number }>();
  for (const { p, zone } of present) {
    const actual = current(p.id);
    const target = wanted.get(p.id) ?? null;
    const actualZone = actual === null ? null : zoneOfGroup(actual);
    const immediate = p.status === 'dnd' || (actualZone !== null && zone !== actualZone);
    const waiting = own(prev.pending, p.id);
    const sameTarget = waiting !== undefined && waiting.target === target;
    if (target === actual) {
      assignment.set(p.id, actual);
    } else if (immediate) {
      assignment.set(p.id, null);
      if (target !== null) pending.set(p.id, { target, since: now });
    } else if (sameTarget && now - waiting.since >= GROUP_DEBOUNCE_MS) {
      assignment.set(p.id, target);
    } else {
      assignment.set(p.id, actual);
      pending.set(p.id, { target, since: sameTarget ? waiting.since : now });
    }
  }

  // 5. Les groupes : l'affectation inversée. Un groupe d'un seul membre vers qui personne n'est en attente est dissous tout de
  //    suite : son membre passe à null (et une attente de quitter le groupe n'a plus d'objet). Sa zone est zoneOfGroup : celle de la
  //    grappe qui a pris son id, ou, si aucune ne l'a pris (tous ses membres attendent d'en sortir), celle qu'il avait.
  const members = new Map<string, string[]>();
  for (const [id, group] of assignment) {
    if (group !== null) members.set(group, [...(members.get(group) ?? []), id]);
  }
  const awaited = new Set([...pending.values()].map((w) => w.target));
  const groups: Record<string, Group> = {};
  for (const id of [...members.keys()].sort(compare)) {
    const list = members.get(id)!;
    if (list.length === 1 && !awaited.has(id)) {
      const alone = list[0]!;
      assignment.set(alone, null);
      if (pending.get(alone)?.target === null) pending.delete(alone);
      continue;
    }
    groups[id] = { id, members: list, zoneId: zoneOfGroup(id) };
  }

  return { assignment: Object.fromEntries(assignment), groups, pending: Object.fromEntries(pending), nextId };
}

// Les zones où un groupe compte au moins 2 membres.
export function busyZoneIds(s: GroupingState): Set<string> {
  const busy = new Set<string>();
  for (const group of Object.values(s.groups)) {
    if (group.zoneId !== null && group.members.length >= 2) busy.add(group.zoneId);
  }
  return busy;
}

// L'ordre lexicographique (des unités UTF-16), le même sur toutes les machines, quelle que soit leur langue.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// La valeur propre de l'objet pour cette clé : l'id d'un joueur comme « constructor » ne doit pas lire une propriété héritée.
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

// Le nombre de voix de chaque id de la liste, parmi ceux qu'`allowed` accepte (null ne compte jamais).
function votes(ids: Array<string | null>, allowed: (id: string) => boolean): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (id !== null && allowed(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
