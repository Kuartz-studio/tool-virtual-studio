import { useEffect, useId, useRef, useState } from 'react';
import { fr, t } from '../i18n/fr';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { ActivityMark } from './ActivityMark';
import { ChevronUpIcon } from './icons';
import { MeMenu } from './MeMenu';
import type { PanelControls } from './panels';
import { levelOf } from '@bureau/shared';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { LevelBadge, XpBar } from './ui/ProgressBits';
import { gradeLabel } from './progress-format';

interface MeChipProps {
  // Le nom de la personne, tel que le serveur le dit (ou celui de la session avant), et son e-mail.
  name: string;
  email: string;
  // La connexion au bureau (le menu lui parle), null avant que la page l'ouvre.
  socket: OfficeSocket | null;
  // Comment ouvrir un panneau depuis le menu (la coque les tient : un seul est ouvert à la fois).
  panels: PanelControls;
  onSignOut(): void;
  signingOut: boolean;
}

// La puce « Moi », en bas à gauche : ton portrait avec la pastille de ton statut (de la couleur de ton mode, si tu en as un), ton nom, et dessous ton mode en cours (l'icône, ou le point de
// la couleur, et le nom de l'état d'activité) ou, sans mode, ton statut. Un seul bouton, nommé « Mon profil », qui ouvre le menu (MeMenu) vers
// le haut. Un lecteur d'écran entend le nom, le statut et le mode en description du bouton, et un changement de statut confirmé par le serveur.
//
// Ce qui est affiché est ce que le serveur a confirmé (`status:changed`, `activity:changed`), lu au magasin : pas de changement affiché que le
// serveur n'a pas pris. Avant son `init`, la puce montre le nom de la session, et ni point ni statut. Elle marche alors quand même : le menu
// doit s'ouvrir pour qu'on puisse se déconnecter.
export function MeChip({ name, email, socket, panels, onSignOut, signingOut }: MeChipProps) {
  const avatarKey = useOfficeStore((state) => state.self?.avatarKey ?? null);
  const status = useOfficeStore((state) => state.self?.status ?? null);
  const activity = useOfficeStore((state) => state.self?.activity ?? null);
  // Sa progression : la pastille du niveau sur le portrait, la barre de l'XP sous le nom. Avant le premier `init`, rien.
  const xp = useOfficeStore((state) => state.progress?.xp ?? null);

  const [open, setOpen] = useState(false);
  const menuId = useId();
  const detailsId = useId();
  const trigger = useRef<HTMLButtonElement>(null);

  // Le nom affiché sous le tien : celui de l'état d'activité en cours, sinon du statut.
  const label = status === null ? null : activity ? activity.label : fr.status[status];

  // Après un choix, le focus revient à la puce, dont la description ne change qu'à la confirmation du serveur : un lecteur d'écran n'entendrait
  // que l'ancien statut. Le nouveau est annoncé (aria-live), mais seulement quand c'est le sien qui change : ni à l'arrivée au bureau, ni
  // pour les autres.
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(label);
  useEffect(() => {
    if (label !== null && announced.current !== null && label !== announced.current) {
      setAnnouncement(t(fr.me.statusChanged, { status: label }));
    }
    announced.current = label;
  }, [label]);

  return (
    <div className="dock dock-me">
      <button
        ref={trigger}
        type="button"
        className="me-chip"
        aria-label={fr.me.chip}
        aria-describedby={detailsId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="me-portrait">
          <AvatarPortrait avatarKey={avatarKey} name={name} size={36} status={status} activity={activity} />
          {xp !== null && <LevelBadge level={levelOf(xp)} />}
        </span>
        <span className="me-text" id={detailsId}>
          <span className="me-name" title={name}>
            {name}
          </span>{' '}
          {label !== null && (
            <span className="me-mode" title={label}>
              {activity && <ActivityMark activity={activity} />}
              <span>{label}</span>
            </span>
          )}
          {xp !== null && <span className="visually-hidden">{gradeLabel(levelOf(xp))}</span>}
        </span>
        {xp !== null && <XpBar xp={xp} />}
        <ChevronUpIcon />
      </button>
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <MeMenu open={open} onClose={() => setOpen(false)} anchorRef={trigger} id={menuId} name={name} email={email} socket={socket} panels={panels} onSignOut={onSignOut} signingOut={signingOut} />
    </div>
  );
}
