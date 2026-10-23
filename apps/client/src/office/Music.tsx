import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react';
import { scenesOfTheme, THEME_IDS, themeOf, type SceneId, type ThemeId } from '../audio/catalog';
import { fr } from '../i18n/fr';
import { COVER_HEIGHT, COVER_WIDTH, drawCover } from './ambiance-covers';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ListMusicIcon } from './icons';
import { IconButton } from './ui/IconButton';
import { Segmented } from './ui/Segmented';

// Les pièces du module musique, que partagent le juke-box du dock (SoundPopover) et la fenêtre de la puce du lieu (RoomMusic) :
// - MusicCard : une musique, telle qu'on l'entend, avec sa vignette, et pour qui elle joue (la pièce, ou soi) ; quand on peut la changer, la
//   vignette et son titre sont un seul bouton, qui ouvre la liste ;
// - MusicPicker : la liste des musiques d'un thème (« Par défaut », « Pirate »), qui remplace la fenêtre le temps du choix (« Retour » ou Échap y ramènent) ;
// - useMusicPicking : ce que montre la fenêtre (ses cartes, ou la liste) ;
// - Cover, la pochette en pixel art d'une ambiance ; Switch, un interrupteur ; keepArrows, qui garde les flèches loin de l'avatar.

// Un interrupteur : une case à cocher qui se lit et s'annonce comme un interrupteur (role=switch).
export function Switch({ checked, label, onChange, inputRef }: { checked: boolean; label: string; onChange(checked: boolean): void; inputRef?: RefObject<HTMLInputElement | null> }) {
  return (
    <label className="switch">
      <input ref={inputRef} type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

const ARROWS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// Les flèches sont à ce qu'elles règlent (un onglet, un volume) : elles ne vont pas jusqu'à l'avatar, dont le clavier (game/input.ts) ne les ignore que
// dans un champ où l'on écrit, et non sur un bouton ou un curseur.
export function keepArrows(event: KeyboardEvent<HTMLElement>): void {
  if (ARROWS.has(event.key)) event.stopPropagation();
}

// La pochette d'une ambiance : 16 × 10 pixels (ambiance-covers.ts), que le CSS agrandit sans lissage. Décorative : le titre est écrit à côté.
// `data-cover` dit laquelle (les tests).
export function Cover({ scene }: { scene: SceneId }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) drawCover(canvas.current, scene);
  }, [scene]);
  return <canvas ref={canvas} className="juke-cover" width={COVER_WIDTH} height={COVER_HEIGHT} data-cover={scene} aria-hidden="true" />;
}

// La vignette : la pochette (rien qu'un fond quand la musique est coupée), l'égaliseur de celle qu'on entend, et, quand elle ouvre la liste, l'icône
// de la liste au survol.
function Art({ scene, playing, small = false, editable = false }: { scene: SceneId | null; playing: boolean; small?: boolean; editable?: boolean }) {
  return (
    <span className={`juke-art${small ? ' is-small' : ''}`}>
      {scene !== null && <Cover scene={scene} />}
      {playing && (
        <span className="juke-eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      {editable && (
        <span className="music-art-edit" aria-hidden="true">
          <ListMusicIcon />
        </span>
      )}
    </span>
  );
}

// Le nom d'une ambiance, ce qu'elle évoque, et où elle joue d'elle-même (seules celles du thème « Par défaut » ont une pièce à elles).
export function describeScene(scene: SceneId): string {
  const { mood, where } = fr.sound.scenes[scene];
  return where === null ? mood : `${mood} · ${where}`;
}

// Ce qu'on dit d'une musique choisie, sous son titre : son thème et ce qu'elle évoque.
export const sceneNote = (scene: SceneId): string => `${fr.sound.themes[themeOf(scene)]} · ${fr.sound.scenes[scene].mood}`;

export interface MusicCardProps {
  // L'icône de l'auditoire (des gens pour la pièce, un casque pour soi), le titre de la carte, et pour qui elle joue.
  icon: ReactNode;
  title: string;
  audience: string;
  // La musique ; null quand elle est coupée (la pièce éteinte), avec `offTitle` à la place de son nom.
  scene: SceneId | null;
  offTitle?: string;
  // La ligne sous le nom (« Par défaut de la pièce », « Pirate · Calme… »).
  note: string;
  // Est-ce elle qu'on entend ? Son égaliseur bouge.
  playing: boolean;
  // Quand on peut la changer : le nom du bouton (vignette et titre), et ce qu'il fait (ouvrir la liste). Sans lui, la carte ne fait que montrer.
  change?: { label: string; onClick(): void; buttonRef?: Ref<HTMLButtonElement> };
  // Ce qui suit : l'interrupteur de la pièce, qui l'a réglée, pourquoi on n'y touche pas…
  children?: ReactNode;
}

