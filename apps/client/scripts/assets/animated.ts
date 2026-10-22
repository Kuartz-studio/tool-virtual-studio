// Les objets animés du pack : chaque planche est une rangée d'images de même taille, rangées côte à côte (la porte qui s'ouvre, la vapeur de la
// machine à café, le feu de la cheminée). Ce fichier choisit celles dont l'appli a besoin, lit la taille d'une image sur la planche, la recopie
// dans public/assets/props/<clé>.png et écrit la liste (packages/shared/src/props/generated.ts) que lisent le client, le serveur et les tests.
import { join } from 'node:path';
import { TILE_SIZE, type LightKind, type Prop } from '@bureau/shared';
import { Img, readImage } from './image';

// Le dossier des planches animées dans le pack (relatif au dossier des ressources).
export const ANIMATED_DIR = 'moderninteriors-win/3_Animated_objects/32x32/spritesheets';

export interface AnimatedSource {
  key: string;
  // Le fichier de la planche dans ANIMATED_DIR.
  file: string;
  frames: number;
  fps: number;
  loop: boolean;
  // Les rangées du bas qu'il occupe au sol, et s'il arrête l'avatar.
  claim: number;
  solid: boolean;
  light?: LightKind;
}

const sheet = (name: string): string => `animated_${name}_32x32.png`;

// Les objets retenus (planches vérifiées image par image). Le nombre d'images et leur taille sont ceux des planches : propFromSheet refuse celle
// dont la largeur n'est pas un multiple du nombre d'images.
export const ANIMATED_PROPS: readonly AnimatedSource[] = [
  // Porte des bureaux : image 0 fermée, 1 à 3 s'ouvre, 4 ouverte (les battants de chant, presque invisibles), 5 à 7 se referme.
  { key: 'door-glass-double', file: sheet('door_glass_double'), frames: 8, fps: 12, loop: false, claim: 1, solid: false },
  // Machine à café, la vapeur en boucle.
  { key: 'coffee', file: sheet('coffee'), frames: 6, fps: 6, loop: true, claim: 1, solid: true },
  // Cheminée à feu animé, en quatre teintes.
  { key: 'chimney', file: sheet('chimney'), frames: 3, fps: 6, loop: true, claim: 2, solid: true, light: 'fire' },
  { key: 'chimney-red', file: sheet('chimney_red'), frames: 3, fps: 6, loop: true, claim: 2, solid: true, light: 'fire' },
  { key: 'chimney-white', file: sheet('chimney_white'), frames: 3, fps: 6, loop: true, claim: 2, solid: true, light: 'fire' },
  { key: 'chimney-yellow', file: sheet('chimney_yellow'), frames: 3, fps: 6, loop: true, claim: 2, solid: true, light: 'fire' },
  // Enceintes : les cônes pulsent quand la musique joue.
  { key: 'amplifier', file: sheet('amplifier'), frames: 3, fps: 6, loop: true, claim: 1, solid: true, light: 'glow' },
  { key: 'amplifier-big', file: sheet('amplifier_big'), frames: 3, fps: 6, loop: true, claim: 1, solid: true, light: 'glow' },
  // La salle de sport.
  { key: 'treadmill', file: sheet('tapis_roulant'), frames: 12, fps: 12, loop: true, claim: 2, solid: true },
  { key: 'punching-bag-left', file: sheet('punching_bag_left'), frames: 6, fps: 8, loop: true, claim: 1, solid: true },
  { key: 'punching-bag-right', file: sheet('punching_bag_right'), frames: 6, fps: 8, loop: true, claim: 1, solid: true },
  // L'accueil : une personne derrière son poste, un module de comptoir d'une case (côte à côte, deux ou trois font un comptoir) ; deux coiffures. Elle cligne des yeux.
  { key: 'receptionist', file: sheet('receptionist'), frames: 7, fps: 5, loop: true, claim: 1, solid: true },
  { key: 'receptionist-2', file: sheet('receptionist_2'), frames: 7, fps: 5, loop: true, claim: 1, solid: true },
  // L'horloge comtoise de l'accueil : le balancier va et vient (une case de large, trois de haut, haute comme une armoire : elle bloque).
  { key: 'grandfather-clock', file: sheet('pendulum_clock'), frames: 4, fps: 2, loop: true, claim: 1, solid: true },
  // Bougies (au sol et au mur) et aquarium du salon.
  { key: 'candle', file: sheet('candle'), frames: 3, fps: 6, loop: true, claim: 1, solid: false, light: 'candle' },
  { key: 'wall-candle', file: sheet('wall_candle'), frames: 3, fps: 6, loop: true, claim: 0, solid: false, light: 'candle' },
  { key: 'fishtank', file: sheet('fishtank_orange'), frames: 8, fps: 6, loop: true, claim: 1, solid: true, light: 'water' },
];

