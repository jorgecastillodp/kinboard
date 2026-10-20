"use client";

import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WeekdayPicker } from "@/components/weekday-picker";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import {
  REPEAT_CHOICES,
  choiceForRule,
  dayFromKey,
  formatRepeatRule,
  parseRepeatRule,
  ruleForChoice,
  type RepeatChoice,
  type RepeatRule,
} from "@/lib/event-repeat";

/** What the event dialog holds for a repeat: the choice, the chosen weekdays, and an end date if any. */
export interface RepeatValue {
  choice: RepeatChoice;
  days: number[];
  until: Date | null;
}

export const NO_REPEAT: RepeatValue = { choice: "never", days: [], until: null };

/** The dialog's value for a stored rule, to edit an occurrence's repeat. */
export function repeatValueFromRule(ruleText: string | null | undefined): RepeatValue {
  const rule = parseRepeatRule(ruleText);
  if (!rule) return NO_REPEAT;
  let until: Date | null = null;
  if (rule.until) {
    const [y, m, d] = rule.until.split("-").map(Number);
    until = new Date(y, m - 1, d);
  }
  return { choice: choiceForRule(rule), days: rule.weekdays ?? [], until };
}

/** The rule a dialog value makes: null for no repeat, or for custom days with none picked. */
export function ruleFromRepeatValue(value: RepeatValue): RepeatRule | null {
  return ruleForChoice(value.choice, {
    weekdays: value.days,
    until: value.until ? format(value.until, "yyyy-MM-dd") : null,
  });
}

/** Whether two dialog values are the same repeat. */
export function sameRepeat(a: RepeatValue, b: RepeatValue): boolean {
  const ra = ruleFromRepeatValue(a);
  const rb = ruleFromRepeatValue(b);
  return (ra ? formatRepeatRule(ra) : "") === (rb ? formatRepeatRule(rb) : "");
}

/**
 * The repeat part of the event dialog: never, daily, weekly, every two weeks,
 * monthly, yearly or custom days (the task dialog's weekday toggles), and an
 * optional last day. Only Kinboard's own calendars take repeats; for any
 * other the choice is off and says why.
 */
export function RepeatFields({
  value,
  onChange,
  startDate,
  disabled,
  idPrefix,
}: {
  value: RepeatValue;
  onChange: (value: RepeatValue) => void;
  /** The event's day: custom days start with its weekday, and the end can't be before it. */
  startDate: Date;
  disabled: boolean;
  idPrefix: string;
}) {
  const t = useTranslations("calendar");
  const dateLocale = getDateFnsLocale(useLocale());
  const selectId = `${idPrefix}-repeat`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={selectId}>{t("fieldRepeat")}</Label>
      <Select
        value={disabled ? "never" : value.choice}
        disabled={disabled}
        onValueChange={(choice) =>
          onChange({
            ...value,
            choice: choice as RepeatChoice,
            days: choice === "custom" && value.days.length === 0 ? [startDate.getDay()] : value.days,
          })
        }
      >
        <SelectTrigger id={selectId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REPEAT_CHOICES.map((choice) => (
            <SelectItem key={choice} value={choice}>
              {t(`repeat.${choice}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {disabled && <p className="text-xs text-muted-foreground">{t("repeatLocalOnly")}</p>}
      {!disabled && value.choice === "custom" && (
        <WeekdayPicker value={value.days} onChange={(days) => onChange({ ...value, days })} />
      )}
      {!disabled && value.choice !== "never" && (
        <div className="flex flex-col gap-2">
          <Label>{t("repeatEnds")}</Label>
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex-1 justify-start text-left font-normal" data-testid={`${idPrefix}-repeat-until`}>
                  <CalendarIcon className="mr-2 size-4" />
                  {value.until ? format(value.until, "PPP", { locale: dateLocale }) : t("repeatEndsNever")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={value.until ?? undefined}
                  onSelect={(until) => until && onChange({ ...value, until })}
                  disabled={(date) => date < new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            {value.until && (
              <Button variant="ghost" size="icon" aria-label={t("repeatClearEnd")} onClick={() => onChange({ ...value, until: null })}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Repeats weekly on Mon, Wed, until 31 Dec 2026", for an occurrence's details; null when it doesn't repeat. */
export function useRepeatSummary(): (ruleText: string | null | undefined) => string | null {
  const t = useTranslations("calendar");
  const dateLocale = getDateFnsLocale(useLocale());
  return (ruleText) => {
    const rule = parseRepeatRule(ruleText);
    if (!rule) return null;
    const choice = choiceForRule(rule);
    const days = (rule.weekdays ?? []).map((d) => format(new Date(2026, 9, 4 + d), "EEE", { locale: dateLocale })).join(", ");
    const what = choice === "custom" ? t("repeatSummary.custom", { days }) : t(`repeatSummary.${choice === "never" ? "daily" : choice}`);
    const untilDay = rule.until ? dayFromKey(rule.until) : null;
    if (untilDay === null) return what;
    const [y, m, d] = rule.until!.split("-").map(Number);
    return t("repeatSummaryUntil", { what, date: format(new Date(y, m - 1, d), "PPP", { locale: dateLocale }) });
  };
}
