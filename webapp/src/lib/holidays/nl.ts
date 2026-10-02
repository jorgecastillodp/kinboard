/**
 * Dutch public holidays. Days off are those the Algemene termijnenwet lists:
 * Good Friday is not among them, and Easter and Whit Sunday only as Sundays.
 * Whether a job gives each one off is up to the employment contract -- many
 * give Liberation Day only every fifth year.
 * nameKeys map to the `holidays` translation namespace.
 */

import type { Holiday } from "./types";
import { computeEaster, addDays } from "./utils";

export function getNlHolidays(year: number): Holiday[] {
  const easter = computeEaster(year);

  return [
    { nameKey: "nlNieuwjaarsdag", date: new Date(year, 0, 1), emoji: "🎆", dayOff: true },
    { nameKey: "nlGoedeVrijdag", date: addDays(easter, -2), emoji: "✝️", dayOff: false },
    { nameKey: "nlEerstePaasdag", date: easter, emoji: "🐣", dayOff: false },
    { nameKey: "nlTweedePaasdag", date: addDays(easter, 1), emoji: "🐰", dayOff: true },
    { nameKey: "nlKoningsdag", date: new Date(year, 3, 27), emoji: "🇳🇱", dayOff: true },
    { nameKey: "nlBevrijdingsdag", date: new Date(year, 4, 5), emoji: "🕊️", dayOff: true },
    { nameKey: "nlHemelvaartsdag", date: addDays(easter, 39), emoji: "⛅", dayOff: true },
    { nameKey: "nlEerstePinksterdag", date: addDays(easter, 49), emoji: "🕊️", dayOff: false },
    { nameKey: "nlTweedePinksterdag", date: addDays(easter, 50), emoji: "🕊️", dayOff: true },
    { nameKey: "nlEersteKerstdag", date: new Date(year, 11, 25), emoji: "🎄", dayOff: true },
    { nameKey: "nlTweedeKerstdag", date: new Date(year, 11, 26), emoji: "🎁", dayOff: true },
  ];
}
