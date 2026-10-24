import {
  ArrowLeft,
  ArrowLeftRight,
  Armchair,
  AudioLines,
  BookOpen,
  CalendarDays,
  Check,
  CircleStop,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Coffee,
  Crown,
  DoorClosed,
  DoorOpen,
  Dumbbell,
  Ellipsis,
  Eraser,
  Flame,
  FlaskConical,
  Footprints,
  Focus,
  Gamepad2,
  Gem,
  Globe,
  Headphones,
  History,
  Image as Picture,
  Info,
  LampDesk,
  Library,
  Lightbulb,
  LightbulbOff,
  ListChecks,
  ListMusic,
  LocateFixed,
  Lock,
  LockOpen,
  LogOut,
  MapPin,
  Maximize,
  MessageCircle,
  Mic,
  MicOff,
  Minimize,
  Minus,
  Monitor,
  MonitorUp,
  Moon,
  Music,
  Navigation,
  Pencil,
  Paperclip,
  Play,
  Plus,
  ScrollText,
  Search,
  SendHorizontal,
  Settings2,
  Shapes,
  ShieldCheck,
  Shirt,
  Slash,
  SlidersHorizontal,
  Sofa,
  Sparkles,
  Store,
  Sun,
  SunDim,
  Sunrise,
  Sunset,
  Trash2,
  Trophy,
  Undo2,
  UserRound,
  UserX,
  Sprout,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
  createLucideIcon,
} from 'lucide-react';
import type { LightLevel } from '@bureau/shared';
import type { LucideIcon } from 'lucide-react';
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

