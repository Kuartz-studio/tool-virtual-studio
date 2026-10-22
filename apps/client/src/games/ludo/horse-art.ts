// La tête de cheval des petits chevaux, en pixel art de 12 × 12 : dessinée ici en lettres, comme les pochettes des ambiances (office/ambiance-covers.ts), puis rendue en SVG par
// `horsePaths`. Chaque lettre est un pixel ; `.` est le vide. Le cheval regarde vers la droite.
//   o  le contour       b  le corps, de la couleur du joueur   l  le reflet du museau, une teinte plus claire
//   m  la crinière, une teinte plus sombre                      e  l'œil   w  son éclat   n  le naseau
// Les couleurs sont celles de l'illustration (ludo.css, `--ludo-<couleur>`) : le jour comme la nuit. Le contour est fermé, aucun pixel peint ne touche le vide (horse-art.test.ts) :
// posé sur une case de n'importe quelle couleur, le cheval se découpe.
export const HORSE_SIZE = 12;

export const HORSE_ROWS: readonly string[] = [
  '....o.o.....',
  '..oobobo....',
  '.ommmbbboo..',
  'ommmmbbbbbo.',
  '.ommmbwebbbo',
  'ommmmbbbbllo',
  '.ommmbbbblno',
  'ommmmbbbbllo',
  '.ommmbbbbooo',
  'ommmmbbbbo..',
  '.ommmbbbo...',
  '.oooooooo...',
];

// Le nombre de pixels peints.
export const HORSE_PIXELS = HORSE_ROWS.join('').replaceAll('.', '').length;

// Les suites de pixels voisins d'une même lettre sur une ligne : [colonne de départ, longueur].
function runsOf(row: string, key: string): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (let x = 0; x < row.length; x++) {
    if (row[x] !== key) continue;
    const start = x;
    while (row[x + 1] === key) x++;
    runs.push([start, x - start + 1]);
  }
  return runs;
}

// Le cheval en SVG : un chemin par lettre, fait d'un morceau par suite de pixels voisins (« M x y h n v1 h-n z »). Les pixels voisins sont fondus : le dessin pèse bien moins que ses
// 144 carrés, et un plateau de seize chevaux reste léger. Chaque chemin porte sa lettre (`key`) : la feuille de style y met la couleur, selon le joueur.
export function horsePaths(): Array<{ key: string; d: string }> {
  const keys = [...new Set(HORSE_ROWS.join('').replaceAll('.', ''))];
  return keys.map((key) => ({
    key,
    d: HORSE_ROWS.flatMap((row, y) => runsOf(row, key).map(([x, length]) => `M${x} ${y}h${length}v1h-${length}z`)).join(''),
  }));
}
