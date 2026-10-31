// Les versions de l'appli, telles que les gens les voient dans la fenêtre « Quoi de neuf ? » (docs/nouveautes.md) : MAJEUR.MINEUR, le mineur sur deux
// chiffres (1.00, 1.01 … 1.09, 1.10 … 1.99, puis 2.00). La numérotation commence à la 1.00, le 29 octobre 2026.
//
// C'est la seule source de la version en cours : le serveur l'enregistre sur le compte quand la fenêtre est fermée (POST /api/me/release-seen), et la
// donne aux comptes créés à partir de maintenant ; le client la compare à la dernière version vue pour savoir s'il montre la fenêtre. Publier une
// version, c'est monter ce numéro ET ajouter sa note dans apps/client/src/updates/releases.ts (un test vérifie que les deux vont ensemble).
export const CURRENT_RELEASE = '1.01';

// La forme d'un numéro : un majeur sans zéro inutile (1, 2, 10…), un point, deux chiffres.
const RELEASE_PATTERN = /^(0|[1-9]\d*)\.(\d{2})$/;

// Ce texte est-il un numéro de version bien formé ? Ce que le compte a enregistré passe par ici : une valeur abîmée vaut « aucune version vue ».
export function isReleaseVersion(value: unknown): value is string {
  return typeof value === 'string' && RELEASE_PATTERN.test(value);
}

// Compare deux numéros bien formés comme des nombres : le majeur d'abord, puis le mineur (« 1.10 » vient après « 1.09 », et « 10.00 » après « 9.99 »,
// ce que l'ordre des textes ne donnerait pas toujours). Négatif si `a` est plus ancien, positif s'il est plus récent, 0 s'ils sont égaux. Lève pour
// un numéro mal formé : c'est une erreur du code, pas une donnée à corriger.
export function compareReleases(a: string, b: string): number {
  const [aMajor, aMinor] = partsOf(a);
  const [bMajor, bMinor] = partsOf(b);
  return aMajor !== bMajor ? aMajor - bMajor : aMinor - bMinor;
}

// La personne a-t-elle encore des nouveautés à voir ? Oui si elle n'a jamais vu de version (null, ou une valeur abîmée), ou une plus ancienne que
// `current`. Une version vue plus récente que celle du serveur (un retour en arrière après une mise en ligne) ne montre rien.
export function isReleaseBehind(seen: string | null | undefined, current: string = CURRENT_RELEASE): boolean {
  return !isReleaseVersion(seen) || compareReleases(seen, current) < 0;
}

function partsOf(version: string): [number, number] {
  const match = RELEASE_PATTERN.exec(version);
  if (!match) throw new Error(`Numéro de version mal formé : « ${version} » (attendu : MAJEUR.MINEUR, comme 1.00).`);
  return [Number(match[1]), Number(match[2])];
}
