import { DECOR_CATEGORIES, decorItemsOf, isDecorId, type DecorItem } from '@bureau/shared';

// La logique du sélecteur d'éléments du panneau Décorer (DecorPicker) : la recherche dans la banque, et les éléments récents.

// Les éléments récents : les derniers qu'on a pris en main, du plus récent au plus ancien, gardés dans le navigateur (localStorage) d'une
// visite à l'autre. C'est un confort de cet appareil : rien n'est envoyé au serveur.
const RECENTS_KEY = 'bureau.decor-recents.v1';
export const MAX_DECOR_RECENTS = 12;

// Les récents enregistrés. Ce qui n'est pas lisible (rien d'enregistré, JSON abîmé, autre chose qu'une liste) donne une liste vide ; un
// élément qui n'est plus dans la banque (le catalogue a changé) et les doublons sont écartés. Le stockage peut lever (navigation privée,
// cookies bloqués) : liste vide.
export function loadDecorRecents(): string[] {
  let stored: unknown;
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (raw === null) return [];
    stored = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];
  const ids = stored.filter((id): id is string => typeof id === 'string' && isDecorId(id));
  return [...new Set(ids)].slice(0, MAX_DECOR_RECENTS);
}

// Met un élément en tête des récents (sans doublon, `MAX_DECOR_RECENTS` au plus), l'enregistre et rend la nouvelle liste. Un stockage refusé
// ou plein n'empêche rien : la liste vaut pour cette visite.
export function rememberDecorItem(id: string): string[] {
  const recents = [id, ...loadDecorRecents().filter((other) => other !== id)].slice(0, MAX_DECOR_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    // stockage indisponible : rien à faire
  }
  return recents;
}

// Un texte ramené à sa forme de recherche : en minuscules et sans accents (« canape » trouve « Canapé »).
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr').trim();
}

// Les éléments de toute la banque dont le nom contient la recherche, dans l'ordre des catégories. Une recherche vide ne trouve rien.
export function searchDecorItems(query: string): DecorItem[] {
  const needle = searchKey(query);
  if (needle === '') return [];
  return DECOR_CATEGORIES.flatMap(({ id }) => decorItemsOf(id)).filter((item) => searchKey(item.name).includes(needle));
}
