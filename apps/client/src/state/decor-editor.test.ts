import { DEFAULT_DESK_DECOR, DESK_ROOMS, buildOfficeTiledMap, buildTiledMap, parseOfficeMap, type DeskInfo } from '@bureau/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { createOfficeStore } from './office-store';

const desk: DeskInfo = {
  key: 'A2',
  ownerId: 'moi',
  ownerName: 'Léa',
  name: null,
  locked: false,
  closedByState: false,
  floor: 'sable',
  wall: 'creme',
  items: [],
};

let store: ReturnType<typeof createOfficeStore>;
beforeEach(() => {
  store = createOfficeStore();
});

describe('l\'éditeur de déco du magasin', () => {
  test('ouvert sur un bureau : le brouillon est le réglage du serveur, rien en main, aucun refus', () => {
    store.getState().openDecorEditor(desk);
    expect(store.getState().decorEditor).toEqual({
      deskKey: 'A2',
      saved: { floor: 'sable', wall: 'creme', items: [] },
      draft: { floor: 'sable', wall: 'creme', items: [] },
      held: null,
      error: null,
      tool: 'place',
      replace: null,
    });
    store.getState().closeDecorEditor();
    expect(store.getState().decorEditor).toBeNull();
  });

  test('sans éditeur ouvert, les gestes ne changent rien', () => {
    const before = store.getState();
    store.getState().holdDecorItem('of-7-28');
    store.getState().placeHeld({ x: 3, y: 3 });
    store.getState().patchDecorTheme({ floor: 'noyer' });
    expect(store.getState().decorEditor).toBeNull();
    expect(store.getState().desks).toBe(before.desks);
  });

  test('on tient un élément, on le pose : il entre dans le brouillon (pas dans ce que le serveur a) et reste en main pour en poser un autre', () => {
    const s = store.getState();
    s.openDecorEditor(desk);
    s.holdDecorItem('of-7-28');
    s.placeHeld({ x: 4, y: 3 });
    const editor = store.getState().decorEditor!;
    expect(editor.draft.items).toEqual([{ id: 'of-7-28', x: 3, y: 2 }]);
    expect(editor.saved.items).toEqual([]);
    expect(editor.held).toBe('of-7-28');
  });

  test('un geste refusé laisse le brouillon tel quel et dit pourquoi ; le geste suivant efface le refus', () => {
    const s = store.getState();
    s.openDecorEditor(desk);
    s.holdDecorItem('of-7-28');
    s.placeHeld({ x: 4, y: 3 });
    s.placeHeld({ x: DESK_ROOMS.standard.door.x, y: DESK_ROOMS.standard.height - 1 });   // devant la porte : elle serait murée
    expect(store.getState().decorEditor!.error).toBe('blocks_door');
    expect(store.getState().decorEditor!.draft.items).toHaveLength(1);
    s.placeHeld({ x: 7, y: 1 });
    expect(store.getState().decorEditor!.error).toBeNull();
    expect(store.getState().decorEditor!.draft.items).toHaveLength(2);
  });

  test('reprendre un élément posé le met en main ; le jeter le retire', () => {
    const s = store.getState();
    s.openDecorEditor({ ...desk, items: [{ id: 'of-7-28', x: 3, y: 2 }, { id: 'of-6-10', x: 0, y: 0 }] });
    s.pickDecorItem(0);
    expect(store.getState().decorEditor).toMatchObject({ held: 'of-7-28', draft: { items: [{ id: 'of-6-10', x: 0, y: 0 }] } });
    s.removeDecorItem(0);
    expect(store.getState().decorEditor!.draft.items).toEqual([]);
    s.pickDecorItem(5);   // pas d'élément n° 5
    expect(store.getState().decorEditor!.draft.items).toEqual([]);
  });

  test('les thèmes se règlent sans toucher aux éléments ; remplacer le brouillon lâche ce qu\'on tient', () => {
    const s = store.getState();
    s.openDecorEditor(desk);
    s.holdDecorItem('of-7-28');
    s.patchDecorTheme({ wall: 'rouge' });
    expect(store.getState().decorEditor!.draft).toMatchObject({ floor: 'sable', wall: 'rouge' });
    s.setDecorDraft(DEFAULT_DESK_DECOR);
    expect(store.getState().decorEditor).toMatchObject({ held: null, draft: DEFAULT_DESK_DECOR });
  });

  test('enregistré : le brouillon devient ce que le serveur a', () => {
    const s = store.getState();
    s.openDecorEditor(desk);
    s.patchDecorTheme({ floor: 'noyer' });
    s.markDecorSaved();
    expect(store.getState().decorEditor!.saved.floor).toBe('noyer');
  });

  test('reset ferme l\'éditeur', () => {
    store.getState().openDecorEditor(desk);
    store.getState().reset();
    expect(store.getState().decorEditor).toBeNull();
  });

  test('la gomme : on change d\'outil, la main se vide ; prendre un élément reprend la pose ; la gomme ne pose rien', () => {
    const s = store.getState();
    s.openDecorEditor(desk);
    s.holdDecorItem('of-7-28');
    s.setDecorTool('erase');
    expect(store.getState().decorEditor).toMatchObject({ tool: 'erase', held: null });
    s.placeHeld({ x: 4, y: 3 });
    expect(store.getState().decorEditor!.draft.items).toEqual([]);
    s.holdDecorItem('of-7-28');
    expect(store.getState().decorEditor).toMatchObject({ tool: 'place', held: 'of-7-28' });
  });

  test('lâcher ce qu\'on tient ne quitte pas la gomme', () => {
    const s = store.getState();
    s.openDecorEditor(desk);
    s.setDecorTool('erase');
    s.holdDecorItem(null);
    expect(store.getState().decorEditor!.tool).toBe('erase');
  });

  test('poser sur un élément de la même sorte : rien ne change tant que la personne n\'a pas confirmé', () => {
    const s = store.getState();
    s.openDecorEditor({ ...desk, items: [{ id: 'of-7-28', x: 3, y: 2 }] });
    s.holdDecorItem('of-6-10');   // une plante, un autre meuble : même sorte (objet)
    s.placeHeld({ x: 4, y: 3 });
    const editor = store.getState().decorEditor!;
    expect(editor.draft.items).toEqual([{ id: 'of-7-28', x: 3, y: 2 }]);
    expect(editor.error).toBeNull();
    expect(editor.replace).toEqual({ id: 'of-6-10', at: { x: 4, y: 3 }, replacing: [0] });
  });

  test('confirmer : l\'ancien élément part, le nouveau est posé, et on garde le nouveau en main', () => {
    const s = store.getState();
    s.openDecorEditor({ ...desk, items: [{ id: 'of-7-28', x: 3, y: 2 }, { id: 'of-14-12', x: 4, y: 2 }] });
    s.holdDecorItem('of-6-10');
    s.placeHeld({ x: 4, y: 3 });
    s.confirmReplace();
    const editor = store.getState().decorEditor!;
    expect(editor.replace).toBeNull();
    // Le bureau est parti, l'objet posé dessus (une autre sorte) est resté, la plante est là.
    expect(editor.draft.items).toEqual([{ id: 'of-14-12', x: 4, y: 2 }, { id: 'of-6-10', x: 4, y: 3 }]);
    expect(editor.held).toBe('of-6-10');
    expect(editor.draft).not.toBe(editor.saved);
  });

  test('renoncer : le brouillon reste tel quel', () => {
    const s = store.getState();
    s.openDecorEditor({ ...desk, items: [{ id: 'of-7-28', x: 3, y: 2 }] });
    s.holdDecorItem('of-6-10');
    s.placeHeld({ x: 4, y: 3 });
    s.cancelReplace();
    expect(store.getState().decorEditor).toMatchObject({ replace: null, held: 'of-6-10', draft: { items: [{ id: 'of-7-28', x: 3, y: 2 }] } });
  });

  test('tant que la confirmation attend, un autre clic dans la pièce ne pose rien', () => {
    const s = store.getState();
    s.openDecorEditor({ ...desk, items: [{ id: 'of-7-28', x: 3, y: 2 }] });
    s.holdDecorItem('of-6-10');
    s.placeHeld({ x: 4, y: 3 });
    s.placeHeld({ x: 0, y: 0 });
    expect(store.getState().decorEditor!.draft.items).toHaveLength(1);
    expect(store.getState().decorEditor!.replace).toMatchObject({ at: { x: 4, y: 3 } });
  });

  test('remplacer qui rendrait la pièce invalide : refusé avec la raison, rien n\'est en attente', () => {
    const s = store.getState();
    // Un bureau devant la porte, de la même sorte qu\'un autre meuble, ne peut pas non plus le remplacer s\'il mure la porte.
    s.openDecorEditor({ ...desk, items: [{ id: 'of-6-10', x: DESK_ROOMS.standard.door.x, y: DESK_ROOMS.standard.height - 1 }] });
    s.holdDecorItem('of-7-28');
    s.placeHeld({ x: DESK_ROOMS.standard.door.x, y: DESK_ROOMS.standard.height - 1 });
    expect(store.getState().decorEditor).toMatchObject({ error: 'blocks_door', replace: null });
  });

  test('jeter, reprendre ou changer de brouillon efface une confirmation en attente (les rangs ne valent plus)', () => {
    const s = store.getState();
    s.openDecorEditor({ ...desk, items: [{ id: 'of-7-28', x: 3, y: 2 }] });
    s.holdDecorItem('of-6-10');
    s.placeHeld({ x: 4, y: 3 });
    s.removeDecorItem(0);
    expect(store.getState().decorEditor!.replace).toBeNull();
    s.openDecorEditor({ ...desk, items: [{ id: 'of-7-28', x: 3, y: 2 }] });
    s.holdDecorItem('of-6-10');
    s.placeHeld({ x: 4, y: 3 });
    s.setDecorDraft(DEFAULT_DESK_DECOR);
    expect(store.getState().decorEditor!.replace).toBeNull();
  });

  test('confirmer sans rien en attente ne fait rien', () => {
    const s = store.getState();
    s.openDecorEditor(desk);
    const before = store.getState().decorEditor;
    s.confirmReplace();
    s.cancelReplace();
    expect(store.getState().decorEditor).toBe(before);
  });
});

