import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { saveTimezone } from '../lib/profile-api';
import { useMinute } from '../lib/use-clock';
import { deviceTimezone, formatClock, formatUtcOffset, wallTime } from '../lib/zoned-time';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { BackIcon, CheckIcon, DeviceZoneIcon, SearchIcon } from './icons';
import { sameZone, searchZones, zoneLabel, zoneOptions, type ZoneOption } from './timezones';

// Choisir son fuseau horaire, dans le menu « Moi » (à la place de la liste, comme « Changer de nom ») : l'heure qu'il est chez soi, une recherche
// (sans accents : « montreal », « reunion », ou un décalage : « utc+9 »), le fuseau de cet appareil proposé en tête quand il n'est pas déjà le sien,
// puis la liste des fuseaux, d'ouest en est, chacun avec son décalage et l'heure qu'il y est. Le sien est coché, et la liste s'ouvre sur lui.
// Choisir une ligne l'enregistre tout de suite (PATCH /api/me) : le serveur la valide et l'annonce à tout le bureau, la réponse est appliquée ici
// (la ligne du menu suit sans attendre), et le menu revient. Échap vide la recherche, puis revient au menu ; ↓ ↑ passent d'une ligne à l'autre.
export function TimezoneEditor({ current, onClose }: { current: string; onClose(): void }) {
  const uid = useId();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useMinute();
  const device = useMemo(() => deviceTimezone(), []);

  const options = useMemo(() => zoneOptions(now, [current, device]), [now, current, device]);
  const shown = useMemo(() => searchZones(options, query), [options, query]);
  const suggested = device !== null && !sameZone(device, current) && query.trim() === '' ? (options.find((option) => sameZone(option.id, device)) ?? null) : null;
  const timeIn = (zone: string) => formatClock(wallTime(zone, now));

  // À l'ouverture : le focus dans la recherche, et la liste défile jusqu'à son fuseau (au milieu, s'il le faut).
  useEffect(() => {
    search.current?.focus();
    const scroller = list.current;
    const mine = scroller?.querySelector<HTMLElement>('[aria-current="true"]');
    if (scroller && mine) scroller.scrollTop += mine.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2 + mine.offsetHeight / 2;
  }, []);

  async function choose(zone: string) {
    if (saving) return;
    // Le même fuseau (ou son ancien nom) : rien à enregistrer.
    if (sameZone(zone, current)) return onClose();
    setSaving(true);
    setError(null);
    try {
      const profile = await saveTimezone(zone);
      useOfficeStore.getState().setProfile(profile);
      onClose();
    } catch {
      setError(fr.me.timezoneFailed);
      setSaving(false);
    }
  }

  const lines = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      lines()[0]?.focus();
    } else if (event.key === 'Enter') {
      // Entrée choisit la première ligne trouvée.
      event.preventDefault();
      const first = shown[0];
      if (query.trim() !== '' && first) void choose(first.id);
    } else if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const all = lines();
    const index = all.findIndex((line) => line === document.activeElement);
    const focusAt = (at: number) => all[Math.max(0, Math.min(all.length - 1, at))]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        if (index <= 0) search.current?.focus();
        else focusAt(index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(all.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  // Échap (sans recherche à vider) revient au menu, sans le fermer.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  const row = (option: ZoneOption, mine: boolean) => {
    const time = timeIn(option.id);
    const offset = formatUtcOffset(option.offset);
    return (
      <li key={option.id}>
        <button
          type="button"
          className="tz-option"
          aria-current={mine ? 'true' : undefined}
          aria-label={t(fr.me.timezoneOption, { place: zoneLabel(option.id), offset, time })}
          disabled={saving}
          onClick={() => void choose(option.id)}
        >
          <span className="tz-option-place">
            <span className="tz-option-city">{option.city}</span>
            {option.region !== '' && option.region !== option.city && <span className="tz-option-region">{option.region}</span>}
          </span>
          <span className="tz-option-offset">{offset}</span>
          <time className="tz-option-time">{time}</time>
          <span className="tz-option-check">{mine && <CheckIcon />}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="mode-editor tz-editor" onKeyDown={onKeyDown} role="group" aria-labelledby={`${uid}-title`}>
      <div className="mode-editor-head">
        <button type="button" className="mode-editor-back" aria-label={fr.me.timezoneBack} title={fr.me.timezoneBack} onClick={onClose}>
          <BackIcon />
        </button>
        <h2 id={`${uid}-title`}>{fr.me.timezoneTitle}</h2>
      </div>

      {error && <Alert>{error}</Alert>}

      <p className="tz-current">{t(fr.me.timezoneCurrent, { time: timeIn(current), place: zoneLabel(current) })}</p>

      <div className="decor-search tz-search">
        <SearchIcon />
        <label className="visually-hidden" htmlFor={`${uid}-search`}>
          {fr.me.timezoneSearch}
        </label>
        <input
          ref={search}
          id={`${uid}-search`}
          type="search"
          value={query}
          placeholder={fr.me.timezoneSearchPlaceholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>

      {suggested && (
        <button type="button" className="tz-device" disabled={saving} onClick={() => void choose(suggested.id)}>
          <DeviceZoneIcon />
          <span className="tz-device-text">
            <span>{fr.me.timezoneDevice}</span>
            <small>{t(fr.me.timezoneDeviceHint, { place: zoneLabel(suggested.id), time: timeIn(suggested.id) })}</small>
          </span>
        </button>
      )}

      {saving && (
        <p className="tz-status" role="status">
          {fr.me.timezoneSaving}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="tz-empty">{fr.me.timezoneEmpty}</p>
      ) : (
        <ul ref={list} className="tz-list" aria-label={fr.me.timezoneList} aria-busy={saving || undefined} onKeyDown={onListKeyDown}>
          {shown.map((option) => row(option, sameZone(option.id, current)))}
        </ul>
      )}

      <p className="mode-editor-hint">{fr.me.timezoneHint}</p>
    </div>
  );
}
