import { isTimezone } from '@bureau/shared';
import { formatUtcOffset, zoneOffsetMinutes } from '../lib/zoned-time';
import { searchKey } from './decor-picker';

// Les fuseaux horaires qu'on choisit dans le menu « Moi » : une liste lisible, en français (une ville et son pays), plutôt que les quelque
// 400 noms de la base IANA. Elle couvre la France et ses outre-mer, l'Europe, le monde francophone et les grandes villes de chaque fuseau. Le
// serveur, lui, accepte tout nom IANA réel : celui que donne un navigateur ailleurs (« Asia/Almaty ») s'affiche par le nom de sa ville.
//
// Une entrée par fuseau IANA : deux villes du même fuseau n'en font qu'une (Lyon est à Paris), et `also` les retrouve à la recherche. Montréal a
// le sien (America/Montreal, que la base garde comme synonyme de Toronto) : on le reconnaît sous son nom.
export interface ZoneEntry {
  id: string;
  city: string;
  region: string;
  // D'autres mots que la recherche trouve : villes du même fuseau, anciens noms.
  also?: string;
}

export const ZONES: readonly ZoneEntry[] = [
  // La France et l'Europe de l'Ouest.
  { id: 'Europe/Paris', city: 'Paris', region: 'France', also: 'Lyon Marseille Toulouse Bordeaux Lille Nantes Strasbourg Nice Rennes Montpellier Corse' },
  { id: 'Europe/Brussels', city: 'Bruxelles', region: 'Belgique', also: 'Liège Anvers Namur Charleroi' },
  { id: 'Europe/Luxembourg', city: 'Luxembourg', region: 'Luxembourg' },
  { id: 'Europe/Zurich', city: 'Zurich', region: 'Suisse', also: 'Genève Lausanne Berne Bâle Neuchâtel' },
  { id: 'Europe/Monaco', city: 'Monaco', region: 'Monaco' },
  { id: 'Europe/Madrid', city: 'Madrid', region: 'Espagne', also: 'Barcelone Valence Séville' },
  { id: 'Europe/Lisbon', city: 'Lisbonne', region: 'Portugal', also: 'Porto' },
  { id: 'Europe/London', city: 'Londres', region: 'Royaume-Uni', also: 'Angleterre Écosse Édimbourg Manchester' },
  { id: 'Europe/Dublin', city: 'Dublin', region: 'Irlande' },
  { id: 'Europe/Amsterdam', city: 'Amsterdam', region: 'Pays-Bas', also: 'Rotterdam La Haye' },
  { id: 'Europe/Berlin', city: 'Berlin', region: 'Allemagne', also: 'Munich Francfort Hambourg Cologne' },
  { id: 'Europe/Rome', city: 'Rome', region: 'Italie', also: 'Milan Naples Turin Florence Venise' },
  { id: 'Europe/Vienna', city: 'Vienne', region: 'Autriche' },
  { id: 'Europe/Prague', city: 'Prague', region: 'Tchéquie' },
  { id: 'Europe/Warsaw', city: 'Varsovie', region: 'Pologne', also: 'Cracovie' },
  { id: 'Europe/Copenhagen', city: 'Copenhague', region: 'Danemark' },
  { id: 'Europe/Stockholm', city: 'Stockholm', region: 'Suède' },
  { id: 'Europe/Oslo', city: 'Oslo', region: 'Norvège' },
  { id: 'Europe/Helsinki', city: 'Helsinki', region: 'Finlande' },
  { id: 'Europe/Athens', city: 'Athènes', region: 'Grèce' },
  { id: 'Europe/Bucharest', city: 'Bucarest', region: 'Roumanie' },
  { id: 'Europe/Kyiv', city: 'Kyiv', region: 'Ukraine', also: 'Kiev' },
  { id: 'Europe/Istanbul', city: 'Istanbul', region: 'Turquie', also: 'Ankara' },
  { id: 'Europe/Moscow', city: 'Moscou', region: 'Russie', also: 'Saint-Pétersbourg' },
  { id: 'Atlantic/Reykjavik', city: 'Reykjavik', region: 'Islande' },
  { id: 'Atlantic/Canary', city: 'Las Palmas', region: 'Canaries', also: 'Espagne Tenerife' },
  // L'Afrique.
  { id: 'Africa/Casablanca', city: 'Casablanca', region: 'Maroc', also: 'Rabat Marrakech Tanger' },
  { id: 'Africa/Algiers', city: 'Alger', region: 'Algérie', also: 'Oran Constantine' },
  { id: 'Africa/Tunis', city: 'Tunis', region: 'Tunisie', also: 'Sfax' },
  { id: 'Africa/Cairo', city: 'Le Caire', region: 'Égypte', also: 'Alexandrie' },
  { id: 'Africa/Dakar', city: 'Dakar', region: 'Sénégal' },
  { id: 'Africa/Abidjan', city: 'Abidjan', region: 'Côte d\'Ivoire', also: 'Bamako Mali Ouagadougou Burkina Faso Conakry Guinée Lomé Togo' },
  { id: 'Africa/Lagos', city: 'Lagos', region: 'Nigeria', also: 'Cotonou Bénin Niamey Niger' },
  { id: 'Africa/Douala', city: 'Douala', region: 'Cameroun', also: 'Yaoundé Libreville Gabon' },
  { id: 'Africa/Kinshasa', city: 'Kinshasa', region: 'RD Congo', also: 'Brazzaville Congo' },
  { id: 'Africa/Johannesburg', city: 'Johannesburg', region: 'Afrique du Sud', also: 'Le Cap Pretoria Durban' },
  { id: 'Africa/Nairobi', city: 'Nairobi', region: 'Kenya', also: 'Addis-Abeba Éthiopie Djibouti' },
  { id: 'Indian/Antananarivo', city: 'Antananarivo', region: 'Madagascar', also: 'Tananarive' },
  { id: 'Indian/Reunion', city: 'Saint-Denis', region: 'La Réunion', also: 'France outre-mer' },
  { id: 'Indian/Mayotte', city: 'Mamoudzou', region: 'Mayotte', also: 'France outre-mer' },
  { id: 'Indian/Mauritius', city: 'Port-Louis', region: 'Maurice' },
  // Le Moyen-Orient et l'Asie.
  { id: 'Asia/Beirut', city: 'Beyrouth', region: 'Liban' },
  { id: 'Asia/Jerusalem', city: 'Jérusalem', region: 'Israël', also: 'Tel-Aviv' },
  { id: 'Asia/Riyadh', city: 'Riyad', region: 'Arabie saoudite', also: 'Doha Qatar Koweït' },
  { id: 'Asia/Dubai', city: 'Dubaï', region: 'Émirats arabes unis', also: 'Abou Dabi' },
  { id: 'Asia/Tehran', city: 'Téhéran', region: 'Iran' },
  { id: 'Asia/Karachi', city: 'Karachi', region: 'Pakistan', also: 'Islamabad Lahore' },
  { id: 'Asia/Kolkata', city: 'Bombay', region: 'Inde', also: 'Mumbai New Delhi Bangalore Calcutta' },
  { id: 'Asia/Kathmandu', city: 'Katmandou', region: 'Népal' },
  { id: 'Asia/Dhaka', city: 'Dacca', region: 'Bangladesh' },
  { id: 'Asia/Bangkok', city: 'Bangkok', region: 'Thaïlande', also: 'Phnom Penh Cambodge Vientiane Laos' },
  { id: 'Asia/Ho_Chi_Minh', city: 'Hô Chi Minh-Ville', region: 'Viêt Nam', also: 'Saïgon Hanoï Vietnam' },
  { id: 'Asia/Jakarta', city: 'Jakarta', region: 'Indonésie', also: 'Java' },
  { id: 'Asia/Singapore', city: 'Singapour', region: 'Singapour', also: 'Kuala Lumpur Malaisie' },
  { id: 'Asia/Manila', city: 'Manille', region: 'Philippines' },
  { id: 'Asia/Shanghai', city: 'Pékin', region: 'Chine', also: 'Beijing Shanghai Shenzhen Canton' },
  { id: 'Asia/Hong_Kong', city: 'Hong Kong', region: 'Chine' },
  { id: 'Asia/Taipei', city: 'Taipei', region: 'Taïwan' },
  { id: 'Asia/Seoul', city: 'Séoul', region: 'Corée du Sud' },
  { id: 'Asia/Tokyo', city: 'Tokyo', region: 'Japon', also: 'Osaka Kyoto' },
  // L'Océanie et le Pacifique.
  { id: 'Australia/Perth', city: 'Perth', region: 'Australie' },
  { id: 'Australia/Brisbane', city: 'Brisbane', region: 'Australie' },
  { id: 'Australia/Sydney', city: 'Sydney', region: 'Australie', also: 'Melbourne Canberra' },
  { id: 'Pacific/Noumea', city: 'Nouméa', region: 'Nouvelle-Calédonie', also: 'France outre-mer' },
  { id: 'Pacific/Auckland', city: 'Auckland', region: 'Nouvelle-Zélande', also: 'Wellington' },
  { id: 'Pacific/Tahiti', city: 'Papeete', region: 'Polynésie française', also: 'Tahiti France outre-mer' },
  { id: 'Pacific/Honolulu', city: 'Honolulu', region: 'Hawaï' },
  // Les Amériques.
  { id: 'America/Anchorage', city: 'Anchorage', region: 'Alaska' },
  { id: 'America/Vancouver', city: 'Vancouver', region: 'Canada' },
  { id: 'America/Los_Angeles', city: 'Los Angeles', region: 'États-Unis', also: 'San Francisco Seattle Las Vegas Californie' },
  { id: 'America/Denver', city: 'Denver', region: 'États-Unis' },
  { id: 'America/Chicago', city: 'Chicago', region: 'États-Unis', also: 'Houston Dallas La Nouvelle-Orléans' },
  { id: 'America/Mexico_City', city: 'Mexico', region: 'Mexique' },
  { id: 'America/New_York', city: 'New York', region: 'États-Unis', also: 'Washington Boston Miami Philadelphie Atlanta' },
  { id: 'America/Toronto', city: 'Toronto', region: 'Canada', also: 'Ottawa Ontario' },
  { id: 'America/Montreal', city: 'Montréal', region: 'Canada', also: 'Québec' },
  { id: 'America/Halifax', city: 'Halifax', region: 'Canada', also: 'Moncton Acadie' },
  { id: 'America/St_Johns', city: 'Saint-Jean de Terre-Neuve', region: 'Canada' },
  { id: 'America/Miquelon', city: 'Saint-Pierre', region: 'Saint-Pierre-et-Miquelon', also: 'France outre-mer' },
  { id: 'America/Guadeloupe', city: 'Pointe-à-Pitre', region: 'Guadeloupe', also: 'France outre-mer Antilles Saint-Martin Saint-Barthélemy' },
  { id: 'America/Martinique', city: 'Fort-de-France', region: 'Martinique', also: 'France outre-mer Antilles' },
  { id: 'America/Cayenne', city: 'Cayenne', region: 'Guyane', also: 'France outre-mer Kourou' },
  { id: 'America/Port-au-Prince', city: 'Port-au-Prince', region: 'Haïti' },
  { id: 'America/Bogota', city: 'Bogota', region: 'Colombie' },
  { id: 'America/Lima', city: 'Lima', region: 'Pérou' },
  { id: 'America/Santiago', city: 'Santiago', region: 'Chili' },
  { id: 'America/Argentina/Buenos_Aires', city: 'Buenos Aires', region: 'Argentine' },
  { id: 'America/Sao_Paulo', city: 'São Paulo', region: 'Brésil', also: 'Rio de Janeiro Brasilia' },
  // Le temps universel, pour qui travaille avec des serveurs.
  { id: 'UTC', city: 'Temps universel', region: 'UTC', also: 'GMT Greenwich' },
];

