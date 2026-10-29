import { INVITATION_TTL_MS, type MailMode, type Role, type Status } from '@bureau/shared';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { fr, t } from '../i18n/fr';
import { api, ApiError } from '../lib/api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  InboxIcon,
  InviteIcon,
  KeyIcon,
  MailExpiredIcon,
  MailIcon,
  MoreIcon,
  RemoveMemberIcon,
  RenewIcon,
  ResendIcon,
  RevokeIcon,
  SearchIcon,
} from './icons';
import { LastSeen, useMinuteClock } from './LastSeen';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { Drawer } from './ui/Drawer';
import { IconButton } from './ui/IconButton';
import { Popover, type PopoverPlacement } from './ui/Popover';
import { Segmented, type SegmentedOption } from './ui/Segmented';

// Un membre actif, tel que GET /api/admin/members le dit. Seules les routes /api/admin donnent l'adresse e-mail d'un membre : aucun
// autre panneau ne la montre. `avatarKey` (son personnage) et `lastSeenAt` (sa dernière présence, ISO 8601, null s'il n'est jamais venu)
// manquent à un serveur d'avant : le portrait prend alors ses initiales, et la présence ne dit rien.
interface AdminMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarKey?: string | null;
  lastSeenAt?: string | null;
}

// Une invitation en attente, telle que GET /api/admin/invitations la dit. `expired` : son lien ne marche plus, mais on peut la renvoyer.
// `expiresAt` (ISO 8601) : quand il cessera de marcher, d'où « Expire dans 6 jours ».
interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  expired: boolean;
  expiresAt?: string;
}

const ROLES: readonly Role[] = ['member', 'admin'];

// Au-delà de ce nombre de membres, la liste a un champ de recherche : on ne cherche plus quelqu'un des yeux.
const SEARCH_FROM = 6;

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
    // Un nouvel essai après un échec : le squelette de nouveau.
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

// Ce qu'une partie du panneau dit du dernier geste de l'admin : c'est fait (`done`), ou la raison du refus (`error`).
interface Feedback {
  kind: 'done' | 'error';
  text: string;
}

