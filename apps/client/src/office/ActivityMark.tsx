import type { ActivityState } from '@bureau/shared';
import { activityIconOf } from './activity-icons';
import { StatusDot } from './StatusDot';

// La marque d'un état d'activité à côté de son nom : son icône, quand il en a une, sinon le point de sa couleur (StatusDot). Dans la puce « Moi »,
// le menu et le panneau des états. Le panneau Personnes garde le point, comme l'étiquette de l'avatar dans le jeu : leur couleur est celle de l'état.
// L'icône est décorative (Lucide la cache aux lecteurs d'écran) : le nom de l'état est écrit à côté.
export function ActivityMark({ activity }: { activity: Pick<ActivityState, 'id' | 'color' | 'icon'> }) {
  const Icon = activityIconOf(activity.icon);
  if (!Icon) return <StatusDot status={null} activity={activity} />;
  return <Icon className="activity-icon" data-activity={activity.id} />;
}
