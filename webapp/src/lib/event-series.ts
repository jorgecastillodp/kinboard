/**
 * Writing a repeating event: the series row and its occurrences, which are
 * ordinary rows in `events` (lib/event-repeat.ts decides when they fall).
 * Server only, on the service role: the routes under /api/calendar/series and
 * the daily cron that keeps every series' occurrences far enough ahead.
 */
import {
  MAX_OCCURRENCES,
  dayFromKey,
  dayKey,
  formatRepeatRule,
  horizonDay,
  occurrences,
  parseRepeatRule,
  wallParts,
  type RepeatRule,
} from "@/lib/event-repeat";
import { zonedWallTimeToUtc } from "@/lib/integration-event-input";
import type { SeriesFields, SeriesTiming } from "@/lib/event-series-input";

/* The admin client is deliberately untyped in this codebase (see family-scope.ts). */
type Admin = any;

export interface SeriesRow {
  id: string;
  family_id: string;
  calendar_id: string;
  rule: string;
  time_zone: string;
  first_start_at: string;
  first_end_at: string;
  all_day: boolean;
  title: string;
  description: string | null;
  location: string | null;
  person_id: string | null;
  generated_through: string;
}

export const SERIES_COLUMNS =
  "id, family_id, calendar_id, rule, time_zone, first_start_at, first_end_at, all_day, title, description, location, person_id, generated_through";

/**
 * The rows for a series' occurrences on the wall days `fromDay`..`toDay`, and
 * the last day they cover: `toDay`, or the last one made when the cap stopped
 * them sooner.
 */
export function occurrenceRows(series: SeriesRow, fromDay: number, toDay: number) {
  const rule = parseRepeatRule(series.rule);
  if (!rule || toDay < fromDay) return { rows: [], through: toDay };
  const list = occurrences({
    first: { start: new Date(series.first_start_at), end: new Date(series.first_end_at) },
    allDay: series.all_day,
    rule,
    timeZone: series.time_zone,
    fromDay,
    toDay,
  });
  const through = list.length >= MAX_OCCURRENCES ? wallParts(list[list.length - 1].start, series.time_zone).day : toDay;
  const rows = list.map((o) => ({
    calendar_id: series.calendar_id,
    series_id: series.id,
    recurrence_rule: series.rule,
    title: series.title,
    description: series.description,
    location: series.location,
    person_id: series.person_id,
    start_at: o.start.toISOString(),
    end_at: o.end.toISOString(),
    all_day: series.all_day,
  }));
  return { rows, through };
}

/** The last day a series should have occurrences for, today. */
function targetDay(series: SeriesRow, rule: RepeatRule, now: Date): number {
  const firstDay = wallParts(new Date(series.first_start_at), series.time_zone).day;
  const today = wallParts(now, series.time_zone).day;
  return horizonDay(rule, Math.max(today, firstDay));
}

async function insertOccurrences(admin: Admin, rows: unknown[]) {
  // In slices, so a long series is a few requests rather than one huge one.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from("events").insert(rows.slice(i, i + 200));
    if (error) throw error;
  }
}

/** A new series and its first occurrences. */
export async function createSeries(
  admin: Admin,
  input: { familyId: string; calendarId: string; fields: SeriesFields; timing: SeriesTiming; rule: RepeatRule; timeZone: string; now: Date },
): Promise<{ id: string; occurrences: number }> {
  const { data: series, error } = await admin
    .from("event_series")
    .insert({
      family_id: input.familyId,
      calendar_id: input.calendarId,
      rule: formatRepeatRule(input.rule),
      time_zone: input.timeZone,
      first_start_at: input.timing.start.toISOString(),
      first_end_at: input.timing.end.toISOString(),
      all_day: input.timing.allDay,
      title: input.fields.title,
      description: input.fields.description,
      location: input.fields.location,
      person_id: input.fields.personId,
      generated_through: dayKey(wallParts(input.timing.start, input.timeZone).day),
    })
    .select(SERIES_COLUMNS)
    .single();
  if (error) throw error;
  try {
    return { id: series.id, occurrences: await regenerate(admin, series as SeriesRow, input.now) };
  } catch (err) {
    await admin.from("event_series").delete().eq("id", series.id);
    throw err;
  }
}

