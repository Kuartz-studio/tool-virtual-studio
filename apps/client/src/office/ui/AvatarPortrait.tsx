import { CHARACTER_SHEET, type Status } from '@bureau/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { composeAvatar } from '../../game/avatar-compose';
import { initials } from './initials';

// Le portrait d'une personne : sa tête et ses épaules, tirées de son personnage (celui du jeu, assemblé par composeAvatar). On prend l'image 18
// de la planche : le personnage de face (« down », la quatrième direction), à l'arrêt ; 32 × 32 px de l'image, du haut de la tête aux épaules.
const FRONT_FRAME = CHARACTER_SHEET.directions.indexOf('down') * CHARACTER_SHEET.framesPerDirection;
const SOURCE = { x: FRONT_FRAME * CHARACTER_SHEET.frameWidth, y: 16, size: 32 } as const;

// Les planches déjà assemblées, par clé de personnage : la même personne est dans le menu, la liste, un toast et le lieu, et on ne l'assemble
// qu'une fois. Les 64 dernières servies seulement (le plus ancien part le premier) : une planche pèse, et un bureau n'a pas tant de monde.
const SHEETS_KEPT = 64;
const sheets = new Map<string, Promise<HTMLCanvasElement | null>>();

function sheetOf(key: string): Promise<HTMLCanvasElement | null> {
  const known = sheets.get(key);
  if (known) {
    sheets.delete(key);
    sheets.set(key, known);
    return known;
  }
  // Une planche qui n'est pas venue (image manquante, clé inconnue) ne reste pas : la prochaine demande réessaie.
  const pending = composeAvatar(key).then(
    (sheet) => {
      if (sheet === null) sheets.delete(key);
      return sheet;
    },
    () => {
      sheets.delete(key);
      return null;
    },
  );
  sheets.set(key, pending);
  if (sheets.size > SHEETS_KEPT) sheets.delete(sheets.keys().next().value as string);
  return pending;
}

// Pour les tests : le cache ne passe pas d'un test à l'autre.
export function clearPortraitCache(): void {
  sheets.clear();
}

// Le portrait, sur un carré de `size` px, dessiné sans lissage (le pixel art ne se floute pas). Avant qu'il soit prêt, ou sans personnage
// (`avatarKey` nul : le compte n'en a pas choisi), les initiales du nom. `status` ajoute le point du statut, en bas à droite.
// Il est décoratif : le nom de la personne est écrit à côté.
export function AvatarPortrait({ avatarKey, name = '', size, status }: { avatarKey: string | null; name?: string; size: number; status?: Status | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    setDrawn(false);
    if (avatarKey === null) return;
    let current = true;
    void sheetOf(avatarKey).then((sheet) => {
      const context = canvas.current?.getContext('2d');
      if (!current || !sheet || !context) return;
      context.clearRect(0, 0, size, size);
      context.imageSmoothingEnabled = false;
      context.drawImage(sheet, SOURCE.x, SOURCE.y, SOURCE.size, SOURCE.size, 0, 0, size, size);
      setDrawn(true);
    });
    return () => {
      current = false;
    };
  }, [avatarKey, size]);

  return (
    <span className="portrait" style={{ '--s': `${size}px` } as CSSProperties} aria-hidden="true">
      <canvas ref={canvas} className="portrait-image" width={size} height={size} hidden={!drawn} />
      {!drawn && <span className="portrait-initials">{initials(name)}</span>}
      {status != null && <span className="portrait-dot" data-status={status} />}
    </span>
  );
}
