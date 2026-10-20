import type { PublicPlayer } from '@bureau/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bindKeyboard, DirectionInput } from '../game/input';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json } from '../test/fake-api';
import { AdminPanel } from './AdminPanel';

const store = () => useOfficeStore.getState();

beforeEach(() => {
  store().reset();
});

// ---- Le serveur simulé -------------------------------------------------------------------------------------------------------------

type Role = 'admin' | 'member';
interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// Ce que GET /api/admin/members dit : les membres actifs, avec leur adresse et leur rôle.
const ADA: Member = { id: 'ada', name: 'Ada', email: 'ada@x.fr', role: 'admin' };
const BOB: Member = { id: 'bob', name: 'Bob', email: 'bob@x.fr', role: 'member' };
const CLEO: Member = { id: 'cleo', name: 'Cléo', email: 'cleo@x.fr', role: 'admin' };
const NINA: Member = { id: 'nina', name: 'Nina', email: 'nina@x.fr', role: 'member' };
const MEMBERS = [ADA, BOB, CLEO];

// Ce que GET /api/admin/invitations dit d'une invitation en attente (admin-routes.ts, `listed`).
const invitation = (id: string, email: string, over: Partial<{ role: Role; expired: boolean }> = {}) => ({
  id,
  email,
  role: 'member' as Role,
  invitedBy: 'ada',
  createdAt: '2026-10-19T10:00:00.000Z',
  expiresAt: '2026-10-26T10:00:00.000Z',
  expired: false,
  ...over,
});
type Invitation = ReturnType<typeof invitation>;

interface World {
  members: Member[];
  invitations: Invitation[];
}

// Un faux serveur qui garde les deux listes ; `routes` ajoute ou remplace des routes, qui peuvent changer ce qu'il garde (`state`).
function serve(world: Partial<World> = {}, routes: (state: World) => Parameters<typeof fakeApi>[0] = () => ({})) {
  const state: World = { members: [...MEMBERS], invitations: [], ...world };
  const api = fakeApi({
    'GET /api/admin/members': () => json(200, state.members),
    'GET /api/admin/invitations': () => json(200, state.invitations),
    ...routes(state),
  });
  return { api, state };
}

type Api = ReturnType<typeof fakeApi>;
// Les requêtes reçues, dans l'ordre : « MÉTHODE /chemin ».
const routesOf = (api: Api) => api.mock.calls.map(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}`);
const countOf = (api: Api, route: string) => routesOf(api).filter((r) => r === route).length;
// Les corps JSON des requêtes « MÉTHODE /chemin » reçues.
const bodiesOf = (api: Api, route: string) =>
  api.mock.calls.filter(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}` === route).map(([, init]) => JSON.parse(String(init?.body)) as unknown);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const player = (id: string, name: string): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
});

// ---- Le panneau --------------------------------------------------------------------------------------------------------------------

interface Options {
  selfId?: string;
  onClose?: () => void;
}

function renderPanel({ selfId = ADA.id, onClose = () => {} }: Options = {}) {
  return render(<AdminPanel id="panneau-admin" selfId={selfId} onClose={onClose} />);
}

// Le panneau ouvert, ses deux listes arrivées (les titres des sections en portent le nombre).
async function openPanel(options?: Options) {
  const view = renderPanel(options);
  await screen.findByRole('region', { name: /^Membres \(\d+\)$/ });
  await screen.findByRole('region', { name: /^Invitations en attente \(\d+\)$/ });
  return view;
}

// Le panneau, avec un bouton à côté, hors de lui (la page, le Chat…) : là où le focus peut passer pendant qu'une réponse se fait attendre.
async function openPanelBeside(options: Options = {}) {
  const { selfId = ADA.id, onClose = () => {} } = options;
  render(
    <>
      <button type="button">Dehors</button>
      <AdminPanel id="panneau-admin" selfId={selfId} onClose={onClose} />
    </>,
  );
  await screen.findByRole('region', { name: /^Membres \(\d+\)$/ });
  await screen.findByRole('region', { name: /^Invitations en attente \(\d+\)$/ });
  return screen.getByRole('button', { name: 'Dehors' });
}

const panel = () => screen.getByRole('complementary', { name: fr.admin.title });
const inviteSection = () => within(panel()).getByRole('region', { name: fr.admin.invite.title });
const pendingSection = () => within(panel()).getByRole('region', { name: /^Invitations en attente/ });
const membersSection = () => within(panel()).getByRole('region', { name: /^Membres/ });
const emailField = () => within(inviteSection()).getByLabelText(fr.admin.invite.email) as HTMLInputElement;
const roleField = () => within(inviteSection()).getByLabelText(fr.admin.invite.role) as HTMLSelectElement;
const submitButton = () => within(inviteSection()).getByRole('button', { name: new RegExp(`^(${fr.admin.invite.submit}|${fr.admin.invite.submitting})$`) }) as HTMLButtonElement;
const rowOf = (section: HTMLElement, text: string) => within(section).getByText(text).closest('li') as HTMLElement;
const removeButton = (name: string) => within(membersSection()).getByRole('button', { name: t(fr.admin.members.removeLabel, { name }) }) as HTMLButtonElement;
const resendButton = (email: string) => within(pendingSection()).getByRole('button', { name: t(fr.admin.pending.resendLabel, { email }) }) as HTMLButtonElement;
const revokeButton = (email: string) => within(pendingSection()).getByRole('button', { name: t(fr.admin.pending.revokeLabel, { email }) }) as HTMLButtonElement;
const dialog = () => screen.getByRole('alertdialog');
const dialogButton = (name: string) => within(dialog()).getByRole('button', { name }) as HTMLButtonElement;

async function invite(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.clear(emailField());
  await user.type(emailField(), email);
  await user.click(submitButton());
}

// ---- Le panneau en général ---------------------------------------------------------------------------------------------------------