describe('l\'éditeur de déco, dans une pièce de la carte qui n\'est pas la standard', () => {
  // A5 : compacte (6 × 7), porte au sud ; A6 : compacte, porte au nord de la pièce.
  const ROWS = Array.from({ length: 24 }, (_, y) => (y === 0 || y === 23 ? '#'.repeat(30) : `#${'.'.repeat(28)}#`));
  const map = parseOfficeMap(
    buildTiledMap({
      ascii: ROWS,
      zones: [
        { type: 'desk', name: 'A5', x: 12, y: 2, w: 6, h: 7 },
        { type: 'door', name: 'A5', x: 14, y: 9, w: 2, h: 2 },
        { type: 'desk', name: 'A6', x: 12, y: 15, w: 6, h: 7 },
        { type: 'door', name: 'A6', x: 14, y: 13, w: 2, h: 2 },
        { type: 'spawn', x: 25, y: 12, w: 1, h: 1 },
      ],
      tileset: { name: 'dev', image: 'tiles.png' },
    }),
  );

  test('un élément se pose dans les limites de la pièce compacte, pas de la standard', () => {
    const s = store.getState();
    s.setOfficeMap(map);
    s.openDecorEditor({ ...desk, key: 'A5' });
    s.holdDecorItem('of-7-28');
    s.placeHeld({ x: 5, y: 3 });
    // Le bureau (3 de large) est ramené contre le mur est de la pièce de 6 cases : colonne 3, pas la colonne 4 qu'une pièce de 9 accepterait.
    expect(store.getState().decorEditor!.draft.items).toEqual([{ id: 'of-7-28', x: 3, y: 2 }]);
  });

  test('un geste qui mure la porte de la pièce compacte est refusé avec la raison', () => {
    const s = store.getState();
    s.setOfficeMap(map);
    s.openDecorEditor({ ...desk, key: 'A5' });
    s.holdDecorItem('of-7-28');
    // Au-delà de la dernière colonne (la sixième) : le pointeur est hors de la pièce, l'ancre ramène le bureau dedans, mais un bureau sur la porte est refusé.
    s.placeHeld({ x: 2, y: 6 });
    expect(store.getState().decorEditor!.error).toBe('blocks_door');
    expect(store.getState().decorEditor!.draft.items).toEqual([]);
  });

  test('porte au nord : un élément mural au-dessus de la porte est refusé', () => {
    const s = store.getState();
    s.setOfficeMap(map);
    s.openDecorEditor({ ...desk, key: 'A6' });
    s.holdDecorItem('of-15-0');
    s.placeHeld({ x: 2, y: 0 });
    expect(store.getState().decorEditor!.error).toBe('blocks_door');
    expect(store.getState().decorEditor!.draft.items).toEqual([]);
    s.placeHeld({ x: 4, y: 0 });
    expect(store.getState().decorEditor!.error).toBeNull();
    expect(store.getState().decorEditor!.draft.items).toEqual([{ id: 'of-15-0', x: 4, y: 0 }]);
  });
});

