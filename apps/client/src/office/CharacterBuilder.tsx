import {
  CHARACTER_PARTS,
  formatCharacter,
  formatPremade,
  parseAvatarKey,
  randomCharacter,
  type CharacterBuild,
  type CharacterFamily,
  type PartChoice,
} from '@bureau/shared';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { resolveAvatarKey } from '../game/avatars';
import { fr, t } from '../i18n/fr';
import { saveAvatarKey } from '../lib/profile-api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { AvatarPreview } from './AvatarPreview';
import { PartThumb } from './sprites';

// Le panneau Mon personnage : on choisit un personnage prêt à jouer, ou on assemble le sien pièce par pièce (peau, yeux, tenue, coiffure,
// accessoire) avec un aperçu qui respire ou marche. « Enregistrer » envoie la clé du personnage au serveur, qui la diffuse : tout le bureau
// voit le nouveau personnage sans recharger. Échap ferme ; le focus va au titre à l'ouverture.
type Mode = 'premade' | 'build';
type Part = 'body' | 'eyes' | 'outfit' | 'hair' | 'accessory';
const PARTS: Part[] = ['body', 'eyes', 'outfit', 'hair', 'accessory'];

const FIRST_OUTFIT: CharacterFamily = CHARACTER_PARTS.outfits[0]!;
const STARTING_BUILD: CharacterBuild = { body: 1, eyes: 1, outfit: { style: FIRST_OUTFIT.number, color: 1 }, hair: null, accessory: null };

