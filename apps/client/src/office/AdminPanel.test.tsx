import { INVITATION_TTL_MS, type MailMode, type PublicPlayer } from '@bureau/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
  avatarKey?: string | null;
  lastSeenAt?: string | null;
}

// Ce que GET /api/admin/members dit : les membres actifs, avec leur adresse et leur rôle.
const ADA: Member = { id: 'ada', name: 'Ada', email: 'ada@x.fr', role: 'admin' };
const BOB: Member = { id: 'bob', name: 'Bob', email: 'bob@x.fr', role: 'member' };
const CLEO: Member = { id: 'cleo', name: 'Cléo', email: 'cleo@x.fr', role: 'admin' };
const NINA: Member = { id: 'nina', name: 'Nina', email: 'nina@x.fr', role: 'member' };
const MEMBERS = [ADA, BOB, CLEO];

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Ce que GET /api/admin/invitations dit d'une invitation en attente (admin-routes.ts, `listed`). Son lien vit encore presque sept jours,
// sauf si elle est expirée.
const invitation = (id: string, email: string, over: Partial<{ role: Role; expired: boolean; expiresAt: string }> = {}) => ({
  id,
  email,
  role: 'member' as Role,
  invitedBy: 'ada',
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + (over.expired ? -DAY : INVITATION_TTL_MS - 60_000)).toISOString(),
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

type User = ReturnType<typeof userEvent.setup>;
type Tab = 'members' | 'invitations';

interface Options {
  selfId?: string;
  onClose?: () => void;
  // Le mode d'envoi du serveur (GET /api/config, que lit OfficeShell) : absent tant qu'il est inconnu.
  mail?: MailMode | null;
  // L'onglet à ouvrir, une fois les listes arrivées (Membres par défaut).
  tab?: Tab;
}

function renderPanel({ selfId = ADA.id, onClose = () => {}, mail }: Options = {}) {
  return render(<AdminPanel id="panneau-admin" selfId={selfId} mail={mail} onClose={onClose} />);
}

const panel = () => screen.getByRole('complementary', { name: fr.admin.title });
// Un onglet, par son libellé (le nombre de sa liste le suit, une fois qu'elle est là).
const tab = (which: Tab) => within(panel()).getByRole('tab', { name: new RegExp(`^${fr.admin.tabs[which]}`) });
const tabpanel = () => within(panel()).getByRole('tabpanel');
// La liste d'un onglet, même quand l'autre est ouvert (elle reste montée, cachée).
const listOf = (which: Tab) => panel().querySelector<HTMLElement>(`[data-list="${which}"]`)!;
const membersSection = () => listOf('members');
const pendingSection = () => listOf('invitations');

// Les deux listes arrivées : leur nombre suit le libellé de leur onglet.
async function listsArrived() {
  await screen.findByRole('tab', { name: /^Membres \d+$/ });
  await screen.findByRole('tab', { name: /^Invitations \d+$/ });
}

async function openPanel(options: Options = {}) {
  const view = renderPanel(options);
  await listsArrived();
  if (options.tab === 'invitations') fireEvent.click(tab('invitations'));
  return view;
}

// Le panneau, avec un bouton à côté, hors de lui (la page, le Chat…) : là où le focus peut passer pendant qu'une réponse se fait attendre.
async function openPanelBeside(options: Options = {}) {
  const { selfId = ADA.id, onClose = () => {}, mail } = options;
  render(
    <>
      <button type="button">Dehors</button>
      <AdminPanel id="panneau-admin" selfId={selfId} mail={mail} onClose={onClose} />
    </>,
  );
  await listsArrived();
  if (options.tab === 'invitations') fireEvent.click(tab('invitations'));
  return screen.getByRole('button', { name: 'Dehors' });
}

// La carte du formulaire, que « Inviter » ouvre.
const inviteToggle = () => within(panel()).getByRole('button', { name: fr.admin.invite.toggle }) as HTMLButtonElement;
const inviteSection = () => within(panel()).getByRole('region', { name: fr.admin.invite.title });
const emailField = () => within(inviteSection()).getByLabelText(fr.admin.invite.email) as HTMLInputElement;
const roleRadio = (role: Role) => within(inviteSection()).getByRole('radio', { name: fr.admin.roles[role] });
const checkedRole = () => within(inviteSection()).getByRole('radio', { checked: true }).textContent;
// Le bouton du formulaire, sous l'un de ses libellés : avec e-mail (envoyer, envoi), sans e-mail (créer le lien, création).
const submitButton = () =>
  within(inviteSection()).getByRole('button', {
    name: new RegExp(`^(${[fr.admin.invite.submit, fr.admin.invite.submitting, fr.admin.invite.create, fr.admin.invite.creating].join('|')})$`),
  }) as HTMLButtonElement;

async function openInvite(user: User) {
  await user.click(inviteToggle());
  return inviteSection();
}

async function invite(user: User, email: string) {
  await user.clear(emailField());
  await user.type(emailField(), email);
  await user.click(submitButton());
}

const rowOf = (section: HTMLElement, text: string) => within(section).getByText(text).closest('li') as HTMLElement;
// Le bouton « … » d'une ligne, que son nom désigne (un membre, une adresse invitée), et son menu.
const actionsButton = (name: string) => within(panel()).getByRole('button', { name: t(fr.admin.actions, { name }) }) as HTMLButtonElement;
const menuOf = (name: string) => screen.getByRole('menu', { name: t(fr.admin.actions, { name }) });
async function openActions(user: User, name: string) {
  await user.click(actionsButton(name));
  return menuOf(name);
}
// Ouvre le menu d'une ligne et y choisit ce geste.
async function choose(user: User, name: string, item: string) {
  await user.click(within(await openActions(user, name)).getByRole('menuitem', { name: item }));
}
const remove = (user: User, name: string) => choose(user, name, fr.admin.members.remove);
const resend = (user: User, email: string) => choose(user, email, fr.admin.pending.resend);
// Sans e-mail, « Renvoyer l'invitation » devient « Nouveau lien » : rien n'est envoyé, un lien neuf est montré.
const renew = (user: User, email: string) => choose(user, email, fr.admin.pending.renew);
const revoke = (user: User, email: string) => choose(user, email, fr.admin.pending.revoke);
const dialog = () => screen.getByRole('alertdialog');
const dialogButton = (name: string) => within(dialog()).getByRole('button', { name }) as HTMLButtonElement;

// ---- Le panneau en général ---------------------------------------------------------------------------------------------------------

describe('le panneau', () => {
  test('la coque des autres panneaux, nommée « Admin » ; deux onglets avec leur nombre, Membres ouvert, et « Inviter »', async () => {
    serve({ invitations: [invitation('inv-nina', 'nina@x.fr')] });
    await openPanel();
    expect(panel().id).toBe('panneau-admin');
    expect(panel().classList.contains('drawer')).toBe(true);
    expect(screen.getByRole('heading', { level: 2, name: fr.admin.title })).toBeTruthy();
    expect(within(panel()).getAllByRole('tab').map((one) => one.textContent)).toEqual(['Membres 3', 'Invitations 1']);
    expect(tab('members').getAttribute('aria-selected')).toBe('true');
    expect(tabpanel().getAttribute('aria-labelledby')).toBe(tab('members').id);
    expect(inviteToggle().getAttribute('aria-expanded')).toBe('false');
    // Le formulaire attend « Inviter » : il n'est pas là d'emblée.
    expect(within(panel()).queryByRole('region', { name: fr.admin.invite.title })).toBeNull();
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
    await listsArrived();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.ui.close }));
  });

  test('les onglets : un clic montre l\'autre liste, et l\'onglet reprend son nom ; la liste cachée reste montée', async () => {
    const user = userEvent.setup();
    serve({ invitations: [invitation('inv-nina', 'nina@x.fr')] });
    await openPanel();
    expect(within(tabpanel()).getByText('bob@x.fr')).toBeTruthy();
    expect(pendingSection().hidden).toBe(true);

    await user.click(tab('invitations'));
    expect(tab('invitations').getAttribute('aria-selected')).toBe('true');
    expect(tabpanel().getAttribute('aria-labelledby')).toBe(tab('invitations').id);
    expect(pendingSection().hidden).toBe(false);
    expect(membersSection().hidden).toBe(true);
    expect(within(pendingSection()).getByText('nina@x.fr')).toBeTruthy();
  });

  test('le bouton Fermer, et Échap, appellent onClose ; Échap pendant une composition (touche morte) l\'annule seulement', async () => {
    serve();
    const user = userEvent.setup();
    const onClose = vi.fn();
    await openPanel({ onClose });

    await user.click(screen.getByRole('button', { name: fr.ui.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(tab('members'), { key: 'Escape', isComposing: true });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('en attendant les listes : des lignes grises (« Chargement… » pour les lecteurs d\'écran), l\'onglet est aria-busy ; puis les listes', async () => {
    const user = userEvent.setup();
    const members = deferred<Response>();
    const invitations = deferred<Response>();
    fakeApi({ 'GET /api/admin/members': () => members.promise, 'GET /api/admin/invitations': () => invitations.promise });
    renderPanel();
    expect(within(membersSection()).getByText(fr.common.loading).className).toBe('visually-hidden');
    expect(membersSection().querySelectorAll('.admin-skeleton-row')).toHaveLength(3);
    expect(tabpanel().getAttribute('aria-busy')).toBe('true');
    expect(within(pendingSection()).getByText(fr.common.loading)).toBeTruthy();

    invitations.resolve(json(200, []));
    await user.click(await screen.findByRole('tab', { name: 'Invitations 0' }));
    expect(within(pendingSection()).getByText(fr.admin.pending.empty)).toBeTruthy();
    expect(within(membersSection()).getByText(fr.common.loading)).toBeTruthy();
    members.resolve(json(200, MEMBERS));
    expect(await within(membersSection()).findByText('bob@x.fr')).toBeTruthy();
    expect(screen.queryByText(fr.common.loading)).toBeNull();
    expect(tabpanel().hasAttribute('aria-busy')).toBe(false);
  });

  test.each([
    ['le serveur est injoignable', () => { throw new TypeError('Failed to fetch'); }],
    ['la session a expiré (401)', () => json(401, { error: 'unauthorized' })],
    ['erreur du serveur (500)', () => json(500, { error: 'internal' })],
  ])('les membres ne se chargent pas (%s) : un message et « Réessayer » dans leur onglet, les invitations s\'affichent ; réessayer recharge', async (_case, failure) => {
    const user = userEvent.setup();
    let fail = true;
    fakeApi({
      'GET /api/admin/members': () => (fail ? failure() : json(200, MEMBERS)),
      'GET /api/admin/invitations': () => json(200, [invitation('inv-nina', 'nina@x.fr')]),
    });
    renderPanel();

    expect((await within(membersSection()).findByRole('alert')).textContent).toBe(fr.admin.members.loadFailed);
    expect(await within(pendingSection()).findByText('nina@x.fr')).toBeTruthy();
    expect(pendingSection().querySelector('[role="alert"]')).toBeNull();

    fail = false;
    await user.click(within(membersSection()).getByRole('button', { name: fr.common.retry }));
    expect(await within(membersSection()).findByText('bob@x.fr')).toBeTruthy();
    expect(within(membersSection()).queryByRole('alert')).toBeNull();
  });

  test('les invitations ne se chargent pas : un message et « Réessayer » dans leur onglet, les membres s\'affichent', async () => {
    const user = userEvent.setup();
    let fail = true;
    fakeApi({
      'GET /api/admin/members': () => json(200, MEMBERS),
      'GET /api/admin/invitations': () => (fail ? json(500, { error: 'internal' }) : json(200, [])),
    });
    renderPanel();
    expect(await within(membersSection()).findByText('bob@x.fr')).toBeTruthy();
    await user.click(tab('invitations'));

    expect((await within(pendingSection()).findByRole('alert')).textContent).toBe(fr.admin.pending.loadFailed);
    fail = false;
    await user.click(within(pendingSection()).getByRole('button', { name: fr.common.retry }));
    expect(await within(pendingSection()).findByText(fr.admin.pending.empty)).toBeTruthy();
    expect(within(pendingSection()).queryByRole('alert')).toBeNull();
  });

  // « Réessayer » disparaît au clic (le squelette le remplace) : le focus irait au haut de la page.
  test.each([
    ['les membres', 'members', 'Membres 3'],
    ['les invitations', 'invitations', 'Invitations 0'],
  ] as const)('« Réessayer » (%s) : le focus passe à l\'onglet, qui le garde quand la liste arrive', async (_list, which, name) => {
    const user = userEvent.setup();
    let fail = true;
    fakeApi({
      'GET /api/admin/members': () => (which === 'members' && fail ? json(500, { error: 'internal' }) : json(200, MEMBERS)),
      'GET /api/admin/invitations': () => (which === 'invitations' && fail ? json(500, { error: 'internal' }) : json(200, [])),
    });
    renderPanel();
    await screen.findByRole('tab', { name: which === 'members' ? /^Invitations \d/ : /^Membres \d/ });
    if (which === 'invitations') await user.click(tab('invitations'));
    const retry = await within(listOf(which)).findByRole('button', { name: fr.common.retry });

    fail = false;
    await user.click(retry);
    expect(document.activeElement).toBe(tabpanel());
    await screen.findByRole('tab', { name });
    expect(document.activeElement).toBe(tabpanel());
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
    await screen.findByRole('tab', { name: 'Membres 3' });
    // La première réponse, plus lente, ne remet pas la liste à jour avec du plus ancien.
    await act(async () => first.resolve(json(200, [ADA])));
    expect(screen.getByRole('tab', { name: 'Membres 3' })).toBeTruthy();
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

  test('« Inviter » ouvre la carte du formulaire et met le focus dans l\'adresse ; sa croix, « Inviter » et Échap la ferment, et rendent le focus à « Inviter »', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    serve();
    await openPanel({ onClose });

    const card = await openInvite(user);
    expect(inviteToggle().getAttribute('aria-expanded')).toBe('true');
    expect(inviteToggle().getAttribute('aria-controls')).toBe(card.id);
    expect(document.activeElement).toBe(emailField());

    // Échap dans la carte la ferme, sans fermer le panneau ; une seconde fois, il ferme le panneau.
    await user.keyboard('{Escape}');
    expect(within(panel()).queryByRole('region', { name: fr.admin.invite.title })).toBeNull();
    expect(document.activeElement).toBe(inviteToggle());
    expect(onClose).not.toHaveBeenCalled();

    await openInvite(user);
    await user.click(within(inviteSection()).getByRole('button', { name: fr.admin.invite.close }));
    expect(within(panel()).queryByRole('region', { name: fr.admin.invite.title })).toBeNull();
    expect(document.activeElement).toBe(inviteToggle());

    await openInvite(user);
    await user.click(inviteToggle());
    expect(within(panel()).queryByRole('region', { name: fr.admin.invite.title })).toBeNull();
    // Dans une composition (touche morte), Échap l'annule seulement.
    await openInvite(user);
    fireEvent.keyDown(emailField(), { key: 'Escape', isComposing: true });
    expect(inviteSection()).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('invitation : POST puis rafraîchissement de la liste ; 409 already_invited affiché', async () => {
    const user = userEvent.setup();
    const { api } = serve({}, postInvitation);
    await openPanel();
    await openInvite(user);

    await invite(user, 'nina@x.fr');

    // La demande part avec l'adresse et le rôle, puis la liste est relue : l'invitation y est, et l'onglet la compte.
    expect(await within(pendingSection()).findByText('nina@x.fr')).toBeTruthy();
    expect(bodiesOf(api, 'POST /api/admin/invitations')).toEqual([{ email: 'nina@x.fr', role: 'member' }]);
    expect(routesOf(api).slice(-2)).toEqual(['POST /api/admin/invitations', 'GET /api/admin/invitations']);
    expect(within(panel()).getByRole('tab', { name: 'Invitations 1' })).toBeTruthy();
    // Le serveur a accepté : le message le dit, le champ est vidé, la carte reste ouverte pour enchaîner.
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

  test('le rôle est « Membre » par défaut, et on peut inviter un admin ; les flèches passent de l\'un à l\'autre sans faire marcher l\'avatar', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      const { api } = serve({}, postInvitation);
      await openPanel();
      await openInvite(user);

      expect(checkedRole()).toBe(fr.admin.roles.member);
      expect(within(inviteSection()).getAllByRole('radio').map((radio) => radio.textContent)).toEqual([fr.admin.roles.member, fr.admin.roles.admin]);
      expect(within(inviteSection()).getByRole('radiogroup', { name: fr.admin.invite.role })).toBeTruthy();
      // Au clavier : le choisi seul est dans l'ordre de tabulation, et → choisit l'autre (sans que l'avatar ne le voie).
      expect(roleRadio('member').tabIndex).toBe(0);
      expect(roleRadio('admin').tabIndex).toBe(-1);
      roleRadio('member').focus();
      await user.keyboard('{ArrowRight>}');
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowRight}');
      expect(checkedRole()).toBe(fr.admin.roles.admin);
      expect(document.activeElement).toBe(roleRadio('admin'));
      await user.keyboard('{Home}');
      expect(checkedRole()).toBe(fr.admin.roles.member);

      await user.type(emailField(), 'nina@x.fr');
      await user.click(roleRadio('admin'));
      await user.click(submitButton());
      expect(await within(pendingSection()).findByText('nina@x.fr')).toBeTruthy();
      expect(bodiesOf(api, 'POST /api/admin/invitations')).toEqual([{ email: 'nina@x.fr', role: 'admin' }]);
      // Une invitation d'admin ne se répète pas par inadvertance : le formulaire revient à son état de départ.
      expect(checkedRole()).toBe(fr.admin.roles.member);
    } finally {
      unbind();
    }
  });

  // Un lecteur d'écran n'annonce que ce qui paraît dans une région qui existait déjà : « Invitation envoyée » s'écrit dans la même.
  test('le message de réussite s\'écrit dans une région role="status" qui existait déjà, vide', async () => {
    const user = userEvent.setup();
    serve({}, postInvitation);
    await openPanel();
    await openInvite(user);
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
    await openInvite(user);
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
    await openInvite(user);
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
      await openInvite(user);
      await user.type(emailField(), 'nina@x.fr');
      await user.click(submitButton());
      await remove(user, 'Bob');
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
      await openInvite(user);
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
      await openInvite(user);
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
      await openInvite(user);
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
      await openInvite(user);
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
    await openInvite(user);
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
    await openInvite(user);
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
  ])('refus (%s) : le message est affiché, l\'adresse et le rôle restent dans le formulaire', async (_case, status, body, message) => {
    const user = userEvent.setup();
    serve({}, () => ({ 'POST /api/admin/invitations': () => (body === undefined ? new Response('Bad Gateway', { status }) : json(status, body)) }));
    await openPanel();
    await openInvite(user);
    await user.type(emailField(), 'nina@x.fr');
    await user.click(roleRadio('admin'));
    await user.click(submitButton());

    expect((await within(inviteSection()).findByRole('alert')).textContent).toBe(message);
    expect(emailField().value).toBe('nina@x.fr');
    expect(checkedRole()).toBe(fr.admin.roles.admin);
    expect(submitButton().disabled).toBe(false);
    expect(document.activeElement).toBe(emailField());
  });

  test('serveur injoignable : le message réseau, l\'adresse reste', async () => {
    const user = userEvent.setup();
    serve({}, () => ({ 'POST /api/admin/invitations': () => { throw new TypeError('Failed to fetch'); } }));
    await openPanel();
    await openInvite(user);
    await user.type(emailField(), 'nina@x.fr');
    await user.click(submitButton());
    expect((await within(inviteSection()).findByRole('alert')).textContent).toBe(fr.common.errors.network);
    expect(emailField().value).toBe('nina@x.fr');
  });

  // L'e-mail n'est pas parti, mais l'invitation existe (admin-routes.ts) : la liste doit la montrer, avec « Renvoyer l'invitation ».
  test('l\'e-mail n\'est pas parti (502) : le message le dit, l\'adresse reste, et l\'invitation gardée apparaît dans la liste', async () => {
    const user = userEvent.setup();
    serve({}, (state) => ({
      'POST /api/admin/invitations': () => {
        state.invitations = [invitation('inv-nina', 'nina@x.fr')];
        return json(502, { error: 'mail_failed' });
      },
    }));
    await openPanel();
    await openInvite(user);
    await invite(user, 'nina@x.fr');

    expect((await within(inviteSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.mailFailed);
    expect(emailField().value).toBe('nina@x.fr');
    expect(await within(pendingSection()).findByText('nina@x.fr')).toBeTruthy();
    await user.click(tab('invitations'));
    expect(within(await openActions(user, 'nina@x.fr')).getByRole('menuitem', { name: fr.admin.pending.resend })).toBeTruthy();
  });

  test('retaper l\'adresse efface le message d\'avant, refus ou invitation envoyée : il parlait de l\'adresse d\'avant', async () => {
    const user = userEvent.setup();
    serve({}, postInvitation);
    await openPanel();
    await openInvite(user);
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
    await openInvite(user);
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

  test('chaque invitation : l\'adresse, le rôle, ce qu\'il reste à son lien (ou « Expirée »), et son menu « … » : Renvoyer, Annuler', async () => {
    const user = userEvent.setup();
    serve({ invitations: PENDING });
    await openPanel({ tab: 'invitations' });
    expect(within(pendingSection()).getAllByRole('listitem')).toHaveLength(2);

    const nina = rowOf(pendingSection(), 'nina@x.fr');
    expect(nina.textContent).toContain(fr.admin.roles.member);
    expect(nina.textContent).toContain(t(fr.admin.pending.expiresInDays, { count: 7 }));
    expect(nina.hasAttribute('data-expired')).toBe(false);
    const old = rowOf(pendingSection(), 'old@x.fr');
    expect(old.textContent).toContain(fr.admin.roles.admin);
    expect(old.textContent).toContain(fr.admin.pending.expired);
    expect(old.getAttribute('data-expired')).toBe('true');

    // Une ligne n'a qu'un bouton, « … », dont le nom dit pour qui il agit ; ses gestes sont dans son menu.
    for (const [row, email] of [[nina, 'nina@x.fr'], [old, 'old@x.fr']] as const) {
      expect(within(row).getAllByRole('button')).toEqual([actionsButton(email)]);
      expect(actionsButton(email).getAttribute('aria-haspopup')).toBe('menu');
    }
    const menu = await openActions(user, 'old@x.fr');
    expect(actionsButton('old@x.fr').getAttribute('aria-expanded')).toBe('true');
    expect(actionsButton('old@x.fr').getAttribute('aria-controls')).toBe(menu.id);
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([fr.admin.pending.resend, fr.admin.pending.revoke]);
  });

  test('ce qu\'il reste au lien : en jours, puis un jour, puis en heures, puis moins d\'une heure ; sans date, rien', async () => {
    const now = Date.now();
    const at = (left: number) => new Date(now + left).toISOString();
    serve({
      invitations: [
        invitation('a', 'a@x.fr', { expiresAt: at(3 * DAY + 2 * HOUR) }),
        invitation('b', 'b@x.fr', { expiresAt: at(DAY + 5 * HOUR) }),
        invitation('c', 'c@x.fr', { expiresAt: at(5 * HOUR + 10 * 60_000) }),
        invitation('d', 'd@x.fr', { expiresAt: at(20 * 60_000) }),
        { ...invitation('e', 'e@x.fr'), expiresAt: undefined as unknown as string },
        // Le serveur la disait encore valable, mais sa date est passée (l'horloge de la page avance sur la sienne).
        invitation('f', 'f@x.fr', { expiresAt: at(-5 * 60_000) }),
      ],
    });
    await openPanel({ tab: 'invitations' });
    const sub = (email: string) => rowOf(pendingSection(), email).querySelector('.admin-row-sub')?.textContent ?? null;
    expect(sub('a@x.fr')).toBe('Expire dans 3 jours');
    expect(sub('b@x.fr')).toBe('Expire dans 1 jour');
    expect(sub('c@x.fr')).toBe('Expire dans 5 h');
    expect(sub('d@x.fr')).toBe('Expire dans moins d\'une heure');
    expect(rowOf(pendingSection(), 'd@x.fr').hasAttribute('data-expired')).toBe(false);
    expect(sub('e@x.fr')).toBeNull();
    expect(sub('f@x.fr')).toBe(fr.admin.pending.expired);
    expect(rowOf(pendingSection(), 'f@x.fr').getAttribute('data-expired')).toBe('true');
  });

  test('le panneau resté ouvert voit le temps passer : chaque minute, ce qu\'il reste est relu, jusqu\'à « Expirée »', async () => {
    const NOW = Date.parse('2026-10-29T10:00:00Z');
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    try {
      serve({ invitations: [invitation('d', 'd@x.fr', { expiresAt: new Date(NOW + 90_000).toISOString() })] });
      await openPanel({ tab: 'invitations' });
      const row = () => rowOf(pendingSection(), 'd@x.fr');
      expect(row().textContent).toContain(fr.admin.pending.expiresSoon);

      // Comme pour « Il y a … » (PeoplePanel.test.tsx) : l'horloge n'est branchée qu'après les effets, qu'on laisse finir.
      await act(async () => {});
      act(() => vi.advanceTimersByTime(2 * 60_000));
      expect(row().textContent).toContain(fr.admin.pending.expired);
      expect(row().getAttribute('data-expired')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  test('une adresse trop longue est coupée à l\'écran, et son infobulle la donne entière', async () => {
    const long = `${'a'.repeat(60)}@exemple-tres-long.fr`;
    serve({ invitations: [invitation('inv-long', long)] });
    await openPanel({ tab: 'invitations' });
    expect(within(pendingSection()).getByText(long).getAttribute('title')).toBe(long);
  });

  test('aucune invitation en attente : une icône, une phrase et ce qui arrive ici ; pas de liste', async () => {
    serve();
    await openPanel({ tab: 'invitations' });
    expect(within(pendingSection()).getByText(fr.admin.pending.empty)).toBeTruthy();
    expect(within(pendingSection()).getByText(fr.admin.pending.emptyHint)).toBeTruthy();
    expect(pendingSection().querySelector('.admin-empty-icon svg')).toBeTruthy();
    expect(within(pendingSection()).queryByRole('list')).toBeNull();
    expect(within(panel()).getByRole('tab', { name: 'Invitations 0' })).toBeTruthy();
  });

  test('Renvoyer : POST …/resend, la liste est relue ; une invitation expirée ne l\'est plus, et le message le dit', async () => {
    const user = userEvent.setup();
    const { api } = serve({ invitations: PENDING }, (state) => ({
      'POST /api/admin/invitations/inv-old/resend': () => {
        state.invitations = state.invitations.map((pending) => (pending.id === 'inv-old' ? invitation('inv-old', 'old@x.fr', { role: 'admin' }) : pending));
        return json(200, { ok: true });
      },
    }));
    await openPanel({ tab: 'invitations' });
    expect(rowOf(pendingSection(), 'old@x.fr').textContent).toContain(fr.admin.pending.expired);

    await resend(user, 'old@x.fr');

    expect(await within(pendingSection()).findByText(t(fr.admin.pending.resent, { email: 'old@x.fr' }))).toBeTruthy();
    expect(routesOf(api).slice(-2)).toEqual(['POST /api/admin/invitations/inv-old/resend', 'GET /api/admin/invitations']);
    await waitFor(() => expect(rowOf(pendingSection(), 'old@x.fr').textContent).not.toContain(fr.admin.pending.expired));
    // Pas de corps : la route ne lit rien. Le menu s'est fermé, et le focus est sur le bouton « … » de la ligne.
    expect(api.mock.calls.find(([input]) => String(input).endsWith('/resend'))?.[1]?.body).toBeUndefined();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(actionsButton('old@x.fr'));
  });

  test('Annuler : DELETE de l\'invitation, la liste est relue, l\'invitation n\'y est plus ; le focus va à l\'onglet', async () => {
    const user = userEvent.setup();
    const { api } = serve({ invitations: PENDING }, (state) => ({
      'DELETE /api/admin/invitations/inv-nina': () => {
        state.invitations = state.invitations.filter((pending) => pending.id !== 'inv-nina');
        return json(200, { ok: true });
      },
    }));
    await openPanel({ tab: 'invitations' });

    await revoke(user, 'nina@x.fr');

    await waitFor(() => expect(within(pendingSection()).queryByText('nina@x.fr')).toBeNull());
    expect(routesOf(api).slice(-2)).toEqual(['DELETE /api/admin/invitations/inv-nina', 'GET /api/admin/invitations']);
    expect(within(pendingSection()).getByText(t(fr.admin.pending.revoked, { email: 'nina@x.fr' }))).toBeTruthy();
    expect(within(pendingSection()).getByText('old@x.fr')).toBeTruthy();
    expect(within(panel()).getByRole('tab', { name: 'Invitations 1' })).toBeTruthy();
    // La ligne n'existe plus : le focus va à l'onglet, d'où la lecture continue.
    expect(document.activeElement).toBe(tabpanel());
  });

  // « Inactif » par aria-disabled et non par `disabled` : un bouton qui devient `disabled` perd le focus, et la personne au clavier
  // se retrouverait en haut de la page.
  test('pendant une action : les boutons « … » de la liste sont inactifs (aria-disabled), le focus reste sur celui qu\'on a pris, et une seule demande part', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    const { api } = serve({ invitations: PENDING }, () => ({ 'POST /api/admin/invitations/inv-nina/resend': () => reply.promise }));
    await openPanel({ tab: 'invitations' });
    await resend(user, 'nina@x.fr');

    for (const button of within(pendingSection()).getAllByRole('button')) expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(actionsButton('nina@x.fr'));
    // Entrée sur le même bouton, un clic sur celui d'une autre ligne : aucun menu ne s'ouvre, rien de plus ne part.
    await user.keyboard('{Enter}');
    fireEvent.click(actionsButton('old@x.fr'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(routesOf(api).filter((route) => route.startsWith('POST') || route.startsWith('DELETE'))).toEqual(['POST /api/admin/invitations/inv-nina/resend']);

    await act(async () => reply.resolve(json(200, { ok: true })));
    await waitFor(() => expect(actionsButton('nina@x.fr').hasAttribute('aria-disabled')).toBe(false));
    expect(document.activeElement).toBe(actionsButton('nina@x.fr'));
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
    const outside = await openPanelBeside({ tab: 'invitations' });
    await revoke(user, 'nina@x.fr');
    outside.focus();

    await act(async () => reply.resolve(json(200, { ok: true })));
    await waitFor(() => expect(within(pendingSection()).queryByText('nina@x.fr')).toBeNull());
    expect(document.activeElement).toBe(outside);
  });

  test('renvoyer : l\'e-mail n\'est pas parti (502) → le message le dit, l\'invitation est gardée', async () => {
    const user = userEvent.setup();
    serve({ invitations: PENDING }, () => ({ 'POST /api/admin/invitations/inv-nina/resend': () => json(502, { error: 'mail_failed' }) }));
    await openPanel({ tab: 'invitations' });
    await resend(user, 'nina@x.fr');
    expect((await within(pendingSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.mailFailed);
    expect(within(pendingSection()).getByText('nina@x.fr')).toBeTruthy();
    await waitFor(() => expect(actionsButton('nina@x.fr').hasAttribute('aria-disabled')).toBe(false));
  });

  // Acceptée ou annulée par un autre admin entre-temps : le serveur répond 404 (« l'annulation n'a rien empêché »). Une invitation acceptée
  // est un nouveau membre : les deux listes sont relues.
  test.each([
    ['renvoyer', 'POST', '/resend', resend],
    ['annuler', 'DELETE', '', revoke],
  ] as const)('%s une invitation qui n\'est plus en attente (404) : le message le dit, et les deux listes sont relues', async (_action, method, suffix, gesture) => {
    const user = userEvent.setup();
    const { api, state } = serve({ invitations: PENDING }, (world) => ({
      [`${method} /api/admin/invitations/inv-nina${suffix}`]: () => {
        // Nina vient d'accepter : plus d'invitation, un membre de plus.
        world.invitations = world.invitations.filter((pending) => pending.id !== 'inv-nina');
        world.members = [...world.members, NINA];
        return json(404, { error: 'not_found' });
      },
    }));
    await openPanel({ tab: 'invitations' });
    await gesture(user, 'nina@x.fr');

    expect((await within(pendingSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.notFoundInvitation);
    await waitFor(() => expect(within(pendingSection()).queryByText('nina@x.fr')).toBeNull());
    await within(membersSection()).findByText('nina@x.fr');
    expect(countOf(api, 'GET /api/admin/invitations')).toBe(2);
    expect(countOf(api, 'GET /api/admin/members')).toBe(2);
    expect(state.members).toContain(NINA);
    expect(within(panel()).getByRole('tab', { name: 'Membres 4' })).toBeTruthy();
    expect(document.activeElement).toBe(tabpanel());
  });

  test('serveur injoignable : le message réseau', async () => {
    const user = userEvent.setup();
    serve({ invitations: PENDING }, () => ({ 'DELETE /api/admin/invitations/inv-nina': () => { throw new TypeError('Failed to fetch'); } }));
    await openPanel({ tab: 'invitations' });
    await revoke(user, 'nina@x.fr');
    expect((await within(pendingSection()).findByRole('alert')).textContent).toBe(fr.common.errors.network);
  });

  test('l\'action suivante efface le message de la précédente', async () => {
    const user = userEvent.setup();
    let calls = 0;
    serve({ invitations: PENDING }, () => ({
      'POST /api/admin/invitations/inv-nina/resend': () => (calls++ === 0 ? json(502, { error: 'mail_failed' }) : json(200, { ok: true })),
    }));
    await openPanel({ tab: 'invitations' });
    await resend(user, 'nina@x.fr');
    await within(pendingSection()).findByRole('alert');
    await waitFor(() => expect(actionsButton('nina@x.fr').hasAttribute('aria-disabled')).toBe(false));
    await resend(user, 'nina@x.fr');
    await within(pendingSection()).findByText(t(fr.admin.pending.resent, { email: 'nina@x.fr' }));
    expect(within(pendingSection()).queryByRole('alert')).toBeNull();
  });
});

// ---- Le menu « … » d'une ligne -----------------------------------------------------------------------------------------------------

describe('le menu « … » d\'une ligne', () => {
  test('au clavier : Entrée l\'ouvre et met le focus sur la première ligne, ↑ ↓ y circulent, Échap le ferme (pas le panneau) et rend le focus au bouton', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    serve();
    await openPanel({ mail: 'none', onClose });
    actionsButton('Bob').focus();
    await user.keyboard('{Enter}');
    const menu = menuOf('Bob');
    const [password, removal] = within(menu).getAllByRole('menuitem');
    expect(document.activeElement).toBe(password);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(removal);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(password);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(removal);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(actionsButton('Bob'));
    expect(actionsButton('Bob').getAttribute('aria-expanded')).toBe('false');
    expect(onClose).not.toHaveBeenCalled();
  });

  test('ses flèches ne font pas marcher l\'avatar ; Tab le ferme, et un clic ailleurs aussi', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      serve();
      await openPanel({ mail: 'none' });
      await openActions(user, 'Bob');
      await user.keyboard('{ArrowDown>}');
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowDown}');

      await user.tab();
      expect(screen.queryByRole('menu')).toBeNull();

      await openActions(user, 'Bob');
      await user.click(tab('members'));
      expect(screen.queryByRole('menu')).toBeNull();
      // Le bouton « … » ouvre et ferme son menu.
      await openActions(user, 'Bob');
      await user.click(actionsButton('Bob'));
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      unbind();
    }
  });

  test('la liste qui défile ferme le menu (il est posé à la page, son bouton partirait sans lui) ; le focus revient au bouton', async () => {
    const user = userEvent.setup();
    serve();
    await openPanel({ mail: 'none' });
    const menu = await openActions(user, 'Bob');
    expect(menu.contains(document.activeElement)).toBe(true);

    const scroller = panel().querySelector('.admin-scroll')!;
    fireEvent.scroll(scroller);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(actionsButton('Bob').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(actionsButton('Bob'));

    // Le menu suivant s'ouvre comme avant, et ne se ferme que si la liste défile de nouveau.
    await openActions(user, 'Cléo');
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.scroll(scroller);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// ---- Membres -----------------------------------------------------------------------------------------------------------------------

describe('membres', () => {
  test('chaque membre : son nom, son adresse et son rôle ; soi-même est « (toi) », sans menu ; les autres ont le leur', async () => {
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
    expect(within(bob).getAllByRole('button')).toEqual([actionsButton('Bob')]);
    // Un autre admin se retire comme les autres.
    expect(actionsButton('Cléo')).toBeTruthy();
  });

  test('sa présence : soi-même et qui est au bureau sont « En ligne » (avec le point de leur statut) ; les autres, leur dernière visite, ou aucune', async () => {
    serve({
      members: [
        ADA,
        BOB,
        { ...CLEO, lastSeenAt: new Date(Date.now() - 3 * HOUR - 60_000).toISOString() },
        { ...NINA, lastSeenAt: null },
      ],
    });
    act(() => store().upsertPlayer({ ...player('bob', 'Bob'), status: 'busy' }));
    await openPanel();
    const seen = (name: string) => rowOf(membersSection(), name).querySelector('.admin-row-seen')?.textContent;

    expect(seen('Ada')).toBe(fr.admin.members.online);
    expect(seen('Bob')).toBe(fr.admin.members.online);
    expect(rowOf(membersSection(), 'Bob').getAttribute('data-online')).toBe('true');
    expect(rowOf(membersSection(), 'Bob').querySelector('.portrait-dot')?.getAttribute('data-status')).toBe('busy');
    expect(seen('Cléo')).toBe(`${fr.office.people.lastSeen} Il y a 3 h`);
    expect(rowOf(membersSection(), 'Cléo').hasAttribute('data-online')).toBe(false);
    expect(rowOf(membersSection(), 'Cléo').querySelector('.portrait-dot')).toBeNull();
    expect(seen('Nina')).toBe(fr.admin.members.neverSeen);
  });

  test('le point du portrait prend la couleur de l\'état d\'activité en cours (le sien, celui des autres), et reprend celle du statut sans état', async () => {
    const PINK = /^(#ec4899|rgb\(236, 72, 153\))$/i;
    const PURPLE = /^(#8b5cf6|rgb\(139, 92, 246\))$/i;
    const pink = { id: 'rose', label: 'En pause', color: '#ec4899', allowEntry: true, hear: true, heard: true };
    serve();
    act(() => {
      useOfficeStore.setState({ self: { ...player('ada', 'Ada'), activity: { id: 'focus', label: 'En focus', color: '#8b5cf6', allowEntry: false, hear: false, heard: false } } });
      store().upsertPlayer({ ...player('bob', 'Bob'), activity: pink });
    });
    await openPanel();
    const dot = (name: string) => rowOf(membersSection(), name).querySelector('.portrait-dot') as HTMLElement;

    expect(dot('Bob').style.backgroundColor).toMatch(PINK);
    expect(dot('Bob').getAttribute('data-activity')).toBe('rose');
    // Le statut ordinaire reste dit par data-status.
    expect(dot('Bob').getAttribute('data-status')).toBe('available');
    expect(dot('Ada').style.backgroundColor).toMatch(PURPLE);
    expect(dot('Ada').getAttribute('data-activity')).toBe('focus');

    // Bob quitte son état : le point reprend la couleur de son statut (celle de la feuille de style).
    act(() => store().setActivity('bob', null));
    expect(dot('Bob').style.backgroundColor).toBe('');
    expect(dot('Bob').hasAttribute('data-activity')).toBe(false);
  });

  test('un nom et une adresse trop longs sont coupés à l\'écran, et leur infobulle les donne entiers', async () => {
    const longName = 'Marie-Hélène de La Tour-Dupin-Gouvernet';
    const longEmail = `${'m'.repeat(50)}@exemple-tres-long.fr`;
    serve({ members: [ADA, { id: 'mh', name: longName, email: longEmail, role: 'member' }] });
    await openPanel();
    expect(within(membersSection()).getByText(longName).getAttribute('title')).toBe(longName);
    expect(within(membersSection()).getByText(longEmail).getAttribute('title')).toBe(longEmail);
  });

  test('plus de six membres : un champ de recherche, dans le nom et l\'adresse, sans accents ni majuscules ; Échap l\'efface, puis ferme le panneau', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const many = ['Dora', 'Élise', 'Farid', 'Gaëlle'].map((name, index) => ({ id: `m${index}`, name, email: `${name.toLowerCase()}@y.fr`, role: 'member' as Role }));
    serve({ members: [...MEMBERS, ...many] });
    await openPanel({ onClose });
    const search = within(membersSection()).getByRole('searchbox', { name: fr.admin.members.search });
    const names = () => within(membersSection()).getAllByRole('listitem').map((row) => row.querySelector('.admin-row-name')?.textContent);
    expect(names()).toHaveLength(7);

    await user.type(search, 'CLEO');
    expect(names()).toEqual(['Cléo']);
    await user.clear(search);
    await user.type(search, 'y.fr');
    expect(names()).toEqual(['Dora', 'Élise', 'Farid', 'Gaëlle']);
    await user.clear(search);
    await user.type(search, 'zz');
    expect(within(membersSection()).queryByRole('list')).toBeNull();
    expect(within(membersSection()).getByText(t(fr.admin.members.noMatch, { query: 'zz' }))).toBeTruthy();

    await user.keyboard('{Escape}');
    expect((search as HTMLInputElement).value).toBe('');
    expect(names()).toHaveLength(7);
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('six membres ou moins : pas de champ de recherche', async () => {
    serve();
    await openPanel();
    expect(within(membersSection()).queryByRole('searchbox')).toBeNull();
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

    await remove(user, 'Bob');
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
    await remove(user, 'Bob');
    await user.click(dialogButton(fr.admin.removal.confirm));
    await waitFor(() => expect(within(membersSection()).queryByText('Bob')).toBeNull());
    expect(routesOf(api).slice(-2)).toEqual(['DELETE /api/admin/members/bob', 'GET /api/admin/members']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(panel()).getByRole('tab', { name: 'Membres 2' })).toBeTruthy();
    expect(within(membersSection()).getByText(t(fr.admin.members.removed, { name: 'Bob' }))).toBeTruthy();
  });

  test('la boîte de dialogue est modale, nommée par la personne et décrite ; le focus est sur « Annuler », le geste sûr', async () => {
    const user = userEvent.setup();
    serve();
    await openPanel();
    await remove(user, 'Bob');

    const confirmation = dialog();
    expect(confirmation.getAttribute('aria-modal')).toBe('true');
    expect(confirmation.getAttribute('aria-labelledby')).toBe(within(confirmation).getByRole('heading', { name: 'Retirer Bob du bureau ?' }).id);
    expect(confirmation.getAttribute('aria-describedby')).toBe(within(confirmation).getByText(t(fr.admin.removal.body, { email: 'bob@x.fr' })).id);
    expect(document.activeElement).toBe(dialogButton(fr.admin.removal.cancel));
    expect(within(confirmation).getAllByRole('button').map((button) => button.textContent)).toEqual([fr.admin.removal.cancel, fr.admin.removal.confirm]);
  });

  test('Annuler et Échap la ferment sans rien envoyer, et le focus revient au bouton « … » du membre', async () => {
    const user = userEvent.setup();
    const { api } = serve();
    await openPanel();

    await remove(user, 'Bob');
    await user.click(dialogButton(fr.admin.removal.cancel));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(actionsButton('Bob'));

    await remove(user, 'Bob');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(actionsButton('Bob'));

    expect(routesOf(api).filter((route) => route.startsWith('DELETE'))).toEqual([]);
  });

  // Un double clic sur « Retirer » : le second clic tombe sur le fond, qui couvre la page. Il ne doit pas fermer la boîte à peine ouverte, ni
  // lui retirer le focus (Échap et Tab n'y arriveraient plus).
  test('un clic sur le fond ne ferme pas la boîte et ne lui retire pas le focus', async () => {
    const user = userEvent.setup();
    const { api } = serve();
    await openPanel();
    await remove(user, 'Bob');
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
    await remove(user, 'Bob');
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
    await remove(user, 'Bob');
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
      await remove(user, 'Bob');
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

  test('confirmer : « Retrait… » et boutons inactifs pendant la demande, Échap sans effet ; puis la boîte se ferme et le focus va à l\'onglet', async () => {
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
    await remove(user, 'Bob');
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
    // La ligne n'existe plus : le focus va à l'onglet, d'où la lecture continue.
    expect(document.activeElement).toBe(tabpanel());
  });

  // Soi-même n'a pas de menu, mais le serveur refuse aussi : ici, un panneau qui ne se reconnaît pas (selfId d'un autre compte).
  test.each([
    ['soi-même (400)', 400, { error: 'self' }, () => fr.admin.errors.self],
    ['le dernier admin (400)', 400, { error: 'last_admin' }, () => fr.admin.errors.lastAdmin],
    ['la session a expiré (401)', 401, { error: 'unauthorized' }, () => fr.admin.errors.unauthorized],
    ['plus admin (403)', 403, { error: 'forbidden' }, () => fr.admin.errors.forbidden],
    ['erreur du serveur (500)', 500, { error: 'internal' }, () => fr.common.errors.unexpected],
  ])('refus du serveur (%s) : le message est dans la liste, la boîte se ferme, le focus revient au bouton « … », la liste est intacte', async (_case, status, body, message) => {
    const user = userEvent.setup();
    serve({}, () => ({ 'DELETE /api/admin/members/ada': () => json(status, body) }));
    await openPanel({ selfId: 'quelqu-un-d-autre' });

    await remove(user, 'Ada');
    await user.click(dialogButton(fr.admin.removal.confirm));

    expect((await within(membersSection()).findByRole('alert')).textContent).toBe(message());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(actionsButton('Ada'));
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
    await remove(user, 'Bob');
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
    await remove(user, 'Bob');
    await user.click(dialogButton(fr.admin.removal.confirm));

    expect((await within(membersSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.notFoundMember);
    await waitFor(() => expect(within(membersSection()).queryByText('Bob')).toBeNull());
    expect(countOf(api, 'GET /api/admin/members')).toBe(2);
    expect(document.activeElement).toBe(tabpanel());
  });

  test('serveur injoignable : le message réseau, la boîte se ferme', async () => {
    const user = userEvent.setup();
    serve({}, () => ({ 'DELETE /api/admin/members/bob': () => { throw new TypeError('Failed to fetch'); } }));
    await openPanel();
    await remove(user, 'Bob');
    await user.click(dialogButton(fr.admin.removal.confirm));
    expect((await within(membersSection()).findByRole('alert')).textContent).toBe(fr.common.errors.network);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('un identifiant est encodé dans l\'adresse de la demande', async () => {
    const user = userEvent.setup();
    const odd = { id: 'a/b c', name: 'Zoé', email: 'zoe@x.fr', role: 'member' as Role };
    const { api } = serve({ members: [ADA, odd] }, () => ({ 'DELETE /api/admin/members/a%2Fb%20c': () => json(200, { ok: true }) }));
    await openPanel();
    await remove(user, 'Zoé');
    await user.click(dialogButton(fr.admin.removal.confirm));
    await waitFor(() => expect(countOf(api, 'DELETE /api/admin/members/a%2Fb%20c')).toBe(1));
  });
});

// ---- Quelqu'un de nouveau arrive en ligne ------------------------------------------------------------------------------------------

describe('quelqu\'un que les listes ne connaissent pas arrive en ligne', () => {
  function arrive(): void {
    act(() => store().applyInit({ self: player('ada', 'Ada'), players: [], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
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
    // Elle est là : sa ligne dit « En ligne ».
    expect(rowOf(membersSection(), 'Nina').getAttribute('data-online')).toBe('true');

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

// ---- Sans e-mail : des liens à transmettre ----------------------------------------------------------------------------------------

// Avec MAILER=none, rien ne part par e-mail : le serveur rend le lien (`link`) de l'invitation créée ou renvoyée, et celui d'un
// mot de passe. Le panneau le montre une fois, dans une boîte à copier (le ticket) : dans la carte du formulaire, ou en tête de l'onglet
// du geste qui l'a produit.
const LINK = 'https://bureau.exemple.fr/rejoindre?token=jeton-nina';
const OTHER_LINK = 'https://bureau.exemple.fr/rejoindre?token=jeton-tom';
const RESET_LINK = 'https://bureau.exemple.fr/api/auth/reset-password/jeton-bob?callbackURL=https%3A%2F%2Fbureau.exemple.fr%2Freinitialiser';
const DAYS = INVITATION_TTL_MS / DAY;

// Le presse-papiers du navigateur : `writeText` simulé, ou rien du tout (une page en http, hors localhost, n'a pas navigator.clipboard).
function stubClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
}

afterEach(() => {
  // Retire la propriété posée par stubClipboard : navigator retrouve celle de happy-dom.
  Reflect.deleteProperty(navigator, 'clipboard');
});

// La boîte d'une partie du panneau : le groupe nommé par la phrase qui la présente.
const boxIn = (section: HTMLElement, intro: string) => within(section).findByRole('group', { name: intro });
const noBoxIn = (section: HTMLElement) => expect(within(section).queryByRole('group')).toBeNull();
const fieldOf = (box: HTMLElement) => within(box).getByRole('textbox') as HTMLInputElement;
const copyOf = (box: HTMLElement) => within(box).getByRole('button', { name: fr.admin.link.copy }) as HTMLButtonElement;
const dismissOf = (box: HTMLElement) => within(box).getByRole('button', { name: fr.admin.link.dismiss }) as HTMLButtonElement;

describe('inviter sans e-mail', () => {
  const created = t(fr.admin.invite.created, { email: 'nina@x.fr' });

  // Le serveur répond 201 avec le corps d'avant et, en plus, `link`.
  const postWithLink = (links: Record<string, string>) => (state: World) => ({
    'POST /api/admin/invitations': (init: RequestInit | undefined) => {
      const body = JSON.parse(String(init?.body)) as { email: string; role: Role };
      if (state.invitations.some((pending) => pending.email === body.email)) return json(409, { error: 'already_invited' });
      const made = invitation(`inv-${body.email}`, body.email, { role: body.role });
      state.invitations = [made, ...state.invitations];
      return json(201, { ...made, link: links[body.email] });
    },
  });

  test('le serveur rend un lien : la boîte le montre, à copier, sous le formulaire, et ne dit pas qu\'un e-mail est parti', async () => {
    const user = userEvent.setup();
    const { api } = serve({}, postWithLink({ 'nina@x.fr': LINK }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    noBoxIn(inviteSection());

    await invite(user, 'nina@x.fr');
    const box = await boxIn(inviteSection(), created);

    // Le lien, dans un champ en lecture seule nommé par la phrase de la boîte.
    const field = within(box).getByRole('textbox', { name: created }) as HTMLInputElement;
    expect(field.value).toBe(LINK);
    expect(field.readOnly).toBe(true);
    expect(within(box).getByRole('button', { name: fr.admin.link.copy })).toBeTruthy();
    // Sept jours, et pas redonné : l'admin sait qu'il doit le transmettre maintenant, ou demander un nouveau lien.
    expect(within(box).getByText(t(fr.admin.invite.validity, { days: DAYS }))).toBeTruthy();
    expect(DAYS).toBe(7);
    expect(fr.admin.invite.validity).toMatch(/plus affiché/);
    // Sous le formulaire, pas dedans.
    const form = inviteSection().querySelector('form')!;
    expect(form.contains(box)).toBe(false);
    expect(form.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Rien n'est parti : le message d'un envoi ne s'affiche pas. Le champ est vidé, et la liste relue.
    expect(within(inviteSection()).queryByText(t(fr.admin.invite.sent, { email: 'nina@x.fr' }))).toBeNull();
    expect(emailField().value).toBe('');
    await within(pendingSection()).findByText('nina@x.fr');
    expect(routesOf(api).slice(-2)).toEqual(['POST /api/admin/invitations', 'GET /api/admin/invitations']);
  });

  // Un lecteur d'écran lit ce qui s'ajoute à une région vivante : seule la phrase de la boîte y paraît. Le lien (et son jeton), les
  // boutons et la durée de validité n'y sont pas : le focus, qui va sur « Copier le lien », les présente à qui le suit.
  test('la phrase de la boîte paraît dans une région vivante qui existait déjà, vide ; le lien et les boutons n\'y sont pas ; le focus va sur « Copier le lien »', async () => {
    const user = userEvent.setup();
    serve({}, postWithLink({ 'nina@x.fr': LINK }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    const live = inviteSection().querySelector('.admin-link > [aria-live="polite"]')!;
    expect(live.textContent).toBe('');

    await invite(user, 'nina@x.fr');
    const box = await boxIn(inviteSection(), created);
    expect(inviteSection().querySelector('.admin-link > [aria-live="polite"]')).toBe(live);   // la même région, qui existait avant la boîte
    expect(live.textContent).toBe(created);
    expect(live.contains(fieldOf(box))).toBe(false);
    expect(live.contains(copyOf(box))).toBe(false);
    expect(live.contains(dismissOf(box))).toBe(false);
    expect(live.textContent).not.toContain(LINK);
    expect(live.textContent).not.toContain('jeton-nina');
    expect(live.textContent).not.toContain(t(fr.admin.invite.validity, { days: DAYS }));
    // Aucune région vivante de la carte ne porte un champ ou un bouton, ni le lien.
    for (const region of inviteSection().querySelectorAll('[aria-live]')) {
      expect(region.querySelector('input, button')).toBeNull();
      expect(region.textContent).not.toContain('jeton-nina');
    }
    // Le message d'avant garde sa région role="status" à lui, vide : la boîte n'en prend pas la place.
    expect(within(inviteSection()).getByRole('status').textContent).toBe('');
    expect(document.activeElement).toBe(copyOf(box));
  });

  test('sans boîte, la région vivante de chaque partie est vide et le conteneur n\'est pas un groupe', async () => {
    const user = userEvent.setup();
    serve();
    await openPanel({ mail: 'none' });
    await openInvite(user);
    for (const section of [inviteSection(), pendingSection(), membersSection()]) {
      expect(section.querySelector('.admin-link > [aria-live="polite"]')?.textContent).toBe('');
      expect(section.querySelector('[role="group"]')).toBeNull();
    }
  });

  test('« Copier le lien » met le lien dans le presse-papiers, dit « Lien copié. », et le bouton montre une coche', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    serve({}, postWithLink({ 'nina@x.fr': LINK }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    await invite(user, 'nina@x.fr');
    const box = await boxIn(inviteSection(), created);
    stubClipboard(writeText);
    expect(within(box).queryByText(fr.admin.link.copied)).toBeNull();
    // « Lien copié. » s'écrit dans une région vivante déjà là, vide : un lecteur d'écran l'annonce.
    const feedback = box.querySelector('.admin-link-copied')!;
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(feedback.textContent).toBe('');

    await user.click(copyOf(box));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await within(box).findByText(fr.admin.link.copied)).toBe(feedback);
    expect(within(box).queryByText(fr.admin.link.selected)).toBeNull();
    expect(copyOf(box).classList.contains('is-accent')).toBe(true);
    // Le focus reste sur le bouton.
    expect(document.activeElement).toBe(copyOf(box));
  });

  test.each([
    ['le navigateur n\'a pas de presse-papiers (page en http)', () => stubClipboard(undefined)],
    ['le presse-papiers refuse (permission)', () => stubClipboard(vi.fn(async () => { throw new DOMException('refusé', 'NotAllowedError'); }))],
  ])('%s : le lien est sélectionné dans le champ, et la boîte dit de le copier soi-même', async (_name, arrange) => {
    const user = userEvent.setup();
    serve({}, postWithLink({ 'nina@x.fr': LINK }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    await invite(user, 'nina@x.fr');
    const box = await boxIn(inviteSection(), created);
    arrange();

    await user.click(copyOf(box));

    expect(await within(box).findByText(fr.admin.link.selected)).toBeTruthy();
    expect(within(box).queryByText(fr.admin.link.copied)).toBeNull();
    const field = fieldOf(box);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
  });

  test('le champ se sélectionne en entier quand on y met le focus', async () => {
    const user = userEvent.setup();
    serve({}, postWithLink({ 'nina@x.fr': LINK }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    await invite(user, 'nina@x.fr');
    const field = fieldOf(await boxIn(inviteSection(), created));
    await user.click(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
  });

  test('« Masquer le lien » ferme la boîte et rend le focus au champ de l\'adresse', async () => {
    const user = userEvent.setup();
    serve({}, postWithLink({ 'nina@x.fr': LINK }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    await invite(user, 'nina@x.fr');
    const box = await boxIn(inviteSection(), created);

    await user.click(dismissOf(box));

    noBoxIn(inviteSection());
    expect(within(inviteSection()).queryByDisplayValue(LINK)).toBeNull();
    expect(document.activeElement).toBe(emailField());
  });

  // Le serveur ne redonne pas le lien : la carte qui l'attend ne se ferme pas avant de l'avoir montré (sinon il arriverait là où rien
  // ne le montre, perdu sans un mot).
  test('pendant la création : la croix, « Inviter » (aria-disabled, ils gardent le focus) et Échap ne ferment ni la carte ni le panneau ; le lien arrive dans la carte', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const reply = deferred<Response>();
    serve({}, () => ({ 'POST /api/admin/invitations': () => reply.promise }));
    await openPanel({ mail: 'none', onClose });
    await openInvite(user);
    await user.type(emailField(), 'nina@x.fr{Enter}');
    expect(submitButton().textContent).toBe(fr.admin.invite.creating);

    const close = within(inviteSection()).getByRole('button', { name: fr.admin.invite.close });
    expect(close.getAttribute('aria-disabled')).toBe('true');
    expect(inviteToggle().getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('{Escape}');
    await user.click(close);
    expect(document.activeElement).toBe(close);
    await user.click(inviteToggle());
    expect(document.activeElement).toBe(inviteToggle());
    expect(inviteSection()).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => reply.resolve(json(201, { ...invitation('inv-nina', 'nina@x.fr'), link: LINK })));
    const box = await boxIn(inviteSection(), created);
    expect((within(box).getByRole('textbox', { name: created }) as HTMLInputElement).value).toBe(LINK);
    // La réponse arrivée, la carte se ferme de nouveau.
    expect(close.hasAttribute('aria-disabled')).toBe(false);
    expect(inviteToggle().hasAttribute('aria-disabled')).toBe(false);
    await user.click(inviteToggle());
    expect(within(panel()).queryByRole('region', { name: fr.admin.invite.title })).toBeNull();
  });

  test('fermer la carte masque son lien : rouverte, elle repart à neuf', async () => {
    const user = userEvent.setup();
    serve({}, postWithLink({ 'nina@x.fr': LINK }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    await invite(user, 'nina@x.fr');
    await boxIn(inviteSection(), created);

    await user.click(inviteToggle());
    expect(document.activeElement).toBe(inviteToggle());
    await openInvite(user);
    noBoxIn(inviteSection());
  });

  test('le résultat suivant remplace la boîte : le nouveau lien, « Lien copié. » oublié', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn(async () => {}));
    serve({}, postWithLink({ 'nina@x.fr': LINK, 'tom@x.fr': OTHER_LINK }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    await invite(user, 'nina@x.fr');
    await user.click(copyOf(await boxIn(inviteSection(), created)));
    await within(inviteSection()).findByText(fr.admin.link.copied);

    await invite(user, 'tom@x.fr');
    const second = await boxIn(inviteSection(), t(fr.admin.invite.created, { email: 'tom@x.fr' }));

    expect(within(inviteSection()).getAllByRole('group')).toHaveLength(1);
    expect(fieldOf(second).value).toBe(OTHER_LINK);
    expect(within(inviteSection()).queryByText(created)).toBeNull();
    expect(within(inviteSection()).queryByText(fr.admin.link.copied)).toBeNull();
    expect(document.activeElement).toBe(copyOf(second));
  });

  test('la boîte reste tant qu\'on ne la ferme pas : taper l\'adresse suivante, ou un refus, ne l\'efface pas', async () => {
    const user = userEvent.setup();
    serve({ invitations: [invitation('inv-tom', 'tom@x.fr')] }, postWithLink({ 'nina@x.fr': LINK }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    await invite(user, 'nina@x.fr');
    await boxIn(inviteSection(), created);

    await user.type(emailField(), 'tom@x.fr');
    expect(within(inviteSection()).getByRole('group', { name: created })).toBeTruthy();
    await user.click(submitButton());   // déjà invitée : 409
    expect((await within(inviteSection()).findByRole('alert')).textContent).toBe(fr.admin.errors.alreadyInvited);
    expect(fieldOf(within(inviteSection()).getByRole('group', { name: created })).value).toBe(LINK);
  });

  test('sans lien dans la réponse (envoi par e-mail), rien ne change : le message d\'envoi, pas de boîte', async () => {
    const user = userEvent.setup();
    serve({}, (state) => ({
      'POST /api/admin/invitations': () => {
        const made = invitation('inv-nina', 'nina@x.fr');
        state.invitations = [made];
        return json(201, made);
      },
    }));
    await openPanel({ mail: 'resend' });
    await openInvite(user);
    await invite(user, 'nina@x.fr');
    expect(await within(inviteSection()).findByText(t(fr.admin.invite.sent, { email: 'nina@x.fr' }))).toBeTruthy();
    noBoxIn(inviteSection());
    expect(document.activeElement).toBe(emailField());
  });

  test('une réponse 201 sans corps (rien à lire) ne passe pas pour une erreur : le message d\'envoi, pas de boîte', async () => {
    const user = userEvent.setup();
    serve({}, () => ({ 'POST /api/admin/invitations': () => new Response(null, { status: 201 }) }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    await invite(user, 'nina@x.fr');
    expect(await within(inviteSection()).findByText(t(fr.admin.invite.sent, { email: 'nina@x.fr' }))).toBeTruthy();
    expect(within(inviteSection()).queryByRole('alert')).toBeNull();
    noBoxIn(inviteSection());
  });

  test('la réponse arrive après que le focus est passé ailleurs : il n\'est pas repris', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    serve({}, () => ({ 'POST /api/admin/invitations': () => reply.promise }));
    const outside = await openPanelBeside({ mail: 'none' });
    await openInvite(user);
    await user.type(emailField(), 'nina@x.fr');
    await user.click(submitButton());
    outside.focus();

    await act(async () => reply.resolve(json(201, { ...invitation('inv-nina', 'nina@x.fr'), link: LINK })));
    const box = await boxIn(inviteSection(), created);
    expect(fieldOf(box).value).toBe(LINK);   // la boîte est là…
    expect(document.activeElement).toBe(outside);   // …sans avoir pris le focus
  });
});

// Rien ne part sans e-mail : les boutons ne parlent plus d'envoi (le message de chacun dit déjà ce qui arrive : un lien est montré).
describe('libellés sans e-mail', () => {
  const PENDING = [invitation('inv-nina', 'nina@x.fr')];

  test('formulaire : « Créer le lien d\'invitation » avec none, « Envoyer l\'invitation » avec resend, avec memory et tant que le mode est inconnu', async () => {
    expect(fr.admin.invite.create).toBe('Créer le lien d\'invitation');
    expect(fr.admin.invite.submit).toBe('Envoyer l\'invitation');
    for (const [mail, label] of [
      ['none', fr.admin.invite.create],
      ['resend', fr.admin.invite.submit],
      ['memory', fr.admin.invite.submit],
      [null, fr.admin.invite.submit],
      [undefined, fr.admin.invite.submit],
    ] as const) {
      serve();
      const view = await openPanel({ mail });
      fireEvent.click(inviteToggle());
      expect(submitButton().textContent, String(mail)).toBe(label);
      expect(within(inviteSection()).queryAllByRole('button', { name: mail === 'none' ? fr.admin.invite.submit : fr.admin.invite.create })).toEqual([]);
      view.unmount();
    }
  });

  test('le libellé suit le mode quand il arrive après l\'ouverture (la configuration se lit à l\'ouverture)', async () => {
    serve();
    const view = await openPanel({ mail: undefined });
    fireEvent.click(inviteToggle());
    expect(submitButton().textContent).toBe(fr.admin.invite.submit);
    view.rerender(<AdminPanel id="panneau-admin" selfId={ADA.id} mail="none" onClose={() => {}} />);
    expect(submitButton().textContent).toBe(fr.admin.invite.create);
  });

  test('pendant la création : « Création… » avec none', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    serve({}, () => ({ 'POST /api/admin/invitations': () => reply.promise }));
    await openPanel({ mail: 'none' });
    await openInvite(user);
    await user.type(emailField(), 'nina@x.fr');
    await user.click(submitButton());
    expect(submitButton().textContent).toBe(fr.admin.invite.creating);
    expect(fr.admin.invite.creating).toBe('Création…');
    expect(submitButton().disabled).toBe(true);
    await act(async () => reply.resolve(json(201, { ...invitation('inv-nina', 'nina@x.fr'), link: LINK })));
    await waitFor(() => expect(submitButton().textContent).toBe(fr.admin.invite.create));
  });

  test('le menu d\'une invitation : « Nouveau lien » avec none, « Renvoyer l\'invitation » sinon', async () => {
    const user = userEvent.setup();
    expect(fr.admin.pending.renew).toBe('Nouveau lien');
    for (const [mail, label] of [
      ['none', fr.admin.pending.renew],
      ['resend', fr.admin.pending.resend],
      ['memory', fr.admin.pending.resend],
      [null, fr.admin.pending.resend],
      [undefined, fr.admin.pending.resend],
    ] as const) {
      serve({ invitations: PENDING });
      const view = await openPanel({ mail, tab: 'invitations' });
      const menu = await openActions(user, 'nina@x.fr');
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent), String(mail)).toEqual([label, fr.admin.pending.revoke]);
      view.unmount();
    }
  });

  test('aucun libellé de bouton ni de ligne de menu ne parle d\'e-mail ou d\'envoi avec none', async () => {
    const user = userEvent.setup();
    serve({ invitations: PENDING });
    await openPanel({ mail: 'none', tab: 'invitations' });
    await openInvite(user);
    await openActions(user, 'nina@x.fr');
    const names = [...within(panel()).getAllByRole('button'), ...screen.getAllByRole('menuitem')].map(
      (button) => button.getAttribute('aria-label') ?? button.textContent ?? '',
    );
    expect(names.filter((name) => /e-mail|envoy|renvoy/i.test(name))).toEqual([]);
  });
});

describe('renvoyer une invitation sans e-mail', () => {
  const PENDING = [invitation('inv-nina', 'nina@x.fr'), invitation('inv-old', 'old@x.fr', { role: 'admin', expired: true })];
  const renewed = t(fr.admin.pending.renewed, { email: 'nina@x.fr' });
  const resendWithLink = (state: World) => ({
    'POST /api/admin/invitations/inv-nina/resend': () => {
      state.invitations = state.invitations.map((pending) => (pending.id === 'inv-nina' ? { ...pending, expired: false } : pending));
      return json(200, { ok: true, link: LINK });
    },
  });

  test('le serveur rend un lien : la boîte est en tête de l\'onglet Invitations, et on ne dit pas qu\'un e-mail est reparti', async () => {
    const user = userEvent.setup();
    const { api } = serve({ invitations: PENDING }, resendWithLink);
    await openPanel({ mail: 'none', tab: 'invitations' });
    noBoxIn(pendingSection());

    await renew(user, 'nina@x.fr');
    const box = await boxIn(pendingSection(), renewed);

    expect(fieldOf(box).value).toBe(LINK);
    expect(fieldOf(box).readOnly).toBe(true);
    expect(within(box).getByText(t(fr.admin.invite.validity, { days: DAYS }))).toBeTruthy();
    expect(within(pendingSection()).queryByText(t(fr.admin.pending.resent, { email: 'nina@x.fr' }))).toBeNull();
    expect(routesOf(api).slice(-2)).toEqual(['POST /api/admin/invitations/inv-nina/resend', 'GET /api/admin/invitations']);
    expect(document.activeElement).toBe(copyOf(box));
    // La boîte précède la liste : elle est sous les messages, au-dessus des invitations.
    expect(box.compareDocumentPosition(within(pendingSection()).getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('copier, masquer : comme dans la carte du formulaire, et le focus revient au bouton « … » de l\'invitation', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    serve({ invitations: PENDING }, resendWithLink);
    await openPanel({ mail: 'none', tab: 'invitations' });
    await renew(user, 'nina@x.fr');
    const box = await boxIn(pendingSection(), renewed);
    stubClipboard(writeText);

    await user.click(copyOf(box));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await within(box).findByText(fr.admin.link.copied)).toBeTruthy();

    await user.click(dismissOf(box));
    noBoxIn(pendingSection());
    expect(document.activeElement).toBe(actionsButton('nina@x.fr'));
  });

  test('renvoyer une autre invitation remplace la boîte', async () => {
    const user = userEvent.setup();
    serve({ invitations: PENDING }, (state) => ({
      ...resendWithLink(state),
      'POST /api/admin/invitations/inv-old/resend': () => json(200, { ok: true, link: OTHER_LINK }),
    }));
    await openPanel({ mail: 'none', tab: 'invitations' });
    await renew(user, 'nina@x.fr');
    await boxIn(pendingSection(), renewed);
    await renew(user, 'old@x.fr');
    const second = await boxIn(pendingSection(), t(fr.admin.pending.renewed, { email: 'old@x.fr' }));

    expect(within(pendingSection()).getAllByRole('group')).toHaveLength(1);
    expect(fieldOf(second).value).toBe(OTHER_LINK);
  });

  test('annuler cette invitation fait disparaître son lien ; en annuler une autre, non', async () => {
    const user = userEvent.setup();
    serve({ invitations: PENDING }, (state) => ({
      ...resendWithLink(state),
      'DELETE /api/admin/invitations/inv-old': () => {
        state.invitations = state.invitations.filter((pending) => pending.id !== 'inv-old');
        return json(200, { ok: true });
      },
      'DELETE /api/admin/invitations/inv-nina': () => {
        state.invitations = state.invitations.filter((pending) => pending.id !== 'inv-nina');
        return json(200, { ok: true });
      },
    }));
    await openPanel({ mail: 'none', tab: 'invitations' });
    await renew(user, 'nina@x.fr');
    await boxIn(pendingSection(), renewed);

    await revoke(user, 'old@x.fr');
    await waitFor(() => expect(within(pendingSection()).queryByText('old@x.fr')).toBeNull());
    expect(within(pendingSection()).getByRole('group', { name: renewed })).toBeTruthy();

    await revoke(user, 'nina@x.fr');
    await waitFor(() => expect(within(pendingSection()).queryByText('nina@x.fr')).toBeNull());
    noBoxIn(pendingSection());
  });

  test('sans lien dans la réponse (e-mail renvoyé), le message d\'avant, pas de boîte', async () => {
    const user = userEvent.setup();
    serve({ invitations: PENDING }, () => ({ 'POST /api/admin/invitations/inv-nina/resend': () => json(200, { ok: true }) }));
    await openPanel({ mail: 'resend', tab: 'invitations' });
    await resend(user, 'nina@x.fr');
    expect(await within(pendingSection()).findByText(t(fr.admin.pending.resent, { email: 'nina@x.fr' }))).toBeTruthy();
    noBoxIn(pendingSection());
  });
});

describe('lien de mot de passe', () => {
  const passwordItem = (menu: HTMLElement) => within(menu).queryByRole('menuitem', { name: fr.admin.members.passwordLink });
  const askPasswordLink = (user: User, name: string) => choose(user, name, fr.admin.members.passwordLink);
  const introFor = (name: string) => t(fr.admin.members.passwordLinkIntro, { name });
  const resetLinkOf = (id: string, reply: () => Response | Promise<Response>) => ({ [`POST /api/admin/members/${id}/reset-link`]: reply });

  test('avec MAILER=none : une ligne « Lien de mot de passe » dans le menu de chaque membre ; soi-même n\'a pas de menu', async () => {
    const user = userEvent.setup();
    serve();
    await openPanel({ mail: 'none' });   // ADA est le compte connecté
    const bob = await openActions(user, 'Bob');
    expect(within(bob).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([fr.admin.members.passwordLink, fr.admin.members.remove]);
    expect(fr.admin.members.passwordLink).toBe('Lien de mot de passe');
    await user.keyboard('{Escape}');
    expect(passwordItem(await openActions(user, 'Cléo'))).not.toBeNull();
    expect(within(rowOf(membersSection(), 'Ada')).queryByRole('button')).toBeNull();
  });

  test('le compte connecté est celui de selfId : avec Cléo, c\'est Ada qui a le menu', async () => {
    const user = userEvent.setup();
    serve();
    await openPanel({ mail: 'none', selfId: CLEO.id });
    expect(within(rowOf(membersSection(), 'Cléo')).queryByRole('button')).toBeNull();
    expect(passwordItem(await openActions(user, 'Ada'))).not.toBeNull();
  });

  test.each([
    ['le mode est inconnu (configuration pas encore lue, ou illisible)', undefined],
    ['null', null],
    ['MAILER=resend', 'resend'],
    ['MAILER=memory', 'memory'],
  ] as const)('%s : pas de « Lien de mot de passe », le menu n\'a que « Retirer du bureau »', async (_name, mail) => {
    const user = userEvent.setup();
    serve();
    await openPanel({ mail });
    const menu = await openActions(user, 'Bob');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([fr.admin.members.remove]);
  });

  test('la ligne demande le lien (POST sans corps) et la boîte le montre, avec la phrase du membre', async () => {
    const user = userEvent.setup();
    const { api } = serve({}, () => resetLinkOf('bob', () => json(200, { link: RESET_LINK })));
    await openPanel({ mail: 'none' });

    await askPasswordLink(user, 'Bob');
    const box = await boxIn(membersSection(), introFor('Bob'));

    expect(introFor('Bob')).toBe('Ce lien permet de choisir un nouveau mot de passe pour Bob.');
    expect(fieldOf(box).value).toBe(RESET_LINK);
    expect(fieldOf(box).readOnly).toBe(true);
    expect(within(box).getByText(fr.admin.members.passwordLinkValidity)).toBeTruthy();
    expect(fr.admin.members.passwordLinkValidity).toMatch(/une heure/);
    expect(fr.admin.members.passwordLinkValidity).toMatch(/plus affiché/);
    expect(document.activeElement).toBe(copyOf(box));
    // La demande : un POST sans corps ; la liste des membres n'a pas besoin d'être relue.
    const call = api.mock.calls.find(([input]) => String(input) === '/api/admin/members/bob/reset-link');
    expect(call?.[1]).toMatchObject({ method: 'POST' });
    expect(call?.[1]?.body).toBeUndefined();
    expect(countOf(api, 'GET /api/admin/members')).toBe(1);
    expect(within(membersSection()).queryByRole('alert')).toBeNull();
  });

  test('copier et masquer : le focus revient au bouton « … » de ce membre', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    serve({}, () => resetLinkOf('bob', () => json(200, { link: RESET_LINK })));
    await openPanel({ mail: 'none' });
    await askPasswordLink(user, 'Bob');
    const box = await boxIn(membersSection(), introFor('Bob'));
    stubClipboard(writeText);

    await user.click(copyOf(box));
    expect(writeText).toHaveBeenCalledWith(RESET_LINK);
    expect(await within(box).findByText(fr.admin.link.copied)).toBeTruthy();

    await user.click(dismissOf(box));
    noBoxIn(membersSection());
    expect(document.activeElement).toBe(actionsButton('Bob'));
  });

  test('le lien d\'un autre membre remplace la boîte', async () => {
    const user = userEvent.setup();
    serve({}, () => ({
      ...resetLinkOf('bob', () => json(200, { link: RESET_LINK })),
      ...resetLinkOf('cleo', () => json(200, { link: OTHER_LINK })),
    }));
    await openPanel({ mail: 'none' });
    await askPasswordLink(user, 'Bob');
    await boxIn(membersSection(), introFor('Bob'));
    await askPasswordLink(user, 'Cléo');
    const second = await boxIn(membersSection(), introFor('Cléo'));
    expect(within(membersSection()).getAllByRole('group')).toHaveLength(1);
    expect(fieldOf(second).value).toBe(OTHER_LINK);
  });

  test('pendant la demande : les boutons « … » sont inactifs (aria-disabled), le focus reste, une seule demande part', async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    const { api } = serve({}, () => resetLinkOf('bob', () => reply.promise));
    await openPanel({ mail: 'none' });
    await askPasswordLink(user, 'Bob');

    expect(actionsButton('Bob').getAttribute('aria-disabled')).toBe('true');
    expect(actionsButton('Cléo').getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(actionsButton('Bob'));
    await user.keyboard('{Enter}');
    fireEvent.click(actionsButton('Cléo'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(routesOf(api).filter((route) => route.startsWith('POST'))).toEqual(['POST /api/admin/members/bob/reset-link']);

    await act(async () => reply.resolve(json(200, { link: RESET_LINK })));
    await boxIn(membersSection(), introFor('Bob'));
    expect(actionsButton('Bob').hasAttribute('aria-disabled')).toBe(false);
  });

  test.each([
    ['membre retiré entre-temps (404)', () => json(404, { error: 'not_found' }), fr.admin.errors.notFoundMember, true],
    ['le lien n\'a pas pu être créé (502)', () => json(502, { error: 'reset_failed' }), fr.admin.errors.resetFailed, false],
    ['route absente : le serveur n\'est plus sans e-mail (404 générique)', () => json(404, { error: 'not_found' }), fr.admin.errors.notFoundMember, true],
    ['accès refusé (403)', () => json(403, { error: 'forbidden' }), fr.admin.errors.forbidden, false],
    ['session expirée (401)', () => json(401, { error: 'unauthorized' }), fr.admin.errors.unauthorized, false],
    ['serveur injoignable', () => { throw new TypeError('Failed to fetch'); }, fr.common.errors.network, false],
    ['erreur du serveur (500)', () => json(500, { error: 'internal' }), fr.common.errors.unexpected, false],
    ['réponse sans lien', () => json(200, {}), fr.common.errors.unexpected, false],
  ] as const)('%s : le message, pas de boîte, et le bouton est de nouveau actif', async (_name, reply, message, reloads) => {
    const user = userEvent.setup();
    const { api } = serve({}, () => resetLinkOf('bob', reply));
    await openPanel({ mail: 'none' });

    await askPasswordLink(user, 'Bob');

    expect((await within(membersSection()).findByRole('alert')).textContent).toBe(message);
    noBoxIn(membersSection());
    await waitFor(() => expect(countOf(api, 'GET /api/admin/members')).toBe(reloads ? 2 : 1));
    // 404 : Bob n'est plus là pour tout le monde, la liste est relue (le faux serveur la garde telle quelle ici) ; sinon, le bouton sert encore.
    if (!reloads) expect(actionsButton('Bob').hasAttribute('aria-disabled')).toBe(false);
  });

  test('retirer le membre fait disparaître son lien', async () => {
    const user = userEvent.setup();
    serve({}, (state) => ({
      ...resetLinkOf('bob', () => json(200, { link: RESET_LINK })),
      'DELETE /api/admin/members/bob': () => {
        state.members = state.members.filter((member) => member.id !== 'bob');
        return json(200, { ok: true });
      },
    }));
    await openPanel({ mail: 'none' });
    await askPasswordLink(user, 'Bob');
    await boxIn(membersSection(), introFor('Bob'));

    await remove(user, 'Bob');
    await user.click(dialogButton(fr.admin.removal.confirm));
    await waitFor(() => expect(within(membersSection()).queryByText('Bob')).toBeNull());
    noBoxIn(membersSection());
  });

  test('l\'identifiant du membre est encodé dans l\'adresse', async () => {
    const user = userEvent.setup();
    const odd: Member = { id: 'a/b c', name: 'Odd', email: 'odd@x.fr', role: 'member' };
    const { api } = serve({ members: [ADA, odd] }, () => resetLinkOf('a%2Fb%20c', () => json(200, { link: RESET_LINK })));
    await openPanel({ mail: 'none' });
    await askPasswordLink(user, 'Odd');
    await boxIn(membersSection(), introFor('Odd'));
    expect(countOf(api, 'POST /api/admin/members/a%2Fb%20c/reset-link')).toBe(1);
  });
});
