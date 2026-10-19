// Exécute l'une après l'autre les tâches d'une même clé ; celles de clés différentes restent simultanées.
// Le serveur tourne en une seule instance : cette file suffit à rendre atomique un « vérifier puis agir » (accepter un jeton,
// inviter une adresse, retirer un membre) que la base ne protège pas par une contrainte.
export function oneAtATimePerKey() {
  const queues = new Map<string, Promise<void>>();
  return async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const result = (queues.get(key) ?? Promise.resolve()).then(task);
    const queue = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, queue);
    try {
      return await result;
    } finally {
      if (queues.get(key) === queue) queues.delete(key);
    }
  };
}