describe('le panneau', () => {
  test('une région « Admin » nommée par son titre, avec ses trois sections : Inviter, Invitations en attente, Membres', async () => {
    serve({ invitations: [invitation('inv-nina', 'nina@x.fr')] });
    await openPanel();
    expect(panel().id).toBe('panneau-admin');
    expect(screen.getByRole('heading', { level: 2, name: fr.admin.title })).toBeTruthy();
    expect(within(panel()).getByRole('heading', { level: 3, name: fr.admin.invite.title })).toBeTruthy();
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Invitations en attente (1)' })).toBeTruthy();
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Membres (3)' })).toBeTruthy();
  });

  test('à l\'ouverture, les membres et les invitations en attente sont lus, une fois chacun, et rien d\'autre ne part', async () => {
    const { api } = serve();
    await openPanel();
    expect(routesOf(api).sort()).toEqual(['GET /api/admin/invitations', 'GET /api/admin/members']);
  });

  test('à l\'ouverture, le focus va au titre : un lecteur d\'écran l\'annonce, et Tab entre dans le panneau', async () => {
    serve();
    renderPanel();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: fr.admin.title }));
    await screen.findByRole('region', { name: /^Membres \(/ });
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.admin.close }));
  });

  test('le bouton Fermer, et Échap, appellent onClose ; Échap pendant une composition (touche morte) l\'annule seulement', async () => {
    serve();
    const user = userEvent.setup();
    const onClose = vi.fn();
    await openPanel({ onClose });

    await user.click(screen.getByRole('button', { name: fr.admin.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    // Dans le champ de l'adresse aussi.
    await user.click(emailField());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(3);

    fireEvent.keyDown(emailField(), { key: 'Escape', isComposing: true });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test('en attendant les listes : « Chargement… » dans chaque section, puis les listes', async () => {
    const members = deferred<Response>();
    const invitations = deferred<Response>();
    fakeApi({ 'GET /api/admin/members': () => members.promise, 'GET /api/admin/invitations': () => invitations.promise });
    renderPanel();
    expect(within(membersSection()).getByText(fr.common.loading)).toBeTruthy();
    expect(within(pendingSection()).getByText(fr.common.loading)).toBeTruthy();

    invitations.resolve(json(200, []));
    expect(await within(pendingSection()).findByText(fr.admin.pending.empty)).toBeTruthy();
    expect(within(membersSection()).getByText(fr.common.loading)).toBeTruthy();
    members.resolve(json(200, MEMBERS));
    expect(await within(membersSection()).findByText('bob@x.fr')).toBeTruthy();
    expect(screen.queryByText(fr.common.loading)).toBeNull();
  });

  test.each([
    ['le serveur est injoignable', () => { throw new TypeError('Failed to fetch'); }],
    ['la session a expiré (401)', () => json(401, { error: 'unauthorized' })],
    ['erreur du serveur (500)', () => json(500, { error: 'internal' })],
  ])('les membres ne se chargent pas (%s) : un message et « Réessayer » dans leur section, les invitations s\'affichent ; réessayer recharge', async (_case, failure) => {
    const user = userEvent.setup();
    let fail = true;
    fakeApi({
      'GET /api/admin/members': () => (fail ? failure() : json(200, MEMBERS)),
      'GET /api/admin/invitations': () => json(200, [invitation('inv-nina', 'nina@x.fr')]),
    });
    renderPanel();

    expect((await within(membersSection()).findByRole('alert')).textContent).toBe(fr.admin.members.loadFailed);
    expect(await within(pendingSection()).findByText('nina@x.fr')).toBeTruthy();
    expect(within(pendingSection()).queryByRole('alert')).toBeNull();

    fail = false;
    await user.click(within(membersSection()).getByRole('button', { name: fr.common.retry }));
    expect(await within(membersSection()).findByText('bob@x.fr')).toBeTruthy();
    expect(within(membersSection()).queryByRole('alert')).toBeNull();
  });

  test('les invitations ne se chargent pas : un message et « Réessayer » dans leur section, les membres s\'affichent', async () => {
    const user = userEvent.setup();
    let fail = true;
    fakeApi({
      'GET /api/admin/members': () => json(200, MEMBERS),
      'GET /api/admin/invitations': () => (fail ? json(500, { error: 'internal' }) : json(200, [])),
    });
    renderPanel();

    expect((await within(pendingSection()).findByRole('alert')).textContent).toBe(fr.admin.pending.loadFailed);
    expect(await within(membersSection()).findByText('bob@x.fr')).toBeTruthy();

    fail = false;
    await user.click(within(pendingSection()).getByRole('button', { name: fr.common.retry }));
    expect(await within(pendingSection()).findByText(fr.admin.pending.empty)).toBeTruthy();
    expect(within(pendingSection()).queryByRole('alert')).toBeNull();
  });

  // « Réessayer » disparaît au clic (« Chargement… » le remplace) : le focus irait au haut de la page.
  test.each([
    ['les membres', 'GET /api/admin/members', membersSection, 'Membres (3)'],
    ['les invitations', 'GET /api/admin/invitations', pendingSection, 'Invitations en attente (0)'],
  ] as const)('« Réessayer » (%s) : le focus passe au titre de la section, qui reste là quand la liste arrive', async (_list, route, section, title) => {
    const user = userEvent.setup();
    let fail = true;
    fakeApi({
      'GET /api/admin/members': () => (route.includes('members') && fail ? json(500, { error: 'internal' }) : json(200, MEMBERS)),
      'GET /api/admin/invitations': () => (route.includes('invitations') && fail ? json(500, { error: 'internal' }) : json(200, [])),
    });
    renderPanel();
    const retry = await within(section()).findByRole('button', { name: fr.common.retry });
    retry.focus();

    fail = false;
    await user.click(retry);
    expect(document.activeElement).toBe(within(section()).getByRole('heading', { level: 3 }));
    await screen.findByRole('heading', { level: 3, name: title });
    expect(document.activeElement).toBe(within(section()).getByRole('heading', { level: 3 }));
  });

  test('deux demandes en vol (StrictMode ouvre deux fois) : la réponse la plus récente gagne, même arrivée la première', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const pending = [first, second];
    let calls = 0;
    const api = fakeApi({ 'GET /api/admin/members': () => pending[calls++]!.promise, 'GET /api/admin/invitations': () => json(200, []) });
    render(
      <StrictMode>
        <AdminPanel selfId="ada" onClose={() => {}} />
      </StrictMode>,
    );
    await waitFor(() => expect(countOf(api, 'GET /api/admin/members')).toBe(2));

    await act(async () => second.resolve(json(200, MEMBERS)));
    await screen.findByRole('region', { name: 'Membres (3)' });
    // La première réponse, plus lente, ne remet pas la liste à jour avec du plus ancien.
    await act(async () => first.resolve(json(200, [ADA])));
    expect(screen.getByRole('region', { name: 'Membres (3)' })).toBeTruthy();
  });
});

// ---- Inviter -----------------------------------------------------------------------------------------------------------------------

describe('inviter', () => {
  const postInvitation = (state: World) => ({
    'POST /api/admin/invitations': (init: RequestInit | undefined) => {
      const body = JSON.parse(String(init?.body)) as { email: string; role: Role };
      if (state.invitations.some((pending) => pending.email === body.email)) return json(409, { error: 'already_invited' });
      const created = invitation(`inv-${body.email}`, body.email, { role: body.role });
      state.invitations = [created, ...state.invitations];
      return json(201, created);
    },
  });

  test('invitation : POST puis rafraîchissement de la liste ; 409 already_invited affiché', async () => {
    const user = userEvent.setup();
    const { api } = serve({}, postInvitation);
    await openPanel();
    expect(within(pendingSection()).getByText(fr.admin.pending.empty)).toBeTruthy();

    await invite(user, 'nina@x.fr');

    // La demande part avec l'adresse et le rôle, puis la liste est relue : l'invitation y est.
    expect(await within(pendingSection()).findByText('nina@x.fr')).toBeTruthy();
    expect(bodiesOf(api, 'POST /api/admin/invitations')).toEqual([{ email: 'nina@x.fr', role: 'member' }]);
    expect(routesOf(api).slice(-2)).toEqual(['POST /api/admin/invitations', 'GET /api/admin/invitations']);
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Invitations en attente (1)' })).toBeTruthy();
    // Le serveur a accepté : le message le dit, le champ est vidé.
    const sent = within(inviteSection()).getByText(t(fr.admin.invite.sent, { email: 'nina@x.fr' }));
    expect(sent.closest('[role="status"]')).toBeTruthy();
    expect(emailField().value).toBe('');

    // La même adresse une seconde fois : le serveur refuse (409), le message est affiché, l'adresse reste dans le champ.
    await invite(user, 'nina@x.fr');
    expect((await within(inviteSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.alreadyInvited);
    expect(emailField().value).toBe('nina@x.fr');
    expect(within(inviteSection()).queryByText(t(fr.admin.invite.sent, { email: 'nina@x.fr' }))).toBeNull();
    expect(countOf(api, 'POST /api/admin/invitations')).toBe(2);
  });

  test('le rôle est « Membre » par défaut, et on peut inviter un admin', async () => {
    const user = userEvent.setup();
    const { api } = serve({}, postInvitation);
    await openPanel();

    expect(roleField().value).toBe('member');
    expect([...roleField().options].map((option) => option.textContent)).toEqual([fr.admin.roles.member, fr.admin.roles.admin]);

    await user.type(emailField(), 'nina@x.fr');
    await user.selectOptions(roleField(), 'admin');
    await user.click(submitButton());
    expect(await within(pendingSection()).findByText('nina@x.fr')).toBeTruthy();
    expect(bodiesOf(api, 'POST /api/admin/invitations')).toEqual([{ email: 'nina@x.fr', role: 'admin' }]);
    // Une invitation d'admin ne se répète pas par inadvertance : le formulaire revient à son état de départ.
    expect(roleField().value).toBe('member');
  });

  // Un lecteur d'écran n'annonce que ce qui paraît dans une région qui existait déjà : « Invitation envoyée » s'écrit dans la même.
  test('le message de réussite s\'écrit dans une région role="status" qui existait déjà, vide', async () => {
    const user = userEvent.setup();
    serve({}, postInvitation);
    await openPanel();
    const region = within(inviteSection()).getByRole('status');
    expect(region.textContent).toBe('');

    await invite(user, 'nina@x.fr');
    await within(pendingSection()).findByText('nina@x.fr');
    expect(within(inviteSection()).getByRole('status')).toBe(region);
    expect(region.textContent).toBe(t(fr.admin.invite.sent, { email: 'nina@x.fr' }));
  });

  test('après une invitation, le focus est dans le champ de l\'adresse : on enchaîne', async () => {
    const user = userEvent.setup();
    serve({}, postInvitation);
    await openPanel();
    await invite(user, 'nina@x.fr');
    await within(pendingSection()).findByText('nina@x.fr');
    expect(document.activeElement).toBe(emailField());
  });

  // L'e-mail part pendant une ou deux secondes (Resend) : l'admin qui enchaîne a déjà tapé l'adresse suivante.
  test('ce qui a été tapé pendant l\'envoi reste dans le champ, quand le serveur accepte la première invitation', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    serve({}, () => ({ 'POST /api/admin/invitations': () => reply.promise }));
    await openPanel();
    await user.type(emailField(), 'nina@x.fr');
    await user.click(submitButton());
    await user.clear(emailField());
    await user.type(emailField(), 'bob@x.fr');

    await act(async () => reply.resolve(json(201, invitation('inv-nina', 'nina@x.fr'))));
    expect(await within(inviteSection()).findByText(t(fr.admin.invite.sent, { email: 'nina@x.fr' }))).toBeTruthy();
    expect(emailField().value).toBe('bob@x.fr');
  });

  // Le POST est lent (l'e-mail part par Resend) : l'admin est passé à autre chose avant la réponse, qui ne lui reprend pas le focus.
  describe('la réponse arrive après que le focus est passé ailleurs', () => {
    const slowPost = () => {
      const reply = deferred<Response>();
      const answer = () => act(async () => reply.resolve(json(201, invitation('inv-nina', 'nina@x.fr'))));
      const routes = (state: World) => ({
        'POST /api/admin/invitations': async () => {
          const response = await reply.promise;
          state.invitations = [invitation('inv-nina', 'nina@x.fr'), ...state.invitations];
          return response;
        },
      });
      return { routes, answer };
    };

    test('la boîte de retrait ouverte entre-temps garde le focus : Tab et Échap y restent, et Échap ne ferme pas le panneau', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const { routes, answer } = slowPost();
      serve({}, routes);
      await openPanel({ onClose });
      await user.type(emailField(), 'nina@x.fr');
      await user.click(submitButton());
      await user.click(removeButton('Bob'));
      expect(document.activeElement).toBe(dialogButton(fr.admin.removal.cancel));

      await answer();
      await within(pendingSection()).findByText('nina@x.fr');
      expect(document.activeElement).toBe(dialogButton(fr.admin.removal.cancel));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    test('un élément hors du panneau garde le focus', async () => {
      const user = userEvent.setup();
      const { routes, answer } = slowPost();
      serve({}, routes);
      const outside = await openPanelBeside();
      await user.type(emailField(), 'nina@x.fr');
      await user.click(submitButton());
      outside.focus();

      await answer();
      await within(pendingSection()).findByText('nina@x.fr');
      expect(document.activeElement).toBe(outside);
    });

    test('un refus qui arrive tard ne reprend pas le focus non plus', async () => {
      const user = userEvent.setup();
      const reply = deferred<Response>();
      serve({}, () => ({ 'POST /api/admin/invitations': () => reply.promise }));
      const outside = await openPanelBeside();
      await user.type(emailField(), 'nina@x.fr');
      await user.click(submitButton());
      outside.focus();

      await act(async () => reply.resolve(json(409, { error: 'already_invited' })));
      await within(inviteSection()).findByRole('alert');
      expect(document.activeElement).toBe(outside);
    });

    test('le focus est resté sur le bouton qui a envoyé : il revient au champ', async () => {
      const user = userEvent.setup();
      const { routes, answer } = slowPost();
      serve({}, routes);
      await openPanel();
      await user.type(emailField(), 'nina@x.fr');
      await user.click(submitButton());
      expect(document.activeElement).toBe(submitButton());

      await answer();
      await within(pendingSection()).findByText('nina@x.fr');
      expect(document.activeElement).toBe(emailField());
    });

    // Un bouton devenu inactif perd le focus (le navigateur le met sur la page) : le champ le reprend.
    test('le focus n\'est nulle part (sur la page) : le champ le reprend', async () => {
      const user = userEvent.setup();
      const { routes, answer } = slowPost();
      serve({}, routes);
      await openPanel();
      await user.type(emailField(), 'nina@x.fr');
      emailField().blur();
      fireEvent.submit(emailField().form!);
      expect(document.activeElement).toBe(document.body);

      await answer();
      await within(pendingSection()).findByText('nina@x.fr');
      expect(document.activeElement).toBe(emailField());
    });
  });

  test('« Envoyer l\'invitation » est inactif tant que l\'adresse est vide (espaces compris)', async () => {
    const user = userEvent.setup();
    serve();
    await openPanel();
    expect(submitButton().disabled).toBe(true);
    await user.type(emailField(), '   ');
    expect(submitButton().disabled).toBe(true);
    await user.type(emailField(), 'a');
    expect(submitButton().disabled).toBe(false);
  });

  test('pendant l\'envoi : « Envoi… », bouton inactif, et un second envoi ne part pas', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    const { api } = serve({}, () => ({ 'POST /api/admin/invitations': () => reply.promise }));
    await openPanel();
    await user.type(emailField(), 'nina@x.fr');
    await user.click(submitButton());

    expect(submitButton().textContent).toBe(fr.admin.invite.submitting);
    expect(submitButton().disabled).toBe(true);
    fireEvent.submit(emailField().form!);
    expect(countOf(api, 'POST /api/admin/invitations')).toBe(1);

    await act(async () => reply.resolve(json(201, invitation('inv-nina', 'nina@x.fr'))));
    await waitFor(() => expect(submitButton().textContent).toBe(fr.admin.invite.submit));
  });

  test.each([
    ['une invitation est déjà en attente (409)', 409, { error: 'already_invited' }, fr.admin.errors.alreadyInvited],
    ['un compte existe déjà, actif ou retiré (409)', 409, { error: 'already_member' }, fr.admin.errors.alreadyMember],
    ['l\'adresse n\'est pas valable (400)', 400, { error: 'invalid' }, fr.admin.errors.invalid],
    ['la session a expiré (401)', 401, { error: 'unauthorized' }, fr.admin.errors.unauthorized],
    ['plus admin (403)', 403, { error: 'forbidden' }, fr.admin.errors.forbidden],
    ['erreur du serveur (500)', 500, { error: 'internal' }, fr.common.errors.unexpected],
    ['une réponse sans code (le relais est tombé)', 502, undefined, fr.common.errors.unexpected],
  ])('refus (%s) : le message est affiché, l\'adresse et le rôle restent dans le champ', async (_case, status, body, message) => {
    const user = userEvent.setup();
    serve({}, () => ({ 'POST /api/admin/invitations': () => (body === undefined ? new Response('Bad Gateway', { status }) : json(status, body)) }));
    await openPanel();
    await user.type(emailField(), 'nina@x.fr');
    await user.selectOptions(roleField(), 'admin');
    await user.click(submitButton());

    expect((await within(inviteSection()).findByRole('alert')).textContent).toBe(message);
    expect(emailField().value).toBe('nina@x.fr');
    expect(roleField().value).toBe('admin');
    expect(submitButton().disabled).toBe(false);
    expect(document.activeElement).toBe(emailField());
  });

  test('serveur injoignable : le message réseau, l\'adresse reste', async () => {
    const user = userEvent.setup();
    serve({}, () => ({ 'POST /api/admin/invitations': () => { throw new TypeError('Failed to fetch'); } }));
    await openPanel();
    await user.type(emailField(), 'nina@x.fr');
    await user.click(submitButton());
    expect((await within(inviteSection()).findByRole('alert')).textContent).toBe(fr.common.errors.network);
    expect(emailField().value).toBe('nina@x.fr');
  });

  // L'e-mail n'est pas parti, mais l'invitation existe (admin-routes.ts) : la liste doit la montrer, avec « Renvoyer ».
  test('l\'e-mail n\'est pas parti (502) : le message le dit, l\'adresse reste, et l\'invitation gardée apparaît dans la liste', async () => {
    const user = userEvent.setup();
    serve({}, (state) => ({
      'POST /api/admin/invitations': () => {
        state.invitations = [invitation('inv-nina', 'nina@x.fr')];
        return json(502, { error: 'mail_failed' });
      },
    }));
    await openPanel();
    await invite(user, 'nina@x.fr');

    expect((await within(inviteSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.mailFailed);
    expect(emailField().value).toBe('nina@x.fr');
    expect(await within(pendingSection()).findByText('nina@x.fr')).toBeTruthy();
    expect(resendButton('nina@x.fr')).toBeTruthy();
  });

  test('retaper l\'adresse efface le message d\'avant, refus ou invitation envoyée : il parlait de l\'adresse d\'avant', async () => {
    const user = userEvent.setup();
    serve({}, postInvitation);
    await openPanel();
    await invite(user, 'nina@x.fr');
    await within(inviteSection()).findByText(t(fr.admin.invite.sent, { email: 'nina@x.fr' }));
    await user.type(emailField(), 'n');
    expect(within(inviteSection()).queryByText(t(fr.admin.invite.sent, { email: 'nina@x.fr' }))).toBeNull();

    // La même adresse : refusée, puis on la corrige.
    await invite(user, 'nina@x.fr');
    await within(inviteSection()).findByRole('alert');
    await user.type(emailField(), 's');
    expect(within(inviteSection()).queryByRole('alert')).toBeNull();
  });

  test('une nouvelle tentative efface le message d\'avant', async () => {
    const user = userEvent.setup();
    let calls = 0;
    serve({}, (state) => ({
      'POST /api/admin/invitations': () => {
        if (calls++ === 0) return json(400, { error: 'invalid' });
        state.invitations = [invitation('inv-nina', 'nina@x.fr')];
        return json(201, state.invitations[0]);
      },
    }));
    await openPanel();
    await invite(user, 'nina');
    await within(inviteSection()).findByRole('alert');
    await invite(user, 'nina@x.fr');
    await within(inviteSection()).findByText(t(fr.admin.invite.sent, { email: 'nina@x.fr' }));
    expect(within(inviteSection()).queryByRole('alert')).toBeNull();
  });
});

// ---- Invitations en attente ---------------------------------------------------------------------------------------------------------

describe('invitations en attente', () => {
  const PENDING = [invitation('inv-nina', 'nina@x.fr'), invitation('inv-old', 'old@x.fr', { role: 'admin', expired: true })];

  test('chaque invitation : l\'adresse, le rôle, « expirée » si son lien ne marche plus, et ses deux actions', async () => {
    serve({ invitations: PENDING });
    await openPanel();
    const items = within(pendingSection()).getAllByRole('listitem');
    expect(items).toHaveLength(2);

    const nina = rowOf(pendingSection(), 'nina@x.fr');
    expect(nina.textContent).toContain(fr.admin.roles.member);
    expect(nina.textContent).not.toContain(fr.admin.pending.expired);
    const old = rowOf(pendingSection(), 'old@x.fr');
    expect(old.textContent).toContain(fr.admin.roles.admin);
    expect(old.textContent).toContain(fr.admin.pending.expired);

    // Le texte des boutons est court ; leur nom dit pour qui ils agissent.
    for (const row of [nina, old]) {
      expect(within(row).getAllByRole('button').map((button) => button.textContent)).toEqual([fr.admin.pending.resend, fr.admin.pending.revoke]);
    }
    expect(resendButton('old@x.fr')).toBeTruthy();
    expect(revokeButton('old@x.fr')).toBeTruthy();
  });

  test('une adresse trop longue est coupée à l\'écran, et son infobulle la donne entière', async () => {
    const long = `${'a'.repeat(60)}@exemple-tres-long.fr`;
    serve({ invitations: [invitation('inv-long', long)] });
    await openPanel();
    expect(within(pendingSection()).getByText(long).getAttribute('title')).toBe(long);
  });

  test('aucune invitation en attente : un message, pas de liste', async () => {
    serve();
    await openPanel();
    expect(within(pendingSection()).getByText(fr.admin.pending.empty)).toBeTruthy();
    expect(within(pendingSection()).queryByRole('list')).toBeNull();
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Invitations en attente (0)' })).toBeTruthy();
  });

  test('Renvoyer : POST …/resend, la liste est relue ; une invitation expirée n\'est plus expirée, et le message le dit', async () => {
    const user = userEvent.setup();
    const { api } = serve({ invitations: PENDING }, (state) => ({
      'POST /api/admin/invitations/inv-old/resend': () => {
        state.invitations = state.invitations.map((pending) => (pending.id === 'inv-old' ? { ...pending, expired: false } : pending));
        return json(200, { ok: true });
      },
    }));
    await openPanel();
    expect(rowOf(pendingSection(), 'old@x.fr').textContent).toContain(fr.admin.pending.expired);

    await user.click(resendButton('old@x.fr'));

    expect(await within(pendingSection()).findByText(t(fr.admin.pending.resent, { email: 'old@x.fr' }))).toBeTruthy();
    expect(routesOf(api).slice(-2)).toEqual(['POST /api/admin/invitations/inv-old/resend', 'GET /api/admin/invitations']);
    expect(rowOf(pendingSection(), 'old@x.fr').textContent).not.toContain(fr.admin.pending.expired);
    // Pas de corps : la route ne lit rien.
    expect(api.mock.calls.find(([input]) => String(input).endsWith('/resend'))?.[1]?.body).toBeUndefined();
  });

  test('Annuler : DELETE de l\'invitation, la liste est relue, l\'invitation n\'y est plus', async () => {
    const user = userEvent.setup();
    const { api } = serve({ invitations: PENDING }, (state) => ({
      'DELETE /api/admin/invitations/inv-nina': () => {
        state.invitations = state.invitations.filter((pending) => pending.id !== 'inv-nina');
        return json(200, { ok: true });
      },
    }));
    await openPanel();

    await user.click(revokeButton('nina@x.fr'));

    await waitFor(() => expect(within(pendingSection()).queryByText('nina@x.fr')).toBeNull());
    expect(routesOf(api).slice(-2)).toEqual(['DELETE /api/admin/invitations/inv-nina', 'GET /api/admin/invitations']);
    expect(within(pendingSection()).getByText(t(fr.admin.pending.revoked, { email: 'nina@x.fr' }))).toBeTruthy();
    expect(within(pendingSection()).getByText('old@x.fr')).toBeTruthy();
    // La ligne n'existe plus : le focus va au titre de la section, d'où la lecture continue.
    const title = within(panel()).getByRole('heading', { level: 3, name: 'Invitations en attente (1)' });
    expect(document.activeElement).toBe(title);
  });

  // « Inactif » par aria-disabled et non par `disabled` : un bouton qui devient `disabled` perd le focus, et la personne au clavier
  // se retrouverait en haut de la page.
  test('pendant une action : les boutons de la section sont inactifs (aria-disabled), le focus reste sur celui qu\'on a pris, et une seule demande part', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    const { api } = serve({ invitations: PENDING }, () => ({ 'POST /api/admin/invitations/inv-nina/resend': () => reply.promise }));
    await openPanel();
    await user.click(resendButton('nina@x.fr'));

    for (const button of within(pendingSection()).getAllByRole('button')) expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(resendButton('nina@x.fr'));
    // Entrée sur le même bouton, un clic sur celui d'une autre ligne : rien de plus ne part.
    await user.keyboard('{Enter}');
    fireEvent.click(revokeButton('old@x.fr'));
    expect(routesOf(api).filter((route) => route.startsWith('POST') || route.startsWith('DELETE'))).toEqual(['POST /api/admin/invitations/inv-nina/resend']);

    await act(async () => reply.resolve(json(200, { ok: true })));
    await waitFor(() => expect(resendButton('nina@x.fr').hasAttribute('aria-disabled')).toBe(false));
    expect(document.activeElement).toBe(resendButton('nina@x.fr'));
  });

  test('annuler : la réponse qui arrive après que le focus est passé ailleurs ne le reprend pas (la ligne disparaît quand même)', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    serve({ invitations: PENDING }, (state) => ({
      'DELETE /api/admin/invitations/inv-nina': async () => {
        const response = await reply.promise;
        state.invitations = state.invitations.filter((pending) => pending.id !== 'inv-nina');
        return response;
      },
    }));
    const outside = await openPanelBeside();
    await user.click(revokeButton('nina@x.fr'));
    outside.focus();

    await act(async () => reply.resolve(json(200, { ok: true })));
    await waitFor(() => expect(within(pendingSection()).queryByText('nina@x.fr')).toBeNull());
    expect(document.activeElement).toBe(outside);
  });

  test('renvoyer : l\'e-mail n\'est pas parti (502) → le message le dit, l\'invitation est gardée', async () => {
    const user = userEvent.setup();
    serve({ invitations: PENDING }, () => ({ 'POST /api/admin/invitations/inv-nina/resend': () => json(502, { error: 'mail_failed' }) }));
    await openPanel();
    await user.click(resendButton('nina@x.fr'));
    expect((await within(pendingSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.mailFailed);
    expect(within(pendingSection()).getByText('nina@x.fr')).toBeTruthy();
    expect(resendButton('nina@x.fr').disabled).toBe(false);
  });

  // Acceptée ou annulée par un autre admin entre-temps : le serveur répond 404 (« l'annulation n'a rien empêché »). Une invitation acceptée
  // est un nouveau membre : les deux listes sont relues.
  test.each([
    ['renvoyer', 'POST', '/resend', resendButton],
    ['annuler', 'DELETE', '', revokeButton],
  ] as const)('%s une invitation qui n\'est plus en attente (404) : le message le dit, et les deux listes sont relues', async (_action, method, suffix, button) => {
    const user = userEvent.setup();
    const { api, state } = serve({ invitations: PENDING }, (world) => ({
      [`${method} /api/admin/invitations/inv-nina${suffix}`]: () => {
        // Nina vient d'accepter : plus d'invitation, un membre de plus.
        world.invitations = world.invitations.filter((pending) => pending.id !== 'inv-nina');
        world.members = [...world.members, NINA];
        return json(404, { error: 'not_found' });
      },
    }));
    await openPanel();
    await user.click(button('nina@x.fr'));

    expect((await within(pendingSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.notFoundInvitation);
    await waitFor(() => expect(within(pendingSection()).queryByText('nina@x.fr')).toBeNull());
    await within(membersSection()).findByText('nina@x.fr');
    expect(countOf(api, 'GET /api/admin/invitations')).toBe(2);
    expect(countOf(api, 'GET /api/admin/members')).toBe(2);
    expect(state.members).toContain(NINA);
    expect(document.activeElement).toBe(within(panel()).getByRole('heading', { level: 3, name: 'Invitations en attente (1)' }));
  });

  test('serveur injoignable : le message réseau', async () => {
    const user = userEvent.setup();
    serve({ invitations: PENDING }, () => ({ 'DELETE /api/admin/invitations/inv-nina': () => { throw new TypeError('Failed to fetch'); } }));
    await openPanel();
    await user.click(revokeButton('nina@x.fr'));
    expect((await within(pendingSection()).findByRole('alert')).textContent).toBe(fr.common.errors.network);
  });

  test('l\'action suivante efface le message de la précédente', async () => {
    const user = userEvent.setup();
    let calls = 0;
    serve({ invitations: PENDING }, () => ({
      'POST /api/admin/invitations/inv-nina/resend': () => (calls++ === 0 ? json(502, { error: 'mail_failed' }) : json(200, { ok: true })),
    }));
    await openPanel();
    await user.click(resendButton('nina@x.fr'));
    await within(pendingSection()).findByRole('alert');
    await user.click(resendButton('nina@x.fr'));
    await within(pendingSection()).findByText(t(fr.admin.pending.resent, { email: 'nina@x.fr' }));
    expect(within(pendingSection()).queryByRole('alert')).toBeNull();
  });
});

// ---- Membres -----------------------------------------------------------------------------------------------------------------------

describe('membres', () => {
  test('chaque membre : son nom, son adresse et son rôle ; soi-même est « (toi) », sans bouton Retirer ; les autres ont le leur', async () => {
    serve();
    await openPanel();
    const items = within(membersSection()).getAllByRole('listitem');
    expect(items).toHaveLength(3);

    const ada = rowOf(membersSection(), 'Ada');
    expect(ada.textContent).toContain('ada@x.fr');
    expect(ada.textContent).toContain(fr.admin.roles.admin);
    expect(ada.textContent).toContain(fr.admin.you);
    expect(within(ada).queryByRole('button')).toBeNull();

    const bob = rowOf(membersSection(), 'Bob');
    expect(bob.textContent).toContain('bob@x.fr');
    expect(bob.textContent).toContain(fr.admin.roles.member);
    expect(bob.textContent).not.toContain(fr.admin.you);
    expect(within(bob).getByRole('button', { name: 'Retirer Bob' }).textContent).toBe(fr.admin.members.remove);
    // Un autre admin se retire comme les autres.
    expect(removeButton('Cléo')).toBeTruthy();
  });

  test('un nom et une adresse trop longs sont coupés à l\'écran, et leur infobulle les donne entiers', async () => {
    const longName = 'Marie-Hélène de La Tour-Dupin-Gouvernet';
    const longEmail = `${'m'.repeat(50)}@exemple-tres-long.fr`;
    serve({ members: [ADA, { id: 'mh', name: longName, email: longEmail, role: 'member' }] });
    await openPanel();
    expect(within(membersSection()).getByText(longName).getAttribute('title')).toBe(longName);
    expect(within(membersSection()).getByText(longEmail).getAttribute('title')).toBe(longEmail);
  });
});

// ---- Retirer un membre -------------------------------------------------------------------------------------------------------------

describe('retirer un membre', () => {
  const removeBob = (state: World) => ({
    'DELETE /api/admin/members/bob': () => {
      state.members = state.members.filter((member) => member.id !== 'bob');
      return json(200, { ok: true });
    },
  });

  test('retrait d\'un membre : confirmation obligatoire', async () => {
    const user = userEvent.setup();
    const { api } = serve({}, removeBob);
    await openPanel();

    await user.click(removeButton('Bob'));
    // Rien n'est parti : une boîte de dialogue demande de confirmer, en nommant la personne.
    const confirmation = screen.getByRole('alertdialog', { name: t(fr.admin.removal.title, { name: 'Bob' }) });
    expect(countOf(api, 'DELETE /api/admin/members/bob')).toBe(0);
    expect(within(confirmation).getByText(t(fr.admin.removal.body, { email: 'bob@x.fr' }))).toBeTruthy();

    // « Annuler » : toujours rien, Bob est toujours là.
    await user.click(dialogButton(fr.admin.removal.cancel));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(countOf(api, 'DELETE /api/admin/members/bob')).toBe(0);
    expect(within(membersSection()).getByText('Bob')).toBeTruthy();

    // Confirmé : la demande part, la liste est relue, Bob n'y est plus.
    await user.click(removeButton('Bob'));
    await user.click(dialogButton(fr.admin.removal.confirm));
    await waitFor(() => expect(within(membersSection()).queryByText('Bob')).toBeNull());
    expect(routesOf(api).slice(-2)).toEqual(['DELETE /api/admin/members/bob', 'GET /api/admin/members']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Membres (2)' })).toBeTruthy();
    expect(within(membersSection()).getByText(t(fr.admin.members.removed, { name: 'Bob' }))).toBeTruthy();
  });

  test('la boîte de dialogue est modale, nommée par la personne et décrite ; le focus est sur « Annuler », le geste sûr', async () => {
    const user = userEvent.setup();
    serve();
    await openPanel();
    await user.click(removeButton('Bob'));

    const confirmation = dialog();
    expect(confirmation.getAttribute('aria-modal')).toBe('true');
    expect(confirmation.getAttribute('aria-labelledby')).toBe(within(confirmation).getByRole('heading', { name: 'Retirer Bob ?' }).id);
    expect(confirmation.getAttribute('aria-describedby')).toBe(within(confirmation).getByText(t(fr.admin.removal.body, { email: 'bob@x.fr' })).id);
    expect(document.activeElement).toBe(dialogButton(fr.admin.removal.cancel));
    expect(within(confirmation).getAllByRole('button').map((button) => button.textContent)).toEqual([fr.admin.removal.cancel, fr.admin.removal.confirm]);
  });

  test('Annuler et Échap la ferment sans rien envoyer, et le focus revient au bouton Retirer', async () => {
    const user = userEvent.setup();
    const { api } = serve();
    await openPanel();

    await user.click(removeButton('Bob'));
    await user.click(dialogButton(fr.admin.removal.cancel));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(removeButton('Bob'));

    await user.click(removeButton('Bob'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(removeButton('Bob'));

    expect(routesOf(api).filter((route) => route.startsWith('DELETE'))).toEqual([]);
  });

  // Un double clic sur « Retirer » : le second clic tombe sur le fond, qui couvre la page. Il ne doit pas fermer la boîte à peine ouverte, ni
  // lui retirer le focus (Échap et Tab n'y arriveraient plus).
  test('un clic sur le fond ne ferme pas la boîte et ne lui retire pas le focus', async () => {
    const user = userEvent.setup();
    const { api } = serve();
    await openPanel();
    await user.click(removeButton('Bob'));
    expect(document.activeElement).toBe(dialogButton(fr.admin.removal.cancel));

    await user.click(dialog().parentElement!);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(document.activeElement).toBe(dialogButton(fr.admin.removal.cancel));
    // Un clic dans la boîte, hors de ses boutons, non plus ; la boîte garde alors le focus, et Maj+Tab ne sort pas.
    await user.click(within(dialog()).getByRole('heading'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(document.activeElement).toBe(dialog());
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(dialogButton(fr.admin.removal.confirm));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(routesOf(api).filter((route) => route.startsWith('DELETE'))).toEqual([]);
  });

  test('Échap dans la boîte la ferme, mais pas le panneau', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    serve();
    await openPanel({ onClose });
    await user.click(removeButton('Bob'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Le panneau, lui, se ferme toujours par Échap.
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('le focus reste dans la boîte : Tab après le dernier bouton revient au premier, Maj+Tab avant le premier va au dernier', async () => {
    const user = userEvent.setup();
    serve();
    await openPanel();
    await user.click(removeButton('Bob'));
    const cancel = dialogButton(fr.admin.removal.cancel);
    const confirm = dialogButton(fr.admin.removal.confirm);

    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
  });

  test('dans la boîte, le clavier n\'est plus celui de l\'avatar : flèches et ZQSD ne le font pas marcher', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      serve();
      await openPanel();
      await user.click(removeButton('Bob'));
      // Touche gardée enfoncée (« > ») : sans la boîte pour la prendre, l'avatar marcherait tant qu'elle l'est.
      await user.keyboard('{ArrowRight>}');
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowRight}');
      // Le Q d'un clavier AZERTY est à la position de KeyA.
      fireEvent.keyDown(document.activeElement!, { code: 'KeyA', key: 'q' });
      expect(directions.current()).toBeNull();
      fireEvent.keyUp(document.activeElement!, { code: 'KeyA', key: 'q' });
      expect(screen.getByRole('alertdialog')).toBeTruthy();

      // Boîte fermée, les mêmes touches font marcher l'avatar.
      await user.keyboard('{Escape}');
      await user.keyboard('{ArrowRight>}');
      expect(directions.current()).toBe('right');
    } finally {
      unbind();
    }
  });

  test('confirmer : « Retrait… » et boutons inactifs pendant la demande, Échap sans effet ; puis la boîte se ferme et le focus va au titre des membres', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    const { api } = serve({}, (state) => ({
      'DELETE /api/admin/members/bob': async () => {
        const response = await reply.promise;
        state.members = state.members.filter((member) => member.id !== 'bob');
        return response;
      },
    }));
    await openPanel();
    await user.click(removeButton('Bob'));
    await user.click(dialogButton(fr.admin.removal.confirm));

    // Inactifs par aria-disabled : le focus reste sur le bouton pris, dans la boîte.
    expect(dialogButton(fr.admin.removal.confirming).getAttribute('aria-disabled')).toBe('true');
    expect(dialogButton(fr.admin.removal.cancel).getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(dialogButton(fr.admin.removal.confirming));
    await user.keyboard('{Escape}');
    await user.click(dialogButton(fr.admin.removal.cancel));
    await user.click(dialogButton(fr.admin.removal.confirming));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(countOf(api, 'DELETE /api/admin/members/bob')).toBe(1);

    await act(async () => reply.resolve(json(200, { ok: true })));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(within(membersSection()).queryByText('Bob')).toBeNull());
    // La ligne n'existe plus : le focus va au titre de la section, d'où la lecture continue.
    expect(document.activeElement).toBe(within(panel()).getByRole('heading', { level: 3, name: 'Membres (2)' }));
  });

  // Le bouton manque à sa propre ligne, mais le serveur refuse aussi : ici, un panneau qui ne se reconnaît pas (selfId d'un autre compte).
  test.each([
    ['soi-même (400)', 400, { error: 'self' }, () => fr.admin.errors.self],
    ['le dernier admin (400)', 400, { error: 'last_admin' }, () => fr.admin.errors.lastAdmin],
    ['la session a expiré (401)', 401, { error: 'unauthorized' }, () => fr.admin.errors.unauthorized],
    ['plus admin (403)', 403, { error: 'forbidden' }, () => fr.admin.errors.forbidden],
    ['erreur du serveur (500)', 500, { error: 'internal' }, () => fr.common.errors.unexpected],
  ])('refus du serveur (%s) : le message est dans la section, la boîte se ferme, le focus revient au bouton, la liste est intacte', async (_case, status, body, message) => {
    const user = userEvent.setup();
    serve({}, () => ({ 'DELETE /api/admin/members/ada': () => json(status, body) }));
    await openPanel({ selfId: 'quelqu-un-d-autre' });

    await user.click(removeButton('Ada'));
    await user.click(dialogButton(fr.admin.removal.confirm));

    expect((await within(membersSection()).findByRole('alert')).textContent).toBe(message());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(removeButton('Ada'));
    expect(within(membersSection()).getAllByRole('listitem')).toHaveLength(3);
  });

  test('la réponse qui arrive après que le focus est passé ailleurs ne le reprend pas ; la boîte se ferme et la liste est relue', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    serve({}, (state) => ({
      'DELETE /api/admin/members/bob': async () => {
        const response = await reply.promise;
        state.members = state.members.filter((member) => member.id !== 'bob');
        return response;
      },
    }));
    const outside = await openPanelBeside();
    await user.click(removeButton('Bob'));
    await user.click(dialogButton(fr.admin.removal.confirm));
    outside.focus();

    await act(async () => reply.resolve(json(200, { ok: true })));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(within(membersSection()).queryByText('Bob')).toBeNull());
    expect(document.activeElement).toBe(outside);
  });

  test('le membre a déjà été retiré (404) : le message le dit, et la liste est relue', async () => {
    const user = userEvent.setup();
    const { api } = serve({}, (state) => ({
      'DELETE /api/admin/members/bob': () => {
        state.members = state.members.filter((member) => member.id !== 'bob');
        return json(404, { error: 'not_found' });
      },
    }));
    await openPanel();
    await user.click(removeButton('Bob'));
    await user.click(dialogButton(fr.admin.removal.confirm));

    expect((await within(membersSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.notFoundMember);
    await waitFor(() => expect(within(membersSection()).queryByText('Bob')).toBeNull());
    expect(countOf(api, 'GET /api/admin/members')).toBe(2);
    expect(document.activeElement).toBe(within(panel()).getByRole('heading', { level: 3, name: 'Membres (2)' }));
  });

  test('serveur injoignable : le message réseau, la boîte se ferme', async () => {
    const user = userEvent.setup();
    serve({}, () => ({ 'DELETE /api/admin/members/bob': () => { throw new TypeError('Failed to fetch'); } }));
    await openPanel();
    await user.click(removeButton('Bob'));
    await user.click(dialogButton(fr.admin.removal.confirm));
    expect((await within(membersSection()).findByRole('alert')).textContent).toBe(fr.common.errors.network);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('un identifiant est encodé dans l\'adresse de la demande', async () => {
    const user = userEvent.setup();
    const odd = { id: 'a/b c', name: 'Zoé', email: 'zoe@x.fr', role: 'member' as Role };
    const { api } = serve({ members: [ADA, odd] }, () => ({ 'DELETE /api/admin/members/a%2Fb%20c': () => json(200, { ok: true }) }));
    await openPanel();
    await user.click(removeButton('Zoé'));
    await user.click(dialogButton(fr.admin.removal.confirm));
    await waitFor(() => expect(countOf(api, 'DELETE /api/admin/members/a%2Fb%20c')).toBe(1));
  });
});

// ---- Quelqu'un de nouveau arrive en ligne ------------------------------------------------------------------------------------------

describe('quelqu\'un que les listes ne connaissent pas arrive en ligne', () => {
  function arrive(): void {
    act(() => store().applyInit({ self: player('ada', 'Ada'), players: [], mapKey: 'dev-office', chatHistory: [] }));
  }

  test('une invitation vient d\'être acceptée : les deux listes sont relues, une seule fois ; Nina quitte les invitations et entre dans les membres', async () => {
    const { api, state } = serve({ invitations: [invitation('inv-nina', 'nina@x.fr')] });
    arrive();
    await openPanel();
    expect(within(pendingSection()).getByText('nina@x.fr')).toBeTruthy();

    // Nina accepte, crée son compte, puis entre au bureau.
    state.members = [...state.members, NINA];
    state.invitations = [];
    act(() => store().upsertPlayer(player('nina', 'Nina')));

    expect(await within(membersSection()).findByText('nina@x.fr')).toBeTruthy();
    await waitFor(() => expect(within(pendingSection()).queryByText('nina@x.fr')).toBeNull());
    expect(countOf(api, 'GET /api/admin/members')).toBe(2);
    expect(countOf(api, 'GET /api/admin/invitations')).toBe(2);

    // Un membre déjà connu qui arrive ne relit rien.
    act(() => store().upsertPlayer(player('bob', 'Bob')));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(countOf(api, 'GET /api/admin/members')).toBe(2);
    expect(countOf(api, 'GET /api/admin/invitations')).toBe(2);
  });

  test('une relecture qui échoue ne casse pas la liste déjà là : pas de message, les membres restent', async () => {
    let calls = 0;
    fakeApi({
      'GET /api/admin/members': () => (++calls === 1 ? json(200, MEMBERS) : json(500, { error: 'internal' })),
      'GET /api/admin/invitations': () => json(200, []),
    });
    arrive();
    await openPanel();
    act(() => store().upsertPlayer(player('nina', 'Nina')));
    await waitFor(() => expect(calls).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(membersSection()).queryByRole('alert')).toBeNull();
    expect(within(membersSection()).getAllByRole('listitem')).toHaveLength(3);
  });

  test('si le serveur ne la connaît toujours pas après la relecture, on ne boucle pas', async () => {
    const { api } = serve();
    arrive();
    act(() => store().upsertPlayer(player('fantome', 'Fantôme')));
    await openPanel();
    await waitFor(() => expect(countOf(api, 'GET /api/admin/members')).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(countOf(api, 'GET /api/admin/members')).toBe(2);
    expect(countOf(api, 'GET /api/admin/invitations')).toBe(2);
  });
});