// Un refus se lit tout de suite (role="alert"). Un « c'est fait » est écrit dans une région qui existait déjà (role="status"), pour qu'un
// lecteur d'écran l'annonce : une région qui apparaît avec son texte n'est pas toujours lue. À l'écran, il est sobre : une coche et une
// phrase, sans cadre ; seul le refus a son fond rouge.
function FeedbackMessage({ feedback }: { feedback: Feedback | null }) {
  return (
    <>
      {feedback?.kind === 'error' && <Alert>{feedback.text}</Alert>}
      <div role="status" className="admin-status">
        {feedback?.kind === 'done' && (
          <p className="admin-done">
            <CheckIcon />
            {feedback.text}
          </p>
        )}
      </div>
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

type AdminTab = 'members' | 'invitations';

// Le panneau Admin : réservé aux admins (OfficeShell ne le monte, et n'en montre la ligne du menu « Plus », que pour eux ; le serveur refuse
// de toute façon un membre : 403). Il a la coque des autres panneaux (Drawer : le titre, « Fermer », Échap), un peu plus large. En haut,
// deux onglets, « Membres » et « Invitations », chacun avec son nombre, et le bouton « Inviter », qui ouvre le formulaire dans une carte
// au-dessus de la liste :
// - Membres : son portrait (et le point de son statut s'il est en ligne, de la couleur de son état d'activité s'il en a pris un), son nom,
//   son adresse, son rôle et sa présence. Ses gestes sont dans le menu « … » de sa ligne : « Lien de mot de passe » (sans e-mail),
//   « Retirer du bureau », après une confirmation. Soi-même n'a pas de menu (le serveur refuse aussi de se retirer : `self`). Plus de six
//   membres : un champ de recherche.
// - Invitations (expirées comprises) : l'adresse, le rôle, ce qu'il reste à vivre au lien. Le menu « … » : « Renvoyer l'invitation » (sans
//   e-mail : « Nouveau lien »), « Annuler l'invitation ».
// Les deux listes restent montées, l'une cachée : un message ou une boîte de lien ne se perd pas quand on change d'onglet.
//
// Les listes (/api/admin/members et /api/admin/invitations) sont lues à l'ouverture. Après chaque geste, réussi ou non, la liste
// concernée est relue : un refus ne dit pas toujours que rien n'a changé (l'e-mail n'est pas parti mais l'invitation existe ; la réponse
// s'est perdue). Un « introuvable » relit les deux : une invitation acceptée entre-temps est un nouveau membre. Quelqu'un que la liste
// des membres ne connaît pas et qui arrive au bureau (une invitation vient d'être acceptée) les fait relire aussi, une fois par personne,
// comme le panneau Personnes.
//
// Sans e-mail (`mail` vaut « none » : MAILER=none, que dit GET /api/config), rien n'est envoyé : le serveur rend le lien d'une invitation
// créée ou renvoyée, et celui d'un mot de passe. Le panneau le montre dans une boîte à copier, une seule à la fois dans tout le panneau ; le
// serveur ne le redonne pas. Tant que `mail` est inconnu, le panneau est celui des e-mails.
//
// Le focus va au titre à l'ouverture (Drawer : le lecteur d'écran l'annonce, et Tab entre dans le panneau) ; Échap ferme ce qui est le
// plus près (un menu, la boîte de retrait, la recherche qu'on efface, le formulaire), puis le panneau.
export function AdminPanel({ id, selfId, mail, onClose }: { id?: string; selfId: string; mail?: MailMode | null; onClose(): void }) {
  const members = useAdminList<AdminMember>('/api/admin/members');
  const invitations = useAdminList<PendingInvitation>('/api/admin/invitations');
  const players = useOfficeStore((state) => state.players);
  const baseId = useId();
  const panelId = `${baseId}-liste`;
  const tabId = (which: AdminTab) => `${baseId}-${which}`;
  const inviteId = `${baseId}-inviter`;
  const [tab, setTab] = useState<AdminTab>('members');
  const [inviting, setInviting] = useState(false);
  const inviteButton = useRef<HTMLButtonElement>(null);
  // L'onglet ouvert : le focus y va quand la ligne qu'on venait d'utiliser disparaît, ou quand on réessaie de charger une liste.
  const panel = useRef<HTMLDivElement>(null);
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
  const noMail = mail === 'none';

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

  // L'invitation est en route (le formulaire attend la réponse) : la carte ne se ferme pas avant. Sans e-mail, la réponse porte le lien,
  // que le serveur ne redonnera pas : la carte fermée entre-temps, il arriverait là où rien ne le montre, et serait perdu sans un mot.
  const [sending, setSending] = useState(false);

  // Fermer le formulaire rend le focus à « Inviter », et masque le lien d'invitation qu'il montrait : rouvert, le formulaire repart à neuf.
  function closeInvite() {
    if (sending) return;
    setInviting(false);
    setShown((current) => (current?.place === 'invite' ? null : current));
    inviteButton.current?.focus();
  }

  const options: SegmentedOption<AdminTab>[] = [
    { id: 'members', label: fr.admin.tabs.members, count: members.items?.length },
    { id: 'invitations', label: fr.admin.tabs.invitations, count: invitations.items?.length },
  ];
  const loading = (tab === 'members' ? members : invitations).items === null;

  return (
    <Drawer id={id} title={fr.admin.title} onClose={onClose} className="admin-drawer">
      <div className="admin-toolbar">
        <Segmented label={fr.admin.tabs.label} value={tab} options={options} panelId={panelId} tabId={tabId} onSelect={(which) => setTab(which)} />
        <button
          ref={inviteButton}
          type="button"
          className="bar-button is-primary admin-invite-toggle"
          aria-expanded={inviting}
          aria-controls={inviting ? inviteId : undefined}
          // Pendant l'envoi, il ne ferme pas la carte : inactif par aria-disabled, et non `disabled`, pour garder le focus.
          aria-disabled={sending || undefined}
          onClick={() => (inviting ? closeInvite() : setInviting(true))}
        >
          <InviteIcon />
          {fr.admin.invite.toggle}
        </button>
      </div>
      <div className="admin-scroll">
        {inviting && (
          <InviteCard id={inviteId} reloadInvitations={reloadInvitations} noMail={noMail} links={links} submitting={sending} onSubmitting={setSending} onClose={closeInvite} />
        )}
        <div ref={panel} id={panelId} className="admin-tabpanel" role="tabpanel" aria-labelledby={tabId(tab)} aria-busy={loading || undefined} tabIndex={-1}>
          <MembersSection hidden={tab !== 'members'} list={members} selfId={selfId} canLinkPassword={noMail} links={links} panel={panel} />
          <InvitationsSection hidden={tab !== 'invitations'} list={invitations} reloadMembers={reloadMembers} noMail={noMail} links={links} panel={panel} />
        </div>
      </div>
    </Drawer>
  );
}

// Rend le focus à `target` après une réponse du serveur, mais seulement s'il n'est pas passé ailleurs pendant l'attente : nulle part (un
// bouton rendu inactif le perd), ou dans la partie du geste (le bouton qui l'a lancé, la boîte de retrait). Sinon la réponse le
// volerait à qui est passé à autre chose : la boîte de retrait ouverte entre-temps (derrière elle, Tab et Échap ne l'atteindraient plus,
// et Échap fermerait le panneau), un champ du Chat. Le retour du focus au bouton quand on ferme la boîte, lui, est immédiat : sans ce test.
function focusUnlessMoved(target: HTMLElement | null | undefined, section: HTMLElement | null): void {
  const active = document.activeElement;
  if (active === null || active === document.body || section?.contains(active)) target?.focus();
}

// ---- Un lien à transmettre -----------------------------------------------------------------------------------------------------------

// Un lien que le serveur vient de rendre et ne redonnera pas : il n'a gardé que l'empreinte du jeton.
interface ShownLink {
  // Un numéro par résultat : la boîte d'un résultat neuf repart de zéro (« Lien copié » oublié), même si le lien s'écrit pareil.
  key: number;
  // Où la boîte paraît : dans la carte du formulaire (`invite`), ou en tête de l'onglet du geste qui l'a produite.
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

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
// La durée de validité d'une invitation, en jours, telle que le serveur la fixe (INVITATION_TTL_MS).
const INVITATION_DAYS = Math.round(INVITATION_TTL_MS / DAY_MS);

// L'emplacement de la boîte. Une région vivante (aria-live), qui existe avant la boîte et vide, ne porte que la phrase de la boîte : un
// lecteur d'écran l'annonce quand elle paraît. Le lien (son jeton ouvre un compte), les boutons et la durée de validité n'y sont pas : le
// focus, qui va à « Copier le lien », les présente à qui le suit. (Ce n'est pas une région role="status" : chaque partie du panneau en a
// déjà une, pour ses messages.) Le conteneur est un groupe nommé par la phrase tant que la boîte est là.
function LinkSlot({ links, place, section }: { links: Links; place: ShownLink['place']; section: RefObject<HTMLElement | null> }) {
  const introId = useId();
  const shown = links.shown?.place === place ? links.shown : null;
  return (
    <div className="admin-link" data-open={shown ? 'true' : undefined} role={shown ? 'group' : undefined} aria-labelledby={shown ? introId : undefined}>
      <div aria-live="polite">
        {shown && (
          <p id={introId} className="admin-link-intro">
            {shown.intro}
          </p>
        )}
      </div>
      {shown && <LinkBox key={shown.key} shown={shown} introId={introId} section={section} onDismiss={() => dismiss(links)} />}
    </div>
  );
}

// Masquer la boîte rend le focus au bouton du geste, avant qu'elle ne disparaisse avec celui qu'elle avait.
function dismiss(links: Links): void {
  const target = links.shown?.returnFocus();
  links.hide();
  target?.focus();
}

// Le lien dans un champ en lecture seule (nommé par la phrase, qui est dans LinkSlot), avec au bout le bouton « Copier le lien » ; puis,
// sous un trait pointillé, comme le talon d'un ticket, la durée de validité ; et la croix « Masquer le lien », dans le coin. À son
// apparition, le focus va à « Copier le lien », sauf s'il était passé ailleurs pendant l'attente (focusUnlessMoved). « Lien copié »
// s'écrit dans une région vivante déjà là, vide : la seule autre chose qu'un lecteur d'écran annonce. Copié, le bouton montre une coche.
function LinkBox({ shown, introId, section, onDismiss }: { shown: ShownLink; introId: string; section: RefObject<HTMLElement | null>; onDismiss(): void }) {
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
    <>
      <div className="admin-link-row">
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
        <IconButton ref={copyButton} label={fr.admin.link.copy} small tip="bottom" tone={copied === 'copied' ? 'accent' : 'default'} onClick={() => void copy()}>
          {copied === 'copied' ? <CheckIcon /> : <CopyIcon />}
        </IconButton>
      </div>
      <p className="admin-link-copied" aria-live="polite">
        {copied === 'copied' ? fr.admin.link.copied : copied === 'selected' ? fr.admin.link.selected : ''}
      </p>
      <div className="admin-link-tear" aria-hidden="true" />
      <p id={hintId} className="admin-link-hint">
        {shown.validity}
      </p>
      <IconButton className="admin-link-dismiss" label={fr.admin.link.dismiss} small tip="bottom" onClick={onDismiss}>
        <CloseIcon />
      </IconButton>
    </>
  );
}

// ---- Inviter -----------------------------------------------------------------------------------------------------------------------

// Le choix du rôle : deux positions, « Membre » et « Admin », côte à côte (un groupe de boutons radio). Il suit le motif « radiogroup » :
// le choisi est le seul dans l'ordre de tabulation, et les flèches passent à l'autre, choix et focus ensemble. Ces flèches sont aussi
// celles de l'avatar : prises ici (preventDefault), il ne les voit pas.
function RolePicker({ value, onChange }: { value: Role; onChange(role: Role): void }) {
  const labelId = useId();
  const buttons = useRef(new Map<Role, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: Role;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowUp':
        next = value === 'member' ? 'admin' : 'member';
        break;
      case 'Home':
        next = 'member';
        break;
      case 'End':
        next = 'admin';
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(next);
    buttons.current.get(next)?.focus();
  }

  return (
    <div className="admin-role">
      <span id={labelId} className="admin-role-label">
        {fr.admin.invite.role}
      </span>
      <div className="seg admin-role-seg" role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown}>
        {ROLES.map((role) => (
          <button
            key={role}
            ref={(element) => {
              if (element) buttons.current.set(role, element);
              else buttons.current.delete(role);
            }}
            type="button"
            role="radio"
            className="seg-tab"
            aria-checked={value === role}
            tabIndex={value === role ? 0 : -1}
            onClick={() => onChange(role)}
          >
            {fr.admin.roles[role]}
          </button>
        ))}
      </div>
    </div>
  );
}

// La carte du formulaire, sous les onglets : l'adresse, le rôle, et le bouton qui envoie. Le champ prend le focus à l'ouverture. Il ne se
// vide qu'à l'invitation envoyée : refusée, l'adresse reste, on la corrige. Le rôle revient alors à « Membre » : une invitation d'admin ne
// se répète pas par inadvertance. La carte reste ouverte après un envoi, pour enchaîner ; sa croix, « Inviter » et Échap la ferment, sauf
// pendant l'envoi (`submitting`, que tient le panneau : « Inviter » en dépend aussi) : elle attend sa réponse, et le lien qu'elle porte.
// `noMail` (MAILER=none) : rien n'est envoyé, le bouton dit « Créer le lien d'invitation » au lieu d'« Envoyer l'invitation », et le lien
// paraît dans la carte, sous le formulaire.
function InviteCard({
  id,
  reloadInvitations,
  noMail,
  links,
  submitting,
  onSubmitting,
  onClose,
}: {
  id: string;
  reloadInvitations(): Promise<void>;
  noMail: boolean;
  links: Links;
  submitting: boolean;
  onSubmitting(submitting: boolean): void;
  onClose(): void;
}) {
  const titleId = useId();
  const emailId = useId();
  const section = useRef<HTMLElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    emailInput.current?.focus();
  }, []);

  const submitLabel = noMail ? { idle: fr.admin.invite.create, busy: fr.admin.invite.creating } : { idle: fr.admin.invite.submit, busy: fr.admin.invite.submitting };

  // Un champ e-mail ne garde pas les espaces autour de l'adresse (le navigateur les retire de sa valeur), et le serveur les retire aussi.
  const canSubmit = email !== '' && !submitting;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const sent = { email, role };
    onSubmitting(true);
    setFeedback(null);
    let hasLink = false;
    try {
      const created = await api<{ id: string; link?: string } | undefined>('/api/admin/invitations', { method: 'POST', body: JSON.stringify({ email, role }) });
      // Le formulaire se vide s'il n'a pas changé depuis l'envoi : l'e-mail part pendant une ou deux secondes (Resend), et la personne
      // qui a déjà tapé l'adresse suivante la garde.
      setEmail((current) => (current === sent.email ? '' : current));
      setRole((current) => (current === sent.role ? 'member' : current));
      if (typeof created?.link === 'string') {
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
    onSubmitting(false);
    // Le bouton a perdu le focus en devenant inactif : le champ le reprend, pour enchaîner ou corriger l'adresse. (Avec un lien, c'est
    // « Copier le lien » qui le prend : il faut d'abord le transmettre.)
    if (!hasLink) focusUnlessMoved(emailInput.current, section.current);
    void reloadInvitations();
  }

  // Échap ferme la carte (et rend le focus à « Inviter ») avant de fermer le panneau ; dans une composition (touche morte), il l'annule.
  // Pendant l'envoi, il ne ferme rien, ni la carte ni le panneau (comme la boîte de retrait pendant le retrait).
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (!submitting) onClose();
  }

  return (
    <section ref={section} id={id} className="admin-invite" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="admin-invite-head">
        <h3 id={titleId}>{fr.admin.invite.title}</h3>
        <IconButton label={fr.admin.invite.close} small tip="bottom" aria-disabled={submitting || undefined} onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      <form className="admin-invite-form" onSubmit={submit} noValidate>
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
            placeholder={fr.admin.invite.emailPlaceholder}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              // Le message d'avant parlait de l'adresse d'avant.
              setFeedback(null);
            }}
          />
        </div>
        <div className="admin-invite-row">
          <RolePicker value={role} onChange={setRole} />
          <button type="submit" className="bar-button is-primary admin-invite-submit" disabled={!canSubmit}>
            {submitting ? submitLabel.busy : submitLabel.idle}
          </button>
        </div>
        <FeedbackMessage feedback={feedback} />
      </form>
      <LinkSlot links={links} place="invite" section={section} />
    </section>
  );
}

