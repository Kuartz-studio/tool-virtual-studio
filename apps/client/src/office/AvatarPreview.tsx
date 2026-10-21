import { CHARACTER_SHEET } from '@bureau/shared';
import { useEffect, useRef, useState } from 'react';
import { composeAvatar, SHEET_HEIGHT, SHEET_WIDTH } from '../game/avatar-compose';
import { fr } from '../i18n/fr';

// Le personnage de cette clé, de face, qui respire (ou qui marche) : l'aperçu du builder. Il assemble la planche comme le jeu (composeAvatar)
// et en dessine une image à la fois, agrandie ×3 sans flou.
const DOWN = CHARACTER_SHEET.directions.indexOf('down');
const SCALE = 3;

export function AvatarPreview({ avatarKey, walking = false }: { avatarKey: string; walking?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null);

  // La planche : refaite à chaque nouvelle clé. Une clé qui n'a pas fini d'arriver n'écrase pas celle d'après.
  useEffect(() => {
    let current = true;
    void composeAvatar(avatarKey).then(
      (assembled) => current && setSheet(assembled),
      () => current && setSheet(null),
    );
    return () => {
      current = false;
    };
  }, [avatarKey]);

  // Les images, en boucle : 6 pour la direction « bas ».
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    if (!target || !context || !sheet) return;
    const { frameWidth, frameHeight, framesPerDirection, idleFrameRate, walkFrameRate } = CHARACTER_SHEET;
    let frame = 0;
    const draw = () => {
      context.clearRect(0, 0, target.width, target.height);
      context.imageSmoothingEnabled = false;
      const sx = (DOWN * framesPerDirection + (frame % framesPerDirection)) * frameWidth;
      const sy = walking ? frameHeight : 0;
      context.drawImage(sheet, sx, sy, frameWidth, frameHeight, 0, 0, frameWidth * SCALE, frameHeight * SCALE);
      frame += 1;
    };
    draw();
    const timer = setInterval(draw, 1000 / (walking ? walkFrameRate : idleFrameRate));
    return () => clearInterval(timer);
  }, [sheet, walking]);

  return (
    <canvas
      ref={canvas}
      className="avatar-preview"
      width={CHARACTER_SHEET.frameWidth * SCALE}
      height={CHARACTER_SHEET.frameHeight * SCALE}
      role="img"
      aria-label={fr.character.preview}
      data-ready={sheet !== null ? 'true' : 'false'}
      data-sheet={`${SHEET_WIDTH}x${SHEET_HEIGHT}`}
    />
  );
}
