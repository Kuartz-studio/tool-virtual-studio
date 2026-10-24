// Généré par `pnpm --filter @bureau/client gen:assets` (apps/client/scripts/assets/tileset.ts) : ne pas modifier à la main.

// Le jeu de tuiles de la carte : public/assets/tiles/office.png (16 colonnes de cases de 32 px), cité par la carte.
export const TILESET = { name: 'office', image: '../tiles/office.png', columns: 16, tileCount: 318 } as const;

// Les sols qu'on peut choisir pour une pièce (et ceux de la carte) : le numéro de leur tuile dans le jeu de tuiles.
export const FLOOR_THEMES = [
  { id: "sable", label: "Sable", gid: 1 },
  { id: "creme", label: "Crème", gid: 2 },
  { id: "blanc", label: "Carrelage blanc", gid: 3 },
  { id: "marbre", label: "Marbre clair", gid: 4 },
  { id: "gris", label: "Dalles grises", gid: 5 },
  { id: "graphite", label: "Graphite", gid: 6 },
  { id: "beton", label: "Béton", gid: 7 },
  { id: "parquet-clair", label: "Parquet clair", gid: 8 },
  { id: "parquet-brun", label: "Parquet brun", gid: 9 },
  { id: "noyer", label: "Noyer", gid: 10 },
  { id: "parquet-rouge", label: "Parquet rouge", gid: 11 },
  { id: "chevrons", label: "Chevrons", gid: 12 },
  { id: "sauge", label: "Sauge", gid: 13 },
  { id: "menthe", label: "Menthe", gid: 14 },
  { id: "bleu", label: "Bleu", gid: 15 },
  { id: "bleu-clair", label: "Bleu clair", gid: 16 },
  { id: "lilas", label: "Moquette lilas", gid: 17 },
  { id: "rose", label: "Rose poudré", gid: 18 },
  { id: "damier", label: "Damier brun", gid: 19 },
  { id: "turquoise", label: "Turquoise", gid: 20 },
  { id: "pierre", label: "Pierre claire", gid: 21 },
  { id: "losanges", label: "Losanges bleus", gid: 22 },
] as const;

// Les murs : la face (deux cases de haut : `top` puis `bottom`) et le pan vertical (`stem`).
export const WALL_THEMES = [
  { id: "gris-perle", label: "Gris perle", top: 23, bottom: 24, stem: 25 },
  { id: "creme", label: "Crème", top: 26, bottom: 27, stem: 28 },
  { id: "sauge-pale", label: "Sauge pâle", top: 29, bottom: 30, stem: 31 },
  { id: "brique-claire", label: "Brique claire", top: 32, bottom: 33, stem: 34 },
  { id: "sable", label: "Sable", top: 35, bottom: 36, stem: 37 },
  { id: "peche", label: "Pêche", top: 38, bottom: 39, stem: 40 },
  { id: "lin", label: "Lin rayé", top: 41, bottom: 42, stem: 43 },
  { id: "beton", label: "Béton", top: 44, bottom: 45, stem: 46 },
  { id: "anthracite", label: "Anthracite", top: 47, bottom: 48, stem: 49 },
  { id: "brun", label: "Brun", top: 50, bottom: 51, stem: 52 },
  { id: "bois-sombre", label: "Bois sombre", top: 53, bottom: 54, stem: 55 },
  { id: "rose-raye", label: "Rose rayé", top: 56, bottom: 57, stem: 58 },
  { id: "rouge", label: "Rouge", top: 59, bottom: 60, stem: 61 },
  { id: "bleu", label: "Bleu", top: 62, bottom: 63, stem: 64 },
  { id: "violet", label: "Violet", top: 65, bottom: 66, stem: 67 },
  { id: "bleu-ciel", label: "Bleu ciel", top: 68, bottom: 69, stem: 70 },
  { id: "turquoise", label: "Turquoise", top: 71, bottom: 72, stem: 73 },
  { id: "carreaux-bleus", label: "Carreaux bleus", top: 74, bottom: 75, stem: 76 },
  { id: "menthe", label: "Menthe", top: 77, bottom: 78, stem: 79 },
  { id: "vert-gris", label: "Vert-gris", top: 80, bottom: 81, stem: 82 },
] as const;

