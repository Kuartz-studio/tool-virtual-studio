import { CURRENT_RELEASE, compareReleases, isReleaseVersion, type Role } from '@bureau/shared';

// Les notes de version, telles que la fenêtre « Quoi de neuf ? » (WhatsNew.tsx) les montre : la plus récente d'abord. La marche à suivre pour en publier
// une est dans docs/nouveautes.md ; en deux mots : monter CURRENT_RELEASE (packages/shared/src/releases.ts) et ajouter sa note en tête de RELEASES, dans
// le même commit (le test refuse l'un sans l'autre).
//
// Elles s'adressent aux collègues : en français, au tutoiement, courtes et concrètes (ce que la personne peut faire, pas comment c'est codé). Elles ne
// parlent jamais de ce qui est encore une surprise (voir « La règle de la surprise » dans docs/nouveautes.md) : le dépôt est public.

// Le genre d'une nouveauté : la fenêtre range les nouveautés d'une version par genre, dans cet ordre (RELEASE_KINDS), sous un titre à sa couleur
// (Nouveautés, Améliorations, Corrections, Suppressions : fr.whatsNew.groups). `removed`, ce qu'on a retiré, reste rare.
export const RELEASE_KINDS = ['new', 'improved', 'fixed', 'removed'] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

// Une nouveauté tient sur une ligne dans la fenêtre : un titre de RELEASE_TITLE_MAX caractères au plus, un texte de RELEASE_TEXT_MAX (le test des notes
// le vérifie). À 520 px de large, la colonne du texte en prend une soixantaine ; on garde de la marge.
export const RELEASE_TITLE_MAX = 34;
export const RELEASE_TEXT_MAX = 56;

// Les icônes des notes, par le nom de ce qu'elles montrent : office/icons.tsx (ReleaseIcon) les fait correspondre à celles de Lucide. Une note qui veut
// une autre icône l'ajoute là-bas, et ici.
export type ReleaseIconName = 'fullscreen' | 'zoom' | 'admin' | 'whatsNew' | 'statusDot' | 'treadmill' | 'decor' | 'blackTiles';

export interface ReleaseEntry {
  kind: ReleaseKind;
  icon: ReleaseIconName;
  // Le titre et le texte, une ligne chacun (RELEASE_TITLE_MAX, RELEASE_TEXT_MAX).
  title: string;
  text: string;
  // Réservée aux admins (le panneau Admin, par exemple) : les membres ne la voient pas.
  adminsOnly?: boolean;
}

export interface Release {
  // Le numéro (MAJEUR.MINEUR : packages/shared/src/releases.ts) et le jour de la mise en ligne (AAAA-MM-JJ).
  version: string;
  date: string;
  // L'accroche, sous le titre de la fenêtre : une phrase.
  tagline: string;
  entries: readonly ReleaseEntry[];
}

export const RELEASES: readonly Release[] = [
  {
    version: '1.00',
    date: '2026-10-29',
    tagline: 'Le bureau passe en version 1.00 : voici ce qui change pour toi.',
    entries: [
      { kind: 'new', icon: 'fullscreen', title: 'Plein écran en réunion', text: 'Mets la caméra ou l\'écran de n\'importe qui en grand.' },
      { kind: 'new', icon: 'whatsNew', title: 'Les nouveautés, ici même', text: 'Tu les retrouves à tout moment dans ton menu « Moi ».' },
      { kind: 'improved', icon: 'zoom', title: 'Un zoom tout en douceur', text: 'La caméra te suit partout, sans saut, même au bord.' },
      { kind: 'fixed', icon: 'statusDot', title: 'La pastille de ton portrait', text: 'Elle prend la couleur de ton mode en cours.' },
    ],
  },
];

// Ce que la fenêtre montre à ce rôle :
// - `history` : tout l'historique (la ligne « Nouveautés » du menu « Moi », le bouton « Tout l'historique ») ;
// - sinon, les versions manquées : plus récentes que la dernière vue, jusqu'à la version en cours. Qui n'en a vu aucune (null, ou une valeur abîmée) ne
//   voit que la version en cours : on ne lui raconte pas toute l'histoire d'un coup.
// Seulement les versions qui ont quelque chose à dire à ce rôle (hasNotesFor) : une version faite pour les seuls admins n'ouvre pas, chez un membre, une
// fenêtre vide. Toujours la plus récente d'abord, et jamais une note plus récente que la version en cours : un filet de sécurité, puisque le test des
// notes (releases.test.ts) refuse déjà une note en tête qui ne serait pas CURRENT_RELEASE.
export function releasesToShow(
  seen: string | null,
  history: boolean,
  role: Role,
  releases: readonly Release[] = RELEASES,
  current: string = CURRENT_RELEASE,
): Release[] {
  const published = releases
    .filter((release) => compareReleases(release.version, current) <= 0 && hasNotesFor(release, role))
    .sort((a, b) => compareReleases(b.version, a.version));
  if (history) return published;
  if (!isReleaseVersion(seen)) return published.filter((release) => release.version === current);
  return published.filter((release) => compareReleases(release.version, seen) > 0);
}

// Les nouveautés d'une version pour ce rôle : un membre ne voit pas celles des admins.
export function entriesFor(release: Release, role: Role): ReleaseEntry[] {
  return release.entries.filter((entry) => role === 'admin' || !entry.adminsOnly);
}

// Une version a-t-elle quelque chose à montrer à ce rôle : une nouveauté qui le concerne ?
export function hasNotesFor(release: Release, role: Role): boolean {
  return entriesFor(release, role).length > 0;
}

// Les nouveautés d'une version pour ce rôle, rangées par genre dans l'ordre de RELEASE_KINDS (l'ordre de la note dans chaque genre) ; un genre sans
// nouveauté n'a pas de groupe.
export function groupsFor(release: Release, role: Role): Array<{ kind: ReleaseKind; entries: ReleaseEntry[] }> {
  const entries = entriesFor(release, role);
  return RELEASE_KINDS.map((kind) => ({ kind, entries: entries.filter((entry) => entry.kind === kind) })).filter((group) => group.entries.length > 0);
}

// « 29 octobre 2026 » : le jour de la note, lu comme une date du calendrier (sans fuseau : le 29 reste le 29 partout). Le premier du mois s'écrit
// « 1er », comme en français : Intl ne le fait pas (« 1 janvier 2027 »), on remplace donc ce seul jour, la partie `day` du résultat.
const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatReleaseDate(date: string): string {
  return DATE_FORMAT.formatToParts(new Date(`${date}T00:00:00Z`))
    .map((part) => (part.type === 'day' && part.value === '1' ? '1er' : part.value))
    .join('');
}