/** Make a series' occurrences from its first day through today's target, and record how far they go. */
async function regenerate(admin: Admin, series: SeriesRow, now: Date): Promise<number> {
  const rule = parseRepeatRule(series.rule);
  if (!rule) return 0;
  const firstDay = wallParts(new Date(series.first_start_at), series.time_zone).day;
  const { rows, through } = occurrenceRows(series, firstDay, targetDay(series, rule, now));
  await insertOccurrences(admin, rows);
  const { error } = await admin.from("event_series").update({ generated_through: dayKey(through) }).eq("id", series.id);
  if (error) throw error;
  return rows.length;
}

/**
 * The daily top-up: every series whose occurrences stop short of its horizon
 * gets the next ones, from the day after `generated_through` (so an
 * occurrence deleted on its own is not made again).
 */
export async function extendAllSeries(admin: Admin, now: Date): Promise<{ series: number; added: number }> {
  const { data, error } = await admin.from("event_series").select(SERIES_COLUMNS);
  if (error) throw error;
  let series = 0;
  let added = 0;
  for (const row of (data ?? []) as SeriesRow[]) {
    const rule = parseRepeatRule(row.rule);
    const from = dayFromKey(row.generated_through);
    if (!rule || from === null) continue;
    const { rows, through } = occurrenceRows(row, from + 1, targetDay(row, rule, now));
    if (rows.length === 0 && through <= from) continue;
    await insertOccurrences(admin, rows);
    const { error: updateError } = await admin
      .from("event_series")
      .update({ generated_through: dayKey(Math.max(from, through)), updated_at: now.toISOString() })
      .eq("id", row.id);
    if (updateError) throw updateError;
    series += 1;
    added += rows.length;
  }
  return { series, added };
}

/**
 * "All events", from an edit made on one occurrence. A new title, place,
 * description or person goes to every occurrence as it is. A new time, day,
 * length or repeat makes the series again from its first day: moving that
 * occurrence by some days moves the whole series by as many (and a weekly
 * series' weekdays with it), unless a new repeat was chosen too.
 *
 * `rule` null stops the repeat: the edited occurrence stays, on its own, and
 * the series and its other occurrences go.
 */
