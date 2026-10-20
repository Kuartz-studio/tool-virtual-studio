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

export function ScreenIcon() {
  return (
    <Icon>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </Icon>
  );
}