// Le prop d'une planche de cette taille : la taille d'une image (la largeur de la planche partagée entre ses images), son empreinte en cases.
export function propFromSheet(spec: AnimatedSource, width: number, height: number): Prop {
  if (width % spec.frames !== 0) throw new Error(`« ${spec.key} » : la planche (${width} px de large) ne se partage pas en ${spec.frames} images.`);
  const frameWidth = width / spec.frames;
  if (frameWidth % TILE_SIZE !== 0 || height % TILE_SIZE !== 0) {
    throw new Error(`« ${spec.key} » : une image de ${frameWidth} × ${height} px n'est pas un nombre entier de cases.`);
  }
  const [w, h] = [frameWidth / TILE_SIZE, height / TILE_SIZE];
  if (spec.claim < 0 || spec.claim > h) throw new Error(`« ${spec.key} » : l'empreinte au sol (${spec.claim} rangées) dépasse l'image (${h} cases).`);
  return {
    key: spec.key,
    sheet: `/assets/props/${spec.key}.png`,
    frameWidth,
    frameHeight: height,
    frames: spec.frames,
    fps: spec.fps,
    loop: spec.loop,
    w,
    h,
    claim: spec.claim,
    solid: spec.solid,
    ...(spec.light ? { light: spec.light } : {}),
  };
}

export interface BuiltProps {
  props: Prop[];
  files: Array<{ path: string; image: Img }>;
}

// Les planches lues dans le pack, et ce qu'on en écrit : une image par prop (`<clé>.png`), la liste des props.
export function buildAnimated(source: string, specs: readonly AnimatedSource[] = ANIMATED_PROPS): BuiltProps {
  const keys = new Set<string>();
  const built: BuiltProps = { props: [], files: [] };
  for (const spec of specs) {
    if (keys.has(spec.key)) throw new Error(`Deux objets animés portent la clé « ${spec.key} ».`);
    keys.add(spec.key);
    const image = readImage(join(source, ANIMATED_DIR, spec.file));
    built.props.push(propFromSheet(spec, image.width, image.height));
    built.files.push({ path: `${spec.key}.png`, image });
  }
  return built;
}

// Le fichier TypeScript généré : une ligne par prop, dans l'ordre de ANIMATED_PROPS.
export function renderPropsSource(props: readonly Prop[]): string {
  const lines = props.map((p) => {
    const light = p.light ? `, light: ${JSON.stringify(p.light)}` : '';
    return `  { key: ${JSON.stringify(p.key)}, sheet: ${JSON.stringify(p.sheet)}, frameWidth: ${p.frameWidth}, frameHeight: ${p.frameHeight}, frames: ${p.frames}, fps: ${p.fps}, loop: ${p.loop}, w: ${p.w}, h: ${p.h}, claim: ${p.claim}, solid: ${p.solid}${light} },`;
  });
  return `// Généré par \`pnpm --filter @bureau/client gen:assets\` (apps/client/scripts/assets) : ne pas modifier à la main.
import type { Prop } from './catalog';

export const PROP_LIST: readonly Prop[] = [
${lines.join('\n')}
];
`;
}
