import { CURRENT_RELEASE, isReleaseBehind, type Role } from '@bureau/shared';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { fr, t } from '../i18n/fr';
import { CloseIcon, ReleaseIcon, WhatsNewIcon } from '../office/icons';
import { IconButton } from '../office/ui/IconButton';
import { markReleaseSeen } from './release-api';
import { formatReleaseDate, groupsFor, releasesToShow, type Release } from './releases';
import { useWhatsNewStore } from './whats-new-store';

// Le temps qu'on laisse au bureau pour s'afficher avant la fenêtre : on voit d'abord qu'on est arrivé, puis ce qui a changé.
export const WHATS_NEW_DELAY_MS = 500;

// Ce qu'on peut atteindre au clavier dans la fenêtre : le piège du focus y tourne.
const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

interface WhatsNewProps {
  // Le rôle du compte : les nouveautés réservées aux admins ne sont montrées qu'à eux.
  role: Role;
  // La dernière version vue, telle que la session la dit (lib/session.ts) : null, aucune (on montre la version en cours) ; undefined, on ne sait pas
  // (la fenêtre ne s'ouvre pas d'elle-même).
  lastReleaseSeen: string | null | undefined;
  // Le bureau est en place : on est entré (après l'écran d'entrée), et le serveur a dit qui est là. Pas avant : la fenêtre ne passe jamais devant la
  // connexion ni devant l'écran d'entrée.
  ready: boolean;
}

// La fenêtre « Quoi de neuf ? » (docs/nouveautes.md), que la coque du bureau garde montée. Elle s'ouvre :
// - d'elle-même, une fois par compte, à la première entrée au bureau après une mise à jour (la dernière version vue est plus ancienne que CURRENT_RELEASE,
//   ou il n'y en a aucune) : elle montre les versions manquées, la plus récente d'abord ;
// - sur demande (la ligne « Nouveautés » du menu « Moi », useWhatsNewStore) : tout l'historique.
// Elle ne montre que les versions qui ont quelque chose à dire à ce rôle (releasesToShow) : un membre en retard d'une seule version faite pour les admins
// n'a pas de fenêtre du tout.
// La fermer (« C'est parti », la croix, Échap, un clic sur le fond) enregistre la version en cours comme vue : tout de suite ici (elle ne revient pas
// dans cette page), et sur le compte (POST /api/me/release-seen), sans attendre la réponse. Si l'enregistrement échoue, elle reviendra à la prochaine
// entrée : c'est le moindre mal.
//
// C'est une fenêtre modale (dialog), nommée par son titre et décrite par l'accroche de la version. Le focus va à « C'est parti » à l'ouverture (Entrée
// referme aussitôt), Tab ne sort pas de la fenêtre, et à la fermeture il revient d'où il venait (la puce « Moi » pour l'historique). Aucune touche
// n'en sort (stopPropagation) : le clavier de l'avatar (game/input.ts) écoute la fenêtre du navigateur, et ne fait pas marcher l'avatar derrière elle.
export function WhatsNew({ role, lastReleaseSeen, ready }: WhatsNewProps) {
  // La dernière version vue, gardée ici : la session ne sera relue qu'à la prochaine arrivée sur la page.
  const [seen, setSeen] = useState(lastReleaseSeen);
  const behind = seen !== undefined && isReleaseBehind(seen);
  const history = useWhatsNewStore((state) => state.history);
  // « Tout l'historique », demandé depuis la fenêtre ouverte d'elle-même.
  const [showAll, setShowAll] = useState(false);

  // La demande d'historique vit hors de la page (useWhatsNewStore) : si la page du bureau part pendant que l'historique est ouvert (session expirée,
  // déconnexion, mot de passe réinitialisé : retour à la connexion), on l'efface. Sinon, au retour, la fenêtre s'ouvrirait d'elle-même sur tout
  // l'historique dès « Entrer », sans qu'on l'ait demandé, avec un focus à rendre à une puce qui n'existe plus.
  useEffect(() => () => useWhatsNewStore.getState().closeHistory(), []);

  // Le moment où le bureau est en place, attendu un instant (WHATS_NEW_DELAY_MS) : la fenêtre ne s'ouvre d'elle-même qu'après.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ready || !behind) return;
    const timer = setTimeout(() => setSettled(true), WHATS_NEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, behind]);

  const all = history !== null || showAll;
  const releases = releasesToShow(seen ?? null, all, role);
  const open = releases.length > 0 && (history !== null || (behind && ready && settled));
  // « Tout l'historique » n'est proposé que s'il en montrerait davantage, à ce rôle.
  const canShowAll = !all && releasesToShow(seen ?? null, true, role).length > releases.length;

  // Où rendre le focus à la fermeture : ce qui a demandé l'historique, sinon ce qui avait le focus avant l'ouverture.
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnTo.current = history?.from ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    // Seulement à l'ouverture : passer à tout l'historique ne change pas d'où l'on vient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    if (behind) {
      setSeen(CURRENT_RELEASE);
      markReleaseSeen().catch(() => {
        // Pas enregistrée (réseau, session) : la fenêtre reviendra à la prochaine entrée.
      });
    }
    setShowAll(false);
    useWhatsNewStore.getState().closeHistory();
    const target = returnTo.current;
    returnTo.current = null;
    if (target?.isConnected) target.focus();
  }

  if (!open) return null;
  return <WhatsNewDialog releases={releases} role={role} canShowAll={canShowAll} onShowAll={() => setShowAll(true)} onClose={close} />;
}

interface DialogProps {
  releases: Release[];
  role: Role;
  // « Tout l'historique » : seulement quand il y a plus de versions que celles montrées.
  canShowAll: boolean;
  onShowAll(): void;
  onClose(): void;
}

