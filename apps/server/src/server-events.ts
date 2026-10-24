import type { ActivityState, MyProgress, TaskView } from '@bureau/shared';

// Ce que les routes REST disent au temps réel (la tâche 13 s'y abonne) : un membre vient d'être retiré, un profil a changé, les
// sessions d'un compte viennent d'être fermées (son mot de passe réinitialisé).
export interface ServerEventMap {
  'member:removed': [userId: string];
  'profile:changed': [profile: { id: string; name: string; avatarKey: string | null }];
  'sessions:revoked': [userId: string];
  // Un de ses états d'activité a été remplacé (`state`) ou supprimé (null) : si c'est celui qu'elle a pris, le bureau le voit changer.
  'activity:edited': [change: { userId: string; id: string; state: ActivityState | null }];
  // Sa progression a changé (une tâche cochée, un achat…) : `progress` est son état du moment, avec le gain qui l'y amène s'il y en a un. Le temps réel le lui dit,
  // et dit son niveau à tout le bureau s'il a changé.
  'progress:changed': [change: { userId: string; progress: MyProgress }];
  // Une tâche a changé d'état (faite, rendue, retirée) : `notify` dit à qui le dire (celle qui l'a confiée, ou celle qui l'avait reçue).
  'task:changed': [change: { task: TaskView; notify: string[] }];
}

export interface ServerEvents {
  /** Renvoie la fonction qui désabonne cet écouteur. */
  on<E extends keyof ServerEventMap>(event: E, listener: (...args: ServerEventMap[E]) => void): () => void;
  /** Synchrone : les écouteurs sont appelés dans l'ordre de leur abonnement, avant le retour. Ne lève jamais. */
  emit<E extends keyof ServerEventMap>(event: E, ...args: ServerEventMap[E]): void;
}

// L'émetteur est un point d'appel de routes HTTP : l'erreur d'un écouteur (levée, ou promesse rejetée) ne doit ni faire échouer
// une requête dont la base est déjà à jour, ni empêcher les écouteurs suivants de s'exécuter (retirer un membre doit couper
// toutes ses connexions). Elle est donc remise à `onError` (par défaut, la sortie d'erreur).
export function createServerEvents(o: { onError?: (err: unknown) => void } = {}): ServerEvents {
  const onError = o.onError ?? ((err: unknown) => console.error('Un écouteur d\'événement a échoué :', err));
  const listeners: { [E in keyof ServerEventMap]: Set<(...args: ServerEventMap[E]) => void> } = {
    'member:removed': new Set(),
    'profile:changed': new Set(),
    'sessions:revoked': new Set(),
    'activity:edited': new Set(),
    'progress:changed': new Set(),
    'task:changed': new Set(),
  };

  return {
    on(event, listener) {
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },
    emit(event, ...args) {
      // Une copie : un écouteur peut se désabonner (ou en abonner un autre) pendant l'émission.
      for (const listener of [...listeners[event]]) {
        try {
          const result: unknown = listener(...args);
          if (result instanceof Promise) result.catch(onError);
        } catch (err) {
          onError(err);
        }
      }
    },
  };
}
