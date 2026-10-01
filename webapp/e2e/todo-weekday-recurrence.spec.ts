import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dayKeyIn,
  formatRecurrenceDays,
  isRecurringTaskDue,
  isTodoOpen,
  isWeekdayTaskDue,
  nextWeekdayDueDate,
  recurrenceWeekdays,
} from "../src/lib/todo-recurrence";

/**
 * A task could repeat daily, weekly, every two weeks or monthly -- no way to
 * say "Monday to Friday" or "Monday to Thursday". Custom days stores the
 * picked weekdays in the existing `recurrence` text column ("days:MO,TU,...").
 * Dates are pinned: Thursday 1 October 2026 onward, local noon unless the
 * test is about the clock.
 */
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour);
const MON_FRI = [1, 2, 3, 4, 5];
const MON_THU = [1, 2, 3, 4];

test("picked days are stored Monday first; all seven is daily, none is nothing", () => {
  expect(formatRecurrenceDays([5, 1, 2, 3, 4])).toBe("days:MO,TU,WE,TH,FR");
  expect(formatRecurrenceDays(MON_THU)).toBe("days:MO,TU,WE,TH");
  expect(formatRecurrenceDays([0, 6])).toBe("days:SA,SU");
  expect(formatRecurrenceDays([0, 1, 2, 3, 4, 5, 6])).toBe("daily");
  expect(formatRecurrenceDays([])).toBeNull();
  expect(formatRecurrenceDays([7, -1])).toBeNull();

  expect(recurrenceWeekdays("days:fr,mo")).toEqual([1, 5]);
  expect(recurrenceWeekdays("days:XX,MO")).toEqual([1]);
  expect(recurrenceWeekdays("weekly")).toBeNull();
  expect(recurrenceWeekdays(null)).toBeNull();
  expect(recurrenceWeekdays(formatRecurrenceDays(MON_FRI))).toEqual(MON_FRI);
});

test("a Monday-to-Friday task is due on its days and not at the weekend", () => {
  // Never done: counted from the day it was made.
  const madeThursday = { created_at: at(1, 9).toISOString() };
  expect(isWeekdayTaskDue(madeThursday, MON_FRI, at(1))).toBe(true);

  const madeSaturday = { created_at: at(3, 9).toISOString() };
  expect(isWeekdayTaskDue(madeSaturday, MON_FRI, at(3))).toBe(false);
  expect(isWeekdayTaskDue(madeSaturday, MON_FRI, at(4))).toBe(false);
  expect(isWeekdayTaskDue(madeSaturday, MON_FRI, at(5))).toBe(true);

  // Done on Friday: nothing until Monday.
  const doneFriday = { last_completed: at(2, 18).toISOString() };
  expect(isWeekdayTaskDue(doneFriday, MON_FRI, at(3))).toBe(false);
  expect(isWeekdayTaskDue(doneFriday, MON_FRI, at(4))).toBe(false);
  expect(isWeekdayTaskDue(doneFriday, MON_FRI, at(5))).toBe(true);

  // Done Monday morning: not again that evening, due Tuesday.
  const doneMonday = { last_completed: at(5, 8).toISOString() };
  expect(isWeekdayTaskDue(doneMonday, MON_FRI, at(5, 20))).toBe(false);
  expect(isWeekdayTaskDue(doneMonday, MON_FRI, at(6))).toBe(true);

  // A missed Wednesday does not pile up: on Thursday it is simply due.
  const doneTuesday = { last_completed: at(6, 8).toISOString() };
  expect(isWeekdayTaskDue(doneTuesday, MON_FRI, at(8))).toBe(true);
});

test("Monday to Thursday skips Friday", () => {
  const doneThursday = { last_completed: at(1, 18).toISOString() };
  expect(isWeekdayTaskDue(doneThursday, MON_THU, at(2))).toBe(false);
  expect(isWeekdayTaskDue(doneThursday, MON_THU, at(5))).toBe(true);
});

test("the shared rule and the open check understand custom days", () => {
  const task = { recurrence: "days:MO,TU,WE,TH,FR", last_completed: at(2, 18).toISOString() };
  expect(isRecurringTaskDue(task, at(3))).toBe(false); // Saturday
  expect(isTodoOpen(task, at(3))).toBe(false);
  expect(isRecurringTaskDue(task, at(5))).toBe(true); // Monday
  expect(isTodoOpen(task, at(5))).toBe(true);
  // The existing schedules are unchanged.
  expect(isRecurringTaskDue({ recurrence: "daily", last_completed: at(1, 8).toISOString() }, at(2))).toBe(true);
});

test("the next due day is the first picked weekday since it was done or made", () => {
  const next = nextWeekdayDueDate({ last_completed: at(2, 18).toISOString() }, MON_FRI, at(3));
  expect([next!.getFullYear(), next!.getMonth(), next!.getDate(), next!.getHours()]).toEqual([2026, 9, 5, 0]);

  const fresh = nextWeekdayDueDate({ created_at: at(3, 9).toISOString() }, MON_FRI, at(3));
  expect(fresh!.getDate()).toBe(5);
});

test("what day it is depends on the family's timezone", () => {
  // Sunday 20:00 in Los Angeles is already Monday 05:00 in Berlin.
  const instant = new Date("2026-10-05T03:00:00Z");
  expect(dayKeyIn(instant, "America/Los_Angeles")).toBe("2026-10-04");
  expect(dayKeyIn(instant, "Europe/Berlin")).toBe("2026-10-05");
  expect(() => dayKeyIn(instant, "Not/AZone")).not.toThrow();

  const doneFriday = { last_completed: "2026-10-02T15:00:00Z" }; // Friday in both zones
  expect(isWeekdayTaskDue(doneFriday, MON_FRI, instant, "America/Los_Angeles")).toBe(false);
  expect(isWeekdayTaskDue(doneFriday, MON_FRI, instant, "Europe/Berlin")).toBe(true);
});

/**
 * Three places decide when a recurring task is due: the shared rule, the
 * reminder job and the task page's own sort. The other two keep their own
 * copies of the interval table, and a value they do not know reads as "never
 * due" -- custom days would have been silently left out of both.
 */
test("the reminder job and the task page both understand custom days", () => {
  const reminders = readFileSync(join(process.cwd(), "src/app/api/cron/todo-reminders/route.ts"), "utf8");
  expect(reminders).toContain("recurrenceWeekdays(todo.recurrence)");
  expect(reminders).toContain("isWeekdayTaskDue(todo, weekdays, now, timeZone)");

  const page = readFileSync(join(process.cwd(), "src/app/todos/page.tsx"), "utf8");
  expect(page).toContain("nextWeekdayDueDate(todo, pickedDays)");
  expect(page).toContain("formatRecurrenceDays(days)");
});

