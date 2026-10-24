import {
  CLOSE_JOIN_DISTANCE_PX,
  CLOSE_LEAVE_DISTANCE_PX,
  GROUP_DEBOUNCE_MS,
  GROUP_MEMORY_MS,
  JOIN_DISTANCE_PX,
  LEAVE_DISTANCE_PX,
  REJOIN_DEBOUNCE_MS,
  ZONE_JOIN_DEBOUNCE_MS,
} from '../constants';
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
// - nextId : le numéro du prochain id créé (g1, g2…) ; un numéro n'est créé qu'une fois (seule la mémoire en reprend un, pour les mêmes gens) ;
// - recent : la mémoire des groupes (RecentGroup), par id ; absente quand elle est vide. Deux personnes au moins qui étaient d'un groupe défait
//   depuis moins de GROUP_MEMORY_MS, et qui forment une grappe sans id, reprennent le sien : sa room LiveKit, où elles sont encore parquées. Et
//   qui revient dans un groupe qu'il a quitté depuis moins de GROUP_MEMORY_MS le rejoint après REJOIN_DEBOUNCE_MS.
export interface GroupingState {
  assignment: Record<string, string | null>;
  groups: Record<string, Group>;
  pending: Record<string, { target: string | null; since: number }>;
  nextId: number;
  recent?: Record<string, RecentGroup>;
}

