import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COUNTRIES, daysUntilHoliday, getHolidays, getObservances, nextHolidays } from "../src/lib/holidays";
import { holidaysByDay } from "../src/lib/calendar-markers";
import { DEFAULT_WIDGET_ORDER, DEFAULT_WIDGET_VISIBILITY } from "../src/types/widgets";

/**
 * The Holidays widget counts down to the next holidays and marks the ones
 * that are a day off. These pin which holidays it lists, which are days off,
 * and the weekday a day off is taken when the holiday falls on a weekend.
 * Every date is a local calendar day, so the runner's timezone does not
 * matter.
 */
const key = (date: Date | null) =>
  date && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const find = (country: "us" | "uk" | "de" | "nl", from: Date, nameKey: string) =>
  nextHolidays(country, from, 40).find((h) => h.nameKey === nameKey)!;

test("the next holidays from today, the days that are celebrated but worked included", () => {
  // Friday 2 October 2026, in the US.
  expect(nextHolidays("us", new Date(2026, 9, 2, 9), 3).map((h) => [h.nameKey, key(h.date), h.dayOff])).toEqual([
    ["usColumbus", "2026-10-12", true],
    ["usHalloween", "2026-10-31", false],
    ["usVeterans", "2026-11-11", true],
  ]);
  // On the day itself, it is still the next one.
  expect(nextHolidays("us", new Date(2026, 9, 12, 18), 1)[0].nameKey).toBe("usColumbus");
});

test("a US federal holiday on a weekend is taken on the nearest weekday", () => {
  // Saturday 4 July 2026: off on Friday the 3rd. Sunday 4 July 2027: Monday the 5th.
  expect(key(find("us", new Date(2026, 5, 1), "usIndependence").observed)).toBe("2026-07-03");
  expect(key(find("us", new Date(2027, 5, 1), "usIndependence").observed)).toBe("2027-07-05");
  // Saturday 25 December 2027: off on Friday the 24th.
  expect(key(find("us", new Date(2027, 11, 1), "usChristmas").observed)).toBe("2027-12-24");
  // New Year's Day on Saturday 1 January 2028 is taken on Friday 31 December 2027.
  expect(key(find("us", new Date(2027, 11, 1), "usNewYearsDay").observed)).toBe("2027-12-31");
  // A weekday holiday does not move.
  expect(find("us", new Date(2026, 9, 1), "usColumbus").observed).toBeNull();
});

test("a holiday whose day off is still to come stays listed until that day off", () => {
  // Sunday 4 July 2027 is taken on Monday the 5th: on that Monday it is still listed.
  const monday = nextHolidays("us", new Date(2027, 6, 5, 8), 1)[0];
  expect(monday.nameKey).toBe("usIndependence");
  expect(key(monday.observed)).toBe("2027-07-05");
  expect(nextHolidays("us", new Date(2027, 6, 6), 1)[0].nameKey).not.toBe("usIndependence");
});

test("a UK bank holiday on a weekend moves to the next free weekday", () => {
  // Christmas 2027 is a Saturday and Boxing Day a Sunday: Monday the 27th and Tuesday
  // the 28th. New Year's Day 2028, a Saturday, is taken on Monday 3 January.
  expect(nextHolidays("uk", new Date(2027, 11, 1), 3).map((h) => [h.nameKey, key(h.observed)])).toEqual([
    ["ukChristmasDay", "2027-12-27"],
    ["ukBoxingDay", "2027-12-28"],
    ["ukNewYearsDay", "2028-01-03"],
  ]);
  // A Sunday Christmas (2022) is taken on the Tuesday, after Boxing Day's Monday.
  expect(nextHolidays("uk", new Date(2022, 11, 1), 2).map((h) => [h.nameKey, key(h.observed)])).toEqual([
    ["ukChristmasDay", "2022-12-27"],
    ["ukBoxingDay", null],
  ]);
});

test("elsewhere a holiday on a weekend is not moved", () => {
  // 3 October 2026, German Unity Day, is a Saturday.
  expect(find("de", new Date(2026, 9, 1), "tagDerDeutschenEinheit").observed).toBeNull();
});

test("days that are marked but worked are not days off", () => {
  const de = new Map(getHolidays("de", 2026).map((h) => [h.nameKey, h.dayOff]));
  for (const worked of ["heiligabend", "silvester", "ostersonntag", "pfingstsonntag"]) expect(de.get(worked)).toBe(false);
  for (const off of ["weihnachten1", "weihnachten2", "tagDerDeutschenEinheit", "reformationstag"]) expect(de.get(off)).toBe(true);
  expect(getHolidays("us", 2026).every((h) => h.dayOff)).toBe(true); // every federal holiday
  expect(getObservances("us", 2026).every((h) => !h.dayOff)).toBe(true);
});

test("the calendar still marks public holidays only", () => {
  // The observances belong to the countdown. getHolidays, which the calendar
  // reads, is the federal list it always was.
  const us = getHolidays("us", 2026);
  expect(us).toHaveLength(11);
  expect(us.some((h) => h.nameKey === "usHalloween")).toBe(false);
  for (const country of COUNTRIES.filter((c) => c !== "us")) expect(getObservances(country, 2026)).toEqual([]);
});

