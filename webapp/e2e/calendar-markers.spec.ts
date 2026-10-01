import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  holidaysByDay,
  isTaskEventId,
  nextTaskOccurrences,
  taskDayKeys,
  taskMarkersByDay,
  taskOccurrences,
} from "../src/lib/calendar-markers";

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

/**
 * Treated as events, tasks join the lists events appear in -- the Events
 * widget, the week overview, the calendar's day panel -- as all-day items
 * with an id no event row can have, so the panel can send them to the task
 * list instead of the event editor.
 */
test("tasks become all-day items with an id no event can have, coloured by person", () => {
  const occurrences = taskOccurrences(
    [
      { id: "t1", title: "Water the plants", recurrence: "daily", person_id: "emma" },
      { id: "t2", title: "Dentist forms", due_date: "2026-10-03", person_id: null },
    ],
    [{ id: "emma", color: "#ec4899", name: "Emma" }],
    now,
    new Date(2026, 9, 4),
    "neutral",
    now,
  );
  expect(occurrences).toHaveLength(5); // the daily task on 1-4 October, the one-off on the 3rd
  expect(occurrences[0]).toMatchObject({
    id: "task:t1:2026-10-01",
    todoId: "t1",
    dayKey: "2026-10-01",
    color: "#ec4899",
    personName: "Emma", // shown with the title: who the task is for
  });
  // Local midnight of its day: an all-day item.
  const d = occurrences[0].date;
  expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 1, 0]);
  expect(occurrences.find((o) => o.todoId === "t2")).toMatchObject({
    dayKey: "2026-10-03",
    color: "neutral",
    personId: null,
    personName: null,
  });

  expect(occurrences.every((o) => isTaskEventId(o.id))).toBe(true);
  expect(isTaskEventId("5f0c1d2e-6b7a-4c3d-9e8f-0a1b2c3d4e5f")).toBe(false); // an event row's uuid
});

test("an upcoming list gets each task once, at its next occurrence", () => {
  const occurrences = taskOccurrences(
    [
      { id: "t1", title: "Read", recurrence: "daily" },
      { id: "t2", title: "Forms", due_date: "2026-10-03" },
    ],
    [],
    now,
    new Date(2026, 9, 14),
    "neutral",
    now,
  );
  expect(nextTaskOccurrences(occurrences).map((o) => `${o.todoId}@${o.dayKey}`)).toEqual([
    "t1@2026-10-01",
    "t2@2026-10-03",
  ]);
});

test("the week overview compares due dates as dates, not as UTC midnights", () => {
  // The bug, still asserted: a date-only string parses as midnight UTC, which
  // west of UTC is the evening before -- a task due on the 14th was counted
  // on the 13th in the Americas.
  expect(new Date("2026-10-14").toISOString()).toBe("2026-10-14T00:00:00.000Z");

  const source = readFileSync(join(process.cwd(), "src/components/widgets/week-overview-widget.tsx"), "utf8");
  expect(source).not.toMatch(/new Date\(t\.due_date\)/);
  expect(source).toContain("t.due_date?.slice(0, 10) === dayKey");
});

