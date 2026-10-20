// Les membres du bureau, classés pour le panneau Personnes (spec §10 : les membres en ligne, puis ceux hors ligne).

// Ce qu'il faut savoir d'un membre pour le classer ; un membre peut porter d'autres champs (avatar…), que sortPeople garde.
export interface Person {
  id: string;
  name: string;
}

// Le nom, comparé comme en français : « Élise » vient avec les E, et non après « Zoé » comme le voudrait une comparaison des
// points de code. À nom égal, l'identifiant tranche : l'ordre ne dépend pas de celui de la liste reçue.
const byName = (a: Person, b: Person): number => a.name.localeCompare(b.name, 'fr') || a.id.localeCompare(b.id);

// Sépare les membres en ligne (`online` : leurs identifiants) de ceux qui sont hors ligne, chaque liste triée par nom. La liste
// reçue n'est pas modifiée ; un identifiant en ligne qui n'est pas un membre est ignoré.
export function sortPeople<T extends Person>(members: readonly T[], online: ReadonlySet<string>): { online: T[]; offline: T[] } {
  return {
    online: members.filter((member) => online.has(member.id)).sort(byName),
    offline: members.filter((member) => !online.has(member.id)).sort(byName),
  };
}