test("the US observances fall on their days", () => {
  const days = Object.fromEntries(getObservances("us", 2027).map((h) => [h.nameKey, key(h.date)]));
  expect(days).toMatchObject({
    usValentinesDay: "2027-02-14",
    usEaster: "2027-03-28",
    usMothersDay: "2027-05-09", // second Sunday of May
    usFathersDay: "2027-06-20", // third Sunday of June
    usHalloween: "2027-10-31",
    usChristmasEve: "2027-12-24",
  });
});

test("every holiday the countdown can show has a name in English, German and French", () => {
  for (const lang of ["en", "de", "fr"]) {
    const names = JSON.parse(readFileSync(join(process.cwd(), `messages/${lang}.json`), "utf8")).holidays;
    for (const country of COUNTRIES) {
      for (const holiday of [...getHolidays(country, 2026), ...getObservances(country, 2026)]) {
        expect(names[holiday.nameKey], `${lang}: ${holiday.nameKey}`).toBeTruthy();
      }
    }
  }
});

test("on the weekday a weekend holiday is taken, the countdown says today", () => {
  // Juneteenth 2027 is Saturday 19 June, taken on Friday the 18th.
  const juneteenth = find("us", new Date(2027, 5, 1), "usJuneteenth");
  expect(key(juneteenth.observed)).toBe("2027-06-18");
  expect(daysUntilHoliday(juneteenth, new Date(2027, 5, 16, 9))).toBe(2); // Wednesday: two days to the day off
  expect(daysUntilHoliday(juneteenth, new Date(2027, 5, 18, 9))).toBe(0); // Friday: the day off is today
  expect(daysUntilHoliday(juneteenth, new Date(2027, 5, 19, 9))).toBe(0); // Saturday: the holiday itself
  // Sunday 4 July 2027, taken on Monday the 5th: Saturday counts one day, the Monday is today.
  const july4 = find("us", new Date(2027, 5, 1), "usIndependence");
  expect(daysUntilHoliday(july4, new Date(2027, 6, 3, 9))).toBe(1);
  expect(daysUntilHoliday(july4, new Date(2027, 6, 5, 9))).toBe(0);
  // A holiday that does not move counts to its own day.
  expect(daysUntilHoliday(find("us", new Date(2026, 9, 1), "usColumbus"), new Date(2026, 9, 2, 9))).toBe(10);
});

test("Dutch King's Day moves to Saturday the 26th when the 27th is a Sunday", () => {
  for (const [year, day] of [[2025, 26], [2026, 27], [2031, 26], [2036, 26]] as const) {
    const kingsDay = getHolidays("nl", year).find((h) => h.nameKey === "nlKoningsdag")!;
    expect(key(kingsDay.date), `${year}`).toBe(`${year}-04-${day}`);
    expect(kingsDay.date.getDay(), `${year}`).not.toBe(0);
  }
  // The calendar reads the same list, so its marker moves too.
  const april2025 = holidaysByDay("nl", new Date(2025, 3, 1), new Date(2025, 3, 30));
  expect(april2025.get("2025-04-26")?.nameKey).toBe("nlKoningsdag");
  expect(april2025.has("2025-04-27")).toBe(false);
  expect(key(find("nl", new Date(2031, 3, 1), "nlKoningsdag").date)).toBe("2031-04-26");
});

test("Dutch Liberation Day is listed every year but a day off only in a lustrum year", () => {
  const liberation = (year: number) => getHolidays("nl", year).find((h) => h.nameKey === "nlBevrijdingsdag")!;
  for (const year of [2025, 2030, 2035]) {
    expect(liberation(year).dayOff, `${year}`).toBe(true);
  }
  for (const year of [2026, 2027, 2028, 2029, 2031]) {
    expect(key(liberation(year).date)).toBe(`${year}-05-05`);
    expect(liberation(year).dayOff, `${year}`).toBe(false);
  }
});

test("a narrow card's text wraps instead of overflowing", () => {
  // In French, "Chômé le lun., 27. déc." is wider than the text column on a
  // ~220px card. The line must be allowed to wrap, and break before the date
  // rather than inside it. A long one-word name -- "Unabhängigkeitstag" --
  // must break too, not be cut off by the line clamp.
  const widget = readFileSync(join(process.cwd(), "src/components/widgets/holiday-widget.tsx"), "utf8");
  const dayOffLine = widget.slice(widget.indexOf("{holiday.dayOff && ("), widget.indexOf("{isToday ? (", widget.indexOf("{holiday.dayOff && (")));
  expect(dayOffLine).toContain("TreePalm");
  expect(dayOffLine).not.toContain("whitespace-nowrap");
  expect(widget).toMatch(/replace\(\/ \/g, "\\u00a0"\)/);
  expect(widget).toMatch(/line-clamp-2 [^"]*break-words/);
});

test("the widget is opt-in and can be switched on under Settings -> Widgets", () => {
  expect(DEFAULT_WIDGET_VISIBILITY.holidays).toBe(false);
  expect(DEFAULT_WIDGET_ORDER).toContain("holidays");
  const settings = readFileSync(join(process.cwd(), "src/app/settings/widgets/page.tsx"), "utf8");
  expect(settings).toContain('key: "holidays"');
});
