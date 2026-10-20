/**
 * Repeating events in Kinboard's own calendars.
 *
 * A series is stored the way a synced Google or CalDAV calendar stores one:
 * a row per occurrence in `events`, each pointing at its `event_series`. So
 * everything that reads events — the calendar, the Home widgets, reminders,
 * the calendar feed, the Integration API — shows the repeats without knowing
 * they repeat. This file decides when the occurrences fall. Pure, so the fast
 * suite covers it.
 *
 * Occurrences keep the first one's wall-clock time in the series' time zone,
 * across daylight-saving changes, the way the calendar page builds a single
 * event in the browser.
 */
import { zonedWallTimeToUtc } from "@/lib/integration-event-input";

export type RepeatFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface RepeatRule {
  freq: RepeatFreq;
  /** Every how many days, weeks, months or years. */
  interval: number;
  /** Weekly only: the weekdays it falls on, 0 = Sunday. Missing: the first occurrence's own. */
  weekdays?: number[];
  /** The last day it may fall on, "YYYY-MM-DD" in the series' zone. Missing: it doesn't end. */
  until?: string;
}

/** What the event dialog offers. */
export const REPEAT_CHOICES = ["never", "daily", "weekly", "biweekly", "monthly", "yearly", "custom"] as const;
export type RepeatChoice = (typeof REPEAT_CHOICES)[number];

/** How far ahead occurrences are kept, by frequency; a daily job tops them up. */
export const HORIZON_DAYS: Record<RepeatFreq, number> = {
  daily: 120,
  weekly: 400,
  monthly: 3 * 366,
  yearly: 10 * 366,
};

/** No series makes more occurrences than this in one go, whatever its rule says. */
export const MAX_OCCURRENCES = 500;

const DAY_MS = 86_400_000;
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** A wall-clock day as a number: days since 1970-01-01. */
export type WallDay = number;

/** The weekday of a wall day, 0 = Sunday (1970-01-01 was a Thursday). */
export function weekdayOf(day: WallDay): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** "YYYY-MM-DD" for a wall day, and back. */
export function dayKey(day: WallDay): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
export function dayFromKey(key: string): WallDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const ms = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== key) return null;
  return ms / DAY_MS;
}

/** The wall-clock day and time of an instant in a zone. */
export function wallParts(instant: Date, timeZone: string): { day: WallDay; msIntoDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const day = Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS;
  const msIntoDay = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + instant.getUTCMilliseconds();
  return { day, msIntoDay };
}

/** The rule for a choice in the event dialog; null for "never". */
export function ruleForChoice(
  choice: RepeatChoice,
  options: { weekdays?: number[]; until?: string | null } = {},
): RepeatRule | null {
  const until = options.until ? { until: options.until } : {};
  switch (choice) {
    case "never":
      return null;
    case "daily":
      return { freq: "daily", interval: 1, ...until };
    case "weekly":
      return { freq: "weekly", interval: 1, ...until };
    case "biweekly":
      return { freq: "weekly", interval: 2, ...until };
    case "monthly":
      return { freq: "monthly", interval: 1, ...until };
    case "yearly":
      return { freq: "yearly", interval: 1, ...until };
    case "custom": {
      const weekdays = [...new Set(options.weekdays ?? [])].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
      return weekdays.length > 0 ? { freq: "weekly", interval: 1, weekdays, ...until } : null;
    }
  }
}

/** The dialog's choice for a rule, to show it again when editing. */
export function choiceForRule(rule: RepeatRule | null): RepeatChoice {
  if (!rule) return "never";
  if (rule.freq === "weekly" && rule.weekdays && rule.weekdays.length > 0) return "custom";
  if (rule.freq === "weekly") return rule.interval === 2 ? "biweekly" : "weekly";
  return rule.freq;
}

