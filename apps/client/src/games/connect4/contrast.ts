// Le contraste de deux couleurs (#rrggbb) selon les WCAG : de 1 (deux fois la même) à 21 (noir sur blanc). Un élément d'interface qu'il faut voir (un jeton, un cerclage) en demande 3
// contre ce qui l'entoure [WCAG 1.4.11]. Ne sert qu'aux tests des couleurs du jeu.
function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const rgb = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((rgb >> 16) & 255) + 0.7152 * channel((rgb >> 8) & 255) + 0.0722 * channel(rgb & 255);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
