import type { ReactNode } from 'react';

// Les icônes des commandes et des vignettes : des traits de la couleur du texte (currentColor). Elles sont décoratives (le nom du bouton
// dit tout) : cachées aux lecteurs d'écran, et sans texte (un textContent vide).
function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function MicIcon({ off = false, size }: { off?: boolean; size?: number }) {
  return (
    <Icon size={size}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {off && <path d="M4 4l16 16" />}
    </Icon>
  );
}

export function CameraIcon({ off = false }: { off?: boolean }) {
  return (
    <Icon>
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="M15 10l6-3v10l-6-3" />
      {off && <path d="M3 3l18 18" />}
    </Icon>
  );
}

// Les quatre coins qui s'écartent (plein écran), ou qui se resserrent (en sortir).
export function FullscreenIcon({ exit = false }: { exit?: boolean }) {
  return (
    <Icon>
      {exit ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
    </Icon>
  );
}

export function ScreenIcon() {
  return (
    <Icon>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </Icon>
  );
}

// Une note de musique, barrée quand la musique est coupée.
export function MusicIcon({ off = false }: { off?: boolean }) {
  return (
    <Icon>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
      {off && <path d="M3 3l18 18" />}
    </Icon>
  );
}

// Un haut-parleur : avec des ondes quand le son est là, barré quand il est coupé.
export function VolumeIcon({ off = false }: { off?: boolean }) {
  return (
    <Icon>
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      {off ? <path d="M22 9l-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
    </Icon>
  );
}

// Des étincelles : les effets sonores.
export function SparklesIcon({ off = false }: { off?: boolean }) {
  return (
    <Icon>
      <path d="M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z" />
      {off && <path d="M3 3l18 18" />}
    </Icon>
  );
}

// Les icônes des boutons de la barre et des panneaux (tracés d'après Lucide, licence ISC : voir public/assets/CREDITS.txt).
export function ChatIcon() {
  return (
    <Icon>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
    </Icon>
  );
}

export function UsersIcon() {
  return (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

// Un visage souriant : le personnage.
export function SmileIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
    </Icon>
  );
}

// Un ordinateur portable : le bureau de la personne.
export function LaptopIcon() {
  return (
    <Icon>
      <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.3 2.6a1 1 0 0 1-.9 1.4H3.6a1 1 0 0 1-.9-1.4L4 16" />
    </Icon>
  );
}

export function ShieldIcon() {
  return (
    <Icon>
      <path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
    </Icon>
  );
}

// Une fiole : le bac à sable des essais.
export function FlaskIcon() {
  return (
    <Icon>
      <path d="M10 2v7.3M14 9.3V2M8.5 2h7M14 9.3a6.5 6.5 0 1 1-4 0M5.5 16h13" />
    </Icon>
  );
}

export function LogOutIcon() {
  return (
    <Icon>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon size={16}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  );
}

// Un chevron vers le haut : le menu des statuts s'ouvre vers le haut.
export function ChevronUpIcon() {
  return (
    <Icon size={14}>
      <path d="m18 15-6-6-6 6" />
    </Icon>
  );
}

export function EraserIcon() {
  return (
    <Icon>
      <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </Icon>
  );
}
