import { INVITATION_TTL_MS, type MailMode, type Role } from '@bureau/shared';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { fr, t } from '../i18n/fr';
import { api, ApiError } from '../lib/api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';

// Un membre actif, tel que GET /api/admin/members le dit. Seules les routes /api/admin donnent l'adresse e-mail d'un membre : aucun
// autre panneau ne la montre.
interface AdminMember {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// Une invitation en attente, telle que GET /api/admin/invitations la dit. `expired` : son lien ne marche plus, mais on peut la renvoyer.
interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  expired: boolean;
}

const ROLES: readonly Role[] = ['member', 'admin'];

interface AdminList<T> {
  // null tant que la liste n'est pas arrivée.
  items: T[] | null;
  // Le premier chargement a échoué (un rechargement qui échoue, lui, garde la liste déjà là).
  failed: boolean;
  reload(): Promise<void>;
}

// Une liste de l'API admin, chargée à l'ouverture du panneau. reload() la relit ; seule la réponse à la demande la plus récente
// compte (deux demandes en vol, StrictMode ou un nouvel essai, ne se marchent pas dessus).
function useAdminList<T>(path: string): AdminList<T> {
  const [state, setState] = useState<{ items: T[] | null; failed: boolean }>({ items: null, failed: false });
  const latest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    // Un nouvel essai après un échec : « Chargement… » de nouveau.
    setState((previous) => (previous.failed ? { items: null, failed: false } : previous));
    try {
      const items = await api<T[]>(path);
      if (mounted.current && request === latest.current) setState({ items, failed: false });
    } catch {
      // Un rechargement en arrière-plan qui échoue laisse la liste déjà là ; seul le premier chargement a un message d'échec.
      if (mounted.current && request === latest.current) setState((previous) => (previous.items ? previous : { items: null, failed: true }));
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}

// Ce qu'une section dit du dernier geste de l'admin : c'est fait (`done`), ou la raison du refus (`error`).
interface Feedback {
  kind: 'done' | 'error';
  text: string;
}

// Un refus se lit tout de suite (role="alert"). Un « c'est fait » est écrit dans une région qui existait déjà (role="status"), pour qu'un
// lecteur d'écran l'annonce : une région qui apparaît avec son texte n'est pas toujours lue.
function FeedbackMessage({ feedback }: { feedback: Feedback | null }) {
  return (
    <>
      {feedback?.kind === 'error' && <Alert>{feedback.text}</Alert>}
      <div role="status">{feedback?.kind === 'done' && <p className="notice">{feedback.text}</p>}</div>
    </>
  );
}

// Le serveur dit que la cible n'existe pas (ou plus) : l'invitation a été acceptée ou annulée, le membre retiré, entre-temps.
const isNotFound = (err: unknown): boolean => err instanceof ApiError && err.error === 'not_found';

// Le message d'un geste refusé ou raté. `notFound` : celui d'un 404, qui dépend de ce qu'on visait (une invitation, un membre).
function failureMessage(err: unknown, notFound: string): string {
  if (!(err instanceof ApiError)) return fr.common.errors.unexpected;
  if (err.status === 0) return fr.common.errors.network;
  switch (err.error) {
    case 'already_invited':
      return fr.admin.errors.alreadyInvited;
    case 'already_member':
      return fr.admin.errors.alreadyMember;
    case 'mail_failed':
      return fr.admin.errors.mailFailed;
    case 'reset_failed':
      return fr.admin.errors.resetFailed;
    case 'invalid':
      return fr.admin.errors.invalid;
    case 'self':
      return fr.admin.errors.self;
    case 'last_admin':
      return fr.admin.errors.lastAdmin;
    case 'not_found':
      return notFound;
    case 'unauthorized':
      return fr.admin.errors.unauthorized;
    case 'forbidden':
      return fr.admin.errors.forbidden;
    default:
      return fr.common.errors.unexpected;
  }
}

// Le panneau Admin : réservé aux admins (OfficeShell ne le monte, et n'en montre le bouton, que pour eux ; le serveur refuse de toute façon
// un membre : 403). Trois sections :
// - Inviter : une adresse e-mail et un rôle ;
// - Invitations en attente (expirées comprises) : renvoyer, annuler ;
// - Membres : retirer, après une confirmation. Soi-même n'a pas de bouton (le serveur refuse aussi : `self`).
//
// Les listes (/api/admin/members et /api/admin/invitations) sont lues à l'ouverture. Après chaque geste, réussi ou non, la liste
// concernée est relue : un refus ne dit pas toujours que rien n'a changé (l'e-mail n'est pas parti mais l'invitation existe ; la réponse
// s'est perdue). Un « introuvable » relit les deux : une invitation acceptée entre-temps est un nouveau membre. Quelqu'un que la liste
// des membres ne connaît pas et qui arrive au bureau (une invitation vient d'être acceptée) les fait relire aussi, une fois par personne,
// comme le panneau Personnes.
//
// Sans e-mail (`mail` vaut « none » : MAILER=none, que dit GET /api/config), rien n'est envoyé : le serveur rend le lien d'une invitation
// créée ou renvoyée, et celui d'un mot de passe (« Lien de mot de passe », sur chaque membre sauf soi). Le panneau le montre dans une boîte
// à copier, une seule à la fois dans tout le panneau ; le serveur ne le redonne pas. Tant que `mail` est inconnu, le panneau est celui
// des e-mails.
//
// Le focus va au titre à l'ouverture (le lecteur d'écran l'annonce, et Tab entre dans le panneau) ; Échap ferme.
export function AdminPanel({ id, selfId, mail, onClose }: { id?: string; selfId: string; mail?: MailMode | null; onClose(): void }) {
  const members = useAdminList<AdminMember>('/api/admin/members');
  const invitations = useAdminList<PendingInvitation>('/api/admin/invitations');
  const players = useOfficeStore((state) => state.players);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [shown, setShown] = useState<ShownLink | null>(null);
  const links = useMemo<Links>(
    () => ({
      shown,
      show: (link) => setShown({ ...link, key: ++shownCount }),
      hide: () => setShown(null),
      forget: (subject) => setShown((current) => (current?.subject === subject ? null : current)),
    }),
    [shown],
  );

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const requested = useRef(new Set<string>());
  const { items: knownMembers, reload: reloadMembers } = members;
  const reloadInvitations = invitations.reload;
  useEffect(() => {
    if (knownMembers === null) return;
    const known = new Set(knownMembers.map((member) => member.id));
    const unknown = Object.keys(players).filter((playerId) => !known.has(playerId) && !requested.current.has(playerId));
    if (unknown.length === 0) return;
    // Une fois par personne : si le serveur ne la connaît pas davantage après cette relecture, on n'insiste pas.
    for (const playerId of unknown) requested.current.add(playerId);
    void reloadMembers();
    void reloadInvitations();
  }, [knownMembers, players, reloadMembers, reloadInvitations]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Échap dans une composition (clavier à touches mortes, méthode de saisie) l'annule : il ne ferme pas le panneau.
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <aside id={id} className="admin-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="admin-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {fr.admin.title}
        </h2>
        <button type="button" className="bar-button" aria-label={fr.admin.close} onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <div className="admin-body">
        <InviteSection reloadInvitations={reloadInvitations} links={links} />
        <InvitationsSection list={invitations} reloadMembers={reloadMembers} links={links} />
        <MembersSection list={members} selfId={selfId} canLinkPassword={mail === 'none'} links={links} />
      </div>
    </aside>
  );
}

// Rend le focus à `target` après une réponse du serveur, mais seulement s'il n'est pas passé ailleurs pendant l'attente : nulle part (un
// bouton rendu inactif le perd), ou dans la section du geste (le bouton qui l'a lancé, la boîte de retrait). Sinon la réponse le
// volerait à qui est passé à autre chose : la boîte de retrait ouverte entre-temps (derrière elle, Tab et Échap ne l'atteindraient plus,
// et Échap fermerait le panneau), un champ du Chat. Le retour du focus au bouton quand on ferme la boîte, lui, est immédiat : sans ce test.
function focusUnlessMoved(target: HTMLElement | null | undefined, section: HTMLElement | null): void {
  const active = document.activeElement;
  if (active === null || active === document.body || section?.contains(active)) target?.focus();
}

// ---- Un lien à transmettre -----------------------------------------------------------------------------------------------------------

// Un lien que le serveur vient de rendre et ne redonnera pas : il n'a gardé que l'empreinte du jeton.
interface ShownLink {
  // Un numéro par résultat : la boîte d'un résultat neuf repart de zéro (« Copié » oublié), même si le lien s'écrit pareil.
  key: number;
  // La section sous laquelle la boîte paraît : celle du geste qui l'a produite.
  place: 'invite' | 'pending' | 'members';
  // La phrase qui présente le lien, et nomme la boîte.
  intro: string;
  link: string;
  // Combien de temps il vaut, et qu'il ne sera pas redonné.
  validity: string;
  // Ce qu'il ouvre (`invitation:<id>`, `member:<id>`) : annuler l'invitation ou retirer le membre fait disparaître la boîte.
  subject: string;
  // Où va le focus quand on la masque : le bouton du geste, s'il existe encore.
  returnFocus(): HTMLElement | null | undefined;
}

// Une seule boîte à la fois dans tout le panneau : un résultat neuf remplace le précédent.
interface Links {
  shown: ShownLink | null;
  show(link: Omit<ShownLink, 'key'>): void;
  hide(): void;
  forget(subject: string): void;
}

let shownCount = 0;

const DAY_MS = 24 * 3600 * 1000;
// La durée de validité d'une invitation, en jours, telle que le serveur la fixe (INVITATION_TTL_MS).
const INVITATION_DAYS = Math.round(INVITATION_TTL_MS / DAY_MS);

// L'emplacement de la boîte sous une section : une région vivante (aria-live) qui existe avant la boîte, vide, pour qu'un lecteur
// d'écran annonce la boîte quand elle paraît. (Ce n'est pas une région role="status" : chaque section en a déjà une, pour ses messages.)
function LinkSlot({ links, place, section }: { links: Links; place: ShownLink['place']; section: RefObject<HTMLElement | null> }) {
  const shown = links.shown?.place === place ? links.shown : null;
  return <div aria-live="polite">{shown && <LinkBox key={shown.key} shown={shown} section={section} onDismiss={() => dismiss(links)} />}</div>;
}

// Masquer la boîte rend le focus au bouton du geste, avant qu'elle ne disparaisse avec celui qu'elle avait.
function dismiss(links: Links): void {
  const target = links.shown?.returnFocus();
  links.hide();
  target?.focus();
}

// La phrase, le lien dans un champ en lecture seule, « Copier le lien » et « Masquer », puis la durée de validité. À son apparition,
// le focus va à « Copier le lien », sauf s'il était passé ailleurs pendant l'attente (focusUnlessMoved).
function LinkBox({ shown, section, onDismiss }: { shown: ShownLink; section: RefObject<HTMLElement | null>; onDismiss(): void }) {
  const introId = useId();
  const hintId = useId();
  const field = useRef<HTMLInputElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<'copied' | 'selected' | null>(null);

  useEffect(() => {
    focusUnlessMoved(copyButton.current, section.current);
  }, [section]);

  function selectLink() {
    const input = field.current;
    if (!input) return;
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
  }

  async function copy() {
    try {
      // Sans presse-papiers (une page en http, hors localhost) ou s'il refuse (permission), `clipboard` est absent ou rejette.
      await navigator.clipboard.writeText(shown.link);
      setCopied('copied');
    } catch {
      // Le lien est sélectionné : la personne le copie elle-même.
      selectLink();
      setCopied('selected');
    }
  }

  return (
    <div className="admin-link" role="group" aria-labelledby={introId}>
      <p id={introId} className="admin-link-intro">
        {shown.intro}
      </p>
      <input
        ref={field}
        className="admin-link-field"
        type="text"
        readOnly
        spellCheck={false}
        autoComplete="off"
        aria-labelledby={introId}
        aria-describedby={hintId}
        value={shown.link}
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="admin-link-actions">
        <button ref={copyButton} type="button" className="bar-button" onClick={() => void copy()}>
          {fr.admin.link.copy}
        </button>
        <button type="button" className="bar-button" onClick={onDismiss}>
          {fr.admin.link.dismiss}
        </button>
      </div>
      {copied && <p className="admin-link-copied">{copied === 'copied' ? fr.admin.link.copied : fr.admin.link.selected}</p>}
      <p id={hintId} className="admin-link-hint">
        {shown.validity}
      </p>
    </div>
  );
}

// ---- Inviter -----------------------------------------------------------------------------------------------------------------------

// L'adresse et le rôle. Le champ ne se vide qu'à l'invitation envoyée : refusée, l'adresse reste, on la corrige. Le rôle revient alors
// à « Membre » : une invitation d'admin ne se répète pas par inadvertance.
function InviteSection({ reloadInvitations, links }: { reloadInvitations(): Promise<void>; links: Links }) {
  const titleId = useId();
  const emailId = useId();
  const roleId = useId();
  const section = useRef<HTMLElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Un champ e-mail ne garde pas les espaces autour de l'adresse (le navigateur les retire de sa valeur), et le serveur les retire aussi.
  const canSubmit = email !== '' && !submitting;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const sent = { email, role };
    setSubmitting(true);
    setFeedback(null);
    let hasLink = false;
    try {
      const created = await api<{ id: string; link?: string }>('/api/admin/invitations', { method: 'POST', body: JSON.stringify({ email, role }) });
      // Le formulaire se vide s'il n'a pas changé depuis l'envoi : l'e-mail part pendant une ou deux secondes (Resend), et la personne
      // qui a déjà tapé l'adresse suivante la garde.
      setEmail((current) => (current === sent.email ? '' : current));
      setRole((current) => (current === sent.role ? 'member' : current));
      if (typeof created.link === 'string') {
        // Sans e-mail (MAILER=none), rien n'est parti : le serveur rend le lien, que l'admin transmet. La boîte du lien (qui prend le
        // focus, sauf s'il est passé ailleurs) remplace le message d'envoi.
        hasLink = true;
        links.show({
          place: 'invite',
          intro: t(fr.admin.invite.created, { email }),
          link: created.link,
          validity: t(fr.admin.invite.validity, { days: INVITATION_DAYS }),
          subject: `invitation:${created.id}`,
          returnFocus: () => emailInput.current,
        });
      } else {
        setFeedback({ kind: 'done', text: t(fr.admin.invite.sent, { email }) });
      }
    } catch (err) {
      setFeedback({ kind: 'error', text: failureMessage(err, fr.admin.errors.notFoundInvitation) });
    }
    setSubmitting(false);
    // Le bouton a perdu le focus en devenant inactif : le champ le reprend, pour enchaîner ou corriger l'adresse. (Avec un lien, c'est
    // « Copier le lien » qui le prend : il faut d'abord le transmettre.)
    if (!hasLink) focusUnlessMoved(emailInput.current, section.current);
    void reloadInvitations();
  }

  return (
    <section ref={section} className="admin-section" aria-labelledby={titleId}>
      <h3 id={titleId}>{fr.admin.invite.title}</h3>
      <form className="admin-invite" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={emailId}>{fr.admin.invite.email}</label>
          <input
            ref={emailInput}
            id={emailId}
            type="email"
            name="email"
            autoComplete="off"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              // Le message d'avant parlait de l'adresse d'avant.
              setFeedback(null);
            }}
          />
        </div>
        <FeedbackMessage feedback={feedback} />
        <div className="admin-invite-row">
          <div className="field">
            <label htmlFor={roleId}>{fr.admin.invite.role}</label>
            <select id={roleId} name="role" value={role} onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : 'member')}>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {fr.admin.roles[value]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="button" disabled={!canSubmit}>
            {submitting ? fr.admin.invite.submitting : fr.admin.invite.submit}
          </button>
        </div>
      </form>
      <LinkSlot links={links} place="invite" section={section} />
    </section>
  );
}

