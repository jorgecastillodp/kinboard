import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseSeriesCreate, parseSeriesUpdate } from "../src/lib/event-series-input";
import { MAX_OCCURRENCES, dayFromKey } from "../src/lib/event-repeat";
import { occurrenceRows, shiftRule, type SeriesRow } from "../src/lib/event-series";
import { takesRepeatingEvents } from "../src/lib/local-calendars";
import { codeOnly } from "./source-helpers";

/**
 * Repeating events, server side and wiring: what a request may say, the rows
 * a series writes, which calendars take one, and how the routes, the nightly
 * job, the migration and the calendar page fit together. No stack;
 * calendar-repeat.spec.ts drives the real thing.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const CAL = "11111111-2222-3333-4444-555555555555";
const OCC = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const body = (over: Record<string, unknown> = {}) => ({
  calendar_id: CAL,
  title: "Swimming",
  start_at: "2026-10-21T15:00:00.000Z",
  end_at: "2026-10-21T16:00:00.000Z",
  all_day: false,
  rule: "FREQ=WEEKLY",
  time_zone: "Europe/Berlin",
  ...over,
});

test("a new series: every field is checked before anything is written", () => {
  const ok = parseSeriesCreate(body({ location: "  ", person_id: null }));
  expect(ok.ok).toBe(true);
  if (ok.ok) {
    expect(ok.value.rule).toEqual({ freq: "weekly", interval: 1 });
    expect(ok.value.fields).toEqual({ title: "Swimming", description: null, location: null, personId: null });
  }
  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ calendar_id: "nope" }, /calendar_id/],
    [{ time_zone: "Mars/Olympus" }, /time_zone/],
    [{ title: "   " }, /title/],
    [{ end_at: "2026-10-21T14:00:00.000Z" }, /before/],
    [{ end_at: "2026-12-01T16:00:00.000Z" }, /31 days/],
    [{ rule: "FREQ=HOURLY" }, /rule/],
    [{ rule: "FREQ=DAILY;UNTIL=20261001" }, /ends before it starts/],
    [{ person_id: "someone" }, /person_id/],
    [{ all_day: "yes" }, /all_day/],
  ];
  for (const [over, error] of bad) {
    const parsed = parseSeriesCreate(body(over));
    expect(parsed.ok, JSON.stringify(over)).toBe(false);
    if (!parsed.ok) expect(parsed.error, JSON.stringify(over)).toMatch(error);
  }
  expect(parseSeriesCreate(null).ok).toBe(false);
});

test("a change for every occurrence: no rule keeps the repeat, null stops it, text replaces it", () => {
  const update = (over: Record<string, unknown>) => parseSeriesUpdate({ ...body(), occurrence_id: OCC, ...over }, "Europe/Berlin");
  const { rule: _rule, ...withoutRule } = { ...body(), occurrence_id: OCC };
  const kept = parseSeriesUpdate(withoutRule, "Europe/Berlin");
  expect(kept.ok && kept.value.rule).toBeUndefined();
  const stopped = update({ rule: null });
  expect(stopped.ok && stopped.value.rule).toBeNull();
  const replaced = update({ rule: "FREQ=MONTHLY" });
  expect(replaced.ok && replaced.value.rule).toEqual({ freq: "monthly", interval: 1 });
  expect(update({ occurrence_id: "x" }).ok).toBe(false);
  expect(update({ rule: "FREQ=WEEKLY;BYDAY=QQ" }).ok).toBe(false);
});

test("moving a series moves a weekly one's weekdays with it; other repeats move with their first day", () => {
  expect(shiftRule({ freq: "weekly", interval: 1, weekdays: [1, 3] }, 1)).toEqual({ freq: "weekly", interval: 1, weekdays: [2, 4] });
  expect(shiftRule({ freq: "weekly", interval: 1, weekdays: [6] }, 2)).toEqual({ freq: "weekly", interval: 1, weekdays: [1] });
  expect(shiftRule({ freq: "weekly", interval: 1, weekdays: [1] }, -1)).toEqual({ freq: "weekly", interval: 1, weekdays: [0] });
  expect(shiftRule({ freq: "weekly", interval: 1, weekdays: [1] }, 7)).toEqual({ freq: "weekly", interval: 1, weekdays: [1] });
  expect(shiftRule({ freq: "monthly", interval: 1 }, 3)).toEqual({ freq: "monthly", interval: 1 });
});

test("a series' rows are ordinary events that carry the series and its rule", () => {
  const series: SeriesRow = {
    id: "series-1",
    family_id: "family-1",
    calendar_id: CAL,
    rule: "FREQ=WEEKLY;BYDAY=MO,WE",
    time_zone: "Europe/Berlin",
    first_start_at: "2026-10-19T15:00:00.000Z",
    first_end_at: "2026-10-19T16:00:00.000Z",
    all_day: false,
    title: "Swimming",
    description: null,
    location: "Pool",
    person_id: null,
    generated_through: "2026-10-19",
  };
  const { rows, through } = occurrenceRows(series, dayFromKey("2026-10-19")!, dayFromKey("2026-10-28")!);
  expect(rows.map((r) => r.start_at)).toEqual([
    "2026-10-19T15:00:00.000Z",
    "2026-10-21T15:00:00.000Z",
    "2026-10-26T16:00:00.000Z", // 17:00 in Berlin, after the clocks went back
    "2026-10-28T16:00:00.000Z",
  ]);
  expect(rows[0]).toMatchObject({ calendar_id: CAL, series_id: "series-1", recurrence_rule: series.rule, title: "Swimming", location: "Pool", all_day: false });
  expect(through).toBe(dayFromKey("2026-10-28"));
  // A run the cap stops reports how far it got, so the next top-up starts there.
  const capped = occurrenceRows({ ...series, rule: "FREQ=DAILY" }, dayFromKey("2026-10-19")!, dayFromKey("2030-01-01")!);
  expect(capped.rows).toHaveLength(MAX_OCCURRENCES);
  expect(capped.through).toBe(dayFromKey("2026-10-19")! + MAX_OCCURRENCES - 1);
});

test("only Kinboard's own calendars take repeating events", () => {
  const local = { google_calendar_id: null, ics_url: null, caldav_url: null, is_holidays: false, is_waste_collection: false };
  expect(takesRepeatingEvents(local)).toBe(true);
  for (const over of [{ google_calendar_id: "g" }, { caldav_url: "https://dav.example" }, { ics_url: "" }, { is_holidays: true }, { is_waste_collection: true }]) {
    expect(takesRepeatingEvents({ ...local, ...over }), JSON.stringify(over)).toBe(false);
  }
});

test("the routes: the family's own session, a local calendar, and the series and occurrence of that family", () => {
  const create = codeOnly(read("src/app/api/calendar/series/route.ts"));
  expect(create).toContain("const auth = await requireSession(request);");
  expect(create).toContain("if (!familyMatchesSession(auth.session, familyId)) {");
  expect(create).toMatch(/\.from\("calendars"\)[\s\S]*?\.eq\("family_id", familyId\)/);
  expect(create).toContain("if (!takesRepeatingEvents(calendar)) {");
  expect(create).toMatch(/\.from\("people"\)[\s\S]*?\.eq\("family_id", familyId\)/);
  const byId = codeOnly(read("src/app/api/calendar/series/[id]/route.ts"));
  expect(byId.match(/requireSession\(request\)/g)?.length).toBe(2);
  expect(byId.match(/familyMatchesSession\(auth\.session, familyId\)/g)?.length).toBe(2);
  expect(byId).toContain('.from("event_series").select(SERIES_COLUMNS).eq("id", id).eq("family_id", familyId).maybeSingle()');
  expect(byId).toMatch(/\.eq\("id", id\)\s*\.eq\("series_id", seriesId\)/);
  expect(byId).toContain('request.nextUrl.searchParams.get("from")');
  const cron = codeOnly(read("src/app/api/cron/extend-event-series/route.ts"));
  expect(cron).toContain("if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {");
  expect(cron).toContain("await extendAllSeries(createAdminClient(), new Date())");
});

test("the nightly job is wired like the others, and the migration keeps writes on the server", () => {
  expect(read("docker/Dockerfile")).toContain("http://localhost:3000/api/cron/extend-event-series' >> /usr/local/bin/extend-event-series");
  const compose = read("docker/docker-compose.yml");
  expect(compose).toContain('ofelia.job-exec.extend-event-series.command: "/usr/local/bin/extend-event-series"');
  expect(compose).toContain('ofelia.job-exec.extend-event-series.no-overlap: "true"');
  expect(read("docker/ofelia.demo.ini")).toContain('[job-exec "extend-event-series"]');
  const migration = codeOnly(read("docker/migration_zzzzzzzzzzzzz_event_series.sql"), { sql: true });
  expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.event_series (");
  expect(migration).toContain("ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;");
  expect(migration).toMatch(/REVOKE ALL ON TABLE public\.event_series FROM authenticated;\s*GRANT SELECT ON TABLE public\.event_series TO authenticated;/);
  expect(migration).toMatch(/ALTER TABLE public\.events ADD COLUMN IF NOT EXISTS series_id UUID\s*REFERENCES public\.event_series\(id\) ON DELETE CASCADE;/);
  expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
});

test("the calendar page: a repeat in both dialogs, a series for a repeating event, and the question on change and delete", () => {
  const page = codeOnly(read("src/app/calendar/page.tsx"));
  expect(page.match(/<RepeatFields/g)?.length).toBe(2);
  expect(page).toContain("disabled={!repeatableCalendar(newEvent.calendar_id)}");
  expect(page).toMatch(/if \(rule\) \{\s*await createSeries\.mutateAsync\(\{/);
  expect(page).toContain("time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,");
  // A new repeat goes to every occurrence; otherwise the question.
  expect(page).toMatch(/!sameRepeat\(editForm\.repeat, repeatValueFromRule\(event\.recurrence_rule\)\)/);
  expect(page).toMatch(/kind: "edit",\s*run: async \(scope\) => \{\s*if \(scope === "this"\) await updateEvent\.mutateAsync/);
  expect(page).toMatch(/kind: "delete",\s*run: async \(scope\) => \{\s*if \(scope === "this"\) return deleteOneEvent\(event\);/);
  expect(page).toContain('await deleteSeries.mutateAsync({ series_id: seriesId, from: scope === "following" ? event.id : undefined });');
  expect(page).toContain("{repeatSummary(selectedEvent.recurrence_rule)}");
  // A single event given a repeat becomes the first of a series.
  expect(page).toMatch(/await createSeries\.mutateAsync\(\{\s*calendar_id: event\.calendar_id,[\s\S]*?await deleteEvent\.mutateAsync\(event\.id\);/);
});

test("every repeat string is there in every language, with the same placeholders", () => {
  const [en, de, fr] = ["en", "de", "fr"].map((l) => JSON.parse(read(`messages/${l}.json`)).calendar);
  const flat = (o: Record<string, unknown>, prefix = ""): Array<[string, string]> =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]]));
  const keys = ["fieldRepeat", "repeat", "repeatLocalOnly", "repeatEnds", "repeatEndsNever", "repeatClearEnd", "repeatPickDay", "repeatSummary", "repeatSummaryUntil", "editSeriesTitle", "editSeriesBody", "deleteSeriesTitle", "deleteSeriesBody", "scopeThis", "scopeFollowing", "scopeAll", "seriesDeleted"];
  const english = flat(Object.fromEntries(keys.map((k) => [k, en[k]])));
  expect(english.length).toBeGreaterThan(25);
  for (const [lang, messages] of [["de", de], ["fr", fr]] as const) {
    const other = new Map(flat(Object.fromEntries(keys.map((k) => [k, messages[k]]))));
    for (const [key, text] of english) {
      expect(other.get(key)?.trim(), `${lang} ${key}`).toBeTruthy();
      expect((other.get(key)!.match(/\{\w+\}/g) ?? []).sort(), `${lang} ${key}`).toEqual((text.match(/\{\w+\}/g) ?? []).sort());
    }
  }
});
