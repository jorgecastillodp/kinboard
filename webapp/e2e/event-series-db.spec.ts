import { expect, test } from "@playwright/test";
import { createSeries, deleteSeries, extendAllSeries, updateSeries, type SeriesRow } from "../src/lib/event-series";
import { HORIZON_DAYS, dayFromKey, dayKey, wallParts } from "../src/lib/event-repeat";

/**
 * The writes behind repeating events, against a small in-memory stand-in for
 * the database (just the supabase-js calls lib/event-series.ts makes): the
 * nightly top-up, changing every occurrence, stopping a repeat, and deleting
 * from one occurrence on. No stack.
 */

type Row = Record<string, unknown>;

/** The supabase-js query builder, as far as lib/event-series.ts uses it, over arrays. */
function fakeAdmin() {
  const tables: Record<string, Row[]> = { event_series: [], events: [] };
  let nextId = 1;
  const from = (table: string) => {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | undefined;
    let wantCount = false;
    let headOnly = false;
    let returning = false;
    let single: "single" | "maybe" | null = null;
    const filters: Array<(r: Row) => boolean> = [];
    const builder = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op === "select") op = "select";
        else returning = true;
        wantCount = opts?.count === "exact";
        headOnly = opts?.head === true;
        return builder;
      },
      insert(rows: Row | Row[]) { op = "insert"; payload = rows; return builder; },
      update(values: Row, opts?: { count?: string }) { op = "update"; payload = values; wantCount = opts?.count === "exact"; return builder; },
      delete() { op = "delete"; return builder; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
      gte(col: string, val: string) { filters.push((r) => String(r[col]) >= val); return builder; },
      single() { single = "single"; return builder; },
      maybeSingle() { single = "maybe"; return builder; },
      then(resolve: (v: unknown) => unknown) {
        const rows = tables[table];
        const match = (r: Row) => filters.every((f) => f(r));
        let data: unknown = null;
        let count: number | null = null;
        if (op === "insert") {
          const list = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({ id: `id-${nextId++}`, ...r }));
          rows.push(...list);
          data = single ? list[0] : list;
        } else if (op === "update") {
          const hit = rows.filter(match);
          hit.forEach((r) => Object.assign(r, payload));
          count = hit.length;
        } else if (op === "delete") {
          const keep = rows.filter((r) => !match(r));
          const gone = rows.filter(match);
          tables[table] = keep;
          if (table === "event_series") tables.events = tables.events.filter((e) => !gone.some((g) => g.id === e.series_id));
          count = gone.length;
        } else {
          const hit = rows.filter(match);
          count = hit.length;
          data = headOnly ? null : single ? hit[0] ?? null : hit;
        }
        void returning;
        return Promise.resolve({ data, error: null, count: wantCount ? count : null }).then(resolve);
      },
    };
    return builder;
  };
  return { admin: { from }, tables };
}

const zone = "Europe/Berlin";
const now = new Date("2026-10-20T10:00:00Z");
const dayOf = (iso: unknown) => dayKey(wallParts(new Date(String(iso)), zone).day);

async function weeklySeries(admin: unknown, until?: string) {
  return createSeries(admin, {
    familyId: "fam",
    calendarId: "cal",
    fields: { title: "Swimming", description: null, location: null, personId: null },
    timing: { start: new Date("2026-10-21T15:00:00Z"), end: new Date("2026-10-21T16:00:00Z"), allDay: false },
    rule: until ? { freq: "weekly", interval: 1, until } : { freq: "weekly", interval: 1 },
    timeZone: zone,
    now,
  });
}

test("a new series gets its occurrences up to its horizon, and records how far they go", async () => {
  const { admin, tables } = fakeAdmin();
  const created = await weeklySeries(admin);
  const days = tables.events.map((e) => dayOf(e.start_at));
  expect(days[0]).toBe("2026-10-21");
  expect(new Set(days.map((d) => new Date(`${d}T12:00:00Z`).getUTCDay()))).toEqual(new Set([3]));
  const series = tables.event_series[0] as unknown as SeriesRow;
  const horizon = dayFromKey("2026-10-21")! + HORIZON_DAYS.weekly;
  expect(series.generated_through).toBe(dayKey(horizon));
  expect(created.occurrences).toBe(tables.events.length);
  expect(dayFromKey(days[days.length - 1])!).toBeLessThanOrEqual(horizon);
});

test("the nightly top-up adds only what is new, and never brings back an occurrence deleted on its own", async () => {
  const { admin, tables } = fakeAdmin();
  await weeklySeries(admin);
  const before = tables.events.length;
  // One occurrence deleted on its own.
  const deleted = tables.events.splice(3, 1)[0];
  // Nothing to add the same day.
  expect(await extendAllSeries(admin, now)).toEqual({ series: 0, added: 0 });
  // Five weeks later: about five more, after the last one, and the deleted one stays gone.
  const later = new Date(now.getTime() + 35 * 86_400_000);
  const result = await extendAllSeries(admin, later);
  expect(result.series).toBe(1);
  expect(result.added).toBe(5);
  expect(tables.events.length).toBe(before - 1 + 5);
  expect(tables.events.some((e) => e.start_at === deleted.start_at)).toBe(false);
  const starts = tables.events.map((e) => String(e.start_at));
  expect(new Set(starts).size).toBe(starts.length);
});

