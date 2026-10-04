import { isValidTimeZone, zoneOffsetMs } from "@/lib/integration-event-input";

/**
 * What Settings → Language offers for the family's time zone: the
 * `timezone` setting, which the server (lib/family-time.ts) and the database
 * (family_time_zone()) read; absent means the server's own. Pure, so
 * e2e/time-zone-setting.spec.ts tests it without a stack.
 */

export interface TimeZoneOption {
  zone: string;
  /** "America/New York": the name as people write it. */
  label: string;
  /** "UTC-07:00", at the moment the list was made. */
  offset: string;
  /** The same offset in minutes east of UTC. */
  minutes: number;
  /** The names a search matches, lower case: current, as written, former. */
  search: string;
}

/** For a browser too old to list its zones. */
const FALLBACK_ZONES = [
  "Africa/Johannesburg", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/New_York",
  "America/Phoenix", "America/Sao_Paulo", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney",
  "Europe/Berlin", "Europe/London", "Europe/Paris", "Pacific/Auckland",
];

/**
 * Chrome lists zones by their CLDR names, some of which IANA has since
 * renamed — "Asia/Calcutta", "Europe/Kiev" — and Firefox by the current
 * ones. Offered by the current name; the old one still finds it in a search.
 * Every browser, Node and Postgres accept both.
 */
export const CURRENT_ZONE_NAMES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};
const FORMER_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CURRENT_ZONE_NAMES).map(([former, current]) => [current, former]),
);

/** Every zone this browser knows, by its current name, sorted, UTC included — Chrome leaves it out. */
export function allTimeZones(): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  const named = (zones.length > 0 ? zones : FALLBACK_ZONES).map((zone) => CURRENT_ZONE_NAMES[zone] ?? zone);
  return [...new Set([...named, "UTC"])].sort();
}

/** 330 → "UTC+05:30", -420 → "UTC-07:00", 0 → "UTC+00:00". */
export function formatUtcOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${minutes < 0 ? "-" : "+"}${hh}:${mm}`;
}

export function zoneLabel(zone: string): string {
  return zone.replace(/_/g, " ");
}

/** One zone's entry, or null if this browser cannot work out its offset. */
export function timeZoneOption(zone: string, at: Date = new Date()): TimeZoneOption | null {
  let minutes: number;
  try {
    minutes = Math.round(zoneOffsetMs(at.getTime(), zone) / 60_000);
  } catch {
    return null;
  }
  if (!Number.isFinite(minutes)) return null;
  const label = zoneLabel(zone);
  const former = FORMER_NAMES[zone] ? ` ${FORMER_NAMES[zone]} ${zoneLabel(FORMER_NAMES[zone])}` : "";
  return { zone, label, offset: formatUtcOffset(minutes), minutes, search: `${zone} ${label}${former}`.toLowerCase() };
}

/**
 * Every zone with its offset at `at`, sorted by name. `include` adds zones the
 * browser does not list but knows — the family's own, if it is an alias.
 */
export function timeZoneOptions(at: Date = new Date(), include: (string | null | undefined)[] = []): TimeZoneOption[] {
  const zones = new Set(allTimeZones());
  for (const zone of include) if (isValidTimeZone(zone)) zones.add(zone);
  return [...zones].sort().flatMap((zone) => timeZoneOption(zone, at) ?? []);
}

/** "utc+1", "+5:30", "-0800", "GMT+2" as minutes east of UTC; null for a word that is no offset. */
export function queryOffset(word: string): number | null {
  const m = /^(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(word);
  if (!m || Number(m[2]) > 14 || Number(m[3] ?? 0) > 59) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

function queryWords(query: string): string[] {
  return query.toLowerCase().replace(/_/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Whether an option matches every word of `query`: an offset word its offset
 * exactly ("utc+1" is not +10), any other word part of a name. `extra` is
 * more text to match, such as the label of the Automatic choice.
 */
export function matchesTimeZoneQuery(option: TimeZoneOption, query: string, extra = ""): boolean {
  const names = `${option.search} ${extra.toLowerCase()}`;
  return queryWords(query).every((word) => {
    const offset = queryOffset(word);
    return offset !== null ? option.minutes === offset : names.includes(word);
  });
}

/** The options matching `query`; all of them for an empty one. */
export function filterTimeZones(options: TimeZoneOption[], query: string): TimeZoneOption[] {
  if (queryWords(query).length === 0) return options;
  return options.filter((option) => matchesTimeZoneQuery(option, query));
}

/** "14:05": the wall clock in `zone` at `at`, in the viewer's language. */
export function timeIn(zone: string, locale: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(at);
  } catch {
    return "";
  }
}
