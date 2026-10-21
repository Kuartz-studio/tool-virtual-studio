// Écrit les cartes de public/assets/maps/ depuis leur définition partagée : `pnpm --filter @bureau/client gen:map`.
//   office.json      buildOfficeTiledMap() : la carte du bureau, celle que le serveur charge par défaut
//   dev-office.json  buildTiledMap(DEV_OFFICE) : la petite carte des tests et du développement
// La carte ne peut pas s'écarter de la définition partagée, et rien n'y dépend du hasard ni de l'horloge : relancer le script sans rien
// changer ne modifie aucun fichier.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { DEV_OFFICE, TILESET, buildOfficeTiledMap, buildTiledMap, type TiledMapJson } from '@bureau/shared';

export const MAPS_DIR = resolve(import.meta.dirname, '../../public/assets/maps');

// Le JSON d'une carte, sauf qu'un calque de tuiles tient sur une ligne par rangée de cases (au lieu d'un nombre par ligne), pour qu'on le
// lise et que ses diffs restent courts.
function renderMapJson(map: TiledMapJson): string {
  const text = JSON.stringify(map, null, 2).replace(/"data": \[([^\]]*)\]/g, (_match, body: string) => {
    const numbers = body.split(',').map((n) => n.trim());
    const rows: string[] = [];
    for (let i = 0; i < numbers.length; i += map.width) rows.push(`        ${numbers.slice(i, i + map.width).join(', ')}`);
    return `"data": [\n${rows.join(',\n')}\n      ]`;
  });
  return `${text}\n`;
}

export function renderOfficeJson(): string {
  return renderMapJson(buildOfficeTiledMap());
}

// L'image du jeu de tuiles, vue depuis le fichier de la carte (maps/dev-office.json) : c'est ainsi que Tiled écrit un chemin.
export function renderDevOfficeJson(): string {
  return renderMapJson(buildTiledMap({ ...DEV_OFFICE, tileset: { name: TILESET.name, image: TILESET.image } }));
}

export function mapFiles(): Array<{ path: string; content: string }> {
  return [
    { path: 'office.json', content: renderOfficeJson() },
    { path: 'dev-office.json', content: renderDevOfficeJson() },
  ];
}

export function generateMaps(dir = MAPS_DIR): string[] {
  return mapFiles().map(({ path, content }) => {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  });
}

if (/[\\/]build-map\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  for (const file of generateMaps()) console.log(`Écrit : ${relative(process.cwd(), file)}`);
}
