import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COUNTRIES, getHolidays, getObservances, nextHolidays } from "../src/lib/holidays";
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
const find = (country: "us" | "uk" | "de", from: Date, nameKey: string) =>
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

test("every holiday the countdown can show has a name in English and German", () => {
  for (const lang of ["en", "de"]) {
    const names = JSON.parse(readFileSync(join(process.cwd(), `messages/${lang}.json`), "utf8")).holidays;
    for (const country of COUNTRIES) {
      for (const holiday of [...getHolidays(country, 2026), ...getObservances(country, 2026)]) {
        expect(names[holiday.nameKey], `${lang}: ${holiday.nameKey}`).toBeTruthy();
      }
    }
  }
});

test("the widget is opt-in and can be switched on under Settings -> Widgets", () => {
  expect(DEFAULT_WIDGET_VISIBILITY.holidays).toBe(false);
  expect(DEFAULT_WIDGET_ORDER).toContain("holidays");
  const settings = readFileSync(join(process.cwd(), "src/app/settings/widgets/page.tsx"), "utf8");
  expect(settings).toContain('key: "holidays"');
});