test("a series with an end stops there, and the top-up has nothing to add", async () => {
  const { admin, tables } = fakeAdmin();
  await weeklySeries(admin, "2026-11-11");
  expect(tables.events.map((e) => dayOf(e.start_at))).toEqual(["2026-10-21", "2026-10-28", "2026-11-04", "2026-11-11"]);
  expect(await extendAllSeries(admin, new Date("2027-06-01T00:00:00Z"))).toEqual({ series: 0, added: 0 });
});

test("all events: a new title goes to every occurrence; a day later moves the whole series a day", async () => {
  const { admin, tables } = fakeAdmin();
  await weeklySeries(admin);
  const series = tables.event_series[0] as unknown as SeriesRow;
  const occ = tables.events[2] as { id: string; start_at: string; end_at: string; all_day: boolean };
  const fields = { title: "Swim club", description: null, location: "Pool", personId: null };
  await updateSeries(admin, series, occ, { fields, timing: { start: new Date(occ.start_at), end: new Date(occ.end_at), allDay: false }, rule: undefined }, now);
  expect(new Set(tables.events.map((e) => e.title))).toEqual(new Set(["Swim club"]));
  expect(tables.events.every((e) => e.location === "Pool")).toBe(true);

  // Moved from Wednesday to Thursday, 30 minutes later: every occurrence follows.
  const occ2 = tables.events[2] as { id: string; start_at: string; end_at: string; all_day: boolean };
  const start = new Date(new Date(occ2.start_at).getTime() + 86_400_000 + 30 * 60_000);
  const end = new Date(new Date(occ2.end_at).getTime() + 86_400_000 + 30 * 60_000);
  await updateSeries(admin, tables.event_series[0] as unknown as SeriesRow, occ2, { fields, timing: { start, end, allDay: false }, rule: undefined }, now);
  const days = tables.events.map((e) => new Date(`${dayOf(e.start_at)}T12:00:00Z`).getUTCDay());
  expect(new Set(days)).toEqual(new Set([4]));
  expect(dayOf(tables.events[0].start_at)).toBe("2026-10-22");
  const times = new Set(tables.events.map((e) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date(String(e.start_at)))));
  expect(times).toEqual(new Set(["17:30"]));
});

test("all events: moving a custom-days series a day moves its weekdays too", async () => {
  const { admin, tables } = fakeAdmin();
  await createSeries(admin, {
    familyId: "fam",
    calendarId: "cal",
    fields: { title: "Practice", description: null, location: null, personId: null },
    timing: { start: new Date("2026-10-19T16:00:00Z"), end: new Date("2026-10-19T17:00:00Z"), allDay: false },
    rule: { freq: "weekly", interval: 1, weekdays: [1, 3] },
    timeZone: zone,
    now,
  });
  const occ = tables.events[1] as { id: string; start_at: string; end_at: string; all_day: boolean };
  await updateSeries(admin, tables.event_series[0] as unknown as SeriesRow, occ, {
    fields: { title: "Practice", description: null, location: null, personId: null },
    timing: { start: new Date(new Date(occ.start_at).getTime() + 86_400_000), end: new Date(new Date(occ.end_at).getTime() + 86_400_000), allDay: false },
    rule: undefined,
  }, now);
  expect((tables.event_series[0] as unknown as SeriesRow).rule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
  expect(new Set(tables.events.map((e) => new Date(`${dayOf(e.start_at)}T12:00:00Z`).getUTCDay()))).toEqual(new Set([2, 4]));
});

test("never: the repeat stops, the edited occurrence stays on its own and the rest go", async () => {
  const { admin, tables } = fakeAdmin();
  await weeklySeries(admin);
  const series = tables.event_series[0] as unknown as SeriesRow;
  const occ = tables.events[1] as { id: string; start_at: string; end_at: string; all_day: boolean };
  await updateSeries(admin, series, occ, {
    fields: { title: "Swimming", description: null, location: null, personId: null },
    timing: { start: new Date(occ.start_at), end: new Date(occ.end_at), allDay: false },
    rule: null,
  }, now);
  expect(tables.event_series).toHaveLength(0);
  expect(tables.events).toHaveLength(1);
  expect(tables.events[0]).toMatchObject({ id: occ.id, series_id: null, recurrence_rule: null });
});

test("this and following: later occurrences go, the repeat ends the day before, and an earlier end is kept", async () => {
  const { admin, tables } = fakeAdmin();
  await weeklySeries(admin);
  const third = tables.events[2] as { start_at: string };
  await deleteSeries(admin, tables.event_series[0] as unknown as SeriesRow, third);
  expect(tables.events.map((e) => dayOf(e.start_at))).toEqual(["2026-10-21", "2026-10-28"]);
  const series = tables.event_series[0] as unknown as SeriesRow;
  expect(series.rule).toBe("FREQ=WEEKLY;UNTIL=20261103");
  expect(series.generated_through).toBe("2026-11-03");
  expect(tables.events.every((e) => e.recurrence_rule === series.rule)).toBe(true);
  // Deleting from an occurrence after that end doesn't move the end later.
  await deleteSeries(admin, series, { start_at: "2027-01-06T15:00:00.000Z" });
  expect((tables.event_series[0] as unknown as SeriesRow).rule).toBe("FREQ=WEEKLY;UNTIL=20261103");
  // From the first occurrence on is all of it.
  await deleteSeries(admin, tables.event_series[0] as unknown as SeriesRow, tables.events[0] as { start_at: string });
  expect(tables.event_series).toHaveLength(0);
  expect(tables.events).toHaveLength(0);
});
