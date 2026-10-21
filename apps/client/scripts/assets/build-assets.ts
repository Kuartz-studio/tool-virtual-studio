// Range les images du pack LimeZu dans l'appli : `pnpm --filter @bureau/client gen:assets [dossier des ressources]`.
//   public/assets/characters/   les pièces du builder de personnage (corps, yeux, tenues, coiffures, accessoires, personnages prêts)
//   public/assets/decor/        la banque d'éléments, un atlas par catégorie
//   public/assets/tiles/        le jeu de tuiles de la carte (sols et murs des thèmes, piscine)
//   packages/shared/src/        la liste de tout cela (decor/generated*.ts, character/generated.ts), que lisent le client et le serveur
// Les images du pack ne sont pas dans le dépôt (sa licence interdit de les redistribuer) : ce script les lit là où elles sont, et ce
// qu'il écrit est commité. Le dossier se donne en argument, ou par LIMEZU_SRC ; à défaut, celui du dossier Téléchargements.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { buildCharacters, renderCharactersSource } from './characters';
import { Sheets, buildDecor, renderCatalogSource } from './decor';
import { writeImage } from './image';
import { buildTileset, renderThemesSource } from './tileset';

export const ASSETS_DIR = resolve(import.meta.dirname, '../../public/assets');
export const SHARED_SRC = resolve(import.meta.dirname, '../../../../packages/shared/src');

export function defaultSource(): string {
  return process.env.LIMEZU_SRC ?? join(homedir(), 'Downloads', 'VIRTUAL-Desktop_V2_Ressources');
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function generateAssets(source: string, log: (line: string) => void = () => {}): void {
  const characters = buildCharacters(source);
  for (const { path, image } of characters.files) writeImage(join(ASSETS_DIR, 'characters', path), image);
  writeText(join(SHARED_SRC, 'character/generated.ts'), renderCharactersSource(characters.parts));
  log(`personnages : ${characters.files.length} fichiers`);

  const decor = buildDecor(new Sheets(source));
  for (const [category, atlas] of decor.atlases) writeImage(join(ASSETS_DIR, 'decor', `${category}.png`), atlas);
  writeText(join(SHARED_SRC, 'decor/generated.ts'), renderCatalogSource(decor.items));
  log(`banque d'éléments : ${decor.items.length} éléments dans ${decor.atlases.size} atlas`);

  const tileset = buildTileset(source);
  writeImage(join(ASSETS_DIR, 'tiles/office.png'), tileset.image);
  writeText(join(SHARED_SRC, 'decor/generated-themes.ts'), renderThemesSource(tileset));
  log(`tuiles : ${tileset.tileCount} (dont ${tileset.floors.length} sols et ${tileset.walls.length} murs à choisir)`);
}

// `tsx scripts/assets/build-assets.ts` s'exécute directement ; importé par un test, ce module n'écrit rien.
if (/[\\/]build-assets\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  const source = resolve(process.argv[2] ?? defaultSource());
  generateAssets(source, (line) => console.log(line));
  console.log(`Écrit dans ${relative(process.cwd(), ASSETS_DIR)} et ${relative(process.cwd(), SHARED_SRC)}.`);
}
