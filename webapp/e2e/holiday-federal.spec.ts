import { test, expect } from "@playwright/test";
import { createTranslator } from "next-intl";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";
import { getHolidays, getObservances, nextHolidays } from "../src/lib/holidays";
import { schoolClosures } from "../src/lib/holidays/adapter";
import { holidayLabel, type HolidayTranslator } from "../src/lib/holidays/label";
import { publicHolidayEntries } from "../src/lib/holiday-entries";
import { holidaysByDay } from "../src/lib/calendar-markers";
import { toLocalDateKey } from "../src/lib/local-date";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";

/**
 * A US state's calendar adds the federal holidays the state does not observe,
 * marked "(federal)" -- Columbus Day in California -- and the observances the
 * countdown lists (Halloween) show on the calendar as well. The state's own
 * holidays look as they did, and no other country changes.
 */
const translator = (locale: string, messages: Record<string, unknown>) =>
  createTranslator({ locale, messages, namespace: "holidays" }) as unknown as HolidayTranslator;
const t = translator("en", en);
const list = (region: string, locale = "en", tr = t) =>
  getHolidays(region, 2026, locale).map((h) => `${toLocalDateKey(h.date)} ${holidayLabel(h, tr)}`);

test("California gets Columbus Day, marked federal; its own holidays stay plain", () => {
  const ca = list("US-CA");
  expect(ca).toContain("2026-10-12 Columbus Day (federal)");
  expect(ca).toContain("2026-03-31 César Chávez Day");
  expect(ca).toContain("2026-11-27 Day after Thanksgiving Day");
  expect(ca).toContain("2026-11-26 Thanksgiving Day");
  // The state's Presidents' Day stands for Washington's Birthday: one holiday a day.
  expect(ca).toContain("2026-02-16 Presidents' Day");
  const days = ca.map((s) => s.slice(0, 10));
  expect(new Set(days).size).toBe(days.length);
  expect(ca.filter((s) => s.endsWith("(federal)"))).toEqual(["2026-10-12 Columbus Day (federal)"]);
  const columbus = getHolidays("US-CA", 2026, "en").find((h) => h.federal)!;
  expect(columbus.dayOff).toBe(true);
});

test("a state that observes it, the whole country and other countries are unchanged", () => {
  expect(list("US-NY")).toContain("2026-10-12 Columbus Day");
  for (const region of ["US", "DE-BY", "CH-TI", "GB-ENG", "FR", "NL"]) {
    expect(getHolidays(region, 2026, "en").some((h) => h.federal), region).toBe(false);
  }
});

test("the calendar, its lists and the countdown carry Columbus Day and Halloween", () => {
  const grid = holidaysByDay("US-CA", new Date(2026, 9, 1), new Date(2026, 9, 31), "en");
  expect([...grid].map(([day, h]) => `${day} ${holidayLabel(h, t)}`)).toEqual([
    "2026-10-12 Columbus Day (federal)",
    "2026-10-31 Halloween",
  ]);
  const entries = publicHolidayEntries("US-CA", "2026-10-01", "2026-10-31", "en", (h) => holidayLabel(h, t));
  expect(entries.map((e) => `${e.startKey} ${e.title}`)).toEqual(["2026-10-12 Columbus Day (federal)", "2026-10-31 Halloween"]);
  const next = nextHolidays("US-CA", new Date(2026, 9, 5), 2, "en").map((h) => holidayLabel(h, t));
  expect(next).toEqual(["Columbus Day (federal)", "Halloween"]);
  // The observances are the countdown's, untouched by the federal ones.
  expect(getObservances("US-CA", 2026, "en").some((h) => h.federal)).toBe(false);
});

test("the mark is translated", () => {
  expect(list("US-CA", "de", translator("de", de)).find((s) => s.startsWith("2026-10-12"))).toMatch(/ \(Bundesfeiertag\)$/);
  expect(list("US-CA", "fr", translator("fr", fr)).find((s) => s.startsWith("2026-10-12"))).toMatch(/ \(fédéral\)$/);
});

test("a federal holiday the state skips does not close school", () => {
  expect(schoolClosures("US-CA", 2026, "en").map((c) => toLocalDateKey(c.date))).not.toContain("2026-10-12");
});

test("the day panel's badge shows the day's observance too, as the grid does", () => {
  const page = codeOnly(readFileSync(join(process.cwd(), "src/app/calendar/page.tsx"), "utf8"));
  expect(page).toContain("[...getHolidays(holidayRegion, year, locale), ...getObservances(holidayRegion, year, locale)]");
});

