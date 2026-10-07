import { nextTaskOccurrences, taskOccurrences, type MarkerTodo, type TaskOccurrence } from "@/lib/calendar-markers";
import { toLocalDateKey } from "@/lib/local-date";
import { isRecurring } from "@/lib/todo-recurrence";

/** A task as the Events widget sees it. */
export type EventTodo = MarkerTodo & { id: string; title: string; show_in_events?: boolean | null };

/**
 * The tasks the Events widget lists, each once: the ones flagged "Show under
 * Events on Home" in their create / edit dialog, and only those.
 *
 * Settings -> Calendar -> "Treat tasks as events" does not list every task
 * here. It lists them in the week overview and the calendar's day list, but
 * here the checkbox is how a family picks: with that switch deciding too, a
 * family that had it on (this one did) could never leave a task out, and the
 * checkbox could only add what was already there.
 *
 * A flagged task is listed once, at its next day in the window: one daily
 * chore listed on every day would fill the widget and push the real events out.
 *
 * A task is listed on its day, which takes a due date or a repeat. A flagged
 * one-off task with neither, or one that is overdue, has no day to be on but
 * is still to be done, so it is listed today until it is ticked off: somebody
 * who flagged it wants to see it, and an empty list would read as a broken
 * option.
 */
export function eventTaskOccurrences(
  todos: readonly EventTodo[],
  people: readonly { id: string; color: string; name?: string }[],
  from: Date,
  to: Date,
  unassignedColor: string,
  now: Date = new Date(),
): TaskOccurrence[] {
  const flagged = todos.filter((todo) => todo.show_in_events === true);
  if (flagged.length === 0) return [];

  const onTheirDay = nextTaskOccurrences(taskOccurrences(flagged, people, from, to, unassignedColor, now));

  const today = toLocalDateKey(now);
  const standIns = flagged
    .filter((todo) => !isRecurring(todo) && (!todo.due_date || todo.due_date.slice(0, 10) < today))
    // Today's occurrence, made by the same code as every other one (colour,
    // person, and nothing for a task that is done or in the bin), by giving
    // the task today as its day.
    .flatMap((todo) => taskOccurrences([{ ...todo, due_date: today }], people, from, to, unassignedColor, now));

  return [...onTheirDay, ...standIns].sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.title.localeCompare(b.title));
}