/** The rule as iCalendar RRULE text, the form stored with the series and its occurrences. */
export function formatRepeatRule(rule: RepeatRule): string {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "weekly" && rule.weekdays && rule.weekdays.length > 0) {
    parts.push(`BYDAY=${rule.weekdays.map((d) => BYDAY[d]).join(",")}`);
  }
  if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll("-", "")}`);
  return parts.join(";");
}

/**
 * RRULE text back into a rule: only what Kinboard writes (FREQ, INTERVAL,
 * weekly BYDAY, a date UNTIL). Anything else is null, never a guess.
 */
export function parseRepeatRule(text: string | null | undefined): RepeatRule | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const fields = new Map<string, string>();
  for (const part of text.trim().split(";")) {
    const [key, value, ...rest] = part.split("=");
    if (!key || value === undefined || rest.length > 0 || fields.has(key)) return null;
    fields.set(key.toUpperCase(), value.toUpperCase());
  }
  const freq = fields.get("FREQ")?.toLowerCase();
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly" && freq !== "yearly") return null;
  for (const key of fields.keys()) if (!["FREQ", "INTERVAL", "BYDAY", "UNTIL"].includes(key)) return null;
  const interval = fields.has("INTERVAL") ? Number(fields.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return null;
  const rule: RepeatRule = { freq, interval };
  if (fields.has("BYDAY")) {
    if (freq !== "weekly") return null;
    const days = fields.get("BYDAY")!.split(",").map((d) => BYDAY.indexOf(d as (typeof BYDAY)[number]));
    if (days.some((d) => d < 0)) return null;
    rule.weekdays = [...new Set(days)].sort((a, b) => a - b);
  }
  if (fields.has("UNTIL")) {
    const raw = fields.get("UNTIL")!;
    if (!/^\d{8}$/.test(raw)) return null;
    const key = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    if (dayFromKey(key) === null) return null;
    rule.until = key;
  }
  return rule;
}

function civil(day: WallDay): { year: number; month: number; dom: number } {
  const d = new Date(day * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), dom: d.getUTCDate() };
}
function dayOf(year: number, month: number, dom: number): WallDay {
  return Date.UTC(year, month, dom) / DAY_MS;
}
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The wall days a series falls on, from its first day, inclusive of
 * `fromDay`..`toDay` and never past its `until`. A monthly series on the
 * 31st falls on the last day of shorter months; a yearly one on 29 February
 * on the 28th in other years.
 */
export function repeatDays(rule: RepeatRule, firstDay: WallDay, fromDay: WallDay, toDay: WallDay): WallDay[] {
  const untilDay = rule.until ? dayFromKey(rule.until) : null;
  const last = untilDay === null ? toDay : Math.min(toDay, untilDay);
  const days: WallDay[] = [];
  const keep = (day: WallDay) => {
    if (day >= firstDay && day >= fromDay && day <= last) days.push(day);
  };
  const step = Math.max(1, Math.floor(rule.interval));
  if (rule.freq === "daily") {
    // Start at the first step on or after fromDay rather than walking from the first day.
    const skip = fromDay > firstDay ? Math.ceil((fromDay - firstDay) / step) : 0;
    for (let day = firstDay + skip * step; day <= last && days.length < MAX_OCCURRENCES; day += step) keep(day);
  } else if (rule.freq === "weekly") {
    const weekdays = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(firstDay)];
    const weekStart = firstDay - weekdayOf(firstDay);
    const skipWeeks = fromDay > weekStart ? Math.floor((fromDay - weekStart) / 7 / step) : 0;
    for (let w = weekStart + skipWeeks * 7 * step; w <= last && days.length < MAX_OCCURRENCES; w += 7 * step) {
      for (const wd of weekdays) keep(w + wd);
    }
  } else {
    const first = civil(firstDay);
    for (let k = 0; days.length < MAX_OCCURRENCES; k += step) {
      const monthIndex = rule.freq === "monthly" ? first.month + k : first.month;
      const year = rule.freq === "monthly" ? first.year + Math.floor(monthIndex / 12) : first.year + k;
      const month = ((monthIndex % 12) + 12) % 12;
      const day = dayOf(year, month, Math.min(first.dom, daysInMonth(year, month)));
      if (day > last) break;
      keep(day);
    }
  }
  return days;
}

export interface Occurrence {
  start: Date;
  end: Date;
}

/**
 * The occurrences of a series whose first one runs `first.start`–`first.end`,
 * on the wall days `fromDay`..`toDay`. Each starts at the first one's
 * wall-clock time in `timeZone` (an all-day one at the start of its day) and
 * lasts as many days and ends at the same wall-clock time as the first.
 */
export function occurrences(params: {
  first: Occurrence;
  allDay: boolean;
  rule: RepeatRule;
  timeZone: string;
  fromDay: WallDay;
  toDay: WallDay;
}): Occurrence[] {
  const { first, allDay, rule, timeZone, fromDay, toDay } = params;
  const start = wallParts(first.start, timeZone);
  const end = wallParts(first.end, timeZone);
  const spanDays = Math.max(0, end.day - start.day);
  const startMs = allDay ? 0 : start.msIntoDay;
  return repeatDays(rule, start.day, fromDay, toDay).map((day) => ({
    start: zonedWallTimeToUtc(day, startMs, timeZone),
    end: zonedWallTimeToUtc(day + spanDays, end.msIntoDay, timeZone),
  }));
}

/** The last wall day a series keeps occurrences for, `today` being the zone's today. */
export function horizonDay(rule: RepeatRule, today: WallDay): WallDay {
  const horizon = today + HORIZON_DAYS[rule.freq];
  const untilDay = rule.until ? dayFromKey(rule.until) : null;
  return untilDay === null ? horizon : Math.min(horizon, untilDay);
}
