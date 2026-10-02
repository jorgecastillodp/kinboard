"use client";

import { motion } from "framer-motion";
import { CalendarHeart, ChevronRight, TreePalm } from "lucide-react";
import Link from "next/link";
import { differenceInCalendarDays, format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { WidgetCard } from "@/components/widget-card";
import { useSetting, useToday } from "@/hooks";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { DEFAULT_COUNTRY, nextHolidays, type CountryCode } from "@/lib/holidays";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

interface HolidayWidgetProps {
  maxItems?: number;
  className?: string;
}

/**
 * The next holidays for the family's country (Settings -> Language), each with
 * the days left. A palm tree marks the ones that are a day off -- and, for one
 * that falls on a weekend and is taken on a weekday instead, which weekday.
 */
export function HolidayWidget({ maxItems = 3, className = "" }: HolidayWidgetProps) {
  const t = useTranslations("holidayWidget");
  const tHolidays = useTranslations("holidays");
  const dateLocale = getDateFnsLocale(useLocale());
  // Re-render at midnight so the countdown moves on without a reload.
  const today = useToday();
  const { data: country } = useSetting<CountryCode>(SETTINGS_KEYS.holidayCountry, DEFAULT_COUNTRY);

  const holidays = useMemo(
    () => nextHolidays(country ?? DEFAULT_COUNTRY, new Date(today), maxItems),
    [country, today, maxItems],
  );

  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
  const item = { hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } };
  const day = (date: Date) => format(date, "EEE, d. MMM", { locale: dateLocale });

  const headerRight = (
    <Link
      href="/calendar"
      className="p-1 rounded-lg hover:bg-accent/50 transition-colors"
      aria-label={t("viewCalendarAria")}
    >
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className={className}
    >
      <WidgetCard icon={CalendarHeart} title={t("title")} headerRight={headerRight}>
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-3">
          {holidays.map((holiday) => {
            // Counted to the holiday, or -- for one already past whose day off
            // is today -- to that day off.
            const target = holiday.date >= new Date(today) ? holiday.date : (holiday.observed ?? holiday.date);
            const daysUntil = differenceInCalendarDays(target, new Date(today));
            const isToday = daysUntil === 0;
            const isSoon = daysUntil > 0 && daysUntil <= 7;
            return (
              <motion.div
                key={`${holiday.nameKey}-${holiday.date.getTime()}`}
                variants={item}
                // Wraps on a narrow card -- four columns on a 1024px landscape
                // panel make it ~220px -- so the countdown drops below the name
                // rather than cutting it short.
                className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card px-3 py-2 elev-sm${isToday ? " border-l-4 border-l-primary" : ""}`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base leading-none" aria-hidden="true">
                  {holiday.emoji}
                </span>
                <div className="min-w-[6.5rem] flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{tHolidays(holiday.nameKey)}</p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
                    <span className="whitespace-nowrap">{day(holiday.date)}</span>
                    {holiday.dayOff && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-success">
                        <TreePalm className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        {holiday.observed ? t("dayOffOn", { date: day(holiday.observed) }) : t("dayOff")}
                      </span>
                    )}
                  </p>
                </div>
                {isToday ? (
                  <Badge variant="default" className="ml-auto shrink-0 tabular-nums">{t("todayBadge")}</Badge>
                ) : (
                  <Badge variant={isSoon ? "warning" : "neutral"} className="ml-auto shrink-0 tabular-nums">{t("daysSuffix", { count: daysUntil })}</Badge>
                )}
              </motion.div>
            );
          })}
          {holidays.length === 0 && (
            <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
              <CalendarHeart className="size-8 mb-2 opacity-20" />
              <p className="text-sm">{t("emptyState")}</p>
            </div>
          )}
        </motion.div>
      </WidgetCard>
    </motion.div>
  );
}
