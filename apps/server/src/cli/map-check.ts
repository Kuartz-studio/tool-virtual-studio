import { readFileSync } from 'node:fs';
import { MapError, ZONE_TYPES, parseOfficeMap, type OfficeMap, type TiledMapJson } from '@bureau/shared';

const USAGE = [
  'Usage : pnpm --filter @bureau/server map:check <fichier>',
  'Le chemin est relatif au dossier de lancement (apps/server avec pnpm --filter), par exemple ../client/public/assets/maps/dev-office.json',
].join('\n');

// Le résumé d'une carte lisible : sa taille, ses cases bloquantes, ses zones par type et son point d'apparition.
function summary(file: string, map: OfficeMap): string {
  const blocked = map.blocked.reduce((sum, cell) => sum + cell, 0);
  const tile = (px: number) => Math.floor(px / map.tileSize);
  return [
    `Carte valide : ${file}`,
    `  Taille : ${map.widthTiles} × ${map.heightTiles} cases de ${map.tileSize} px`,
    `  Cases bloquantes : ${blocked} sur ${map.blocked.length}`,
    '  Zones :',
    ...ZONE_TYPES.map((type) => `    ${type} : ${map.zones.filter((zone) => zone.type === type).length}`),
    `  Point d'apparition : x = ${map.spawn.x}, y = ${map.spawn.y} (case ${tile(map.spawn.x)}, ${tile(map.spawn.y)})`,
  ].join('\n');
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// La commande `pnpm --filter @bureau/server map:check <fichier>` : lit une carte Tiled exportée en JSON avec le même code que le
// serveur (parseOfficeMap) et dit si elle est utilisable. À lancer avant de commiter une carte dessinée dans Tiled.
// Renvoie le code de sortie : 0 si la carte est lisible, 1 sinon, avec un message en français sur stderr.
export function mapCheckCommand(args: string[]): number {
  if (args.length !== 1) {
    console.error(USAGE);
    return 1;
  }
  const file = args[0]!;

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    console.error((err as NodeJS.ErrnoException).code === 'ENOENT' ? `Fichier introuvable : ${file}` : `Lecture impossible de « ${file} » : ${errorMessage(err)}`);
    return 1;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    console.error(`« ${file} » n'est pas du JSON valide : ${errorMessage(err)}`);
    return 1;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    console.error(`« ${file} » n'est pas une carte Tiled : un objet JSON est attendu.`);
    return 1;
  }

  try {
    console.log(summary(file, parseOfficeMap(json as TiledMapJson)));
    return 0;
  } catch (err) {
    console.error(err instanceof MapError ? `Carte invalide (${err.code}) : ${err.message}` : `Vérification impossible : ${errorMessage(err)}`);
    return 1;
  }
}

// `tsx src/cli/map-check.ts` ou `node dist/cli/map-check.js` s'exécutent directement. On reconnaît ce cas au nom du script lancé :
// importé par un test, ce module ne lance rien.
if (/[\\/]map-check\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  process.exitCode = mapCheckCommand(process.argv.slice(2));
}
