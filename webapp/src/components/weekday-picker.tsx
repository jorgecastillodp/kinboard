"use client";

import { useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useWeekStart } from "@/hooks/use-week-start";

// A date for each weekday, to let date-fns name it in the user's language:
// 4 October 2026 is a Sunday, so 4 + n has getDay() === n.
const sampleDay = (day: number) => new Date(2026, 9, 4 + day);

/** The weekdays, as getDay() numbers, in the family's week order. */
function useWeekOrder(): number[] {
  const { weekStartsOn } = useWeekStart();
  return useMemo(() => Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7), [weekStartsOn]);
}

/**
 * Seven toggles, one per weekday, for a task that repeats on picked days.
 * Values are getDay() numbers (0 is Sunday); order follows the family's week.
 */
export function WeekdayPicker({
  value,
  onChange,
}: {
  value: readonly number[];
  onChange: (days: number[]) => void;
}) {
  const t = useTranslations("todos");
  const dateLocale = getDateFnsLocale(useLocale());
  const order = useWeekOrder();

  const toggle = (day: number) =>
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t("recurrenceDaysLabel")}</span>
      <div role="group" aria-label={t("recurrenceDaysLabel")} className="flex gap-1">
        {order.map((day) => {
          const on = value.includes(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggle(day)}
              aria-pressed={on}
              aria-label={format(sampleDay(day), "EEEE", { locale: dateLocale })}
              className={`flex-1 min-h-[44px] rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                on
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {format(sampleDay(day), "EEEEEE", { locale: dateLocale })}
            </button>
          );
        })}
      </div>
      {value.length === 0 && <p className="text-xs text-muted-foreground">{t("recurrenceDaysHint")}</p>}
    </div>
  );
}

/**
 * How picked days read in a list: "Weekdays" for Monday to Friday, otherwise
 * the short names in the family's week order -- "Mon, Tue, Wed, Thu".
 */
export function useWeekdaysLabel(): (days: readonly number[]) => string {
  const t = useTranslations("todos");
  const dateLocale = getDateFnsLocale(useLocale());
  const order = useWeekOrder();
  return useCallback(
    (days: readonly number[]) => {
      const set = new Set(days);
      if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return t("recurrence.weekdays");
      return order
        .filter((d) => set.has(d))
        .map((d) => format(sampleDay(d), "EEE", { locale: dateLocale }))
        .join(", ");
    },
    [t, dateLocale, order],
  );
}
