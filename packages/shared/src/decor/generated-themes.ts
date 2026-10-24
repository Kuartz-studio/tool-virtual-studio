// Généré par `pnpm --filter @bureau/client gen:assets` (apps/client/scripts/assets/tileset.ts) : ne pas modifier à la main.

// Le jeu de tuiles de la carte : public/assets/tiles/office.png (16 colonnes de cases de 32 px), cité par la carte.
export const TILESET = { name: 'office', image: '../tiles/office.png', columns: 16, tileCount: 127 } as const;

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
