import {
  AudioLines,
  BookOpen,
  ChevronRight,
  ChevronUp,
  Coffee,
  DoorClosed,
  DoorOpen,
  Ellipsis,
  Eraser,
  FlaskConical,
  Focus,
  Gamepad2,
  Lightbulb,
  LightbulbOff,
  LogOut,
  MapPin,
  Maximize,
  MessageCircle,
  Mic,
  MicOff,
  Minimize,
  Minus,
  MonitorUp,
  Music,
  Play,
  Plus,
  SendHorizontal,
  Settings2,
  ShieldCheck,
  Shirt,
  Slash,
  SlidersHorizontal,
  Sofa,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';

// Le point d'import des icônes des boutons et des menus : celles de Lucide (licence ISC, voir public/assets/CREDITS.txt), sous le nom de leur
// usage (celles des états d'activité sont dans activity-icons.ts, où elles portent le nom que le serveur garde). Elles sont
// décoratives (le nom du bouton dit tout) : Lucide les cache aux lecteurs d'écran, et elles n'ont pas de texte. Leur taille et leur trait
// viennent du CSS (`svg.lucide`, styles.css), qui les ajuste là où il le faut (menus, petits boutons).
// Un nom qui a un état (`off`) choisit entre deux icônes : le micro et son barré, par exemple.

export function MicIcon({ off = false }: { off?: boolean }) {
  return off ? <MicOff /> : <Mic />;
}

export function CameraIcon({ off = false }: { off?: boolean }) {
  return off ? <VideoOff /> : <Video />;
}

export function ScreenIcon() {
  return <MonitorUp />;
}

export function ChatIcon() {
  return <MessageCircle />;
}

export function UsersIcon() {
  return <Users />;
}

// Les trois points : le menu « Plus ».
export function MoreIcon() {
  return <Ellipsis />;
}

export function PlusIcon() {
  return <Plus />;
}

export function MinusIcon() {
  return <Minus />;
}

// Un viseur : revenir à la vue de départ du zoom.
export function ZoomResetIcon() {
  return <Focus />;
}

// L'épingle : un lieu.
export function PlaceIcon() {
  return <MapPin />;
}

// Une tasse fumante : le café qu'on a pris.
export function CoffeeIcon() {
  return <Coffee />;
}

// Un chevron vers la droite : un groupe replié (il pivote quand on le déplie).
export function ChevronRightIcon() {
  return <ChevronRight />;
}

// Une onde sonore : quelqu'un parle avec toi.
export function AudioLinesIcon() {
  return <AudioLines />;
}

// Un chevron vers le haut : les menus du bas s'ouvrent vers le haut.
export function ChevronUpIcon() {
  return <ChevronUp />;
}

// Un t-shirt : l'apparence du personnage.
export function ShirtIcon() {
  return <Shirt />;
}

// Un haut-parleur : avec des ondes quand le son est là, barré quand il est coupé.
export function VolumeIcon({ off = false }: { off?: boolean }) {
  return off ? <VolumeX /> : <Volume2 />;
}

// Des curseurs : les réglages des appareils (micro, caméra).
export function DevicesIcon() {
  return <Settings2 />;
}

export function LogOutIcon() {
  return <LogOut />;
}

// Une ampoule : la lumière du bureau, éteinte ou allumée.
export function LightbulbIcon({ off = false }: { off?: boolean }) {
  return off ? <LightbulbOff /> : <Lightbulb />;
}

// Un canapé : la déco du bureau.
export function DecorIcon() {
  return <Sofa />;
}

export function ShieldIcon() {
  return <ShieldCheck />;
}

// Une fiole : le bac à sable des essais.
export function FlaskIcon() {
  return <FlaskConical />;
}

// La croix des petits boutons de fermeture : plus petite que les autres icônes (`icon-s`).
export function CloseIcon() {
  return <X className="icon-s" />;
}

export function SendIcon() {
  return <SendHorizontal />;
}

// Une porte : on toque, ou elle est fermée.
export function DoorIcon() {
  return <DoorClosed />;
}

// Une porte ouverte : y aller (« Aller à mon bureau »).
export function DoorOpenIcon() {
  return <DoorOpen />;
}

// Des curseurs : les réglages du bureau, une fois dedans.
export function SlidersIcon() {
  return <SlidersHorizontal />;
}

// Un triangle de lecture : écouter un exemple d'effet sonore.
export function PlayIcon() {
  return <Play />;
}

// Les quatre coins qui s'écartent (plein écran), ou qui se resserrent (en sortir).
export function FullscreenIcon({ exit = false }: { exit?: boolean }) {
  return exit ? <Minimize /> : <Maximize />;
}

export function EraserIcon() {
  return <Eraser />;
}

// Lucide n'a pas de version barrée de la note de musique : un trait de Lucide la barre (`icon-struck`, styles.css).
function Struck({ children, off }: { children: ReactNode; off: boolean }) {
  if (!off) return children;
  return (
    <span className="icon-struck">
      {children}
      <Slash />
    </span>
  );
}

// Une note de musique, barrée quand la musique est coupée.
export function MusicIcon({ off = false }: { off?: boolean }) {
  return (
    <Struck off={off}>
      <Music />
    </Struck>
  );
}

// Une manette : les jeux de la salle de jeu (le toast d'une invitation à une table).
export function GamepadIcon() {
  return <Gamepad2 />;
}

// Un livre ouvert : les règles d'un jeu.
export function RulesIcon() {
  return <BookOpen />;
}