// Les tuiles de la piscine : le fond d'eau, les bords et les coins.
export const POOL_TILES = { fill: 83, n: 84, s: 85, w: 86, e: 87, nw: 88, ne: 89, sw: 90, se: 91 } as const;

// Les murs de la boutique (apps/client/scripts/assets/shop-walls.ts) : comme les autres, avec leur prix en kuartzons. Il faut les avoir achetés pour les
// poser dans sa pièce.
export const SHOP_WALL_THEMES = [
  { id: "mur-velours", label: "Velours rouge", top: 92, bottom: 93, stem: 94, price: 350 },
  { id: "mur-lambris", label: "Lambris vert", top: 95, bottom: 96, stem: 97, price: 450 },
  { id: "mur-seventies", label: "Rayures seventies", top: 98, bottom: 99, stem: 100, price: 500 },
  { id: "mur-losanges", label: "Losanges menthe", top: 101, bottom: 102, stem: 103, price: 600 },
  { id: "mur-citrouilles", label: "Citrouilles", top: 104, bottom: 105, stem: 106, price: 666 },
  { id: "mur-bibliotheque", label: "Bibliothèque", top: 107, bottom: 108, stem: 109, price: 900 },
  { id: "mur-jungle", label: "Jungle", top: 110, bottom: 111, stem: 112, price: 1800 },
  { id: "mur-neon", label: "Néon", top: 113, bottom: 114, stem: 115, price: 2400 },
  { id: "mur-marbre-or", label: "Marbre noir et or", top: 116, bottom: 117, stem: 118, price: 2800 },
  { id: "mur-art-deco", label: "Art déco", top: 119, bottom: 120, stem: 121, price: 3000 },
  { id: "mur-galaxie", label: "Galaxie", top: 122, bottom: 123, stem: 124, price: 3200 },
  { id: "mur-kuartz", label: "Kuartz", top: 125, bottom: 126, stem: 127, price: 7500 },
] as const;

