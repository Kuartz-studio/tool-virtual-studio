import { defineProject } from 'vitest/config';

// Chaque worker qui ouvre une base PGlite en mémoire occupe environ 1 Go de RAM : on limite le serveur à 2 workers.
// Vitest veut un `groupOrder` distinct pour un projet dont `maxWorkers` diffère de celui des autres (les autres
// projets gardent la valeur par défaut) : le serveur passe donc dans son propre groupe, après les autres.
export default defineProject({
  test: {
    maxWorkers: 2,
    sequence: { groupOrder: 1 },
  },
});
