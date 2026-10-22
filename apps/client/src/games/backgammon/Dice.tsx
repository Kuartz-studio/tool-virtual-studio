import type { BackgammonEvent } from '@bureau/shared/games/backgammon';
import { useEffect, useState } from 'react';
import { DIE_ART, DIE_PALETTE, pipsOf } from './sprites';

// Les dés : deux dés à points dessinés en code (pixel art, des rectangles de pixels d'art), dans la moitié du tablier de qui joue. Ils roulent environ 600 ms (des faces tirées
// au hasard par le client, rien de plus qu'un décor : les valeurs sont celles du serveur) puis se posent ; en mouvement réduit, les valeurs tout de suite.

// La durée d'un lancer à l'écran, et le temps entre deux faces qui défilent.
export const ROLL_MS = 600;
const FACE_TICK_MS = 90;
// Le jeu entre les deux dés, en pixels d'art (un pixel d'art vaut `artPixel` pixels), et la place du « ×2 ».
const DIE_GAP_ART = 3;

// Vrai pendant les ~600 ms qui suivent un lancer (un événement `dice`, ou l'ouverture, qui est un lancer) ; jamais en mouvement réduit. Le serveur a déjà tiré : les dés
// affichés par le plateau ne sont montrés qu'à la fin du roulement.
export function useRolling(events: BackgammonEvent[], reducedMotion: boolean): boolean {
  const [seen, setSeen] = useState<BackgammonEvent[] | null>(null);
  const [rolling, setRolling] = useState(false);
  // Un lot d'événements neuf qui contient un lancer : on commence à rouler dès ce rendu (pas un rendu plus tard : les dés vrais ne doivent jamais paraître un instant).
  if (events.length > 0 && events !== seen) {
    setSeen(events);
    if (!reducedMotion && events.some((event) => event.type === 'dice' || event.type === 'opening')) setRolling(true);
  }
  // Un saut d'état (aucun événement) coupe un roulement en cours : le plateau passe tout de suite au nouvel état.
  if (events.length === 0 && seen !== null) setSeen(null);
  if (events.length === 0 && rolling) setRolling(false);
  if (reducedMotion && rolling) setRolling(false);

  useEffect(() => {
    if (!rolling) return;
    const timer = setTimeout(() => setRolling(false), ROLL_MS);
    return () => clearTimeout(timer);
  }, [rolling]);

  return rolling;
}

const faceAtRandom = (): number => 1 + Math.floor(Math.random() * 6);

// Un dé : le carré de ses pixels d'art sans ses quatre coins, son liseré, son ombre en bas et à droite, et ses points.
function Die({ value, x, y, art, used }: { value: number; x: number; y: number; art: number; used: boolean }) {
  const px = (n: number): number => n * art;
  const size = DIE_ART;
  return (
    <g className="game-backgammon-die" data-value={value} data-used={used || undefined} transform={`translate(${x} ${y})`}>
      <rect x={px(1)} y={0} width={px(size - 2)} height={px(size)} fill={DIE_PALETTE.edge} />
      <rect x={0} y={px(1)} width={px(size)} height={px(size - 2)} fill={DIE_PALETTE.edge} />
      <rect x={px(2)} y={px(1)} width={px(size - 4)} height={px(size - 2)} fill={DIE_PALETTE.body} />
      <rect x={px(1)} y={px(2)} width={px(size - 2)} height={px(size - 4)} fill={DIE_PALETTE.body} />
      <rect x={px(2)} y={px(size - 2)} width={px(size - 4)} height={px(1)} fill={DIE_PALETTE.shade} />
      <rect x={px(size - 2)} y={px(2)} width={px(1)} height={px(size - 4)} fill={DIE_PALETTE.shade} />
      {pipsOf(value).map(([column, row]) => (
        <rect key={`${column}${row}`} x={px(3 + 3 * column)} y={px(3 + 3 * row)} width={px(2)} height={px(2)} fill={DIE_PALETTE.pip} />
      ))}
    </g>
  );
}

export interface DiceProps {
  values: readonly [number, number];
  // Le centre de la paire, en pixels du tablier.
  x: number;
  y: number;
  artPixel: number;
  // Quel dé est joué (il s'estompe).
  used: readonly [boolean, boolean];
  rolling: boolean;
  side: 'mine' | 'theirs';
}

export function Dice({ values, x, y, artPixel, used, rolling, side }: DiceProps) {
  const [faces, setFaces] = useState<[number, number]>(() => [faceAtRandom(), faceAtRandom()]);
  useEffect(() => {
    if (!rolling) return;
    const timer = setInterval(() => setFaces([faceAtRandom(), faceAtRandom()]), FACE_TICK_MS);
    return () => clearInterval(timer);
  }, [rolling]);

  const dieSize = DIE_ART * artPixel;
  const gap = DIE_GAP_ART * artPixel;
  const left = x - dieSize - gap / 2;
  const top = y - dieSize / 2;
  const doublet = values[0] === values[1];
  const shown = rolling ? faces : values;
  return (
    <g className="game-backgammon-dice" data-rolling={rolling} data-side={side} data-values={values.join(',')} data-used={used.map(Number).join(',')} data-doublet={doublet || undefined}>
      <Die value={shown[0]} x={left} y={top} art={artPixel} used={!rolling && used[0]} />
      <Die value={shown[1]} x={left + dieSize + gap} y={top} art={artPixel} used={!rolling && used[1]} />
      {doublet && !rolling && (
        <text className="game-backgammon-times" x={left + 2 * dieSize + gap + 4} y={y} dominantBaseline="central">
          ×2
        </text>
      )}
    </g>
  );
}
