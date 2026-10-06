import { nextTaskOccurrences, taskOccurrences, type MarkerTodo, type TaskOccurrence } from "@/lib/calendar-markers";
import { toLocalDateKey } from "@/lib/local-date";
import { isRecurring } from "@/lib/todo-recurrence";

/** A task as the Events widget sees it. */
export type EventTodo = MarkerTodo & { id: string; title: string; show_in_events?: boolean | null };

/**
 * The tasks the Events widget lists, each once.
 *
 * A task is listed when it is flagged (Show under Events on Home, in its
 * create / edit dialog), or when `all` is set: Settings -> Calendar -> "Tasks
 * as events" lists every task. Each is listed once, at its next day in the
 * window: one daily chore listed on every day would fill the widget and push
 * the real events out.
 *
 * A task is listed on its day, which takes a due date or a repeat. A flagged
 * one-off task with neither, or one that is overdue, has no day to be on
 * but is still to be done, so it is listed today until it is ticked off:
 * somebody who flagged it wants to see it, and an empty list would read as a
 * broken option. Without the flag, such a task is not listed, as before.
 */
export function eventTaskOccurrences(
  todos: readonly EventTodo[],
  people: readonly { id: string; color: string; name?: string }[],
  from: Date,
  to: Date,
  unassignedColor: string,
  { all, now = new Date() }: { all: boolean; now?: Date },
): TaskOccurrence[] {
  const listed = all ? todos : todos.filter((todo) => todo.show_in_events === true);
  if (listed.length === 0) return [];

  const onTheirDay = nextTaskOccurrences(taskOccurrences(listed, people, from, to, unassignedColor, now));

  const today = toLocalDateKey(now);
  const standIns = todos
    .filter((todo) => todo.show_in_events === true && !isRecurring(todo) && (!todo.due_date || todo.due_date.slice(0, 10) < today))
    // Today's occurrence, made by the same code as every other one (colour,
    // person, and nothing for a task that is done or in the bin), by giving
    // the task today as its day.
    .flatMap((todo) => taskOccurrences([{ ...todo, due_date: today }], people, from, to, unassignedColor, now));

  return [...onTheirDay, ...standIns].sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.title.localeCompare(b.title));
}