// Une horloge qui tourne à rebours : la dernière connexion d'un membre hors ligne.
export function LastSeenIcon() {
  return <History />;
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

// Une ampoule : la lumière du bureau, allumée ou éteinte (barrée) ; tamisée, un soleil voilé.
export function LightbulbIcon({ level = 'on' }: { level?: LightLevel }) {
  if (level === 'dim') return <SunDim />;
  return level === 'off' ? <LightbulbOff /> : <Lightbulb />;
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

// Une porte ouverte : y aller (« Aller à mon bureau »), y inviter quelqu'un.
export function DoorOpenIcon() {
  return <DoorOpen />;
}

// Le menu d'une personne : son profil, la suivre (des pas), la rejoindre (une flèche de navigation), arrêter de la suivre.
export function ProfileIcon() {
  return <UserRound />;
}

export function FollowIcon() {
  return <Footprints />;
}

export function JoinIcon() {
  return <Navigation />;
}

export function StopFollowIcon() {
  return <CircleStop />;
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

// Les modes, dans le menu « Moi » : modifier un mode (le crayon), revenir à la liste, la coche du mode choisi, et supprimer un mode (l'emplacement où il conduit est PlaceIcon).
export function PencilIcon() {
  return <Pencil />;
}

export function BackIcon() {
  return <ArrowLeft />;
}

export function CheckIcon() {
  return <Check />;
}

export function TrashIcon() {
  return <Trash2 />;
}

// ---- La musique (le juke-box, la musique de la pièce) ----

// Une liste de morceaux : la vignette d'une musique qu'on peut changer ouvre la liste.
export function ListMusicIcon() {
  return <ListMusic />;
}

// Un casque : sa musique à soi, que les autres n'entendent pas.
export function HeadphonesIcon() {
  return <Headphones />;
}

// Un chevron vers la gauche : revenir en arrière (de la liste des musiques à la fenêtre).
export function ChevronLeftIcon() {
  return <ChevronLeft />;
}

// Un « i » : l'aide d'un panneau, dans son infobulle (le pied du panneau Décorer).
export function InfoIcon() {
  return <Info />;
}

// Un cadenas : ce qu'on ne peut pas changer ici (la musique du bureau d'un autre), la porte fermée d'un bureau, une conversation verrouillée.
export function LockIcon() {
  return <Lock />;
}

// Un cadenas ouvert : une conversation qu'on peut verrouiller, ou qu'on vient de déverrouiller.
export function LockOpenIcon() {
  return <LockOpen />;
}

// Le bureau (DeskPanel) : le cadenas de la porte fermée, le crayon du nom, la coche d'un enregistrement, les flèches du déménagement, exclure
// quelqu'un de son bureau et le réadmettre (le cadenas est LockIcon, plus haut).
export function RenameIcon() {
  return <Pencil className="icon-s" />;
}

export function SmallCheckIcon() {
  return <Check className="icon-s" />;
}

export function MoveIcon() {
  return <ArrowLeftRight />;
}

export function KickIcon() {
  return <UserX />;
}

export function UnbanIcon() {
  return <Undo2 />;
}

// Une loupe : la recherche dans la banque de déco.
export function SearchIcon() {
  return <Search />;
}

// Une horloge qui recule : les éléments de déco pris récemment.
export function RecentIcon() {
  return <History />;
}

// L'icône de chaque catégorie de la banque de déco (les onglets du sélecteur, DecorPicker). Une catégorie qui n'est pas ici (le catalogue
// en a gagné une) prend des formes.
// La progression : un parchemin, les missions ; une boutique ; un cristal, les kuartzons ; des étincelles, l'XP ; une coupe, un niveau gagné ; une couronne,
// l'autorité ; une flamme, la série de pointage ; une liste cochée, les tâches cochées ; un bloc-notes, les missions confiées ; une gemme, l'onglet de la boutique dans la déco.
export function MissionsIcon() {
  return <ScrollText />;
}

export function ShopIcon() {
  return <Store />;
}

// Le kuartzon, la monnaie du bureau : un cristal de quartz (son nom vient de Kuartz), dessiné comme les icônes de Lucide (24 × 24, trait de 2).
const Kuartzon = createLucideIcon('kuartzon', [
  ['path', { d: 'M12 2l5 5.5v9L12 22l-5-5.5v-9z', key: 'outline' }],
  ['path', { d: 'M7 7.5l5 3 5-3', key: 'top' }],
  ['path', { d: 'M12 10.5V22', key: 'ridge' }],
]);

export function KuartzonIcon() {
  return <Kuartzon />;
}

export function XpIcon() {
  return <Sparkles />;
}

export function LevelUpIcon() {
  return <Trophy />;
}

export function AuthorityIcon() {
  return <Crown />;
}

export function StreakIcon() {
  return <Flame />;
}

export function TodosIcon() {
  return <ListChecks />;
}

export function GivenIcon() {
  return <ClipboardList />;
}

// Un calendrier : depuis quand quelqu'un est membre du bureau (sa fiche).
export function MemberSinceIcon() {
  return <CalendarDays />;
}

const DECOR_CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  ecrans: Monitor,
  bureaux: LampDesk,
  sieges: Armchair,
  rangement: Library,
  papeterie: Paperclip,
  plantes: Sprout,
  deco: Picture,
  cafe: Coffee,
  detente: Sofa,
  sport: Dumbbell,
  boutique: Gem,
};

export function DecorCategoryIcon({ category }: { category: string }) {
  const Icon = DECOR_CATEGORY_ICONS[category] ?? Shapes;
  return <Icon />;
}

// ---- Les fuseaux horaires (le menu « Moi », la carte de l'heure locale d'une personne) ----

// Un globe : son fuseau horaire, dans le menu « Moi ».
export function GlobeIcon() {
  return <Globe />;
}

// Une cible : le fuseau de cet appareil, suggéré en tête de la liste.
export function DeviceZoneIcon() {
  return <LocateFixed />;
}

// Le moment de la journée chez quelqu'un : le soleil qui se lève (le matin), le soleil (l'après-midi), le soleil qui se couche (la soirée), la lune (la nuit).
const DAY_PART_ICONS: Readonly<Record<'morning' | 'afternoon' | 'evening' | 'night', LucideIcon>> = { morning: Sunrise, afternoon: Sun, evening: Sunset, night: Moon };

export function DayPartIcon({ part }: { part: 'morning' | 'afternoon' | 'evening' | 'night' }) {
  const Icon = DAY_PART_ICONS[part];
  return <Icon />;
}
