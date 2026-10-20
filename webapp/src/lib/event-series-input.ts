/**
 * Reading a repeating event's request body (the routes under
 * /api/calendar/series). Pure: every check here is in the fast suite, and a
 * route only ever sees a value that passed.
 */
import { isValidTimeZone } from "@/lib/integration-event-input";
import { dayFromKey, parseRepeatRule, wallParts, type RepeatRule } from "@/lib/event-repeat";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An occurrence lasts at most this long; a series of month-long events is not one. */
export const MAX_SPAN_MS = 31 * 86_400_000;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface SeriesFields {
  title: string;
  /** undefined: not sent, so unchanged (a change); a new series has none. */
  description?: string | null;
  location: string | null;
  personId: string | null;
}

export interface SeriesTiming {
  start: Date;
  end: Date;
  allDay: boolean;
}

const fail = (error: string) => ({ ok: false as const, error });

function optionalText(value: unknown, max: number): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) return false;
  return value.trim() === "" ? null : value;
}

export function parseSeriesFields(body: Record<string, unknown>): Parsed<SeriesFields> {
  const sent = "description" in body && body.description !== undefined;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title === "" || title.length > 300) return fail("title is required (at most 300 characters)");
  const description = optionalText(body.description, 5000);
  if (description === false) return fail("description must be text (at most 5000 characters)");
  const location = optionalText(body.location, 500);
  if (location === false) return fail("location must be text (at most 500 characters)");
  const personId = body.person_id ?? null;
  if (personId !== null && (typeof personId !== "string" || !UUID.test(personId))) return fail("person_id must be an id");
  return {
    ok: true,
    value: { title, ...(sent ? { description } : {}), location, personId: personId as string | null },
  };
}

export function parseSeriesTiming(body: Record<string, unknown>): Parsed<SeriesTiming> {
  const start = typeof body.start_at === "string" ? new Date(body.start_at) : null;
  const end = typeof body.end_at === "string" ? new Date(body.end_at) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return fail("start_at and end_at must be ISO times");
  }
  if (end < start) return fail("end_at is before start_at");
  if (end.getTime() - start.getTime() > MAX_SPAN_MS) return fail("an occurrence lasts at most 31 days");
  if (body.all_day !== undefined && typeof body.all_day !== "boolean") return fail("all_day must be true or false");
  return { ok: true, value: { start, end, allDay: body.all_day === true } };
}

function parseRule(value: unknown, start: Date, timeZone: string): Parsed<RepeatRule> {
  const rule = parseRepeatRule(typeof value === "string" ? value : null);
  if (!rule) return fail("rule must be a repeat Kinboard knows (daily, weekly, monthly or yearly)");
  if (rule.until) {
    const until = dayFromKey(rule.until);
    if (until === null || until < wallParts(start, timeZone).day) return fail("the repeat ends before it starts");
  }
  return { ok: true, value: rule };
}

/** POST /api/calendar/series */
export function parseSeriesCreate(body: unknown): Parsed<{
  calendarId: string;
  fields: SeriesFields;
  timing: SeriesTiming;
  rule: RepeatRule;
  timeZone: string;
}> {
  if (!body || typeof body !== "object") return fail("a JSON body is required");
  const b = body as Record<string, unknown>;
  if (typeof b.calendar_id !== "string" || !UUID.test(b.calendar_id)) return fail("calendar_id must be an id");
  if (!isValidTimeZone(b.time_zone)) return fail("time_zone must be a time zone name");
  const fields = parseSeriesFields(b);
  if (!fields.ok) return fields;
  const timing = parseSeriesTiming(b);
  if (!timing.ok) return timing;
  const rule = parseRule(b.rule, timing.value.start, b.time_zone);
  if (!rule.ok) return rule;
  return {
    ok: true,
    value: {
      calendarId: b.calendar_id,
      // A new series has a description or none: nothing to keep.
      fields: { ...fields.value, description: fields.value.description ?? null },
      timing: timing.value,
      rule: rule.value,
      timeZone: b.time_zone,
    },
  };
}

/**
 * PATCH /api/calendar/series/[id]: the changes to every occurrence, made on
 * one of them. `rule` absent keeps the repeat, null stops it (that occurrence
 * stays, on its own), text replaces it.
 */
export function parseSeriesUpdate(body: unknown, timeZone: string): Parsed<{
  occurrenceId: string;
  fields: SeriesFields;
  timing: SeriesTiming;
  rule: RepeatRule | null | undefined;
}> {
  if (!body || typeof body !== "object") return fail("a JSON body is required");
  const b = body as Record<string, unknown>;
  if (typeof b.occurrence_id !== "string" || !UUID.test(b.occurrence_id)) return fail("occurrence_id must be an id");
  const fields = parseSeriesFields(b);
  if (!fields.ok) return fields;
  const timing = parseSeriesTiming(b);
  if (!timing.ok) return timing;
  let rule: RepeatRule | null | undefined;
  if ("rule" in b && b.rule === null) rule = null;
  else if ("rule" in b) {
    const parsed = parseRule(b.rule, timing.value.start, timeZone);
    if (!parsed.ok) return parsed;
    rule = parsed.value;
  }
  return { ok: true, value: { occurrenceId: b.occurrence_id, fields: fields.value, timing: timing.value, rule } };
}