// Les anciens noms de la base IANA, que des navigateurs donnent encore, vers celui de la liste : le même fuseau sous un autre nom.
const ALIASES: Readonly<Record<string, string>> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Europe/Kiev': 'Europe/Kyiv',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
  'GMT': 'UTC',
  'Universal': 'UTC',
  'Zulu': 'UTC',
};

const BY_ID: ReadonlyMap<string, ZoneEntry> = new Map(ZONES.map((entry) => [entry.id, entry]));

// Le nom de la liste pour ce fuseau : le même, ou celui qui remplace un ancien nom.
export function canonicalZone(zone: string): string {
  return ALIASES[zone] ?? zone;
}

// Deux noms pour le même fuseau de la liste ? (« Asia/Calcutta » et « Asia/Kolkata »)
export function sameZone(a: string, b: string): boolean {
  return canonicalZone(a) === canonicalZone(b);
}

export function zoneEntry(zone: string): ZoneEntry | undefined {
  return BY_ID.get(canonicalZone(zone));
}

// Où est ce fuseau, dit en clair : la ville et le pays de la liste, sinon la ville du nom IANA (« America/Argentina/Salta » : Salta), sans pays.
export function zonePlace(zone: string): { city: string; region: string | null } {
  const entry = zoneEntry(zone);
  if (entry) return { city: entry.city, region: entry.region };
  const last = zone.split('/').at(-1) ?? zone;
  return { city: last.replaceAll('_', ' '), region: null };
}

