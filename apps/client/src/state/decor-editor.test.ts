import { DEFAULT_DESK_DECOR, type DeskInfo } from '@bureau/shared';
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
    s.placeHeld({ x: 4, y: 3 });   // sur le premier
    expect(store.getState().decorEditor!.error).toBe('overlap');
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
});
