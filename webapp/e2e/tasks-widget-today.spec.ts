import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { isOverdue, sectionOf, widgetTasks } from "../src/lib/tasks-widget-groups";
import { codeOnly } from "./source-helpers";

/**
 * The Tasks widget on Home: its Today and Upcoming sections, the order inside
 * them, and the compact row that shows a task's whole title. No stack;
 * tasks-widget-ui.spec.ts looks at the rendered widget.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const TODAY = "2026-10-06";

let n = 0;
const task = (over: Record<string, unknown> = {}) => {
  n += 1;
  return { id: `t${n}`, title: `Task ${n}`, due_date: null as string | null, priority: "medium", recurrence: "once" as string | null, created_at: `2026-10-0${Math.min(n, 5)}T00:00:00.000Z`, ...over };
};
const order = (todos: ReturnType<typeof task>[]) => widgetTasks(todos, TODAY).map(({ section, todo }) => `${section}:${todo.title}`);

test("a task due today, an overdue one and an open repeating one are today's; later and undated ones are upcoming", () => {
  expect(sectionOf(task({ due_date: TODAY }), TODAY)).toBe("today");
  expect(sectionOf(task({ due_date: "2026-10-01" }), TODAY)).toBe("today");
  expect(sectionOf(task({ recurrence: "daily" }), TODAY)).toBe("today");
  expect(sectionOf(task({ recurrence: "days:MO,WE" }), TODAY)).toBe("today");
  // Repeating, and its first day is later: open means it has come round, so it is today's.
  expect(sectionOf(task({ recurrence: "weekly", due_date: "2026-10-13" }), TODAY)).toBe("today");
  expect(sectionOf(task({ due_date: "2026-10-07" }), TODAY)).toBe("upcoming");
  expect(sectionOf(task(), TODAY)).toBe("upcoming");
  expect(sectionOf(task({ recurrence: "once", due_date: "2026-10-06T00:00:00+00:00" }), TODAY)).toBe("today");
});

test("overdue means past its due date", () => {
  expect(isOverdue(task({ due_date: "2026-10-05" }), TODAY)).toBe(true);
  expect(isOverdue(task({ due_date: TODAY }), TODAY)).toBe(false);
  expect(isOverdue(task({ due_date: "2026-10-07" }), TODAY)).toBe(false);
  expect(isOverdue(task(), TODAY)).toBe(false);
});

test("today comes first: overdue, then due today, then the repeating ones", () => {
  const out = order([
    task({ title: "Repeating", recurrence: "daily", priority: "high" }),
    task({ title: "Due today", due_date: TODAY, priority: "low" }),
    task({ title: "Overdue", due_date: "2026-10-02", priority: "low" }),
    task({ title: "Later", due_date: "2026-10-09", priority: "high" }),
    task({ title: "Undated", priority: "high" }),
  ]);
  expect(out).toEqual(["today:Overdue", "today:Due today", "today:Repeating", "upcoming:Later", "upcoming:Undated"]);
});

test("within a group: by priority, then the oldest first; upcoming by date, undated last", () => {
  expect(
    order([
      task({ title: "Low old", recurrence: "daily", priority: "low", created_at: "2026-09-01T00:00:00.000Z" }),
      task({ title: "High new", recurrence: "daily", priority: "high", created_at: "2026-10-05T00:00:00.000Z" }),
      task({ title: "Medium new", recurrence: "daily", priority: "medium", created_at: "2026-10-05T00:00:00.000Z" }),
      task({ title: "Medium old", recurrence: "daily", priority: "medium", created_at: "2026-09-01T00:00:00.000Z" }),
    ]),
  ).toEqual(["today:High new", "today:Medium old", "today:Medium new", "today:Low old"]);
  expect(
    order([
      task({ title: "Undated high", priority: "high" }),
      task({ title: "Next week", due_date: "2026-10-13", priority: "high" }),
      task({ title: "Tomorrow low", due_date: "2026-10-07", priority: "low" }),
      task({ title: "Tomorrow high", due_date: "2026-10-07", priority: "high" }),
    ]),
  ).toEqual(["upcoming:Tomorrow high", "upcoming:Tomorrow low", "upcoming:Next week", "upcoming:Undated high"]);
});

test("every task is listed once, and nothing is listed for no tasks", () => {
  const todos = [task({ due_date: TODAY }), task({ recurrence: "daily" }), task({}), task({ due_date: "2026-10-20" })];
  const out = widgetTasks(todos, TODAY);
  expect(out).toHaveLength(4);
  expect(new Set(out.map(({ todo }) => todo.id)).size).toBe(4);
  expect(widgetTasks([], TODAY)).toEqual([]);
});

test("the widget groups through this, labels each group like the Events widget, and moves on at midnight", () => {
  const widget = codeOnly(read("src/components/widgets/tasks-widget.tsx"));
  expect(widget).toContain("widgetTasks(todos.filter((t) => isTodoOpen(t)), todayStr)");
  expect(widget).toContain("const today = useToday();");
  expect(widget).toContain("}, [todos, todayStr]);");
  expect(widget).toContain('<span className="text-kiosk-label text-2xs">{section === "today" ? t("today") : t("upcoming")}</span>');
  // The Events widget's separator, so the two read alike.
  const events = codeOnly(read("src/components/widgets/upcoming-events.tsx"));
  expect(events).toContain('<span className="text-kiosk-label text-2xs">{dayLabel}</span>');
  // "Today" is a section now, not a tag on each row.
  expect(widget).not.toContain("isDueToday");
  expect(widget).not.toContain('text-warning">{t("today")}');
});

test("a row is compact, and shows the whole title instead of cutting it off", () => {
  const widget = codeOnly(read("src/components/widgets/tasks-widget.tsx"));
  expect(widget).toContain("compact={!large}");
  expect(widget).toContain('<span className="break-words leading-snug">');
  expect(widget).not.toContain("truncate");
  // "Show larger tasks on Home" keeps its big rows.
  expect(widget).toContain('className={large ? "min-h-[72px] [&_label]:text-lg [&_.peer]:scale-125" : undefined}');
  const item = codeOnly(read("src/components/checklist-item.tsx"));
  expect(item).toContain('compact ? "min-h-[40px] gap-2.5 px-3" : "min-h-[52px] gap-3 px-4"');
  // The label fills the row's height, so the whole row is the tap target.
  expect(item).toContain('compact && "flex items-center self-stretch py-1.5"');
});

test("the new section's name exists in every language", () => {
  for (const locale of ["en", "de", "fr"]) {
    const strings = JSON.parse(read(`messages/${locale}.json`)).tasksWidget;
    for (const key of ["today", "upcoming"]) {
      expect(typeof strings[key], `${locale}.${key}`).toBe("string");
      expect(strings[key].trim(), `${locale}.${key}`).not.toBe("");
    }
  }
});
