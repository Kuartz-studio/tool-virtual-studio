import { CURRENT_RELEASE, type Role } from '@bureau/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { fakeApi, json } from '../test/fake-api';
import { RELEASES } from './releases';
import { WHATS_NEW_DELAY_MS, WhatsNew, WhatsNewMenuItem } from './WhatsNew';
import { useWhatsNewStore } from './whats-new-store';

afterEach(() => {
  useWhatsNewStore.setState({ history: null });
});

const TITLE = fr.whatsNew.title;
const latest = RELEASES[0]!;

// Le serveur : POST /api/me/release-seen enregistre la version en cours.
function seenRoute() {
  return fakeApi({ 'POST /api/me/release-seen': () => json(200, { lastReleaseSeen: CURRENT_RELEASE }) });
}

function renderWhatsNew({ seen, ready = true, role = 'member' }: { seen: string | null | undefined; ready?: boolean; role?: Role }) {
  return render(
    <>
      <button type="button">Avant</button>
      <WhatsNew role={role} lastReleaseSeen={seen} ready={ready} />
    </>,
  );
}

// Le délai d'après l'entrée, écoulé : la fenêtre se serait ouverte si elle devait l'être.
const afterDelay = () => act(() => new Promise((resolve) => setTimeout(resolve, WHATS_NEW_DELAY_MS + 50)));

