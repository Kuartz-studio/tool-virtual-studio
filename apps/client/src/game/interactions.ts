import { TILE_SIZE } from '@bureau/shared';

// Ce que le jeu sait actionner de près, par la touche E ou d'un clic : l'interrupteur de la lumière, la machine à café, les enceintes et les
// tables de jeu. Un seul gestionnaire décide laquelle répond (la plus proche), pour qu'une touche n'en actionne pas plusieurs. Ce fichier
// ne dépend pas de Phaser : la scène lui donne les pieds de l'avatar, et dessine l'étiquette (objects/InteractionPrompt.ts).

export interface Point {
  x: number;
  y: number;
}

export interface Interactable {
  id: string;
  // Son centre, en pixels : la portée se compte depuis là.
  pos: Point;
  // Jusqu'où on l'actionne, en cases, en ligne droite depuis les pieds de l'avatar (jusqu'à cette distance comprise).
  reachTiles: number;
  // Où se pose son étiquette (le bas, au milieu), en pixels. `pos` par défaut.
  labelAt?: Point;
  // Ce que la touche va faire (« [E] Éteindre ») ; null : rien à faire ici maintenant, la cible est ignorée.
  prompt(): string | null;
  use(): void;
}

export interface InteractionsOptions {
  // Où sont les pieds de l'avatar à cet instant. update, use et useTarget s'en servent quand on ne leur en donne pas : un pas, ou une
  // téléportation, depuis la dernière image comptent alors.
  feet?: () => Point;
}

export class Interactions {
  private readonly targets: Interactable[] = [];
  private readonly listeners = new Set<(current: Interactable | null) => void>();
  private current: Interactable | null = null;

  constructor(private readonly options: InteractionsOptions = {}) {}

  // Ajoute une cible. Rend la fonction qui la retire : elle ne répond plus, et n'est plus la cible courante.
  register(target: Interactable): () => void {
    if (!this.targets.includes(target)) this.targets.push(target);
    return () => {
      const index = this.targets.indexOf(target);
      if (index === -1) return;
      this.targets.splice(index, 1);
      if (this.current === target) this.setCurrent(null);
    };
  }

  // La cible la plus proche à portée, parmi celles qui ont quelque chose à dire ; à égalité, la première enregistrée. À appeler à chaque image.
  // Sans pieds (ni donnés, ni fournis), on ne sait rien de nouveau : la cible reste celle d'avant.
  update(feet?: Point): Interactable | null {
    const where = feet ?? this.options.feet?.();
    if (where === undefined) return this.current;
    let best: Interactable | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const target of this.targets) {
      if (target.prompt() === null) continue;
      const distance = Math.hypot(target.pos.x - where.x, target.pos.y - where.y);
      if (distance > target.reachTiles * TILE_SIZE || distance >= bestDistance) continue;
      best = target;
      bestDistance = distance;
    }
    this.setCurrent(best);
    return best;
  }

  // La touche E : actionne la cible courante, après avoir relu la portée aux pieds du moment s'ils sont connus. Faux sans cible.
  use(feet?: Point): boolean {
    const where = feet ?? this.options.feet?.();
    if (where !== undefined) this.update(where);
    if (this.current === null) return false;
    this.current.use();
    return true;
  }

  // Un clic sur l'objet : lui seul, même si une autre cible est plus proche, et seulement à portée. Faux sans pieds connus.
  useTarget(target: Interactable, feet?: Point): boolean {
    const where = feet ?? this.options.feet?.();
    if (where === undefined || !this.targets.includes(target) || target.prompt() === null) return false;
    if (Math.hypot(target.pos.x - where.x, target.pos.y - where.y) > target.reachTiles * TILE_SIZE) return false;
    target.use();
    return true;
  }

  // Appelé quand la cible courante change (null : plus aucune), pas quand son texte change.
  onChange(listener: (current: Interactable | null) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private setCurrent(next: Interactable | null): void {
    if (next === this.current) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}
