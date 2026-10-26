import { OFFICE_ROOM, type ActivityState } from '@bureau/shared';
import type { Logger } from 'pino';
import type { DeskController } from '../desks/desk-controller';
import { logServerError } from '../logger';
import type { ModeTravel } from '../modes/mode-travel';
import type { TypedServer } from '../realtime/io';
import type { World } from '../realtime/world';
import type { ActivityService } from './activity-service';

export interface ActivityControllerDeps {
  io: TypedServer;
  world: World;
  activities: Pick<ActivityService, 'get'>;
  /** Un état d'activité qui ne laisse pas entrer ferme la porte du bureau de son propriétaire (DeskController.refreshOwner). */
  desks: Pick<DeskController, 'refreshOwner'>;
  /** Un mode qui a un emplacement conduit à ce lieu, et en sortir ramène au bureau (createModeTravel). */
  travel: Pick<ModeTravel, 'change'>;
  logger: Logger;
}

// Ce que le serveur fait des états d'activité d'une personne présente : elle en prend un (`state:set`) ou revient à un statut ordinaire,
// et tout le bureau le voit (`activity:changed`) ; ce qu'il change se traduit ailleurs (la porte de son bureau, ses groupes de
// conversation et son micro lisent l'état du monde), et un mode qui a un emplacement la conduit à ce lieu, ou l'en ramène (ModeTravel).
// Les modes par défaut (Manger, Sport, Concentration) sont en base comme les autres (DEFAULT_MODES, donnés à la création du compte). Rien ici ne lève.
export function createActivityController(d: ActivityControllerDeps) {
  function announce(userId: string, activity: ActivityState | null): void {
    d.io.to(OFFICE_ROOM).emit('activity:changed', { id: userId, activity });
    d.desks.refreshOwner(userId);
    // Un état où l'on n'est pas entendu (`heard` faux) retire le micro : la bulle de parole s'éteint chez tout le monde.
    if (activity?.heard === false && d.world.setSpeaking(userId, false)) d.io.to(OFFICE_ROOM).emit('speaking:changed', { id: userId, speaking: false });
  }

  return {
    // Prendre cet état (un identifiant d'elle), ou null : plus d'état d'activité. Un identifiant qu'elle n'a pas (étranger, supprimé, ou qui n'est pas un uuid) est ignoré.
    // `treadmill` : le prendre sur son tapis de course, s'il conduit à la salle de sport (ModeTravel).
    async choose(userId: string, activityId: string | null, options: { treadmill?: boolean } = {}): Promise<void> {
      try {
        if (activityId === null) return this.clear(userId);
        const state = await d.activities.get(userId, activityId);
        // Elle a quitté le monde, ou l'état a disparu, pendant la lecture.
        if (!state || !d.world.get(userId)) return;
        const previous = d.world.get(userId)?.activity ?? null;
        d.world.setActivity(userId, state);
        announce(userId, state);
        d.travel.change(userId, previous, state, options);
      } catch (err) {
        logServerError(d.logger, { err, userId }, 'Changement d\'état d\'activité impossible');
      }
    },

    // Revenir à un statut ordinaire : seulement s'il y avait un état d'activité.
    clear(userId: string): void {
      const previous = d.world.get(userId)?.activity;
      if (!previous) return;
      d.world.setActivity(userId, null);
      announce(userId, null);
      d.travel.change(userId, previous, null);
    },

    // L'état `id` de cette personne a été modifié ou supprimé (REST) : celui qu'elle porte suit, et le bureau le voit. Modifié, il ne la déplace pas (elle y est déjà) ; supprimé,
    // elle en sort, et revient au bureau s'il l'avait conduite quelque part.
    edited({ userId, id, state }: { userId: string; id: string; state: ActivityState | null }): void {
      const previous = d.world.get(userId)?.activity ?? null;
      const changed = d.world.editActivity(userId, id, state);
      if (!changed || !d.world.get(userId)) return;
      announce(userId, changed.activity);
      if (state === null) d.travel.change(userId, previous, null);
    },
  };
}

export type ActivityController = ReturnType<typeof createActivityController>;