// ---- Le menu « … » d'une ligne -------------------------------------------------------------------------------------------------------

interface MenuEntry {
  key: string;
  label: string;
  icon: ReactNode;
  // Le geste qu'on ne défait pas (retirer, annuler) : en rouge.
  danger?: boolean;
  select(): void;
}

// Le menu ouvert dans une liste : la ligne qui l'a ouvert, et son bouton « … » (l'ancre du menu, à qui le focus revient).
interface OpenMenu {
  id: string;
  anchor: HTMLElement;
}

// Les gestes d'une ligne, dans une fenêtre (Popover, role="menu") sous son bouton « … », ou au-dessus quand la ligne est dans le bas de la
// page : le menu reste dans la page. Le focus va à la première ligne ; ↑ ↓ passent de l'une à l'autre, Début et Fin vont aux extrémités ;
// Échap ferme et rend le focus au bouton ; Tab aussi, d'où la touche continue (l'élément qui suit le bouton). Aucune de ces touches ne sort
// du menu : ni vers le panneau (Échap le fermerait), ni vers l'avatar (game/input.ts écoute la fenêtre). Un clic ailleurs le ferme.
function RowMenu({ id, anchor, label, entries, onDismiss }: { id: string; anchor: HTMLElement; label: string; entries: MenuEntry[]; onDismiss(): void }) {
  const anchorRef = useRef<HTMLElement | null>(anchor);
  const items = useRef<HTMLDivElement>(null);
  const [placement] = useState<PopoverPlacement>(() => (anchor.getBoundingClientRect().bottom > window.innerHeight * 0.6 ? 'top-end' : 'bottom-end'));
  const lines = () => Array.from(items.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // Sans faire défiler la liste : au premier rendu, la fenêtre n'est pas encore posée sous son bouton (Popover la mesure juste après), et le
  // navigateur ferait défiler la liste jusqu'à l'endroit où elle serait sans cela.
  useEffect(() => {
    lines()[0]?.focus({ preventScroll: true });
  }, []);

  // La fenêtre est posée à la page (position fixe) une fois pour toutes, mais la liste, elle, défile : la molette (sur la liste, ou sur le
  // menu, qui est dans la liste) emporterait le bouton « … » loin de son menu, qui flotterait sur une autre ligne. La liste qui défile
  // ferme donc le menu ; le focus, s'il y était, revient au bouton, sans faire défiler à rebours ce que la personne vient de faire défiler.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const scroller = anchor.closest('.admin-scroll');
    if (!scroller) return;
    const close = () => {
      const hadFocus = items.current?.contains(document.activeElement) ?? false;
      dismissRef.current();
      if (hadFocus) anchor.focus({ preventScroll: true });
    };
    scroller.addEventListener('scroll', close, { passive: true });
    return () => scroller.removeEventListener('scroll', close);
  }, [anchor]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const all = lines();
    const index = all.findIndex((line) => line === document.activeElement);
    const focusAt = (at: number) => all[(at + all.length) % all.length]?.focus({ preventScroll: true });
    switch (event.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index === -1 ? -1 : index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(-1);
        break;
      case 'Escape':
        onDismiss();
        anchor.focus();
        break;
      case 'Tab':
        // Le focus revient au bouton, d'où la touche continue : l'élément suivant (ou précédent avec Maj) du bouton, et non du menu qui
        // disparaît.
        event.stopPropagation();
        onDismiss();
        anchor.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <Popover open onClose={onDismiss} anchorRef={anchorRef} placement={placement} label={label} role="menu" id={id}>
      <div ref={items} className="admin-menu" onKeyDown={onKeyDown}>
        {entries.map((entry) => (
          <button key={entry.key} type="button" role="menuitem" tabIndex={-1} className={entry.danger ? 'menu-item is-danger' : 'menu-item'} onClick={entry.select}>
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}

// Le bouton « … » d'une ligne : son nom dit pour qui il agit, et il dit si son menu est ouvert. Pendant le geste d'une autre ligne de la
// même liste, il est inactif par aria-disabled, et non par `disabled` : un bouton qui devient `disabled` perd le focus, et la personne au
// clavier se retrouverait en haut de la page.
function MoreButton({ label, open, menuId, busy, onToggle }: { label: string; open: boolean; menuId: string; busy: boolean; onToggle(anchor: HTMLElement): void }) {
  return (
    <IconButton
      className="admin-row-more"
      label={label}
      small
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-disabled={busy || undefined}
      onClick={(event) => {
        if (!busy) onToggle(event.currentTarget);
      }}
    >
      <MoreIcon />
    </IconButton>
  );
}

// ---- Les états d'une liste ---------------------------------------------------------------------------------------------------------

// En attendant la liste : trois lignes grises, à la forme des vraies (le portrait, le nom, l'adresse). « Chargement… » pour les lecteurs
// d'écran seulement ; l'onglet, lui, est aria-busy.
function ListSkeleton() {
  return (
    <div className="admin-skeleton">
      <p className="visually-hidden">{fr.common.loading}</p>
      {[0, 1, 2].map((line) => (
        <div key={line} className="admin-skeleton-row" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

// Une liste vide : une icône, une phrase, et ce qu'on peut y faire.
function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="admin-empty">
      <span className="admin-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="admin-empty-title">{title}</p>
      {hint && <p className="admin-empty-hint">{hint}</p>}
    </div>
  );
}

// « Réessayer » : le squelette prend sa place, et le focus tomberait en haut de la page. Il passe à l'onglet, tout de suite.
function retry(list: AdminList<unknown>, panel: HTMLElement | null): void {
  panel?.focus();
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

// ---- Invitations en attente ---------------------------------------------------------------------------------------------------------

// Ce qu'il reste à vivre au lien d'une invitation : « Expire dans 6 jours », « Expire dans 1 jour », puis en heures le dernier jour, et
// « Expirée » quand le serveur le dit, ou quand la date est passée (le panneau est resté ouvert au-delà, ou l'horloge de la page avance sur
// celle du serveur) : l'invitation prend alors aussi l'air d'une expirée (`expired`). Les jours sont arrondis au plus proche : une invitation
// qu'on vient de créer en a sept, et non six et des poussières. Sans date (un serveur d'avant), rien d'écrit.
function expiryOf(invitation: Pick<PendingInvitation, 'expired' | 'expiresAt'>, now: number): { expired: boolean; label: string } {
  const expired = { expired: true, label: fr.admin.pending.expired };
  if (invitation.expired) return expired;
  const expiresAt = invitation.expiresAt === undefined ? Number.NaN : Date.parse(invitation.expiresAt);
  if (Number.isNaN(expiresAt)) return { expired: false, label: '' };
  const left = expiresAt - now;
  if (left <= 0) return expired;
  if (left >= 2 * DAY_MS) return { expired: false, label: t(fr.admin.pending.expiresInDays, { count: Math.round(left / DAY_MS) }) };
  if (left >= DAY_MS) return { expired: false, label: fr.admin.pending.expiresInDay };
  if (left >= HOUR_MS) return { expired: false, label: t(fr.admin.pending.expiresInHours, { count: Math.floor(left / HOUR_MS) }) };
  return { expired: false, label: fr.admin.pending.expiresSoon };
}

// Une action à la fois dans la liste : les boutons « … » sont alors inactifs (aria-disabled, voir MoreButton).
// `noMail` (MAILER=none) : rien n'est renvoyé par e-mail, « Renvoyer l'invitation » devient « Nouveau lien » (le lien neuf s'affiche dans
// une boîte, en tête de l'onglet).
function InvitationsSection({
  hidden,
  list,
  reloadMembers,
  noMail,
  links,
  panel,
}: {
  hidden: boolean;
  list: AdminList<PendingInvitation>;
  reloadMembers(): Promise<void>;
  noMail: boolean;
  links: Links;
  panel: RefObject<HTMLDivElement | null>;
}) {
  const section = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  async function run(invitation: PendingInvitation, action: 'resend' | 'revoke', opener: HTMLElement) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const path = `/api/admin/invitations/${encodeURIComponent(invitation.id)}`;
    // La ligne n'existera plus après la relecture : le focus ira à l'onglet.
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
            returnFocus: () => (opener.isConnected ? opener : panel.current),
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
    focusUnlessMoved(gone ? panel.current : opener, section.current);
    void list.reload();
    // Une invitation qui n'est plus en attente a peut-être été acceptée : le compte est un nouveau membre.
    if (notFound) void reloadMembers();
  }

  // Choisir une ligne du menu le ferme et rend le focus au bouton « … », qui le garde pendant le geste.
  function choose(invitation: PendingInvitation, action: 'resend' | 'revoke', anchor: HTMLElement) {
    setMenu(null);
    anchor.focus();
    void run(invitation, action, anchor);
  }

  const invitations = list.items;
  // L'heure, remise à jour chaque minute : un panneau resté ouvert voit les heures décroître, puis le lien expirer.
  const now = useMinuteClock();
  const open = invitations?.find((invitation) => invitation.id === menu?.id);
  return (
    <div ref={section} className="admin-section" data-list="invitations" hidden={hidden}>
      <FeedbackMessage feedback={feedback} />
      <LinkSlot links={links} place="pending" section={section} />
      {invitations === null && !list.failed && <ListSkeleton />}
      {list.failed && <LoadFailed message={fr.admin.pending.loadFailed} onRetry={() => retry(list, panel.current)} />}
      {invitations?.length === 0 && <EmptyState icon={<InboxIcon />} title={fr.admin.pending.empty} hint={fr.admin.pending.emptyHint} />}
      {invitations && invitations.length > 0 && (
        <ul className="admin-list">
          {invitations.map((invitation) => {
            const expiry = expiryOf(invitation, now);
            return (
              <li key={invitation.id} className="admin-row" data-expired={expiry.expired ? 'true' : undefined}>
                <span className="admin-tile" aria-hidden="true">
                  {expiry.expired ? <MailExpiredIcon /> : <MailIcon />}
                </span>
                <span className="admin-row-text">
                  {/* Une adresse trop longue est coupée (« … ») : l'infobulle la donne en entier. */}
                  <span className="admin-row-name" title={invitation.email}>
                    {invitation.email}
                  </span>
                  {expiry.label && <span className="admin-row-sub admin-expiry">{expiry.label}</span>}
                </span>
                <span className="admin-row-meta">
                  <span className="admin-badge" data-role={invitation.role}>
                    {fr.admin.roles[invitation.role]}
                  </span>
                </span>
                <MoreButton
                  label={t(fr.admin.actions, { name: invitation.email })}
                  open={menu?.id === invitation.id}
                  menuId={menuId}
                  busy={busy}
                  onToggle={(anchor) => setMenu((current) => (current?.id === invitation.id ? null : { id: invitation.id, anchor }))}
                />
              </li>
            );
          })}
        </ul>
      )}
      {menu && open && (
        <RowMenu
          key={menu.id}
          id={menuId}
          anchor={menu.anchor}
          label={t(fr.admin.actions, { name: open.email })}
          onDismiss={() => setMenu(null)}
          entries={[
            {
              key: 'resend',
              label: noMail ? fr.admin.pending.renew : fr.admin.pending.resend,
              icon: noMail ? <RenewIcon /> : <ResendIcon />,
              select: () => choose(open, 'resend', menu.anchor),
            },
            { key: 'revoke', label: fr.admin.pending.revoke, icon: <RevokeIcon />, danger: true, select: () => choose(open, 'revoke', menu.anchor) },
          ]}
        />
      )}
    </div>
  );
}

// ---- Membres -----------------------------------------------------------------------------------------------------------------------

// Pour chercher sans tenir compte des accents ni des majuscules : « cleo » trouve « Cléo ».
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// `canLinkPassword` : le serveur n'envoie pas d'e-mail (MAILER=none), l'admin demande lui-même le lien de mot de passe d'un membre.
function MembersSection({
  hidden,
  list,
  selfId,
  canLinkPassword,
  links,
  panel,
}: {
  hidden: boolean;
  list: AdminList<AdminMember>;
  selfId: string;
  canLinkPassword: boolean;
  links: Links;
  panel: RefObject<HTMLDivElement | null>;
}) {
  const section = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // Qui est là : leur personnage du moment (il a pu changer depuis la lecture de la liste), leur statut et leur état d'activité : le point
  // du portrait, de la couleur de l'état quand il y en a un (comme partout ailleurs : la puce « Moi », le panneau Personnes, le bureau).
  const players = useOfficeStore((state) => state.players);
  const selfStatus = useOfficeStore((state) => state.self?.status ?? null);
  const selfActivity = useOfficeStore((state) => state.self?.activity ?? null);
  // Le retrait qu'on demande à confirmer, et le bouton qui l'a demandé (le focus lui revient si on renonce).
  const [removal, setRemoval] = useState<{ member: AdminMember; opener: HTMLElement } | null>(null);
  const [removing, setRemoving] = useState(false);
  // Un lien de mot de passe est en cours de demande : une seule à la fois dans la liste (aria-disabled, comme les invitations).
  const [requesting, setRequesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [query, setQuery] = useState('');

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
        returnFocus: () => (opener.isConnected ? opener : panel.current),
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: failureMessage(err, fr.admin.errors.notFoundMember) });
      gone = isNotFound(err);
    }
    setRequesting(false);
    if (gone) {
      links.forget(`member:${member.id}`);
      focusUnlessMoved(panel.current, section.current);
      void list.reload();
    }
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
    // Retiré, ou déjà retiré : la ligne n'existera plus après la relecture, le focus ira à l'onglet. Refusé : il revient au bouton « … »,
    // qui existe toujours.
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
    focusUnlessMoved(gone ? panel.current : opener, section.current);
    void list.reload();
  }

  // Choisir une ligne du menu le ferme et rend le focus au bouton « … » : la boîte de retrait le prend ensuite, et le lui rend.
  function choose(member: AdminMember, action: 'password' | 'remove', anchor: HTMLElement) {
    setMenu(null);
    anchor.focus();
    setFeedback(null);
    if (action === 'password') void requestPasswordLink(member, anchor);
    else setRemoval({ member, opener: anchor });
  }

  const members = list.items;
  const searchable = members !== null && members.length > SEARCH_FROM;
  const needle = searchable ? fold(query.trim()) : '';
  const visible = members && needle !== '' ? members.filter((member) => fold(member.name).includes(needle) || fold(member.email).includes(needle)) : members;
  const open = members?.find((member) => member.id === menu?.id);
  return (
    <div ref={section} className="admin-section" data-list="members" hidden={hidden}>
      <FeedbackMessage feedback={feedback} />
      <LinkSlot links={links} place="members" section={section} />
      {searchable && (
        <label className="admin-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            aria-label={fr.admin.members.search}
            placeholder={fr.admin.members.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Échap efface d'abord la recherche ; une recherche vide, il ferme le panneau.
              if (event.key !== 'Escape' || query === '' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.stopPropagation();
              setQuery('');
            }}
          />
        </label>
      )}
      {members === null && !list.failed && <ListSkeleton />}
      {list.failed && <LoadFailed message={fr.admin.members.loadFailed} onRetry={() => retry(list, panel.current)} />}
      {visible?.length === 0 && needle !== '' && <EmptyState icon={<SearchIcon />} title={t(fr.admin.members.noMatch, { query: query.trim() })} />}
      {visible && visible.length > 0 && (
        <ul className="admin-list">
          {visible.map((member) => {
            const mine = member.id === selfId;
            const player = players[member.id];
            // Soi-même est là, puisqu'on regarde le panneau ; les autres, s'ils sont dans le bureau.
            const online = mine || player !== undefined;
            const status: Status | null = mine ? selfStatus : (player?.status ?? null);
            const activity = mine ? selfActivity : (player?.activity ?? null);
            const seenAt = member.lastSeenAt ? Date.parse(member.lastSeenAt) : Number.NaN;
            return (
              <li key={member.id} className="admin-row" data-online={online ? 'true' : undefined}>
                <AvatarPortrait avatarKey={player?.avatarKey ?? member.avatarKey ?? null} name={member.name} size={36} status={status} activity={activity} />
                <span className="admin-row-text">
                  <span className="admin-row-head">
                    {/* Un nom ou une adresse trop longs sont coupés (« … ») : l'infobulle les donne en entier. */}
                    <span className="admin-row-name" title={member.name}>
                      {member.name}
                    </span>
                    {mine && <span className="admin-row-you">{fr.admin.you}</span>}
                  </span>
                  <span className="admin-row-sub" title={member.email}>
                    {member.email}
                  </span>
                </span>
                <span className="admin-row-meta">
                  <span className="admin-badge" data-role={member.role}>
                    {fr.admin.roles[member.role]}
                  </span>
                  <span className="admin-row-seen">
                    {online ? fr.admin.members.online : Number.isNaN(seenAt) ? fr.admin.members.neverSeen : <LastSeen at={seenAt} />}
                  </span>
                </span>
                {/* Pas de menu pour soi : ni se retirer soi-même, ni se demander son propre lien de mot de passe. */}
                {mine ? (
                  <span className="admin-row-more" aria-hidden="true" />
                ) : (
                  <MoreButton
                    label={t(fr.admin.actions, { name: member.name })}
                    open={menu?.id === member.id}
                    menuId={menuId}
                    busy={requesting}
                    onToggle={(anchor) => setMenu((current) => (current?.id === member.id ? null : { id: member.id, anchor }))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {menu && open && (
        <RowMenu
          key={menu.id}
          id={menuId}
          anchor={menu.anchor}
          label={t(fr.admin.actions, { name: open.name })}
          onDismiss={() => setMenu(null)}
          entries={[
            ...(canLinkPassword ? [{ key: 'password', label: fr.admin.members.passwordLink, icon: <KeyIcon />, select: () => choose(open, 'password', menu.anchor) }] : []),
            { key: 'remove', label: fr.admin.members.remove, icon: <RemoveMemberIcon />, danger: true, select: () => choose(open, 'remove', menu.anchor) },
          ]}
        />
      )}
      {removal && <RemovalDialog member={removal.member} busy={removing} onConfirm={() => void confirm()} onCancel={cancel} />}
    </div>
  );
}

// La confirmation d'un retrait : une boîte de dialogue modale (alertdialog), nommée par la personne et décrite par ses conséquences. Le
// focus est sur « Annuler », le geste sûr ; Tab ne sort pas de la boîte ; Échap et « Annuler » renoncent. Un clic sur le fond ne fait
// rien : un double clic sur « Retirer » le fermerait à peine ouverte, et la décision doit être un geste voulu. Le fond couvre la page, que
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
        <span className="admin-dialog-icon" aria-hidden="true">
          <RemoveMemberIcon />
        </span>
        <h4 id={titleId}>{t(fr.admin.removal.title, { name: member.name })}</h4>
        <p id={bodyId}>{t(fr.admin.removal.body, { email: member.email })}</p>
        <div className="admin-dialog-actions">
          <button ref={cancelButton} type="button" className="bar-button" aria-disabled={busy || undefined} onClick={onCancel}>
            {fr.admin.removal.cancel}
          </button>
          <button ref={confirmButton} type="button" className="bar-button is-danger" aria-disabled={busy || undefined} onClick={onConfirm}>
            {busy ? fr.admin.removal.confirming : fr.admin.removal.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
