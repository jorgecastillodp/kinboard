import { getHolidays, type CountryCode, type Holiday } from "@/lib/holidays";
import { toLocalDateKey } from "@/lib/local-date";
import { isRecurring, recurrenceIntervalDays, type RecurringFields } from "@/lib/todo-recurrence";

/**
 * What the calendar marks on a day besides events. Family-wide, and both off
 * by default: a household that has not asked for markers sees the calendar it
 * always had.
 */
export interface CalendarDisplaySettings {
  showHolidays: boolean;
  showTasks: boolean;
  /** Tasks also listed among events: the Events widget, the week overview, the calendar's day lists. */
  tasksAsEvents: boolean;
}

export const DEFAULT_CALENDAR_DISPLAY: CalendarDisplaySettings = {
  showHolidays: false,
  showTasks: false,
  tasksAsEvents: false,
};

export interface MarkerTodo extends RecurringFields {
  due_date?: string | null;
  person_id?: string | null;
  deleted_at?: string | null;
}

// Day arithmetic on date keys, never on timestamps: a key is a calendar day in
// the viewer's timezone, and adding 86 400 000 ms drifts by an hour across DST.
const dayNumber = (key: string): number => {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const keyOf = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

/**
 * The days, as local date keys, on which a task is marked between `from` and
 * `to` inclusive.
 *
 * A one-off task is marked on its due date while it is open, and not at all
 * without one: there is no day to put it on. A recurring task follows the same
 * rule as the task list and the nav badge (lib/todo-recurrence) -- due again
 * `interval` days after it was last done, due since it was created if it never
 * was -- so it is marked from its next due day (today, when it is due or
 * overdue) and every interval after. Nothing recurring is marked before today:
 * past occurrences are history, and that history is not stored.
 */
export function taskDayKeys(todo: MarkerTodo, from: Date, to: Date, now: Date = new Date()): string[] {
  if (todo.deleted_at || todo.completed) return [];
  const fromN = dayNumber(toLocalDateKey(from));
  const toN = dayNumber(toLocalDateKey(to));
  if (toN < fromN) return [];

  if (!isRecurring(todo)) {
    if (!todo.due_date) return [];
    const n = dayNumber(todo.due_date);
    return n >= fromN && n <= toN ? [keyOf(n)] : [];
  }

  const interval = recurrenceIntervalDays(todo);
  if (!interval) return [];
  const todayN = dayNumber(toLocalDateKey(now));
  let next = todayN;
  if (todo.last_completed) {
    const last = new Date(todo.last_completed);
    if (!Number.isNaN(last.getTime())) {
      next = Math.max(todayN, dayNumber(toLocalDateKey(last)) + interval);
    }
  }
  // Jump to the first occurrence inside the range rather than walking to it.
  if (next < fromN) next += Math.ceil((fromN - next) / interval) * interval;

  const keys: string[] = [];
  for (let n = next; n <= toN; n += interval) keys.push(keyOf(n));
  return keys;
}

/**
 * Day key -> one colour per person with a task marked that day, in `people`
 * order, then a single neutral dot for anything unassigned. One dot per person
 * rather than per task: the dot says "something is here for Emma", not how
 * much. A person_id that matches nobody (a removed person) counts as unassigned.
 */
export function taskMarkersByDay(
  todos: readonly MarkerTodo[],
  people: readonly { id: string; color: string }[],
  from: Date,
  to: Date,
  unassignedColor: string,
  now: Date = new Date(),
): Map<string, string[]> {
  const byDay = new Map<string, Set<string | null>>();
  for (const todo of todos) {
    for (const key of taskDayKeys(todo, from, to, now)) {
      let ids = byDay.get(key);
      if (!ids) byDay.set(key, (ids = new Set()));
      ids.add(todo.person_id ?? null);
    }
  }

  const known = new Set(people.map((p) => p.id));
  const out = new Map<string, string[]>();
  for (const [key, ids] of byDay) {
    const colors = people.filter((p) => ids.has(p.id)).map((p) => p.color);
    if ([...ids].some((id) => id === null || !known.has(id))) colors.push(unassignedColor);
    out.set(key, colors);
  }
  return out;
}

/** Day key -> the built-in public holiday on it, for every year the range touches. */
export function holidaysByDay(country: CountryCode, from: Date, to: Date): Map<string, Holiday> {
  const fromKey = toLocalDateKey(from);
  const toKey = toLocalDateKey(to);
  const out = new Map<string, Holiday>();
  for (let year = from.getFullYear(); year <= to.getFullYear(); year++) {
    for (const holiday of getHolidays(country, year)) {
      const key = toLocalDateKey(holiday.date);
      if (key >= fromKey && key <= toKey && !out.has(key)) out.set(key, holiday);
    }
  }
  return out;
}

/** A task on one day, shaped to sit in a list of events. */
export interface TaskOccurrence {
  /** Unique per task and day, and never a real event id: `task:<todo id>:<day key>`. */
  id: string;
  todoId: string;
  title: string;
  dayKey: string;
  /** Local midnight of `dayKey`: an all-day item. */
  date: Date;
  color: string;
  personId: string | null;
}

export const TASK_EVENT_PREFIX = "task:";

/** True for an id made by taskOccurrences -- a task in an event list, with no event row behind it. */
export function isTaskEventId(id: string): boolean {
  return id.startsWith(TASK_EVENT_PREFIX);
}

/**
 * Every occurrence of every task between `from` and `to`, on the days
 * taskDayKeys gives, coloured by person, sorted by day then title.
 */
export function taskOccurrences(
  todos: readonly (MarkerTodo & { id: string; title: string })[],
  people: readonly { id: string; color: string }[],
  from: Date,
  to: Date,
  unassignedColor: string,
  now: Date = new Date(),
): TaskOccurrence[] {
  const colorOf = new Map(people.map((p) => [p.id, p.color]));
  const out: TaskOccurrence[] = [];
  for (const todo of todos) {
    for (const dayKey of taskDayKeys(todo, from, to, now)) {
      const [y, m, d] = dayKey.split("-").map(Number);
      out.push({
        id: `${TASK_EVENT_PREFIX}${todo.id}:${dayKey}`,
        todoId: todo.id,
        title: todo.title,
        dayKey,
        date: new Date(y, m - 1, d),
        color: (todo.person_id && colorOf.get(todo.person_id)) || unassignedColor,
        personId: todo.person_id ?? null,
      });
    }
  }
  return out.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.title.localeCompare(b.title));
}

/**
 * Each task's first occurrence only. An upcoming list shows what comes next;
 * listing every repeat would let one daily chore fill it and push the real
 * events out. Expects the sorted output of taskOccurrences.
 */
export function nextTaskOccurrences(occurrences: readonly TaskOccurrence[]): TaskOccurrence[] {
  const seen = new Set<string>();
  return occurrences.filter((o) => {
    if (seen.has(o.todoId)) return false;
    seen.add(o.todoId);
    return true;
  });
}
