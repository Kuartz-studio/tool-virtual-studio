import { DECOR_ITEMS } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { SHEET_PATH, formatPrice, renderSheet } from './boutique-sheet';
import { Img, readImage } from './image';
import { TEXT_ROWS, drawText, textWidth, wrapText } from './pixel-font';

const WHITE = { r: 255, g: 255, b: 255, a: 255 };

// Les pixels écrits d'un texte : leurs rangées (y) distinctes et leur nombre.
function written(text: string, scale = 1): { rows: number[]; count: number } {
  const img = new Img(textWidth(text, scale) + 4, TEXT_ROWS * scale + 4);
  drawText(img, 2, 2, text, WHITE, scale);
  const rows = new Set<number>();
  let count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.alphaAt(x, y) > 0) {
        rows.add(y);
        count++;
      }
    }
  }
  return { rows: [...rows].sort((a, b) => a - b), count };
}

describe('la police à points (pixel-font.ts)', () => {
  test('une lettre accentuée est sa lettre de base plus son accent, au-dessus ; une majuscule monte deux rangées plus haut', () => {
    const base = written('e');
    const acute = written('é');
    expect(acute.count).toBeGreaterThan(base.count);
    expect(Math.min(...acute.rows)).toBeLessThan(Math.min(...base.rows));
    // L'accent d'une majuscule est au-dessus du haut de la majuscule.
    expect(Math.min(...written('É').rows)).toBeLessThan(Math.min(...written('E').rows));
    // La cédille descend sous la ligne de base.
    expect(Math.max(...written('ç').rows)).toBeGreaterThan(Math.max(...written('c').rows));
  });

  test('la largeur d\'un texte suit son échelle, et un texte long se coupe aux espaces pour tenir dans la largeur donnée', () => {
    expect(textWidth('Squelette', 2)).toBe(textWidth('Squelette', 1) * 2);
    const name = 'Squelette de jeune tricératops';
    const lines = wrapText(name, 200, 2);
    expect(lines.join(' ')).toBe(name);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 2)).toBeLessThanOrEqual(200);
    // Un mot plus long que la ligne reste entier.
    expect(wrapText('Anticonstitutionnellement', 40, 2)).toEqual(['Anticonstitutionnellement']);
  });

  test('chaque caractère des noms de la collection est dessiné : la police a ces lettres accentuées, rien ne tombe sur le point d\'interrogation de repli', () => {
    const known = /^[A-Za-zéèêëàâäîïôöùûüçÉÈÊËÀÂÔÎÏÙÛÇ0-9 '()·×,.:;!&+\-/]+$/;
    for (const item of DECOR_ITEMS.filter((i) => i.cat === 'boutique')) expect(item.name, item.name).toMatch(known);
  });
});

describe('l\'aperçu de la collection (boutique-sheet.ts)', () => {
  test('les prix s\'écrivent par groupes de trois chiffres', () => {
    expect([100, 1200, 9000, 15000].map(formatPrice)).toEqual(['100', '1 200', '9 000', '15 000']);
  });

  test('docs/boutique.png est exactement ce que le script produit à partir de la liste et de l\'atlas (sinon relancer gen:boutique)', () => {
    const fresh = renderSheet();
    const saved = readImage(SHEET_PATH);
    expect([saved.width, saved.height]).toEqual([fresh.width, fresh.height]);
    expect(Buffer.compare(Buffer.from(saved.data), Buffer.from(fresh.data))).toBe(0);
  });
});
