import type { OfficeMap } from '../map/parse-map';
import { zoneAt } from '../map/queries';
import type { ConversationLock, ProximityPlayer } from '../protocol';
import type { GroupingState } from './compute-groups';

// Les conversations verrouillées, au-dessus du calcul des groupes. Le calcul (computeGroups) ne voit pas leurs membres : ils restent ensemble
// quoi qu'il arrive (la distance, les pièces, les portes, les zones), et personne ne les rejoint par proximité. Le serveur tient les verrous, en
// mémoire ; ces fonctions, pures, font sortir un groupe du calcul quand on le verrouille, l'y font revenir quand il ne l'est plus, et donnent
// l'état que voient le coordinateur des rooms, le faux live et les zones occupées.
//
// Un groupe verrouillé garde son id : sa room LiveKit ne change pas, et verrouiller ne coupe rien. Les ids ne se mélangent jamais : le calcul
// n'en crée que de neufs (nextId), et le groupe verrouillé a quitté sa mémoire et les attentes de ceux qui allaient le rejoindre.

// L'état du calcul sans le groupe `id` ni ses membres, que le verrou tient désormais : ni leurs affectations, ni leurs attentes, ni celles des
// autres vers ce groupe (personne ne le rejoint plus), ni sa mémoire (personne ne reprend son id).
export function withoutGroup(s: GroupingState, id: string): GroupingState {
  const members = new Set(Object.hasOwn(s.groups, id) ? s.groups[id]!.members : []);
  const assignment = Object.fromEntries(Object.entries(s.assignment).filter(([player]) => !members.has(player)));
  const pending = Object.fromEntries(Object.entries(s.pending).filter(([player, waiting]) => !members.has(player) && waiting.target !== id));
  const groups = Object.fromEntries(Object.entries(s.groups).filter(([groupId]) => groupId !== id));
  const recent = Object.fromEntries(Object.entries(s.recent ?? {}).filter(([groupId]) => groupId !== id));
  return { assignment, groups, pending, nextId: s.nextId, ...(Object.keys(recent).length > 0 ? { recent } : {}) };
}

// L'état du calcul où revient le groupe `id`, qui n'est plus verrouillé (déverrouillé, ou qu'il ne reste plus qu'un membre) : ceux de ses membres
// qui sont présents y sont affectés, dans un groupe de leur zone s'ils sont tous dans la même, d'un espace ouvert sinon. Le calcul les reprend
// là où ils sont : ceux qui sont encore ensemble gardent la room, sans coupure ; les autres la quittent comme on quitte un groupe ordinaire (un
// membre seul, tout de suite : un groupe d'une personne se défait).
export function withGroup(s: GroupingState, id: string, members: readonly string[], players: readonly ProximityPlayer[], map: OfficeMap): GroupingState {
  const here = players.filter((p) => members.includes(p.id));
  if (here.length === 0) return s;
  const zones = new Set(here.map((p) => zoneAt(map, p.x, p.y)?.id ?? null));
  const zoneId = zones.size === 1 ? [...zones][0]! : null;
  const ids = here.map((p) => p.id).sort(compare);
  return {
    ...s,
    assignment: { ...s.assignment, ...Object.fromEntries(ids.map((m) => [m, id])) },
    groups: { ...s.groups, [id]: { id, members: ids, zoneId } },
  };
}

// L'état que voient le coordinateur des rooms, le faux live, le chat « À proximité » et les zones occupées : celui du calcul, plus chaque
// conversation verrouillée sous son id, sans zone (elle ne tient à aucune pièce : busyZoneIds l'ignore, et l'on peut réapparaître dans une
// salle où se tient un membre d'une conversation verrouillée).
export function overlayLocks(s: GroupingState, locks: Iterable<ConversationLock>): GroupingState {
  const assignment = { ...s.assignment };
  const groups = { ...s.groups };
  for (const lock of locks) {
    groups[lock.id] = { id: lock.id, members: [...lock.members], zoneId: null };
    for (const m of lock.members) assignment[m] = lock.id;
  }
  return { ...s, assignment, groups };
}

// L'ordre lexicographique (des unités UTF-16), le même sur toutes les machines.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