describe('l\'éditeur de déco, devant la pièce', () => {
  // La grande carte : la rangée du dehors de A1 est la 9 (en cases de la pièce), sous la bande de son mur sud (rangées 7 et 8) ; sa porte, colonnes 3 et 4.
  const office = parseOfficeMap(buildOfficeTiledMap());

  test('un clic sur la rue sous sa pièce y pose le pot tenu ; un clic sur le mur sud y accroche l\'horloge', () => {
    const s = store.getState();
    s.setOfficeMap(office);
    s.openDecorEditor({ ...desk, key: 'A1' });
    s.holdDecorItem('of-6-10');
    s.placeHeld({ x: 6.5, y: 9.5 });
    s.holdDecorItem('horloge-ronde');
    s.placeHeld({ x: 6.5, y: 7.6 });
    expect(store.getState().decorEditor).toMatchObject({ error: null, draft: { items: [{ id: 'of-6-10', x: 6, y: 9 }, { id: 'horloge-ronde', x: 6, y: 9 }] } });
  });

  test('devant la porte, rien de solide : la fontaine est refusée avec la raison, le pot passe', () => {
    const s = store.getState();
    s.setOfficeMap(office);
    s.openDecorEditor({ ...desk, key: 'A1' });
    s.holdDecorItem('of-12-15');
    s.placeHeld({ x: 3.5, y: 9.5 });
    expect(store.getState().decorEditor).toMatchObject({ error: 'blocks_door', draft: { items: [] } });
    s.holdDecorItem('of-6-10');
    s.placeHeld({ x: 3.5, y: 9.5 });
    expect(store.getState().decorEditor).toMatchObject({ error: null, draft: { items: [{ id: 'of-6-10', x: 3, y: 9 }] } });
  });
});