// La mémoire d'un groupe : sa zone (celle qu'il avait au dernier départ), et ceux qui l'ont quitté depuis moins de GROUP_MEMORY_MS, avec l'heure
// (en ms) de leur départ. Un groupe qui se défait y laisse ses derniers membres ; celui qui reste et ceux qui partent y ont le même statut.
export interface RecentGroup {
  zoneId: string | null;
  members: Record<string, number>;
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

// Les distances des espaces ouverts :
// - joinPx : deux personnes à moins de joinPx l'une de l'autre sont reliées ;
// - leavePx : déjà ensemble, elles le restent jusqu'à leavePx (au moins joinPx, pour ne pas se couper en boucle à la limite) ;
// - requireStill : pour se relier, les deux doivent être à l'arrêt (passer à côté de quelqu'un en marchant ne connecte pas).
export interface GroupConfig {
  joinPx: number;
  leavePx: number;
  requireStill: boolean;
}

// Celle du bureau : on se relie à ceux qu'on pourrait entendre (le son baisse avec la distance, voir audioGain), qu'on marche ou non,
// puisqu'à la limite leur voix est déjà inaudible.
export const OPEN_SPACE_GROUPING: GroupConfig = { joinPx: JOIN_DISTANCE_PX, leavePx: LEAVE_DISTANCE_PX, requireStill: false };

// Le cercle serré d'origine : 3 cases, à l'arrêt, et 4 cases pour rester.
export const CLOSE_RANGE_GROUPING: GroupConfig = { joinPx: CLOSE_JOIN_DISTANCE_PX, leavePx: CLOSE_LEAVE_DISTANCE_PX, requireStill: true };

// Les groupes de conversation, à partir de l'état de l'appel précédent (prev, jamais modifié) ; now est l'heure en ms. Appelé
// 4 fois par seconde par le serveur. Le résultat est un état neuf, qui ne dépend que des arguments, pas de l'ordre de la liste :
// - dans une zone isolante, tous les éligibles (ni en Ne pas déranger, ni hors conversation par leur état d'activité) forment un groupe, à partir de deux ;
// - dans les espaces ouverts, on se relie à moins de config.joinPx (et à l'arrêt, si config.requireStill), on reste relié jusqu'à
//   config.leavePx, de proche en proche ;
// - un changement ne s'applique qu'après 500 ms (150 ms pour rejoindre le groupe d'une zone, ou un groupe qu'on a quitté depuis moins de
//   GROUP_MEMORY_MS), sauf ces cas, immédiats :
//   · passer en Ne pas déranger (ou hors conversation) fait sortir de son groupe ;
//   · se trouver hors de la zone de son groupe quand c'est un groupe de zone fait sortir du groupe : qu'on vienne de quitter la zone,
//     ou que, resté dehors, on voie son groupe d'espace ouvert devenir celui de la zone (sa plus grande partie y est entrée et la
//     grappe de la zone a pris son id). On en sort même si l'on veut rejoindre une autre grappe, qu'on attend alors 500 ms ;
//   · un groupe réduit à un membre, vers qui personne n'est en route, est dissous ;
// - personne hors d'une zone n'est jamais dans le groupe de cette zone ;
// - quand des groupes fusionnent ou se séparent, chaque id va à la grappe qui compte le plus de ses membres (à égalité, à celle qui
//   reste dans la zone du groupe, puis à la plus grande) : la plus grande partie garde sa room, les autres en changent ;
// - une grappe sans id où se retrouvent au moins deux membres d'un groupe défait depuis moins de GROUP_MEMORY_MS reprend son id (la mémoire,
//   `recent`) : ils retrouvent leur room, où leur connexion est encore parquée.
export function computeGroups(
  players: ProximityPlayer[],
  map: OfficeMap,
  prev: GroupingState,
  now: number,
  config: GroupConfig = OPEN_SPACE_GROUPING,
): GroupingState {
  const joinSq = config.joinPx * config.joinPx;
  const leaveSq = config.leavePx * config.leavePx;
  // Les joueurs présents, dans l'ordre lexicographique de leur id, avec leur zone : zoneOf(p) = zoneAt(map, p.x, p.y)?.id ?? null.
  const present = [...new Map(players.map((p) => [p.id, p])).values()]
    .sort((a, b) => compare(a.id, b.id))
    .map((p) => ({ p, zone: zoneAt(map, p.x, p.y)?.id ?? null }));
  const current = (id: string): string | null => own(prev.assignment, id) ?? null;
  // La mémoire des groupes, sans les départs de plus de GROUP_MEMORY_MS ; et si ce joueur a quitté ce groupe depuis moins longtemps.
  const memory = forget(prev.recent, now);
  const wasIn = (groupId: string, playerId: string): boolean => {
    const remembered = own(memory, groupId);
    return remembered !== undefined && Object.hasOwn(remembered.members, playerId);
  };

  // 1. Les éligibles : tous, sauf les personnes en Ne pas déranger.
  const eligible = present.filter(({ p }) => !isOutOfConversations(p));

  // 2. Les grappes. Une par zone qui compte au moins 2 éligibles.
  const clusters: Cluster[] = [];
  const byZone = new Map<string, string[]>();
  for (const { p, zone } of eligible) {
    if (zone !== null) byZone.set(zone, [...(byZone.get(zone) ?? []), p.id]);
  }
  for (const [zoneId, members] of byZone) if (members.length >= 2) clusters.push({ members, zoneId });

  // Dans les espaces ouverts, une arête a–b si a et b sont déjà ensemble et à leavePx au plus (d ≤ LEAVE), ou s'ils ne le sont pas,
  // à moins de joinPx (d < JOIN) et, selon la config, tous deux à l'arrêt. Chaque composante connexe d'au moins 2 personnes est une grappe.
  const open = eligible.filter(({ zone }) => zone === null).map(({ p }) => p);
  const neighbours = open.map((): number[] => []);
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i]!;
      const b = open[j]!;
      const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      const group = current(a.id);
      const together = group !== null && group === current(b.id);
      if (together ? d2 <= leaveSq : d2 < joinSq && (!config.requireStill || (!a.moving && !b.moving))) {
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
  //    c. Pour les grappes restées sans id : les groupes défaits de la mémoire (ni groupe, ni déjà pris), permis si l'id ne sort pas de sa
  //       zone ; voix = ses membres qui en étaient (depuis moins de GROUP_MEMORY_MS), à partir de deux. Les mêmes gens qui se retrouvent
  //       reprennent ainsi la room où leur connexion est parquée, au lieu d'en ouvrir une neuve.
  //    Dans chaque passe, les paires par voix décroissantes, puis d'abord celles qui gardent la zone du groupe (cluster.zoneId ===
  //    prevZone(id) : la même zone, ou un espace ouvert pour un groupe d'espace ouvert ; une cible en attente n'étant pas encore un
  //    groupe, prevZone vaut null pour elle ; pour un groupe de la mémoire, c'est sa zone), puis taille de grappe décroissante, puis plus
  //    petit id de membre, puis id (ordre lexicographique) ; une paire n'est retenue que si ni sa grappe ni son id ne le sont déjà.
  //    d. Les grappes restantes reçoivent un nouvel id, `g${nextId++}`, de la plus grande à la plus petite (à égalité : celle du
  //       plus petit id de membre).
  //    claimed : les ids pris par une grappe, avec sa zone.
  clusters.sort((a, b) => b.members.length - a.members.length || compare(a.members[0]!, b.members[0]!));
  let nextId = prev.nextId;
  const claimed = new Map<string, string | null>();
  const idOf = new Map<Cluster, string>();
  const prevZone = (id: string): string | null => own(prev.groups, id)?.zoneId ?? null;
  const claimByVotes = (votesOf: (cluster: Cluster) => Map<string, number>, zoneOf: (id: string) => string | null = prevZone) => {
    const pairs = clusters
      .flatMap((cluster, rank) =>
        idOf.has(cluster) ? [] : [...votesOf(cluster)].map(([id, votes]) => ({ cluster, rank, id, votes, keepsZone: cluster.zoneId === zoneOf(id) })),
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
  const rememberedZone = (id: string): string | null => own(memory, id)?.zoneId ?? null;
  claimByVotes((cluster) => {
    const counts = new Map<string, number>();
    for (const [id, remembered] of Object.entries(memory)) {
      if (own(prev.groups, id) !== undefined) continue;   // un groupe qui existe ne se prend que par ses membres (a)
      if (remembered.zoneId !== null && remembered.zoneId !== cluster.zoneId) continue;
      const count = cluster.members.filter((m) => Object.hasOwn(remembered.members, m)).length;
      if (count >= 2) counts.set(id, count);
    }
    return counts;
  }, rememberedZone);
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
  //    Le délai dépend de la cible : rejoindre le groupe d'une zone (un geste voulu) n'attend que ZONE_JOIN_DEBOUNCE_MS, et revenir dans un
  //    groupe qu'on a quitté depuis moins de GROUP_MEMORY_MS (la mémoire) REJOIN_DEBOUNCE_MS : on y retrouve sa connexion parquée, et l'aller-
  //    retour à la limite ne coûte rien. Quitter un groupe attend toujours GROUP_DEBOUNCE_MS (l'hystérésis des distances fait le reste).
  const delayFor = (target: string | null, playerId: string): number => {
    if (target === null) return GROUP_DEBOUNCE_MS;
    if (claimed.get(target) != null) return ZONE_JOIN_DEBOUNCE_MS;
    return wasIn(target, playerId) ? REJOIN_DEBOUNCE_MS : GROUP_DEBOUNCE_MS;
  };
  const assignment = new Map<string, string | null>();
  const pending = new Map<string, { target: string | null; since: number }>();
  for (const { p, zone } of present) {
    const actual = current(p.id);
    const target = wanted.get(p.id) ?? null;
    const actualZone = actual === null ? null : zoneOfGroup(actual);
    const immediate = isOutOfConversations(p) || (actualZone !== null && zone !== actualZone);
    const waiting = own(prev.pending, p.id);
    const sameTarget = waiting !== undefined && waiting.target === target;
    if (target === actual) {
      assignment.set(p.id, actual);
    } else if (immediate) {
      assignment.set(p.id, null);
      if (target !== null) pending.set(p.id, { target, since: now });
    } else if (sameTarget && now - waiting.since >= delayFor(target, p.id)) {
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

  // 6. La mémoire : chaque membre d'un groupe de prev qui n'y est plus (parti vers un autre, vers aucun, du bureau, ou le groupe s'est défait)
  //    y est inscrit à l'heure de ce calcul, avec la zone du groupe à cet appel. Qui y revient l'efface de la mémoire de ce groupe.
  const departures = new Map<string, { zoneId: string | null; members: Map<string, number> }>(
    Object.entries(memory).map(([id, remembered]) => [id, { zoneId: remembered.zoneId, members: new Map(Object.entries(remembered.members)) }]),
  );
  for (const before of Object.values(prev.groups)) {
    for (const m of before.members) {
      if (assignment.get(m) === before.id) continue;
      const entry = departures.get(before.id) ?? { zoneId: null, members: new Map<string, number>() };
      entry.zoneId = own(groups, before.id)?.zoneId ?? zoneOfGroup(before.id);
      entry.members.set(m, now);
      departures.set(before.id, entry);
    }
  }
  for (const [id, group] of Object.entries(groups)) {
    const entry = departures.get(id);
    if (!entry) continue;
    for (const m of group.members) entry.members.delete(m);
    if (entry.members.size === 0) departures.delete(id);
  }
  const recent = sortedRecord([...departures].map(([id, { zoneId, members }]) => [id, { zoneId, members: sortedRecord([...members]) }]));

  return {
    assignment: Object.fromEntries(assignment),
    groups,
    pending: Object.fromEntries(pending),
    nextId,
    ...(Object.keys(recent).length > 0 ? { recent } : {}),
  };
}

// La mémoire sans les départs de plus de GROUP_MEMORY_MS (ni les groupes qui n'en ont plus), triée par id : le résultat ne dépend pas de
// l'ordre où elle a été écrite.
function forget(recent: Record<string, RecentGroup> | undefined, now: number): Record<string, RecentGroup> {
  if (recent === undefined) return {};
  const kept: Array<[string, RecentGroup]> = [];
  for (const [id, remembered] of Object.entries(recent)) {
    const members = Object.entries(remembered.members).filter(([, at]) => now - at < GROUP_MEMORY_MS);
    if (members.length > 0) kept.push([id, { zoneId: remembered.zoneId, members: sortedRecord(members) }]);
  }
  return sortedRecord(kept);
}

// Un objet aux clés dans l'ordre lexicographique.
function sortedRecord<T>(entries: Array<[string, T]>): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => compare(a, b)));
}

// Les zones où un groupe compte au moins 2 membres.
export function busyZoneIds(s: GroupingState): Set<string> {
  const busy = new Set<string>();
  for (const group of Object.values(s.groups)) {
    if (group.zoneId !== null && group.members.length >= 2) busy.add(group.zoneId);
  }
  return busy;
}

// Hors de toute conversation : en Ne pas déranger, ou dans un état d'activité sans entendre ni être entendu. Une conversation verrouillée
// (conversation-locks.ts) perd aussi ces membres-là.
export function isOutOfConversations(p: ProximityPlayer): boolean {
  return p.status === 'dnd' || p.excluded === true;
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
