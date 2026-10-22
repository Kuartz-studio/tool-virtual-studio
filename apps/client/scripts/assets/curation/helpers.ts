import type { DecorCategoryId } from '@bureau/shared';
import type { Entry, EntryOptions } from './types';

// De quoi écrire une curation : un objet se désigne par la case de son coin haut-gauche (`at`) quand la découpe automatique l'isole bien, par un
// rectangle (x, y, largeur, hauteur) quand elle en a fusionné plusieurs.
export type Pick = readonly [number, number];
export type Rect = readonly [number, number, number, number];

export const on =
  (sheet: string, cat: DecorCategoryId) =>
  (name: string, where: Pick | Rect, options: EntryOptions = {}): Entry =>
    where.length === 2 ? { sheet, cat, name, at: where as Pick, ...options } : { sheet, cat, name, rect: where as Rect, ...options };

// Plusieurs objets de même sorte : « Nom 1 », « Nom 2 »… (le nom seul quand il n'y en a qu'un).
export const named = (base: string, wheres: ReadonlyArray<Pick | Rect>, make: ReturnType<typeof on>, options: EntryOptions = {}): Entry[] =>
  wheres.map((where, index) => make(wheres.length === 1 ? base : `${base} ${index + 1}`, where, options));
