import { mkdirSync } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSimAudioFile } from '@bureau/shared';

// Un fichier audio du dossier, tel que le panneau le liste : son nom, et l'adresse où le navigateur le lit.
export interface AudioFile {
  file: string;
  url: string;
  size: number;
}

// L'adresse d'un fichier audio, sous /api pour passer par le proxy de Vite comme le reste.
export const audioUrl = (file: string): string => `/api/sim/audio/${encodeURIComponent(file)}`;

// Les fichiers audio que l'on peut attribuer aux personnes fictives : le contenu d'un dossier (sim-audio/, à la racine du dépôt), où
// l'on dépose ses mp3 à la main ou depuis le panneau « Bac à sable ». Seuls les noms simples avec une extension audio comptent
// (isSimAudioFile) : jamais un chemin, jamais un fichier caché.
export interface AudioLibrary {
  dir: string;
  // Les fichiers audio du dossier, par ordre alphabétique. Un dossier absent ou illisible : [].
  list(): Promise<AudioFile[]>;
  // Ce fichier est-il dans le dossier ? false pour un nom qui n'est pas un nom de fichier audio simple.
  has(file: string): Promise<boolean>;
  // Écrit ce fichier dans le dossier (il remplace le fichier de même nom). Le nom doit être un nom simple (isSimAudioFile).
  save(file: string, bytes: Buffer): Promise<AudioFile>;
}

export function createAudioLibrary(dir: string): AudioLibrary {
  // Le dossier est créé au démarrage : on y dépose ses fichiers sans avoir à le créer soi-même.
  mkdirSync(dir, { recursive: true });
  const describe = async (file: string): Promise<AudioFile> => ({ file, url: audioUrl(file), size: (await stat(join(dir, file))).size });
  return {
    dir,
    async list() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const files = await Promise.all(names.filter(isSimAudioFile).map((file) => describe(file).catch(() => null)));
      return files.filter((f): f is AudioFile => f !== null).sort((a, b) => a.file.localeCompare(b.file, 'fr'));
    },
    async has(file) {
      if (!isSimAudioFile(file)) return false;
      try {
        return (await stat(join(dir, file))).isFile();
      } catch {
        return false;
      }
    },
    async save(file, bytes) {
      if (!isSimAudioFile(file)) throw new Error(`Nom de fichier audio refusé : ${file}`);
      await writeFile(join(dir, file), bytes);
      return describe(file);
    },
  };
}
