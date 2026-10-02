import type { Holiday } from "./types";
import { getDeHolidays } from "./de";
import { getUsHolidays, getUsObservances } from "./us";
import { getUkHolidays } from "./uk";
import { getNlHolidays } from "./nl";
import { getFrHolidays } from "./fr";
import { addDays } from "./utils";

export type CountryCode = "de" | "us" | "uk" | "nl" | "fr";
export const COUNTRIES: readonly CountryCode[] = ["de", "us", "uk", "nl", "fr"];
export const DEFAULT_COUNTRY: CountryCode = "de";

const PROVIDERS: Record<CountryCode, (year: number) => Holiday[]> = {
  de: getDeHolidays,
  us: getUsHolidays,
  uk: getUkHolidays,
  nl: getNlHolidays,
  fr: getFrHolidays,
};

export function getHolidays(country: CountryCode, year: number): Holiday[] {
  return PROVIDERS[country](year);
}

export function getUpcomingHolidays(country: CountryCode, daysAhead: number = 14): Holiday[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff = addDays(today, daysAhead);
  const year = today.getFullYear();
  const holidays = [...getHolidays(country, year), ...getHolidays(country, year + 1)];
  return holidays
    .filter((h) => h.date >= today && h.date <= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

const OBSERVANCES: Partial<Record<CountryCode, (year: number) => Holiday[]>> = {
  us: getUsObservances,
};

/**
 * Days that are celebrated but are not public holidays -- Halloween, Mother's
 * Day -- for the holiday countdown; empty for a country without such a list.
 * The calendar does not mark them: its switch is for public holidays.
 */
export function getObservances(country: CountryCode, year: number): Holiday[] {
  return OBSERVANCES[country]?.(year) ?? [];
}

/** A holiday as the countdown shows it. */
export interface UpcomingHoliday extends Holiday {
  /** The weekday a day off is taken instead, when the holiday falls on a weekend; null when it does not move. */
  observed: Date | null;
}

const isWeekend = (date: Date): boolean => date.getDay() === 0 || date.getDay() === 6;
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * The weekday each of a year's days off is taken on, where it is not the day
 * itself. A US federal holiday on a Saturday is taken the Friday before, on a
 * Sunday the Monday after (5 U.S.C. 6103(b)), so New Year's Day on a Saturday
 * is off on 31 December. A UK bank holiday on a weekend moves to the next
 * weekday that is not one already: a Saturday Christmas is taken on Monday
 * the 27th and its Sunday Boxing Day on the 28th. Elsewhere a holiday that
 * falls on a weekend is simply lost.
 */
function observedDays(country: CountryCode, holidays: readonly Holiday[]): Map<Holiday, Date> {
  const observed = new Map<Holiday, Date>();
  if (country === "us") {
    for (const holiday of holidays) {
      if (!holiday.dayOff) continue;
      if (holiday.date.getDay() === 6) observed.set(holiday, addDays(holiday.date, -1));
      else if (holiday.date.getDay() === 0) observed.set(holiday, addDays(holiday.date, 1));
    }
  } else if (country === "uk") {
    const taken = holidays.filter((h) => h.dayOff && !isWeekend(h.date)).map((h) => h.date);
    for (const holiday of [...holidays].sort((a, b) => a.date.getTime() - b.date.getTime())) {
      if (!holiday.dayOff || !isWeekend(holiday.date)) continue;
      let day = addDays(holiday.date, 1);
      while (isWeekend(day) || taken.some((t) => sameDay(t, day))) day = addDays(day, 1);
      taken.push(day);
      observed.set(holiday, day);
    }
  }
  return observed;
}

/**
 * The next `count` holidays from `from` on, that day included, for the
 * holiday countdown: the public holidays the calendar marks plus the
 * country's observances, sorted by date, each day off that falls on a weekend
 * with the weekday it is taken. A holiday already past whose day off is still
 * to come -- a Sunday holiday, on the Monday it is taken -- stays listed.
 */
export function nextHolidays(country: CountryCode, from: Date, count: number): UpcomingHoliday[] {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const all: UpcomingHoliday[] = [];
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const holidays = getHolidays(country, year);
    const observed = observedDays(country, holidays);
    for (const holiday of holidays) all.push({ ...holiday, observed: observed.get(holiday) ?? null });
    for (const holiday of getObservances(country, year)) all.push({ ...holiday, observed: null });
  }
  return all
    .filter((h) => h.date >= today || (h.observed !== null && h.observed >= today))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || Number(b.dayOff) - Number(a.dayOff))
    .slice(0, count);
}

export type { Holiday } from "./types";
