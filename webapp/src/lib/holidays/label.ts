import type { Holiday } from "./types";

/** The `holidays` namespace translator: next-intl's `useTranslations("holidays")`, or a server one cast to this. */
export interface HolidayTranslator {
  (key: string, values?: Record<string, string>): string;
  has(key: string): boolean;
}

/**
 * A holiday's name for display (RFC-014 §4.3): Kinboard's own translation
 * for curated countries, else the name date-holidays gave in the UI
 * language, falling back to English and then the native name. A real name
 * in another language beats a blank or a key. A US federal holiday the
 * state does not observe says so: "Columbus Day (federal)".
 */
export function holidayLabel(holiday: Pick<Holiday, "nameKey" | "name" | "federal">, t: HolidayTranslator): string {
  const name = holiday.nameKey && t.has(holiday.nameKey) ? t(holiday.nameKey) : holiday.name ?? holiday.nameKey;
  return holiday.federal && t.has("federalHoliday") ? t("federalHoliday", { name }) : name;
}
