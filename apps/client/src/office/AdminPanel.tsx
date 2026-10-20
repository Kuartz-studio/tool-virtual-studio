import type { Role } from '@bureau/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
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
// Le focus va au titre à l'ouverture (le lecteur d'écran l'annonce, et Tab entre dans le panneau) ; Échap ferme.
export function AdminPanel({ id, selfId, onClose }: { id?: string; selfId: string; onClose(): void }) {
  const members = useAdminList<AdminMember>('/api/admin/members');
  const invitations = useAdminList<PendingInvitation>('/api/admin/invitations');
  const players = useOfficeStore((state) => state.players);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

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
        <InviteSection reloadInvitations={reloadInvitations} />
        <InvitationsSection list={invitations} reloadMembers={reloadMembers} />
        <MembersSection list={members} selfId={selfId} />
      </div>
    </aside>
  );
}

// ---- Inviter -----------------------------------------------------------------------------------------------------------------------

// L'adresse et le rôle. Le champ ne se vide qu'à l'invitation envoyée : refusée, l'adresse reste, on la corrige. Le rôle revient alors
// à « Membre » : une invitation d'admin ne se répète pas par inadvertance.
function InviteSection({ reloadInvitations }: { reloadInvitations(): Promise<void> }) {
  const titleId = useId();
  const emailId = useId();
  const roleId = useId();
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
    try {
      await api('/api/admin/invitations', { method: 'POST', body: JSON.stringify({ email, role }) });
      // Le formulaire se vide s'il n'a pas changé depuis l'envoi : l'e-mail part pendant une ou deux secondes (Resend), et la personne
      // qui a déjà tapé l'adresse suivante la garde.
      setEmail((current) => (current === sent.email ? '' : current));
      setRole((current) => (current === sent.role ? 'member' : current));
      setFeedback({ kind: 'done', text: t(fr.admin.invite.sent, { email }) });
    } catch (err) {
      setFeedback({ kind: 'error', text: failureMessage(err, fr.admin.errors.notFoundInvitation) });
    }
    setSubmitting(false);
    // Le bouton a perdu le focus en devenant inactif : le champ le reprend, pour enchaîner ou corriger l'adresse.
    emailInput.current?.focus();
    void reloadInvitations();
  }

  return (
    <section className="admin-section" aria-labelledby={titleId}>
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
    </section>
  );
}

// ---- Invitations en attente ---------------------------------------------------------------------------------------------------------

// Une action à la fois dans la section. Les boutons sont alors inactifs par aria-disabled, et non par `disabled` : un bouton qui devient
// `disabled` perd le focus, et la personne au clavier se retrouverait en haut de la page.
function InvitationsSection({ list, reloadMembers }: { list: AdminList<PendingInvitation>; reloadMembers(): Promise<void> }) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function run(invitation: PendingInvitation, action: 'resend' | 'revoke') {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const path = `/api/admin/invitations/${encodeURIComponent(invitation.id)}`;
    // La ligne n'existera plus après la relecture : le focus ira au titre de la section.
    let gone = false;
    let notFound = false;
    try {
      if (action === 'resend') await api(`${path}/resend`, { method: 'POST' });
      else await api(path, { method: 'DELETE' });
      setFeedback({ kind: 'done', text: t(action === 'resend' ? fr.admin.pending.resent : fr.admin.pending.revoked, { email: invitation.email }) });
      gone = action === 'revoke';
    } catch (err) {
      notFound = isNotFound(err);
      setFeedback({ kind: 'error', text: failureMessage(err, fr.admin.errors.notFoundInvitation) });
      gone = notFound;
    }
    setBusy(false);
    if (gone) heading.current?.focus();
    void list.reload();
    // Une invitation qui n'est plus en attente a peut-être été acceptée : le compte est un nouveau membre.
    if (notFound) void reloadMembers();
  }

  const invitations = list.items;
  return (
    <section className="admin-section" aria-labelledby={titleId}>
      <h3 id={titleId} ref={heading} tabIndex={-1}>
        {invitations ? t(fr.admin.pending.titleCount, { count: invitations.length }) : fr.admin.pending.title}
      </h3>
      <FeedbackMessage feedback={feedback} />
      {invitations === null && !list.failed && <p className="admin-note">{fr.common.loading}</p>}
      {list.failed && <LoadFailed message={fr.admin.pending.loadFailed} onRetry={() => void list.reload()} />}
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
                  onClick={() => void run(invitation, 'resend')}
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

function MembersSection({ list, selfId }: { list: AdminList<AdminMember>; selfId: string }) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Le retrait qu'on demande à confirmer, et le bouton qui l'a demandé (le focus lui revient si on renonce).
  const [removal, setRemoval] = useState<{ member: AdminMember; opener: HTMLElement } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

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
    setRemoving(false);
    setRemoval(null);
    (gone ? heading.current : opener)?.focus();
    void list.reload();
  }

  const members = list.items;
  return (
    <section className="admin-section" aria-labelledby={titleId}>
      <h3 id={titleId} ref={heading} tabIndex={-1}>
        {members ? t(fr.admin.members.titleCount, { count: members.length }) : fr.admin.members.title}
      </h3>
      <FeedbackMessage feedback={feedback} />
      {members === null && !list.failed && <p className="admin-note">{fr.common.loading}</p>}
      {list.failed && <LoadFailed message={fr.admin.members.loadFailed} onRetry={() => void list.reload()} />}
      {members && members.length > 0 && (
        <ul className="admin-list">
          {members.map((member) => (
            <li key={member.id} className="admin-row">
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
              {/* Pas de bouton pour se retirer soi-même. */}
              {member.id !== selfId && (
                <button type="button" className="bar-button" aria-label={t(fr.admin.members.removeLabel, { name: member.name })} onClick={(event) => ask(member, event)}>
                  {fr.admin.members.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {removal && <RemovalDialog member={removal.member} busy={removing} onConfirm={() => void confirm()} onCancel={cancel} />}
    </section>
  );
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