// ---- Invitations en attente ---------------------------------------------------------------------------------------------------------

// Une action à la fois dans la section. Les boutons sont alors inactifs par aria-disabled, et non par `disabled` : un bouton qui devient
// `disabled` perd le focus, et la personne au clavier se retrouverait en haut de la page.
function InvitationsSection({ list, reloadMembers, links }: { list: AdminList<PendingInvitation>; reloadMembers(): Promise<void>; links: Links }) {
  const titleId = useId();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function run(invitation: PendingInvitation, action: 'resend' | 'revoke', opener?: HTMLElement) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const path = `/api/admin/invitations/${encodeURIComponent(invitation.id)}`;
    // La ligne n'existera plus après la relecture : le focus ira au titre de la section.
    let gone = false;
    let notFound = false;
    try {
      if (action === 'resend') {
        const renewed = await api<{ link?: string }>(`${path}/resend`, { method: 'POST' });
        if (typeof renewed?.link === 'string') {
          // Sans e-mail (MAILER=none), rien n'est reparti : le serveur rend le lien neuf (l'ancien ne marche plus), que l'admin transmet.
          links.show({
            place: 'pending',
            intro: t(fr.admin.pending.renewed, { email: invitation.email }),
            link: renewed.link,
            validity: t(fr.admin.invite.validity, { days: INVITATION_DAYS }),
            subject: `invitation:${invitation.id}`,
            returnFocus: () => (opener?.isConnected ? opener : heading.current),
          });
        } else {
          setFeedback({ kind: 'done', text: t(fr.admin.pending.resent, { email: invitation.email }) });
        }
      } else {
        await api(path, { method: 'DELETE' });
        setFeedback({ kind: 'done', text: t(fr.admin.pending.revoked, { email: invitation.email }) });
        gone = true;
      }
    } catch (err) {
      notFound = isNotFound(err);
      setFeedback({ kind: 'error', text: failureMessage(err, fr.admin.errors.notFoundInvitation) });
      gone = notFound;
    }
    // Annulée ou plus en attente : son lien n'ouvre plus rien, la boîte qui le montre disparaît.
    if (gone) links.forget(`invitation:${invitation.id}`);
    setBusy(false);
    if (gone) focusUnlessMoved(heading.current, section.current);
    void list.reload();
    // Une invitation qui n'est plus en attente a peut-être été acceptée : le compte est un nouveau membre.
    if (notFound) void reloadMembers();
  }

  const invitations = list.items;
  return (
    <section ref={section} className="admin-section" aria-labelledby={titleId}>
      <h3 id={titleId} ref={heading} tabIndex={-1}>
        {invitations ? t(fr.admin.pending.titleCount, { count: invitations.length }) : fr.admin.pending.title}
      </h3>
      <FeedbackMessage feedback={feedback} />
      <LinkSlot links={links} place="pending" section={section} />
      {invitations === null && !list.failed && <p className="admin-note">{fr.common.loading}</p>}
      {list.failed && <LoadFailed message={fr.admin.pending.loadFailed} onRetry={() => retry(list, heading.current)} />}
      {invitations?.length === 0 && <p className="admin-note">{fr.admin.pending.empty}</p>}
      {invitations && invitations.length > 0 && (
        <ul className="admin-list">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="admin-row admin-row-wrap">
              {/* Une adresse trop longue est coupée (« … ») : l'infobulle la donne en entier. */}
              <span className="admin-row-name" title={invitation.email}>
                {invitation.email}
              </span>
              <span className="admin-row-line">
                <span className="admin-badge" data-role={invitation.role}>
                  {fr.admin.roles[invitation.role]}
                </span>
                {invitation.expired && (
                  <span className="admin-badge" data-state="expired">
                    {fr.admin.pending.expired}
                  </span>
                )}
              </span>
              <div className="admin-row-actions">
                <button
                  type="button"
                  className="bar-button"
                  aria-disabled={busy || undefined}
                  aria-label={t(fr.admin.pending.resendLabel, { email: invitation.email })}
                  onClick={(event) => void run(invitation, 'resend', event.currentTarget)}
                >
                  {fr.admin.pending.resend}
                </button>
                <button
                  type="button"
                  className="bar-button"
                  aria-disabled={busy || undefined}
                  aria-label={t(fr.admin.pending.revokeLabel, { email: invitation.email })}
                  onClick={() => void run(invitation, 'revoke')}
                >
                  {fr.admin.pending.revoke}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Membres -----------------------------------------------------------------------------------------------------------------------

// `canLinkPassword` : le serveur n'envoie pas d'e-mail (MAILER=none), l'admin demande lui-même le lien de mot de passe d'un membre.
function MembersSection({ list, selfId, canLinkPassword, links }: { list: AdminList<AdminMember>; selfId: string; canLinkPassword: boolean; links: Links }) {
  const titleId = useId();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Le retrait qu'on demande à confirmer, et le bouton qui l'a demandé (le focus lui revient si on renonce).
  const [removal, setRemoval] = useState<{ member: AdminMember; opener: HTMLElement } | null>(null);
  const [removing, setRemoving] = useState(false);
  // Un lien de mot de passe est en cours de demande : une seule à la fois dans la section (aria-disabled, comme les invitations).
  const [requesting, setRequesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Le lien par lequel ce membre choisit un nouveau mot de passe : la boîte le montre, l'admin le lui transmet. Les sessions du membre
  // ne sont fermées que quand il s'en sert.
  async function requestPasswordLink(member: AdminMember, opener: HTMLElement) {
    if (requesting) return;
    setRequesting(true);
    setFeedback(null);
    let gone = false;
    try {
      const reply = await api<{ link?: unknown }>(`/api/admin/members/${encodeURIComponent(member.id)}/reset-link`, { method: 'POST' });
      if (typeof reply?.link !== 'string') throw new ApiError(200, 'unexpected');
      links.show({
        place: 'members',
        intro: t(fr.admin.members.passwordLinkIntro, { name: member.name }),
        link: reply.link,
        validity: fr.admin.members.passwordLinkValidity,
        subject: `member:${member.id}`,
        returnFocus: () => (opener.isConnected ? opener : heading.current),
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: failureMessage(err, fr.admin.errors.notFoundMember) });
      gone = isNotFound(err);
    }
    setRequesting(false);
    if (gone) {
      links.forget(`member:${member.id}`);
      focusUnlessMoved(heading.current, section.current);
      void list.reload();
    }
  }

  function ask(member: AdminMember, event: MouseEvent<HTMLButtonElement>) {
    setFeedback(null);
    setRemoval({ member, opener: event.currentTarget });
  }

  function cancel() {
    if (!removal || removing) return;
    setRemoval(null);
    removal.opener.focus();
  }

  async function confirm() {
    if (!removal || removing) return;
    const { member, opener } = removal;
    setRemoving(true);
    setFeedback(null);
    // Retiré, ou déjà retiré : la ligne n'existera plus après la relecture, le focus ira au titre de la section. Refusé : il revient au
    // bouton, qui existe toujours.
    let gone = false;
    try {
      await api(`/api/admin/members/${encodeURIComponent(member.id)}`, { method: 'DELETE' });
      setFeedback({ kind: 'done', text: t(fr.admin.members.removed, { name: member.name }) });
      gone = true;
    } catch (err) {
      setFeedback({ kind: 'error', text: failureMessage(err, fr.admin.errors.notFoundMember) });
      gone = isNotFound(err);
    }
    // Retiré : le lien de mot de passe qu'on montrait pour lui n'ouvre plus rien.
    if (gone) links.forget(`member:${member.id}`);
    setRemoving(false);
    setRemoval(null);
    focusUnlessMoved(gone ? heading.current : opener, section.current);
    void list.reload();
  }

  const members = list.items;
  return (
    <section ref={section} className="admin-section" aria-labelledby={titleId}>
      <h3 id={titleId} ref={heading} tabIndex={-1}>
        {members ? t(fr.admin.members.titleCount, { count: members.length }) : fr.admin.members.title}
      </h3>
      <FeedbackMessage feedback={feedback} />
      <LinkSlot links={links} place="members" section={section} />
      {members === null && !list.failed && <p className="admin-note">{fr.common.loading}</p>}
      {list.failed && <LoadFailed message={fr.admin.members.loadFailed} onRetry={() => retry(list, heading.current)} />}
      {members && members.length > 0 && (
        <ul className="admin-list">
          {members.map((member) => (
            <li key={member.id} className={canLinkPassword && member.id !== selfId ? 'admin-row admin-row-stack' : 'admin-row'}>
              <div className="admin-row-text">
                <span className="admin-row-line">
                  {/* Un nom ou une adresse trop longs sont coupés (« … ») : l'infobulle les donne en entier. */}
                  <span className="admin-row-name" title={member.name}>
                    {member.name}
                  </span>
                  {member.id === selfId && <span className="admin-row-you">{fr.admin.you}</span>}
                  <span className="admin-badge" data-role={member.role}>
                    {fr.admin.roles[member.role]}
                  </span>
                </span>
                <span className="admin-row-email" title={member.email}>
                  {member.email}
                </span>
              </div>
              {/* Pas de bouton pour se retirer soi-même, ni pour se demander son propre lien de mot de passe. */}
              {member.id !== selfId && (
                <div className="admin-row-actions">
                  {canLinkPassword && (
                    <button
                      type="button"
                      className="bar-button"
                      aria-disabled={requesting || undefined}
                      aria-label={t(fr.admin.members.passwordLinkLabel, { name: member.name })}
                      onClick={(event) => void requestPasswordLink(member, event.currentTarget)}
                    >
                      {fr.admin.members.passwordLink}
                    </button>
                  )}
                  <button type="button" className="bar-button" aria-label={t(fr.admin.members.removeLabel, { name: member.name })} onClick={(event) => ask(member, event)}>
                    {fr.admin.members.remove}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {removal && <RemovalDialog member={removal.member} busy={removing} onConfirm={() => void confirm()} onCancel={cancel} />}
    </section>
  );
}

// « Réessayer » : « Chargement… » prend sa place, et le focus tomberait en haut de la page. Il passe au titre de la section, tout de suite.
function retry(list: AdminList<unknown>, heading: HTMLElement | null): void {
  heading?.focus();
  void list.reload();
}

function LoadFailed({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="admin-failed">
      <Alert>{message}</Alert>
      <button type="button" className="bar-button" onClick={onRetry}>
        {fr.common.retry}
      </button>
    </div>
  );
}

// La confirmation d'un retrait : une boîte de dialogue modale (alertdialog), nommée par la personne et décrite par ses conséquences. Le
// focus est sur « Annuler », le geste sûr ; Tab ne sort pas de la boîte ; Échap et « Annuler » renoncent. Un clic sur le fond ne fait
// rien : un double clic sur « Retirer » le fermerait à peine ouvert, et la décision doit être un geste voulu. Le fond couvre la page, que
// la souris n'atteint plus.
//
// Le clavier est celui de la boîte : aucune touche n'en sort (stopPropagation), ni vers le panneau (Échap le fermerait), ni vers l'avatar
// (game/input.ts écoute la fenêtre). Pendant le retrait, les deux boutons sont inactifs et la boîte ne se ferme pas.
function RemovalDialog({ member, busy, onConfirm, onCancel }: { member: AdminMember; busy: boolean; onConfirm(): void; onCancel(): void }) {
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Tab') {
      // Le focus boucle entre les deux boutons. (Un clic dans la boîte, hors d'eux, donne le focus à la boîte elle-même.)
      const active = document.activeElement;
      if (event.shiftKey && (active === cancelButton.current || active === dialog.current)) {
        event.preventDefault();
        confirmButton.current?.focus();
      } else if (!event.shiftKey && active === confirmButton.current) {
        event.preventDefault();
        cancelButton.current?.focus();
      }
    }
  }

  return (
    <div
      className="admin-dialog-backdrop"
      onMouseDown={(event) => {
        // Appuyer sur le fond retirerait le focus à la boîte (au bouton qui l'a), et le clavier n'y serait plus : Échap et Tab iraient ailleurs.
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1} className="admin-dialog" onKeyDown={onKeyDown}>
        <h4 id={titleId}>{t(fr.admin.removal.title, { name: member.name })}</h4>
        <p id={bodyId}>{t(fr.admin.removal.body, { email: member.email })}</p>
        <div className="admin-dialog-actions">
          <button ref={cancelButton} type="button" className="bar-button" aria-disabled={busy || undefined} onClick={onCancel}>
            {fr.admin.removal.cancel}
          </button>
          <button ref={confirmButton} type="button" className="bar-button bar-button-danger" aria-disabled={busy || undefined} onClick={onConfirm}>
            {busy ? fr.admin.removal.confirming : fr.admin.removal.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