function WhatsNewDialog({ releases, role, canShowAll, onShowAll, onClose }: DialogProps) {
  const titleId = useId();
  const introId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Un clic sur le fond ferme la fenêtre, s'il a commencé sur le fond : une sélection de texte commencée dans la carte et lâchée dehors ne la ferme pas.
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    done.current?.focus();
  }, []);

  // Tout l'historique : la liste s'allonge, et repart du haut ; le focus, qui était sur le bouton disparu, revient à « C'est parti ».
  function showAll() {
    onShowAll();
    requestAnimationFrame(() => {
      body.current?.scrollTo?.({ top: 0 });
      done.current?.focus();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const [latest, ...older] = releases;
  if (!latest) return null;
  return (
    <div
      className="whatsnew-backdrop"
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
        // Appuyer sur le fond ne retire pas le focus à la fenêtre : Échap et Tab y restent jusqu'au relâchement.
        if (pressedBackdrop.current) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedBackdrop.current) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={introId} tabIndex={-1} className="whatsnew" data-sfx-modal onKeyDown={onKeyDown}>
        <div className="whatsnew-banner" aria-hidden="true">
          <span className="whatsnew-tile" />
          <span className="whatsnew-tile" />
          <span className="whatsnew-tile" />
          <span className="whatsnew-tile" />
          <span className="whatsnew-mark">
            <WhatsNewIcon />
          </span>
        </div>
        <IconButton label={fr.ui.close} small tip="bottom" className="whatsnew-close" data-sfx="none" onClick={onClose}>
          <CloseIcon />
        </IconButton>

        {/* Le corps défile quand les notes dépassent la carte : il se prend au clavier (Tab), pour que les flèches et Page suivante le fassent défiler.
            Le focus du départ est dans le pied, et Safari ne donne pas le focus de lui-même à ce qui défile. */}
        <div ref={body} className="whatsnew-body" role="region" aria-labelledby={titleId} tabIndex={0}>
          <header className="whatsnew-head">
            <ReleaseBadge release={latest} />
            <h2 id={titleId}>{fr.whatsNew.title}</h2>
            <p id={introId}>{latest.tagline}</p>
          </header>
          <ReleaseNotes release={latest} role={role} />
          {older.map((release) => (
            <section key={release.version} className="whatsnew-older" aria-labelledby={`${titleId}-${release.version}`}>
              <h3 id={`${titleId}-${release.version}`}>
                <ReleaseBadge release={release} />
              </h3>
              <p className="whatsnew-tagline">{release.tagline}</p>
              <ReleaseNotes release={release} role={role} />
            </section>
          ))}
        </div>

        <footer className="whatsnew-foot">
          {canShowAll && (
            <button type="button" className="bar-button whatsnew-all" onClick={showAll}>
              {fr.whatsNew.history}
            </button>
          )}
          <button ref={done} type="button" className="button whatsnew-done" data-sfx="none" onClick={onClose}>
            {fr.whatsNew.done}
          </button>
        </footer>
      </div>
    </div>
  );
}

// La pastille d'une version : « v1.00 · 29 octobre 2026 » à l'écran, « Version 1.00, du 29 octobre 2026 » pour les lecteurs d'écran.
function ReleaseBadge({ release }: { release: Release }) {
  const date = formatReleaseDate(release.date);
  return (
    <span className="whatsnew-badge">
      <span aria-hidden="true">
        {t(fr.whatsNew.version, { version: release.version })}
        <span className="whatsnew-badge-dot">{' · '}</span>
        <span className="whatsnew-badge-date">{date}</span>
      </span>
      <span className="visually-hidden">{t(fr.whatsNew.badgeLabel, { version: release.version, date })}</span>
    </span>
  );
}

// Les nouveautés d'une version, rangées par genre (groupsFor) : un titre à la couleur du genre (Nouveautés, Améliorations…), puis ses nouveautés en
// lignes, le carré de l'icône teinté par le genre, le titre et le texte, une ligne chacun. Le titre d'un groupe nomme sa liste.
function ReleaseNotes({ release, role }: { release: Release; role: Role }) {
  const baseId = useId();
  return (
    <>
      {groupsFor(release, role).map(({ kind, entries }) => (
        <section key={kind} className="whatsnew-group" data-kind={kind}>
          <p id={`${baseId}-${kind}`} className="whatsnew-group-title">
            {fr.whatsNew.groups[kind]}
          </p>
          <ul className="whatsnew-list" aria-labelledby={`${baseId}-${kind}`}>
            {entries.map((entry) => (
              <li key={entry.title} className="whatsnew-entry">
                <span className="whatsnew-icon" aria-hidden="true">
                  <ReleaseIcon name={entry.icon} />
                </span>
                <div className="whatsnew-entry-text">
                  <p className="whatsnew-entry-title">
                    <strong>{entry.title}</strong>
                  </p>
                  <p>{entry.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// La ligne « Nouveautés » du menu « Moi », avec le numéro de la version en cours à droite : elle ferme le menu et ouvre tout l'historique. Le focus
// reviendra à la puce (`anchorRef`) quand la fenêtre se fermera.
export function WhatsNewMenuItem({ onClose, anchorRef }: { onClose(): void; anchorRef: RefObject<HTMLElement | null> }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="menu-item whatsnew-menu-item"
      aria-label={t(fr.whatsNew.menuItemLabel, { version: CURRENT_RELEASE })}
      onClick={() => {
        onClose();
        useWhatsNewStore.getState().openHistory(anchorRef.current);
      }}
    >
      <WhatsNewIcon />
      <span>{fr.whatsNew.menuItem}</span>
      <span className="menu-hint">{t(fr.whatsNew.version, { version: CURRENT_RELEASE })}</span>
    </button>
  );
}