// Les pièces à choisir parmi des familles (tenue, coiffure, accessoire) : le modèle (une imagette par famille), puis sa couleur (une par
// variante). `optional` ajoute « Aucun ».
function FamilyPicker({
  families,
  value,
  optional,
  onChange,
  label,
}: {
  families: readonly CharacterFamily[];
  value: PartChoice | null;
  optional: boolean;
  onChange(choice: PartChoice | null): void;
  label: (family: CharacterFamily) => string;
}) {
  const family = value ? families.find((f) => f.number === value.style) : undefined;
  return (
    <div className="part-picker">
      <div className="part-grid" role="group" aria-label={fr.character.style}>
        {optional && (
          <button type="button" className="part-choice part-none" aria-pressed={value === null} onClick={() => onChange(null)}>
            {fr.character.none}
          </button>
        )}
        {families.map((f) => (
          <button
            key={f.number}
            type="button"
            className="part-choice"
            aria-pressed={value?.style === f.number}
            title={label(f)}
            aria-label={label(f)}
            onClick={() => onChange({ style: f.number, color: value?.style === f.number ? value.color : 1 })}
          >
            <PartThumb index={f.thumb} />
          </button>
        ))}
      </div>
      {family && value && family.variants > 1 && (
        <div className="part-grid part-colors" role="group" aria-label={fr.character.color}>
          {Array.from({ length: family.variants }, (_, i) => i + 1).map((color) => (
            <button
              key={color}
              type="button"
              className="part-choice"
              aria-pressed={value.color === color}
              title={t(fr.character.colorOne, { number: color })}
              aria-label={t(fr.character.colorOne, { number: color })}
              onClick={() => onChange({ style: family.number, color })}
            >
              <PartThumb index={family.thumb + color - 1} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CharacterBuilder({ id, onClose }: { id?: string; onClose(): void }) {
  const selfId = useOfficeStore((state) => state.selfId ?? '');
  const currentKey = useOfficeStore((state) => state.self?.avatarKey ?? null);
  const savedKey = useMemo(() => resolveAvatarKey(selfId, currentKey), [selfId, currentKey]);

  // Le point de départ : le personnage qu'on a (prêt à jouer, ou assemblé).
  const start = useMemo(() => parseAvatarKey(savedKey), [savedKey]);
  const [mode, setMode] = useState<Mode>(start?.kind === 'built' ? 'build' : 'premade');
  const [premade, setPremade] = useState(start?.kind === 'premade' ? start.number : 1);
  const [build, setBuild] = useState<CharacterBuild>(start?.kind === 'built' ? start.build : STARTING_BUILD);
  const [part, setPart] = useState<Part>('body');
  const [walking, setWalking] = useState(false);

  const key = mode === 'premade' ? formatPremade(premade) : formatCharacter(build);

  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await saveAvatarKey(key);
      setNotice(fr.character.saved);
    } catch {
      setError(fr.character.failed);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function shuffle() {
    setBuild(randomCharacter());
    setMode('build');
    setNotice(null);
  }

  const edit = (next: Partial<CharacterBuild>) => {
    setBuild((current) => ({ ...current, ...next }));
    setNotice(null);
  };

  const tab = (value: Mode, label: string) => (
    <button type="button" role="tab" className="bar-button" aria-selected={mode === value} onClick={() => setMode(value)}>
      {label}
    </button>
  );

  return (
    <aside id={id} className="people-panel character-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="people-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {fr.character.title}
        </h2>
        <button type="button" className="bar-button" aria-label={fr.character.close} onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <div className="people-lists character-body">
        <div className="character-stage">
          <AvatarPreview avatarKey={key} walking={walking} />
          <div className="character-stage-actions">
            <button type="button" className="bar-button" aria-pressed={walking} onClick={() => setWalking((on) => !on)}>
              {fr.character.previewWalk}
            </button>
            <button type="button" className="bar-button" onClick={shuffle}>
              {fr.character.random}
            </button>
          </div>
        </div>

        <div className="character-tabs" role="tablist" aria-label={fr.character.tabs.label}>
          {tab('premade', fr.character.tabs.premade)}
          {tab('build', fr.character.tabs.build)}
        </div>

        {mode === 'premade' ? (
          <div className="part-grid part-premade" role="group" aria-label={fr.character.premadeLabel}>
            {Array.from({ length: CHARACTER_PARTS.premade }, (_, i) => i + 1).map((number) => (
              <button
                key={number}
                type="button"
                className="part-choice"
                aria-pressed={premade === number}
                title={t(fr.character.premadeOne, { number })}
                aria-label={t(fr.character.premadeOne, { number })}
                onClick={() => {
                  setPremade(number);
                  setNotice(null);
                }}
              >
                <PartThumb index={CHARACTER_PARTS.thumbs.premade + number - 1} />
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="part-tabs" role="group" aria-label={fr.character.partsLabel}>
              {PARTS.map((p) => (
                <button key={p} type="button" className="bar-button" aria-pressed={part === p} onClick={() => setPart(p)}>
                  {fr.character.parts[p]}
                </button>
              ))}
            </div>
            {part === 'body' && (
              <div className="part-grid" role="group" aria-label={fr.character.parts.body}>
                {Array.from({ length: CHARACTER_PARTS.bodies }, (_, i) => i + 1).map((body) => (
                  <button
                    key={body}
                    type="button"
                    className="part-choice"
                    aria-pressed={build.body === body}
                    title={t(fr.character.bodyOne, { number: body })}
                    aria-label={t(fr.character.bodyOne, { number: body })}
                    onClick={() => edit({ body })}
                  >
                    <PartThumb index={CHARACTER_PARTS.thumbs.bodies + body - 1} />
                  </button>
                ))}
              </div>
            )}
            {part === 'eyes' && (
              <div className="part-grid" role="group" aria-label={fr.character.parts.eyes}>
                {Array.from({ length: CHARACTER_PARTS.eyes }, (_, i) => i + 1).map((eyes) => (
                  <button
                    key={eyes}
                    type="button"
                    className="part-choice"
                    aria-pressed={build.eyes === eyes}
                    title={t(fr.character.eyesOne, { number: eyes })}
                    aria-label={t(fr.character.eyesOne, { number: eyes })}
                    onClick={() => edit({ eyes })}
                  >
                    <PartThumb index={CHARACTER_PARTS.thumbs.eyes + eyes - 1} />
                  </button>
                ))}
              </div>
            )}
            {part === 'outfit' && (
              <FamilyPicker
                families={CHARACTER_PARTS.outfits}
                value={build.outfit}
                optional={false}
                label={(f) => t(fr.character.outfitOne, { number: f.number })}
                onChange={(choice) => choice && edit({ outfit: choice })}
              />
            )}
            {part === 'hair' && (
              <FamilyPicker
                families={CHARACTER_PARTS.hair}
                value={build.hair}
                optional
                label={(f) => t(fr.character.hairOne, { number: f.number })}
                onChange={(hair) => edit({ hair })}
              />
            )}
            {part === 'accessory' && (
              <FamilyPicker
                families={CHARACTER_PARTS.accessories}
                value={build.accessory}
                optional
                label={(f) => f.label ?? String(f.number)}
                onChange={(accessory) => edit({ accessory })}
              />
            )}
          </>
        )}

        {error && <Alert>{error}</Alert>}
        {notice && (
          <p className="desk-hint" role="status">
            {notice}
          </p>
        )}
        <button type="button" className="bar-button character-save" disabled={busy || key === savedKey} onClick={() => void save()}>
          {busy ? fr.character.saving : fr.character.save}
        </button>
        <p className="desk-hint credits">{fr.character.credits}</p>
      </div>
    </aside>
  );
}
