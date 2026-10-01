import { test, expect } from "@playwright/test";
import { holidaysByDay, taskDayKeys, taskMarkersByDay } from "../src/lib/calendar-markers";

/**
 * The calendar could only show events. Public holidays appeared only in a
 * day's details, and tasks not at all. These are the rules for the two kinds
 * of marker, pinned to fixed dates so every expectation is a day, not an
 * offset. Local noon keeps "now" clear of midnight in any runner timezone.
 */
const now = new Date(2026, 9, 1, 12); // Thursday 1 October 2026
const from = new Date(2026, 8, 27); // the month grid's first day
const to = new Date(2026, 10, 7); // and its last

test("a daily task never done is marked today and every day after, not before", () => {
  const keys = taskDayKeys({ recurrence: "daily", completed: false, last_completed: null }, from, to, now);
  expect(keys[0]).toBe("2026-10-01");
  expect(keys).toHaveLength(38); // 1 October to 7 November
  expect(keys).not.toContain("2026-09-30");
});

test("ticking a daily task off moves its next mark to tomorrow", () => {
  const keys = taskDayKeys(
    { recurrence: "daily", last_completed: new Date(2026, 9, 1, 8).toISOString() },
    from,
    to,
    now,
  );
  expect(keys[0]).toBe("2026-10-02");
});

test("a weekly task follows its last completion, and an overdue one is marked today", () => {
  const doneThreeDaysAgo = taskDayKeys(
    { recurrence: "weekly", last_completed: new Date(2026, 8, 28, 9).toISOString() },
    from,
    to,
    now,
  );
  expect(doneThreeDaysAgo.slice(0, 3)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);

  const doneTenDaysAgo = taskDayKeys(
    { recurrence: "weekly", last_completed: new Date(2026, 8, 21, 9).toISOString() },
    from,
    to,
    now,
  );
  expect(doneTenDaysAgo.slice(0, 2)).toEqual(["2026-10-01", "2026-10-08"]);
});

test("a one-off task is marked on its due date while open, and never without one", () => {
  expect(taskDayKeys({ due_date: "2026-10-14" }, from, to, now)).toEqual(["2026-10-14"]);
  expect(taskDayKeys({ due_date: "2026-10-14", completed: true }, from, to, now)).toEqual([]);
  expect(taskDayKeys({ due_date: null }, from, to, now)).toEqual([]);
  expect(taskDayKeys({ due_date: "2026-12-24" }, from, to, now)).toEqual([]); // outside the grid
  // An overdue one-off stays on the day it was due.
  expect(taskDayKeys({ recurrence: "once", due_date: "2026-09-29" }, from, to, now)).toEqual(["2026-09-29"]);
  // In the recycle bin: nothing.
  expect(
    taskDayKeys({ due_date: "2026-10-14", deleted_at: "2026-10-01T00:00:00Z" }, from, to, now),
  ).toEqual([]);
});

test("one dot per person per day; unassigned and removed people share one neutral dot", () => {
  const people = [
    { id: "ana", color: "#ec4899" },
    { id: "ben", color: "#3b82f6" },
  ];
  const markers = taskMarkersByDay(
    [
      { due_date: "2026-10-14", person_id: "ben" },
      { due_date: "2026-10-14", person_id: "ana" },
      { due_date: "2026-10-14", person_id: "ana" }, // same person twice: one dot
      { due_date: "2026-10-14", person_id: null },
      { due_date: "2026-10-15", person_id: "gone" }, // a person since removed
    ],
    people,
    from,
    to,
    "neutral",
    now,
  );
  expect(markers.get("2026-10-14")).toEqual(["#ec4899", "#3b82f6", "neutral"]);
  expect(markers.get("2026-10-15")).toEqual(["neutral"]);
  expect(markers.has("2026-10-16")).toBe(false);
});

test("built-in holidays are keyed by their local day, across a year boundary", () => {
  const us = holidaysByDay("us", new Date(2026, 11, 20), new Date(2027, 0, 5));
  expect(us.get("2026-12-25")?.nameKey).toBe("usChristmas");
  expect(us.get("2027-01-01")?.nameKey).toBe("usNewYearsDay");

  const de = holidaysByDay("de", new Date(2026, 9, 1), new Date(2026, 9, 31));
  expect(de.get("2026-10-03")?.nameKey).toBe("tagDerDeutschenEinheit");
});