// Une musique telle qu'on l'entend : l'auditoire en tête (la pièce, ou soi), puis la vignette, le nom et sa note. Le nom accessible du bouton dit ce
// qu'il fait et ce qui joue (« Changer la musique de la pièce : Soleil »).
export function MusicCard({ icon, title, audience, scene, offTitle, note, playing, change, children }: MusicCardProps) {
  const name = scene === null ? (offTitle ?? '') : fr.sound.scenes[scene].title;
  const body = (
    <>
      <Art scene={scene} playing={playing} editable={change !== undefined} />
      <span className="music-now-text">
        <span className="music-now-title">{name}</span>
        <small>{note}</small>
      </span>
    </>
  );
  return (
    <section className={`music-card${scene === null ? ' is-silent' : ''}`} aria-label={title}>
      <div className="music-card-head">
        {icon}
        <span className="music-card-titles">
          <span className="music-card-title">{title}</span>
          <span className="music-card-audience">{audience}</span>
        </span>
      </div>
      {change ? (
        <button ref={change.buttonRef} type="button" className="music-now" aria-label={`${change.label} : ${name}`} onClick={change.onClick}>
          {body}
          <ChevronRightIcon />
        </button>
      ) : (
        <div className="music-now">{body}</div>
      )}
      {children}
    </section>
  );
}

// Ce que montre une fenêtre de musique : ses cartes, ou la liste d'une musique qu'on change (`picking` : laquelle) ; la fenêtre fermée revient aux cartes.
// Revenir de la liste rend le focus à la vignette qui l'a ouverte (`changeButton`).
export function useMusicPicking<T extends string>(open: boolean) {
  const [picking, setPicking] = useState<T | null>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useEffect(() => {
    if (!open) setPicking(null);
  }, [open]);
  useEffect(() => {
    if (picking !== null || !returning.current) return;
    returning.current = false;
    changeButton.current?.focus();
  }, [picking]);
  return {
    picking,
    changeButton,
    pick: (what: T) => setPicking(what),
    back: () => {
      returning.current = true;
      setPicking(null);
    },
  };
}

export interface MusicPickerProps {
  // Ce qu'on change, et pour qui (« Musique de la pièce », « Café · pour tout le monde ici »).
  title: string;
  audience: string;
  // Le choix en cours : une ambiance, ou null pour « Par défaut de la pièce » (avec `defaultScene`).
  value: SceneId | null;
  // La musique que la carte donne à la pièce : la liste commence alors par « Par défaut de la pièce ». Sans elle (sa musique à soi), pas de ligne.
  defaultScene?: SceneId;
  // Ce qu'on entend : l'égaliseur de sa ligne.
  playing: SceneId | null;
  onPick(scene: SceneId | null): void;
  onBack(): void;
}

// La liste des musiques, à la place de la fenêtre : « Retour » et le titre en tête, « Par défaut de la pièce » s'il y a lieu, puis le choix du thème et
// les musiques de ce thème seulement. Elle s'ouvre sur le thème du choix en cours (qu'on y voie la coche). Une ligne choisit sa musique tout de suite (on
// l'entend) et la liste reste ouverte : on peut en essayer une autre. Échap ou « Retour » ramènent à la fenêtre ; le focus va à « Retour » à l'ouverture.
// Les lignes sont des boutons (le choix en cours porte aria-current) : passer de l'une à l'autre au clavier ne change pas la musique à chaque pas.
export function MusicPicker({ title, audience, value, defaultScene, playing, onPick, onBack }: MusicPickerProps) {
  const [theme, setTheme] = useState<ThemeId>(() => (value === null ? 'default' : themeOf(value)));
  const listId = useId();
  const back = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    back.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    // Échap revient à la fenêtre, sans la fermer : la fenêtre (Popover) l'écoute sur le document, plus haut.
    event.preventDefault();
    event.stopPropagation();
    onBack();
  }

  // Une ligne : la vignette de `scene`, son nom et sa note ; elle choisit `pick` (null : « Par défaut de la pièce »).
  const row = ({ scene, pick, label, sub, description }: { scene: SceneId; pick: SceneId | null; label: string; sub: string; description?: string }) => {
    const current = value === pick;
    const heard = playing === scene;
    return (
      <button
        type="button"
        className="music-row"
        aria-current={current ? 'true' : undefined}
        aria-description={heard ? `${description ?? sub} · ${fr.sound.picker.playing}` : description}
        title={description}
        data-playing={heard ? 'true' : undefined}
        onClick={() => onPick(pick)}
      >
        <Art scene={scene} playing={heard} small />
        <span className="music-now-text">
          <span className="music-now-title">{label}</span>
          <small>{sub}</small>
        </span>
        {current && <CheckIcon />}
      </button>
    );
  };

  return (
    <div className="music-picker" onKeyDown={onKeyDown}>
      <div className="music-picker-head">
        <IconButton ref={back} label={fr.sound.picker.back} small tip="bottom" onClick={onBack}>
          <ChevronLeftIcon />
        </IconButton>
        <span className="music-card-titles">
          <h3 className="juke-title">{title}</h3>
          <span className="music-card-audience">{audience}</span>
        </span>
      </div>

      {defaultScene !== undefined && (
        <div className="music-default">{row({ scene: defaultScene, pick: null, label: fr.roomMusic.default, sub: fr.sound.scenes[defaultScene].title })}</div>
      )}

      <Segmented
        label={fr.sound.picker.themes}
        value={theme}
        options={THEME_IDS.map((id) => ({ id, label: fr.sound.themes[id] }))}
        onSelect={(id) => setTheme(id)}
        panelId={listId}
        tabId={(id) => `${listId}-${id}`}
      />
      <ul className="music-list" id={listId} role="tabpanel" aria-labelledby={`${listId}-${theme}`}>
        {scenesOfTheme(theme).map((scene) => (
          <li key={scene}>{row({ scene, pick: scene, label: fr.sound.scenes[scene].title, sub: fr.sound.scenes[scene].mood, description: describeScene(scene) })}</li>
        ))}
      </ul>
    </div>
  );
}
