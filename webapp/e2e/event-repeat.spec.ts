import { expect, test } from "@playwright/test";
import {
  MAX_OCCURRENCES,
  choiceForRule,
  dayFromKey,
  dayKey,
  formatRepeatRule,
  horizonDay,
  occurrences,
  parseRepeatRule,
  repeatDays,
  ruleForChoice,
  wallParts,
  weekdayOf,
} from "../src/lib/event-repeat";

/**
 * Repeating events: when the occurrences of a series fall. No stack — the
 * rules are pure, and the zones are real IANA zones through Intl.
 */

const day = (key: string) => dayFromKey(key)!;
const keys = (days: number[]) => days.map(dayKey);

test("rules round-trip as RRULE text, and only Kinboard's own subset is read", () => {
  const rules = [
    { freq: "daily", interval: 1 },
    { freq: "weekly", interval: 2 },
    { freq: "weekly", interval: 1, weekdays: [1, 3, 5] },
    { freq: "monthly", interval: 1, until: "2027-06-30" },
    { freq: "yearly", interval: 1 },
  ] as const;
  for (const rule of rules) expect(parseRepeatRule(formatRepeatRule({ ...rule } as never))).toEqual(rule);
  expect(formatRepeatRule({ freq: "weekly", interval: 1, weekdays: [1, 3], until: "2027-01-31" })).toBe("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270131");
  for (const bad of [null, "", "FREQ=HOURLY", "FREQ=DAILY;COUNT=3", "FREQ=DAILY;INTERVAL=0", "FREQ=MONTHLY;BYDAY=MO", "FREQ=WEEKLY;BYDAY=XX", "FREQ=DAILY;UNTIL=20270231", "FREQ=DAILY;UNTIL=2027", "FREQ=DAILY;FREQ=DAILY", "garbage"]) {
    expect(parseRepeatRule(bad), String(bad)).toBeNull();
  }
});

test("the dialog's choices map to rules and back", () => {
  expect(ruleForChoice("never")).toBeNull();
  expect(ruleForChoice("biweekly")).toEqual({ freq: "weekly", interval: 2 });
  expect(ruleForChoice("custom", { weekdays: [5, 1, 1, 9] })).toEqual({ freq: "weekly", interval: 1, weekdays: [1, 5] });
  expect(ruleForChoice("custom", { weekdays: [] })).toBeNull();
  expect(ruleForChoice("yearly", { until: "2030-01-01" })).toEqual({ freq: "yearly", interval: 1, until: "2030-01-01" });
  for (const choice of ["daily", "weekly", "biweekly", "monthly", "yearly"] as const) {
    expect(choiceForRule(ruleForChoice(choice)), choice).toBe(choice);
  }
  expect(choiceForRule(ruleForChoice("custom", { weekdays: [2] }))).toBe("custom");
  expect(choiceForRule(null)).toBe("never");
});

test("days: daily, weekly on its own weekday, every two weeks, and chosen weekdays", () => {
  expect(weekdayOf(day("2026-10-19"))).toBe(1); // a Monday
  expect(keys(repeatDays({ freq: "daily", interval: 1 }, day("2026-10-19"), day("2026-10-19"), day("2026-10-22")))).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
  expect(keys(repeatDays({ freq: "weekly", interval: 1 }, day("2026-10-21"), day("2026-10-01"), day("2026-11-05")))).toEqual(["2026-10-21", "2026-10-28", "2026-11-04"]);
  expect(keys(repeatDays({ freq: "weekly", interval: 2 }, day("2026-10-21"), day("2026-10-21"), day("2026-11-30")))).toEqual(["2026-10-21", "2026-11-04", "2026-11-18"]);
  // Chosen weekdays, never before the first day itself.
  expect(keys(repeatDays({ freq: "weekly", interval: 1, weekdays: [1, 3] }, day("2026-10-21"), day("2026-10-21"), day("2026-10-28")))).toEqual(["2026-10-21", "2026-10-26", "2026-10-28"]);
  // Starting later (a top-up) lands on the same days as from the start.
  const all = repeatDays({ freq: "weekly", interval: 2, weekdays: [2, 4] }, day("2026-10-20"), day("2026-10-20"), day("2027-03-01"));
  expect(repeatDays({ freq: "weekly", interval: 2, weekdays: [2, 4] }, day("2026-10-20"), day("2027-01-01"), day("2027-03-01"))).toEqual(all.filter((d) => d >= day("2027-01-01")));
  const daily = repeatDays({ freq: "daily", interval: 3 }, day("2026-10-19"), day("2026-10-19"), day("2026-12-31"));
  expect(repeatDays({ freq: "daily", interval: 3 }, day("2026-10-19"), day("2026-11-15"), day("2026-12-31"))).toEqual(daily.filter((d) => d >= day("2026-11-15")));
});

