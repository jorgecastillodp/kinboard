export interface Holiday {
  /**
   * The `holidays` translation key, for countries Kinboard curates (RFC-014
   * §4.3). Empty when Kinboard has none: `name` is shown instead.
   */
  nameKey: string;
  /**
   * The name date-holidays gives it in the language asked for, falling back
   * to English and then to the native name. Shown when `nameKey` is empty or
   * untranslated (holidayLabel).
   */
  name?: string;
  date: Date;
  emoji: string;
  /**
   * A public holiday in law, off work for most people: a US federal holiday,
   * a UK bank holiday, a German gesetzlicher Feiertag. False for a day that is
   * marked but worked -- Christmas Eve in Germany, Halloween in the US -- and
   * for one that is only ever a Sunday.
   */
  dayOff: boolean;
}
