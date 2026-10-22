import type { ActivityIcon } from '@bureau/shared';
import { BookOpen, Check, Code, Coffee, Dumbbell, Gamepad2, Headphones, Moon, Music, PenTool, Phone, Plane, Users, Utensils, Waves, type LucideIcon } from 'lucide-react';

// Les icônes des états d'activité : le nom que le serveur garde et valide (ACTIVITY_ICONS, dans cet ordre : celui de la grille du formulaire)
// vers le composant de Lucide qui la dessine. Elles sont décoratives, comme les autres (le nom de l'état est écrit à côté), et leur taille et
// leur trait viennent du CSS. Ce fichier est le seul à les nommer : icons.tsx a celles des boutons.
export const ACTIVITY_ICON_COMPONENTS = {
  headphones: Headphones,
  users: Users,
  coffee: Coffee,
  utensils: Utensils,
  phone: Phone,
  'pen-tool': PenTool,
  code: Code,
  'book-open': BookOpen,
  moon: Moon,
  plane: Plane,
  dumbbell: Dumbbell,
  music: Music,
  check: Check,
  waves: Waves,
  'gamepad-2': Gamepad2,
} satisfies Record<ActivityIcon, LucideIcon>;

// Le composant de cette icône, ou null : pas de nom (l'état n'a pas d'icône), ou un nom que ce client ne connaît pas (une liste qui a changé
// depuis) : l'état garde alors le point de sa couleur.
export function activityIconOf(name: string | undefined): LucideIcon | null {
  return name !== undefined && Object.hasOwn(ACTIVITY_ICON_COMPONENTS, name) ? ACTIVITY_ICON_COMPONENTS[name as ActivityIcon] : null;
}