test("days: a monthly 31st and a yearly 29 February land on the last day there is", () => {
  expect(keys(repeatDays({ freq: "monthly", interval: 1 }, day("2027-01-31"), day("2027-01-31"), day("2027-05-31")))).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  expect(keys(repeatDays({ freq: "monthly", interval: 1 }, day("2027-11-30"), day("2027-11-30"), day("2028-03-01")))).toEqual(["2027-11-30", "2027-12-30", "2028-01-30", "2028-02-29"]);
  expect(keys(repeatDays({ freq: "yearly", interval: 1 }, day("2028-02-29"), day("2028-02-29"), day("2032-12-31")))).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
});

test("days: an end date is the last day, and no series makes more than the cap", () => {
  expect(keys(repeatDays({ freq: "daily", interval: 1, until: "2026-10-21" }, day("2026-10-19"), day("2026-10-19"), day("2027-10-19")))).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
  expect(repeatDays({ freq: "daily", interval: 1 }, day("2026-01-01"), day("2026-01-01"), day("2036-01-01")).length).toBe(MAX_OCCURRENCES);
  expect(horizonDay({ freq: "daily", interval: 1 }, day("2026-10-19"))).toBe(day("2026-10-19") + 120);
  expect(horizonDay({ freq: "weekly", interval: 1, until: "2026-11-01" }, day("2026-10-19"))).toBe(day("2026-11-01"));
});

test("occurrences keep the wall-clock time across a clock change, in either hemisphere", () => {
  // Berlin leaves summer time on 25 October 2026: 09:00 is 07:00 UTC before and 08:00 UTC after.
  const berlin = occurrences({
    first: { start: new Date("2026-10-19T07:00:00Z"), end: new Date("2026-10-19T08:30:00Z") },
    allDay: false,
    rule: { freq: "weekly", interval: 1 },
    timeZone: "Europe/Berlin",
    fromDay: day("2026-10-19"),
    toDay: day("2026-11-02"),
  });
  expect(berlin.map((o) => o.start.toISOString())).toEqual(["2026-10-19T07:00:00.000Z", "2026-10-26T08:00:00.000Z", "2026-11-02T08:00:00.000Z"]);
  expect(berlin.map((o) => o.end.toISOString())).toEqual(["2026-10-19T08:30:00.000Z", "2026-10-26T09:30:00.000Z", "2026-11-02T09:30:00.000Z"]);
  // Sydney starts summer time on 4 October 2026: 18:00 is 08:00 UTC before and 07:00 UTC after.
  const sydney = occurrences({
    first: { start: new Date("2026-09-28T08:00:00Z"), end: new Date("2026-09-28T09:00:00Z") },
    allDay: false,
    rule: { freq: "weekly", interval: 1 },
    timeZone: "Australia/Sydney",
    fromDay: day("2026-09-28"),
    toDay: day("2026-10-05"),
  });
  expect(sydney.map((o) => o.start.toISOString())).toEqual(["2026-09-28T08:00:00.000Z", "2026-10-05T07:00:00.000Z"]);
});

test("an all-day occurrence runs from the start of its day to the end of its last, in the series' zone", () => {
  const zone = "America/Chicago";
  const first = { start: new Date("2026-10-30T05:00:00.000Z"), end: new Date("2026-10-31T04:59:59.999Z") }; // 30 Oct, local day
  expect(wallParts(first.start, zone)).toEqual({ day: day("2026-10-30"), msIntoDay: 0 });
  const list = occurrences({ first, allDay: true, rule: { freq: "weekly", interval: 1 }, timeZone: zone, fromDay: day("2026-10-30"), toDay: day("2026-11-06") });
  // Chicago leaves summer time on 1 November: the second Friday starts at 06:00 UTC.
  expect(list.map((o) => [o.start.toISOString(), o.end.toISOString()])).toEqual([
    ["2026-10-30T05:00:00.000Z", "2026-10-31T04:59:59.999Z"],
    ["2026-11-06T06:00:00.000Z", "2026-11-07T05:59:59.999Z"],
  ]);
  // A two-day all-day event (30 and 31 October, ending 23:59:59.999 summer time) stays two days long.
  const twoDays = occurrences({ first: { start: first.start, end: new Date("2026-11-01T04:59:59.999Z") }, allDay: true, rule: { freq: "yearly", interval: 1 }, timeZone: zone, fromDay: day("2026-10-30"), toDay: day("2027-12-31") });
  expect(twoDays.map((o) => [wallParts(o.start, zone).day, wallParts(o.end, zone).day]).map(([s, e]) => e - s)).toEqual([1, 1]);
});