describe('la fenêtre « Quoi de neuf ? » à l\'entrée', () => {
  test('un compte en retard la voit une fois le bureau en place (pas avant), avec les nouveautés de la version en cours', async () => {
    seenRoute();
    const view = renderWhatsNew({ seen: null, ready: false });
    await afterDelay();
    expect(screen.queryByRole('dialog')).toBeNull();

    view.rerender(
      <>
        <button type="button">Avant</button>
        <WhatsNew role="member" lastReleaseSeen={null} ready />
      </>,
    );
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby') && document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe(latest.tagline);
    expect(dialog.textContent).toContain(`Version ${latest.version}, du 29 octobre 2026`);
    // Rangées par genre : une liste nommée par le titre de son groupe, dans l'ordre Nouveautés, Améliorations, Corrections ; plus de « Et aussi ».
    const groups = within(dialog).getAllByRole('list').map((list) => list.getAttribute('aria-labelledby') && document.getElementById(list.getAttribute('aria-labelledby')!)?.textContent);
    expect(groups).toEqual([fr.whatsNew.groups.new, fr.whatsNew.groups.improved, fr.whatsNew.groups.fixed]);
    const news = within(dialog).getByRole('list', { name: fr.whatsNew.groups.new });
    expect(within(news).getAllByRole('listitem')[0]?.textContent).toContain('Plein écran en réunion');
    expect(within(dialog).getByRole('list', { name: fr.whatsNew.groups.fixed }).textContent).toContain('La pastille de ton portrait');
    expect(dialog.textContent).not.toContain('Et aussi');
    // Une seule version : pas de « Tout l'historique ».
    expect(screen.queryByRole('button', { name: fr.whatsNew.history })).toBeNull();
  });

  test('à jour, ou quand la session ne dit rien, elle ne s\'ouvre pas', async () => {
    const fetch = seenRoute();
    renderWhatsNew({ seen: CURRENT_RELEASE });
    await afterDelay();
    expect(screen.queryByRole('dialog')).toBeNull();
    renderWhatsNew({ seen: undefined });
    await afterDelay();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('« C\'est parti » la ferme, l\'enregistre comme vue, rend le focus, et elle ne revient pas', async () => {
    const fetch = seenRoute();
    const user = userEvent.setup();
    const view = renderWhatsNew({ seen: null, ready: false });
    screen.getByRole('button', { name: 'Avant' }).focus();
    view.rerender(
      <>
        <button type="button">Avant</button>
        <WhatsNew role="member" lastReleaseSeen={null} ready />
      </>,
    );
    await screen.findByRole('dialog', { name: TITLE });
    // Le focus est sur le geste principal : Entrée referme aussitôt.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.whatsNew.done }));

    await user.click(screen.getByRole('button', { name: fr.whatsNew.done }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Avant' }));
    await afterDelay();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Échap la ferme aussi ; le clavier n\'en sort pas (l\'avatar ne marche pas derrière) ; Tab y tourne', async () => {
    const fetch = seenRoute();
    const user = userEvent.setup();
    const reachedWindow = vi.fn();
    window.addEventListener('keydown', reachedWindow);
    try {
      renderWhatsNew({ seen: '0.99' });
      const dialog = await screen.findByRole('dialog', { name: TITLE });
      const close = screen.getByRole('button', { name: fr.ui.close });
      const done = screen.getByRole('button', { name: fr.whatsNew.done });

      await user.keyboard('{ArrowDown}');
      expect(reachedWindow).not.toHaveBeenCalled();
      // « C'est parti » est le dernier bouton, la croix le premier : Tab boucle de l'un à l'autre.
      await user.tab();
      expect(document.activeElement).toBe(close);
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(done);
      expect(dialog.contains(document.activeElement)).toBe(true);

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(reachedWindow).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', reachedWindow);
    }
  });

  test('le corps, qui défile quand les notes dépassent, se prend au clavier : c\'est une région nommée, entre la croix et les boutons du pied', async () => {
    seenRoute();
    const user = userEvent.setup();
    renderWhatsNew({ seen: null });
    await screen.findByRole('dialog', { name: TITLE });
    const region = screen.getByRole('region', { name: TITLE });
    expect(region.classList.contains('whatsnew-body')).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.ui.close }));
    await user.tab();
    expect(document.activeElement).toBe(region);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.whatsNew.done }));
  });

  test('un clic sur le fond la ferme ; un clic dans la carte, non', async () => {
    seenRoute();
    renderWhatsNew({ seen: null });
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy();
    const backdrop = dialog.parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('un enregistrement qui échoue ne la rouvre pas dans la page (elle reviendra à la prochaine entrée)', async () => {
    fakeApi({ 'POST /api/me/release-seen': () => json(500, { error: 'unexpected' }) });
    const user = userEvent.setup();
    renderWhatsNew({ seen: null });
    await screen.findByRole('dialog', { name: TITLE });
    await user.click(screen.getByRole('button', { name: fr.whatsNew.done }));
    await afterDelay();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('tout l\'historique, depuis le menu « Moi »', () => {
  test('la ligne « Nouveautés » ferme le menu et ouvre la fenêtre, même à jour ; la fermer rend le focus à la puce, sans rien enregistrer', async () => {
    const fetch = seenRoute();
    const user = userEvent.setup();
    const onClose = vi.fn();
    const anchor = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchor} type="button">
          Mon profil
        </button>
        <div role="menu">
          <WhatsNewMenuItem onClose={onClose} anchorRef={anchor} />
        </div>
        <WhatsNew role="member" lastReleaseSeen={CURRENT_RELEASE} ready />
      </>,
    );
    const item = screen.getByRole('menuitem', { name: `Nouveautés, version ${CURRENT_RELEASE}` });
    expect(item.textContent).toContain(`v${CURRENT_RELEASE}`);
    await user.click(item);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('dialog', { name: TITLE })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: fr.ui.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useWhatsNewStore.getState().history).toBeNull();
    expect(document.activeElement).toBe(anchor.current);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('la page du bureau qui part pendant que l\'historique est ouvert efface la demande : au retour, il ne s\'ouvre pas de lui-même', async () => {
    seenRoute();
    const view = renderWhatsNew({ seen: CURRENT_RELEASE });
    act(() => useWhatsNewStore.getState().openHistory(null));
    expect(await screen.findByRole('dialog', { name: TITLE })).toBeTruthy();

    // Retour à la connexion (session expirée, par exemple) : le bureau se démonte, l'historique encore ouvert.
    view.unmount();
    expect(useWhatsNewStore.getState().history).toBeNull();

    renderWhatsNew({ seen: CURRENT_RELEASE });
    await afterDelay();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