export async function updateSeries(
  admin: Admin,
  series: SeriesRow,
  occurrence: { id: string; start_at: string; end_at: string; all_day: boolean },
  change: { fields: SeriesFields; timing: SeriesTiming; rule: RepeatRule | null | undefined },
  now: Date,
): Promise<{ occurrences: number }> {
  const fieldRow = {
    title: change.fields.title,
    description: change.fields.description,
    location: change.fields.location,
    person_id: change.fields.personId,
  };

  if (change.rule === null) {
    const { error: keepError } = await admin
      .from("events")
      .update({
        ...fieldRow,
        start_at: change.timing.start.toISOString(),
        end_at: change.timing.end.toISOString(),
        all_day: change.timing.allDay,
        series_id: null,
        recurrence_rule: null,
      })
      .eq("id", occurrence.id);
    if (keepError) throw keepError;
    const { error } = await admin.from("event_series").delete().eq("id", series.id);
    if (error) throw error;
    return { occurrences: 1 };
  }

  const zone = series.time_zone;
  const oldStart = wallParts(new Date(occurrence.start_at), zone);
  const oldEnd = wallParts(new Date(occurrence.end_at), zone);
  const newStart = wallParts(change.timing.start, zone);
  const newEnd = wallParts(change.timing.end, zone);
  const shift = newStart.day - oldStart.day;
  const timingChanged =
    shift !== 0 ||
    change.timing.allDay !== occurrence.all_day ||
    (!change.timing.allDay && newStart.msIntoDay !== oldStart.msIntoDay) ||
    newEnd.day - newStart.day !== oldEnd.day - oldStart.day ||
    newEnd.msIntoDay !== oldEnd.msIntoDay;

  const oldRule = parseRepeatRule(series.rule);
  const rule: RepeatRule | null = change.rule ?? (oldRule && shiftRule(oldRule, shift));
  if (!rule) throw new Error("the series' rule cannot be read");
  const ruleText = formatRepeatRule(rule);

  if (!timingChanged && ruleText === series.rule) {
    const { error: seriesError } = await admin
      .from("event_series")
      .update({ ...fieldRow, updated_at: now.toISOString() })
      .eq("id", series.id);
    if (seriesError) throw seriesError;
    const { error, count } = await admin.from("events").update(fieldRow, { count: "exact" }).eq("series_id", series.id);
    if (error) throw error;
    return { occurrences: count ?? 0 };
  }

  const firstDay = wallParts(new Date(series.first_start_at), zone).day + shift;
  const span = newEnd.day - newStart.day;
  const firstStart = zonedWallTimeToUtc(firstDay, change.timing.allDay ? 0 : newStart.msIntoDay, zone);
  const firstEnd = zonedWallTimeToUtc(firstDay + span, newEnd.msIntoDay, zone);
  const next: SeriesRow = {
    ...series,
    ...fieldRow,
    rule: ruleText,
    all_day: change.timing.allDay,
    first_start_at: firstStart.toISOString(),
    first_end_at: firstEnd.toISOString(),
  };
  const { error: seriesError } = await admin
    .from("event_series")
    .update({
      ...fieldRow,
      rule: next.rule,
      all_day: next.all_day,
      first_start_at: next.first_start_at,
      first_end_at: next.first_end_at,
      updated_at: now.toISOString(),
    })
    .eq("id", series.id);
  if (seriesError) throw seriesError;
  const { error: deleteError } = await admin.from("events").delete().eq("series_id", series.id);
  if (deleteError) throw deleteError;
  return { occurrences: await regenerate(admin, next, now) };
}

/** A weekly series' weekdays moved by `shift` days with the series; other rules move with their first day. */
export function shiftRule(rule: RepeatRule, shift: number): RepeatRule {
  if (rule.freq !== "weekly" || !rule.weekdays || shift % 7 === 0) return rule;
  const weekdays = [...new Set(rule.weekdays.map((d) => (((d + shift) % 7) + 7) % 7))].sort((a, b) => a - b);
  return { ...rule, weekdays };
}

/**
 * Delete a series: all of it, or from one occurrence on ("this and
 * following"), which ends the repeat the day before so the top-up stops there.
 */
export async function deleteSeries(
  admin: Admin,
  series: SeriesRow,
  from?: { start_at: string },
): Promise<{ deleted: "series" | "following" }> {
  if (!from) {
    const { error } = await admin.from("event_series").delete().eq("id", series.id);
    if (error) throw error;
    return { deleted: "series" };
  }
  const { error: deleteError } = await admin
    .from("events")
    .delete()
    .eq("series_id", series.id)
    .gte("start_at", from.start_at);
  if (deleteError) throw deleteError;
  const { count, error: countError } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("series_id", series.id);
  if (countError) throw countError;
  if (!count) {
    const { error } = await admin.from("event_series").delete().eq("id", series.id);
    if (error) throw error;
    return { deleted: "series" };
  }
  const rule = parseRepeatRule(series.rule);
  const lastDay = wallParts(new Date(from.start_at), series.time_zone).day - 1;
  const through = dayFromKey(series.generated_through);
  const oldUntil = rule?.until ? dayFromKey(rule.until) : null;
  const untilDay = oldUntil === null ? lastDay : Math.min(oldUntil, lastDay);
  const ended = rule ? formatRepeatRule({ ...rule, until: dayKey(untilDay) }) : series.rule;
  const { error } = await admin
    .from("event_series")
    .update({ rule: ended, generated_through: dayKey(through === null ? lastDay : Math.min(through, lastDay)) })
    .eq("id", series.id);
  if (error) throw error;
  await admin.from("events").update({ recurrence_rule: ended }).eq("series_id", series.id);
  return { deleted: "following" };
}