// Les tuiles qui bougent, celles des murs de la boutique (apps/client/scripts/assets/tile-motion.ts) : pour une tuile de base, ses images (la base d'abord),
// la durée de chacune (ms), et comment le mouvement se décale d'une case à l'autre (decor/tile-animations.ts).
export const TILE_ANIMATIONS: ReadonlyArray<{ gid: number; frames: readonly number[]; durations: readonly number[]; phase: 'x' | 'y' | 'xy' | 'scatter' | 'sync'; step: number }> = [
  { gid: 92, frames: [92, 128, 129, 130, 131, 132, 133, 92], durations: [3600, 80, 80, 80, 80, 80, 80, 80], phase: "x", step: 320 },
  { gid: 93, frames: [93, 134, 135, 136, 137, 138, 139], durations: [3680, 80, 80, 80, 80, 80, 80], phase: "x", step: 320 },
  { gid: 95, frames: [95, 140, 141, 142, 143, 144, 145, 95], durations: [5060, 55, 55, 55, 55, 55, 55, 110], phase: "x", step: 220 },
  { gid: 96, frames: [96, 146, 147, 148, 149, 150, 151], durations: [5170, 55, 55, 55, 55, 55, 55], phase: "x", step: 220 },
  { gid: 98, frames: [98, 152, 153, 154, 155, 156], durations: [4590, 90, 90, 90, 90, 90], phase: "x", step: 360 },
  { gid: 99, frames: [99, 157, 158, 159, 160, 161], durations: [4590, 90, 90, 90, 90, 90], phase: "x", step: 360 },
  { gid: 101, frames: [101, 162, 163, 164, 163, 162, 101, 165, 166, 167, 166, 165, 101], durations: [1100, 85, 85, 85, 85, 85, 2625, 85, 85, 85, 85, 85, 1525], phase: "scatter", step: 0 },
  { gid: 102, frames: [102, 168, 169, 170, 169, 168, 102, 171, 172, 173, 172, 171], durations: [2625, 85, 85, 85, 85, 85, 2625, 85, 85, 85, 85, 85], phase: "scatter", step: 0 },
  { gid: 104, frames: [104, 174, 175, 176, 177, 178, 179, 180], durations: [260, 190, 90, 150, 70, 210, 110, 130], phase: "scatter", step: 0 },
  { gid: 105, frames: [105, 181, 182, 183, 184, 185, 186, 187], durations: [260, 190, 90, 150, 70, 210, 110, 130], phase: "scatter", step: 0 },
  { gid: 107, frames: [107, 188, 189, 190, 189, 188, 107, 191, 192, 193, 192, 191], durations: [1500, 90, 90, 90, 90, 90, 3050, 90, 90, 90, 90, 90], phase: "scatter", step: 0 },
  { gid: 108, frames: [108, 194, 195, 196, 195, 194, 108, 197, 198, 197, 108], durations: [3250, 90, 90, 90, 90, 90, 1390, 90, 90, 90, 90], phase: "scatter", step: 0 },
  { gid: 110, frames: [110, 199, 200, 201, 202, 203, 110], durations: [4000, 80, 80, 80, 80, 80, 80], phase: "x", step: 320 },
  { gid: 111, frames: [111, 204, 205, 206, 207, 208], durations: [4080, 80, 80, 80, 80, 80], phase: "x", step: 320 },
  { gid: 113, frames: [209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224], durations: [70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70], phase: "x", step: 560 },
  { gid: 114, frames: [225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240], durations: [70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70], phase: "x", step: 560 },
  { gid: 115, frames: [241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 256], durations: [70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70], phase: "y", step: 560 },
  { gid: 116, frames: [116, 257, 258, 259, 260, 261, 262, 116], durations: [5500, 55, 55, 55, 55, 55, 55, 110], phase: "x", step: 220 },
  { gid: 117, frames: [117, 263, 264, 265, 266, 267, 268], durations: [5610, 55, 55, 55, 55, 55, 55], phase: "x", step: 220 },
  { gid: 118, frames: [118, 269, 270, 271, 272, 118], durations: [5005, 55, 55, 55, 55, 55], phase: "y", step: 220 },
  { gid: 119, frames: [119, 273, 274, 275, 276, 277, 278, 119], durations: [4620, 55, 55, 55, 55, 55, 55, 110], phase: "x", step: 220 },
  { gid: 120, frames: [120, 279, 280, 281, 282, 283, 284], durations: [4730, 55, 55, 55, 55, 55, 55], phase: "x", step: 220 },
  { gid: 121, frames: [121, 285, 286, 287, 288, 289, 290], durations: [4290, 55, 55, 55, 55, 55, 55], phase: "y", step: 220 },
  { gid: 122, frames: [291, 122, 292, 293, 291, 122, 292, 293, 291, 122, 292, 294, 295, 296], durations: [700, 520, 830, 610, 760, 540, 680, 590, 720, 650, 660, 60, 60, 60], phase: "x", step: 120 },
  { gid: 123, frames: [297, 298, 299, 300, 297, 298, 299, 300, 297, 298, 299, 123], durations: [700, 520, 830, 610, 760, 540, 680, 590, 720, 650, 660, 180], phase: "x", step: 120 },
  { gid: 124, frames: [301, 302, 124, 303], durations: [900, 700, 1100, 800], phase: "scatter", step: 0 },
  { gid: 125, frames: [125, 304, 305, 306, 307, 308, 125], durations: [4920, 60, 60, 60, 60, 60, 60], phase: "x", step: 240 },
  { gid: 126, frames: [126, 309, 310, 311, 312, 313], durations: [4980, 60, 60, 60, 60, 60], phase: "x", step: 240 },
  { gid: 127, frames: [127, 314, 315, 316, 317, 318], durations: [4020, 60, 60, 60, 60, 60], phase: "y", step: 240 },
];
