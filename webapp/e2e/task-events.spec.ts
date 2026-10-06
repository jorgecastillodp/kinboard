import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { eventTaskOccurrences, type EventTodo } from "../src/lib/task-events";
import { codeOnly } from "./source-helpers";

/**
 * A task can be listed among the Events on Home from its own dialog ("Show
 * under Events on Home"): which tasks the widget lists, on which day, and the
 * wiring from the dialog to the widget. No stack; task-events-ui.spec.ts
 * drives the dialog and Home.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

// Noon on 6 October 2026 wherever this runs, with the Events widget's window:
// today and the 14 days after it.
const NOW = new Date(2026, 9, 6, 12, 0, 0);
const FROM = new Date(2026, 9, 6);
const TO = new Date(2026, 9, 20, 23, 59, 59);
const PEOPLE = [{ id: "p1", color: "#e11d48", name: "Emma" }];
const GREY = "grey";

let n = 0;
const task = (over: Partial<EventTodo> & Record<string, unknown> = {}): EventTodo & Record<string, unknown> => {
  n += 1;
  return { id: `t${n}`, title: `Task ${n}`, completed: false, recurrence: "once", due_date: null, last_completed: null, show_in_events: false, person_id: null, created_at: "2026-10-01T00:00:00.000Z", ...over };
};
const list = (todos: EventTodo[], all = false) =>
  eventTaskOccurrences(todos, PEOPLE, FROM, TO, GREY, { all, now: NOW }).map((o) => `${o.dayKey} ${o.title}`);

test("only flagged tasks are listed, unless every task is", () => {
  const flagged = task({ title: "Flagged", due_date: "2026-10-08", show_in_events: true });
  const plain = task({ title: "Plain", due_date: "2026-10-08" });
  expect(list([flagged, plain])).toEqual(["2026-10-08 Flagged"]);
  expect(list([flagged, plain], true)).toEqual(["2026-10-08 Flagged", "2026-10-08 Plain"]);
  expect(list([plain])).toEqual([]);
  expect(list([])).toEqual([]);
});

test("a flagged task is listed on its due day, and not before it is in the window", () => {
  expect(list([task({ title: "Today", due_date: "2026-10-06", show_in_events: true })])).toEqual(["2026-10-06 Today"]);
  expect(list([task({ title: "Last day", due_date: "2026-10-20", show_in_events: true })])).toEqual(["2026-10-20 Last day"]);
  expect(list([task({ title: "Too far", due_date: "2026-10-21", show_in_events: true })])).toEqual([]);
});

test("a flagged one-off with no date, or overdue, is listed today until it is ticked off", () => {
  const undated = task({ title: "No date", show_in_events: true });
  const overdue = task({ title: "Overdue", due_date: "2026-10-02", show_in_events: true });
  expect(list([undated, overdue])).toEqual(["2026-10-06 No date", "2026-10-06 Overdue"]);
  // Without the flag, nothing changes: neither has a day to be listed on.
  expect(list([task({ title: "No date" }), task({ title: "Overdue", due_date: "2026-10-02" })])).toEqual([]);
  expect(list([task({ title: "No date" }), task({ title: "Overdue", due_date: "2026-10-02" })], true)).toEqual([]);
  // Ticked off, it goes.
  expect(list([task({ title: "Done", completed: true, show_in_events: true }), task({ title: "Done late", due_date: "2026-10-02", completed: true, show_in_events: true })])).toEqual([]);
});

test("a flagged repeating task is listed once, on its next day", () => {
  const daily = task({ title: "Water the plants", recurrence: "daily", show_in_events: true });
  expect(list([daily])).toEqual(["2026-10-06 Water the plants"]);
  // Done today: its next day is tomorrow, and still just one entry.
  const doneToday = task({ title: "Feed the fish", recurrence: "daily", last_completed: "2026-10-06T08:00:00", last_completed_day: "2026-10-06", show_in_events: true });
  expect(list([doneToday])).toEqual(["2026-10-07 Feed the fish"]);
  const weekly = task({ title: "Bins", recurrence: "weekly", last_completed: "2026-10-03T08:00:00", show_in_events: true });
  expect(list([weekly])).toEqual(["2026-10-10 Bins"]);
});

test("a task in the bin is never listed, flagged or not", () => {
  const binned = task({ title: "Binned", due_date: "2026-10-08", show_in_events: true, deleted_at: "2026-10-05T00:00:00.000Z" });
  const binnedUndated = task({ title: "Binned undated", show_in_events: true, deleted_at: "2026-10-05T00:00:00.000Z" });
  expect(list([binned, binnedUndated])).toEqual([]);
  expect(list([binned, binnedUndated], true)).toEqual([]);
});

test("a person gives the entry its colour and name, and the list is sorted by day, then title", () => {
  const todos = [
    task({ title: "B later", due_date: "2026-10-09", show_in_events: true, person_id: "p1" }),
    task({ title: "A later", due_date: "2026-10-09", show_in_events: true }),
    task({ title: "Soon", due_date: "2026-10-07", show_in_events: true }),
    task({ title: "No date", show_in_events: true }),
  ];
  const out = eventTaskOccurrences(todos, PEOPLE, FROM, TO, GREY, { all: false, now: NOW });
  expect(out.map((o) => `${o.dayKey} ${o.title}`)).toEqual(["2026-10-06 No date", "2026-10-07 Soon", "2026-10-09 A later", "2026-10-09 B later"]);
  const withPerson = out.find((o) => o.title === "B later")!;
  expect(withPerson).toMatchObject({ color: "#e11d48", personName: "Emma", personId: "p1" });
  expect(out.find((o) => o.title === "A later")).toMatchObject({ color: GREY, personName: null });
  // The stand-in for an undated task is made like the others: an all-day entry with a task id.
  const standIn = out.find((o) => o.title === "No date")!;
  expect(standIn.id).toMatch(/^task:t\d+:2026-10-06$/);
  expect(standIn.date.getTime()).toBe(new Date(2026, 9, 6).getTime());
});

test("a flagged task is not listed twice when every task is", () => {
  const flagged = task({ title: "Both", due_date: "2026-10-08", show_in_events: true });
  const undated = task({ title: "Undated both", show_in_events: true });
  expect(list([flagged, undated], true)).toEqual(["2026-10-06 Undated both", "2026-10-08 Both"]);
});

test("the Events widget lists tasks through this, reading them whether or not every task is listed", () => {
  const widget = codeOnly(read("src/components/widgets/upcoming-events.tsx"));
  expect(widget).toContain("eventTaskOccurrences(");
  expect(widget).toContain("{ all: tasksAsEvents }");
  expect(widget).toContain("const { data: todos } = useTodos();");
  expect(widget).not.toContain("useTodos({ enabled: tasksAsEvents })");
  expect(widget).not.toContain("if (!tasksAsEvents) return withHolidays;");
});

test("both task dialogs carry the option, and save, reset and refill it", () => {
  const page = codeOnly(read("src/app/todos/page.tsx"));
  expect(page.match(/<TodoEventsField /g)).toHaveLength(2);
  expect(page).toContain("<TodoEventsField checked={newTaskInEvents} onCheckedChange={setNewTaskInEvents} />");
  expect(page).toContain("<TodoEventsField checked={editInEvents} onCheckedChange={setEditInEvents} />");
  expect(page).toContain("show_in_events: newTaskInEvents,");
  expect(page).toContain("show_in_events: editInEvents,");
  expect(page).toContain("setNewTaskInEvents(false);");
  expect(page).toContain("setEditInEvents(Boolean(todo.show_in_events));");
  const hook = codeOnly(read("src/hooks/use-supabase-queries.ts"));
  expect(hook).toContain("show_in_events?: boolean;");
});

test("the column is added by a migration the entrypoint can run again, and typed", () => {
  const sql = codeOnly(read("docker/migration_todos_show_in_events.sql"), { sql: true });
  expect(sql).toContain("ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS show_in_events BOOLEAN NOT NULL DEFAULT false;");
  expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  const types = codeOnly(read("src/types/database.ts"));
  const todos = types.slice(types.indexOf("todos: {"), types.indexOf("todo_occurrences: {"));
  expect(todos).toContain("show_in_events: boolean;");
  expect(todos.match(/show_in_events\?: boolean;/g)).toHaveLength(2);
});

test("the option's strings exist in every language", () => {
  for (const locale of ["en", "de", "fr"]) {
    const strings = JSON.parse(read(`messages/${locale}.json`)).todos;
    for (const key of ["showInEventsLabel", "showInEventsHint"]) {
      expect(typeof strings[key], `${locale}.${key}`).toBe("string");
      expect(strings[key].trim(), `${locale}.${key}`).not.toBe("");
    }
  }
});
