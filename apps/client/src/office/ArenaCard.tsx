import { ARENA_MAX_HP, ARENA_WEAPONS, ARENA_WEAPON_IDS, WEAPON_SHEET, type ArenaAck, type ArenaCommand, type ArenaFighter, type ArenaWeaponId } from '@bureau/shared';
import { useEffect, useState } from 'react';
import { fr, t } from '../i18n/fr';
import { sendArenaCommand } from '../net/arena-commands';
import { simApi } from '../sim/sim-api';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { useInArenaRoom } from './use-here';

// Le panneau de l'octogone, en haut à gauche, tant qu'on est dans sa salle : les deux coins (rouge, bleu), l'arme et la vie de chacun, le public, et ce
// que l'on peut faire selon où en est le combat : prendre un rôle (combattre, regarder), choisir son arme, lancer le combat (« Start », pour un
// combattant, à deux, chacun armé), le quitter. Pendant le combat, il rappelle la touche. Le serveur fait foi : le panneau n'affiche que ce que dit `arena:state`, et l'erreur d'une commande refusée.
export function ArenaCard({ socket }: { socket: OfficeSocket | null }) {
  const here = useInArenaRoom();
  const arena = useOfficeStore((state) => state.arena);
  const endsAt = useOfficeStore((state) => state.arenaCountdownEndsAt);
  const selfId = useOfficeStore((state) => state.selfId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => performance.now());

  // Le compte à rebours, relu quatre fois par seconde.
  useEffect(() => {
    if (arena.phase !== 'countdown') return;
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [arena.phase]);

  // Une erreur s'efface d'elle-même.
  useEffect(() => {
    if (error === null) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  if (!here) return null;

  const me = arena.fighters.find((f) => f.id === selfId);
  const fighter = me !== undefined;
  const armed = arena.fighters.length === 2 && arena.fighters.every((f) => f.weapon !== null);
  const spectator = arena.spectators.some((s) => s.id === selfId);
  const live = arena.phase === 'countdown' || arena.phase === 'fight';

  const run = (command: ArenaCommand) => {
    setPending(true);
    void sendArenaCommand(socket, command).then((ack: ArenaAck) => {
      setPending(false);
      setError(ack.ok ? null : fr.arena.errors[ack.error]);
    });
  };

  // Le bouton cliqué garde le focus : Espace (le coup de poing) le recliquerait. On le lâche.
  const press = (command: ArenaCommand) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    run(command);
  };

  const status = (() => {
    if (arena.phase === 'countdown') return t(fr.arena.countdown, { seconds: Math.max(1, Math.ceil((endsAt - now) / 1000)) });
    if (arena.phase === 'fight') return fr.arena.fighting;
    if (arena.phase === 'over') {
      const winner = arena.fighters.find((f) => f.id === arena.winnerId);
      return winner ? t(fr.arena.won, { name: winner.name }) : fr.arena.cancelled;
    }
    if (arena.fighters.length < 2) return fr.arena.waitingFoe;
    if (!armed) return fr.arena.waitingWeapons;
    return fr.arena.waitingStart;
  })();

  return (
    <section className="arena-card" aria-label={fr.arena.title} data-phase={arena.phase}>
      <header className="arena-card__head">
        <h2>{fr.arena.title}</h2>
        <span className="arena-card__phase">{fr.arena.phase[arena.phase]}</span>
      </header>

      <div className="arena-card__corners">
        <Corner label={fr.arena.red} side="red" fighter={arena.fighters[0]} selfId={selfId} winnerId={arena.winnerId} />
        <span className="arena-card__vs" aria-hidden="true">
          VS
        </span>
        <Corner label={fr.arena.blue} side="blue" fighter={arena.fighters[1]} selfId={selfId} winnerId={arena.winnerId} />
      </div>

      {fighter && !live && <WeaponPicker current={me.weapon} disabled={pending} onPick={(weapon) => run({ type: 'weapon', weapon })} />}

      <p className="arena-card__status" role="status">
        {status}
      </p>

      <div className="arena-card__actions">
        {!fighter && !spectator && (
          <>
            <button type="button" className="arena-btn arena-btn--fight" disabled={pending || live || arena.fighters.length >= 2} onClick={press({ type: 'join', role: 'fighter' })}>
              {fr.arena.fight}
            </button>
            <button type="button" className="arena-btn" disabled={pending} onClick={press({ type: 'join', role: 'spectator' })}>
              {fr.arena.watch}
            </button>
          </>
        )}
        {spectator && (
          <>
            <span className="arena-card__note">{fr.arena.youWatch}</span>
            {!live && arena.fighters.length < 2 && (
              <button type="button" className="arena-btn arena-btn--fight" disabled={pending} onClick={press({ type: 'join', role: 'fighter' })}>
                {fr.arena.fight}
              </button>
            )}
          </>
        )}
        {fighter && !live && (
          <button type="button" className="arena-btn arena-btn--start" disabled={pending || !armed} onClick={press({ type: 'start' })}>
            {fr.arena.start}
          </button>
        )}
        {__SIM__ && !live && arena.fighters.length < 2 && (
          <button
            type="button"
            className="arena-btn arena-btn--ghost"
            disabled={pending}
            onClick={(event) => {
              event.currentTarget.blur();
              setPending(true);
              simApi.addSparring().then(
                () => setPending(false),
                () => {
                  setPending(false);
                  setError(fr.arena.sparringFailed);
                },
              );
            }}
          >
            {fr.arena.sparring}
          </button>
        )}
        {(fighter || spectator) && (
          <button type="button" className="arena-btn arena-btn--ghost" disabled={pending} onClick={press({ type: 'leave' })}>
            {fr.arena.leave}
          </button>
        )}
      </div>

      {fighter && <p className="arena-card__controls">{fr.arena.controls}</p>}
      {error && (
        <p className="arena-card__error" role="alert">
          {error}
        </p>
      )}

      <p className="arena-card__crowd">
        {arena.spectators.length === 0 ? fr.arena.noSpectators : `${t(fr.arena.spectators, { count: arena.spectators.length })} · ${arena.spectators.map((s) => s.name).join(', ')}`}
      </p>
    </section>
  );
}

function Corner({ label, side, fighter, selfId, winnerId }: { label: string; side: 'red' | 'blue'; fighter: ArenaFighter | undefined; selfId: string | null; winnerId: string | null }) {
  const part = fighter ? Math.max(0, fighter.hp) / ARENA_MAX_HP : 0;
  const level = part > 0.5 ? 'high' : part > 0.25 ? 'mid' : 'low';
  return (
    <div className={`arena-corner arena-corner--${side}`} data-empty={fighter ? undefined : ''} data-winner={fighter && fighter.id === winnerId ? '' : undefined}>
      <span className="arena-corner__tag">
        <span className="arena-corner__dot" aria-hidden="true" />
        {side === 'red' ? fr.arena.redShort : fr.arena.blueShort}
      </span>
      <div className="arena-corner__who">
        <span className="arena-corner__weapon">{fighter?.weapon && <WeaponIcon weapon={fighter.weapon} />}</span>
        <span className="arena-corner__name">
          {fighter ? fighter.name : fr.arena.free}
          {fighter && fighter.id === selfId && <span className="arena-corner__you">{fr.arena.you}</span>}
        </span>
      </div>
      <div className="arena-corner__life">
        <span className="arena-corner__bar" role="meter" aria-valuemin={0} aria-valuemax={ARENA_MAX_HP} aria-valuenow={fighter?.hp ?? 0} aria-label={label}>
          <span className="arena-corner__fill" data-level={level} style={{ width: `${part * 100}%` }} />
        </span>
        <span className="arena-corner__hp">{fighter ? fighter.hp : '—'}</span>
      </div>
    </div>
  );
}

// L'icône d'une arme : sa case de la planche, en image de fond (32 px, sans lissage).
function WeaponIcon({ weapon, className }: { weapon: ArenaWeaponId; className?: string }) {
  const { frame } = ARENA_WEAPONS[weapon];
  const { columns, frameSize } = WEAPON_SHEET;
  return (
    <span
      className={`weapon-icon${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{ backgroundImage: `url(${WEAPON_SHEET.url})`, backgroundPosition: `-${(frame % columns) * frameSize}px -${Math.floor(frame / columns) * frameSize}px` }}
    />
  );
}

const speedOf = (cooldownMs: number): string => (cooldownMs <= 400 ? fr.arena.speeds.fast : cooldownMs <= 800 ? fr.arena.speeds.normal : fr.arena.speeds.slow);

// Le choix de l'arme : une case par arme, son icône, son nom ; ses dégâts, sa portée et sa vitesse dans son nom accessible et sa bulle.
function WeaponPicker({ current, disabled, onPick }: { current: ArenaWeaponId | null; disabled: boolean; onPick: (weapon: ArenaWeaponId) => void }) {
  return (
    <fieldset className="weapon-picker">
      <legend>{fr.arena.chooseWeapon}</legend>
      {ARENA_WEAPON_IDS.map((id) => {
        const weapon = ARENA_WEAPONS[id];
        const stats = t(fr.arena.weaponStats, {
          damage: weapon.damage,
          range: weapon.style === 'shoot' ? fr.arena.ranged : `${Math.round(weapon.rangePx / 32 * 10) / 10} cases`,
          speed: speedOf(weapon.cooldownMs),
        });
        return (
          <button
            key={id}
            type="button"
            className="weapon-picker__option"
            aria-pressed={current === id}
            title={stats}
            aria-label={`${weapon.label} : ${stats}`}
            disabled={disabled}
            onClick={(event) => {
              event.currentTarget.blur();
              onPick(id);
            }}
          >
            <WeaponIcon weapon={id} />
            <span>{weapon.label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