// « Montréal, Canada », « Salta ».
export function zoneLabel(zone: string): string {
  const { city, region } = zonePlace(zone);
  return region === null || region === city ? city : `${city}, ${region}`;
}

// Une ligne de la liste, avec son décalage du moment (il change avec l'heure d'été).
export interface ZoneOption extends ZoneEntry {
  offset: number;
}

const byOffsetThenCity = (a: ZoneOption, b: ZoneOption): number => a.offset - b.offset || a.city.localeCompare(b.city, 'fr');

// La liste, d'ouest en est (le décalage du moment), et par ville à décalage égal, avec en plus les fuseaux `extra` qu'elle n'a pas (le sien, celui de
// l'appareil : « Asia/Almaty » y entre sous le nom de sa ville). Les fuseaux que ce navigateur ne connaît pas en sont écartés.
export function zoneOptions(at: number, extra: readonly (string | null)[] = []): ZoneOption[] {
  const entries: ZoneEntry[] = ZONES.filter((entry) => isTimezone(entry.id));
  for (const zone of extra) {
    if (zone === null || !isTimezone(zone) || entries.some((entry) => sameZone(entry.id, zone))) continue;
    entries.push({ id: zone, city: zonePlace(zone).city, region: '' });
  }
  return entries.map((entry) => ({ ...entry, offset: zoneOffsetMinutes(entry.id, at) })).sort(byOffsetThenCity);
}

// Un mot de la recherche qui est un décalage (« utc+9 », « +9 », « -4 », « utc-3:30 ») : il se compare au décalage entier, pour que « utc+1 » ne
// trouve pas aussi UTC+10. Le vrai signe moins se tape rarement : « - » vaut « − ».
const OFFSET_WORD = /^(utc)?[+-]\d/;
const offsetKey = (offset: number): string => searchKey(formatUtcOffset(offset)).replace('−', '-');

// La recherche : sans tenir compte des accents ni des majuscules (« montreal » trouve Montréal, « reunion » La Réunion), sur la ville, le pays, les
// autres villes du fuseau, le nom IANA et le décalage. Chaque mot doit se trouver quelque part. Vide : toute la liste.
export function searchZones(options: readonly ZoneOption[], query: string): ZoneOption[] {
  const words = searchKey(query).replaceAll('−', '-').split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [...options];
  return options.filter((option) => {
    const haystack = searchKey(`${option.city} ${option.region} ${option.also ?? ''} ${option.id.replaceAll('_', ' ')}`);
    return words.every((word) => (OFFSET_WORD.test(word) ? offsetKey(option.offset) === (word.startsWith('utc') ? word : `utc${word}`) : haystack.includes(word)));
  });
}
