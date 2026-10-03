import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CURRENT_ZONE_NAMES,
  allTimeZones,
  filterTimeZones,
  formatUtcOffset,
  matchesTimeZoneQuery,
  queryOffset,
  timeIn,
  timeZoneOption,
  timeZoneOptions,
} from "../src/lib/time-zones";
import { codeOnly } from "./source-helpers";

/**
 * The family's time zone, Settings → Language: what the picker offers, how
 * a search finds a zone, what the settings route lets through, and the
 * strings. No stack; time-zone-ui.spec.ts drives the page itself.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const winter = new Date("2026-01-15T12:00:00Z");
const summer = new Date("2026-07-15T12:00:00Z");

test("an offset reads the way people write it", () => {
  expect(formatUtcOffset(0)).toBe("UTC+00:00");
  expect(formatUtcOffset(-420)).toBe("UTC-07:00");
  expect(formatUtcOffset(330)).toBe("UTC+05:30");
  expect(formatUtcOffset(825)).toBe("UTC+13:45");
  expect(formatUtcOffset(-570)).toBe("UTC-09:30");
});

test("a zone's offset is the one in force at the moment, summer time included", () => {
  const offset = (zone: string, at: Date) => timeZoneOption(zone, at)?.offset;
  expect(offset("America/New_York", winter)).toBe("UTC-05:00");
  expect(offset("America/New_York", summer)).toBe("UTC-04:00");
  expect(offset("Europe/Berlin", winter)).toBe("UTC+01:00");
  expect(offset("Europe/Berlin", summer)).toBe("UTC+02:00");
  expect(offset("Asia/Kolkata", winter)).toBe("UTC+05:30");
  expect(offset("Asia/Kathmandu", winter)).toBe("UTC+05:45");
  expect(offset("America/St_Johns", winter)).toBe("UTC-03:30");
  // Southern summer: Chatham is on daylight time in January.
  expect(offset("Pacific/Chatham", winter)).toBe("UTC+13:45");
  expect(offset("Pacific/Chatham", summer)).toBe("UTC+12:45");
  expect(offset("UTC", summer)).toBe("UTC+00:00");
  expect(timeZoneOption("Mars/Olympus_Mons", winter)).toBeNull();
  expect(timeIn("Asia/Kolkata", "en-GB", winter)).toBe("17:30");
});

test("every zone the runtime knows is offered once, by its current name, UTC included", () => {
  const zones = allTimeZones();
  expect(zones.length).toBeGreaterThan(300);
  expect(zones).toEqual([...zones].sort());
  expect(new Set(zones).size).toBe(zones.length);
  // V8 lists CLDR's names (Asia/Calcutta, Europe/Kiev) and leaves UTC out.
  for (const zone of ["UTC", "Europe/Berlin", "America/New_York", "Asia/Kolkata", "Europe/Kyiv"]) {
    expect(zones, zone).toContain(zone);
  }
  for (const former of Object.keys(CURRENT_ZONE_NAMES)) expect(zones, former).not.toContain(former);
  // The server checks a zone with Intl before storing it: every name offered passes.
  for (const option of timeZoneOptions(winter)) {
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: option.zone }), option.zone).not.toThrow();
  }
  expect(timeZoneOptions(winter)).toHaveLength(zones.length);
});

test("the family's own zone is offered even when the list leaves it out", () => {
  const zones = timeZoneOptions(winter, ["US/Pacific", "Mars/Olympus_Mons", null]).map((o) => o.zone);
  expect(zones).toContain("US/Pacific");
  expect(zones).not.toContain("Mars/Olympus_Mons");
});

test("an offset typed in a search is a number, not text", () => {
  expect(queryOffset("utc+1")).toBe(60);
  expect(queryOffset("UTC-8")).toBe(-480);
  expect(queryOffset("+5:30")).toBe(330);
  expect(queryOffset("+0530")).toBe(330);
  expect(queryOffset("gmt+2")).toBe(120);
  expect(queryOffset("-03:30")).toBe(-210);
  expect(queryOffset("utc")).toBeNull();
  expect(queryOffset("+15")).toBeNull();
  expect(queryOffset("+5:75")).toBeNull();
  expect(queryOffset("berlin")).toBeNull();
});

test("a search matches every word, in current and former names and in offsets", () => {
  const options = timeZoneOptions(winter);
  const zonesFor = (query: string) => filterTimeZones(options, query).map((o) => o.zone);
  expect(zonesFor("buenos aires")).toEqual(["America/Argentina/Buenos_Aires"]);
  expect(zonesFor("SAO_PAULO")).toEqual(["America/Sao_Paulo"]);
  expect(zonesFor("york new")).toContain("America/New_York");
  expect(zonesFor("calcutta")).toEqual(["Asia/Kolkata"]);
  expect(zonesFor("kiev")).toEqual(["Europe/Kyiv"]);
  expect(zonesFor("+05:45")).toEqual(["Asia/Kathmandu"]);
  // "utc+1" is +01:00 exactly, not +10 to +14 as well.
  const plusOne = filterTimeZones(options, "utc+1");
  expect(plusOne.map((o) => o.zone)).toContain("Europe/Berlin");
  expect(plusOne.every((o) => o.offset === "UTC+01:00")).toBe(true);
  expect(filterTimeZones(options, "utc-8").every((o) => o.offset === "UTC-08:00")).toBe(true);
  expect(zonesFor("utc-8")).toContain("Pacific/Pitcairn");
  expect(zonesFor("europe utc+1")).toContain("Europe/Paris");
  expect(zonesFor("europe utc+1")).not.toContain("Africa/Lagos");
  // "utc" alone finds UTC, not every zone that has an offset.
  expect(zonesFor("utc")).toContain("UTC");
  expect(zonesFor("utc").length).toBeLessThan(5);
  expect(filterTimeZones(options, "")).toHaveLength(options.length);
  expect(filterTimeZones(options, "   ")).toHaveLength(options.length);
  expect(zonesFor("nowhere at all")).toEqual([]);
  // Automatic is found by its own label as well.
  const server = timeZoneOption("Europe/Berlin", winter)!;
  expect(matchesTimeZoneQuery(server, "auto", "Automatic (Europe/Berlin)")).toBe(true);
  expect(matchesTimeZoneQuery(server, "utc+1", "Automatic (Europe/Berlin)")).toBe(true);
  expect(matchesTimeZoneQuery(server, "tokyo", "Automatic (Europe/Berlin)")).toBe(false);
});

test("the settings route stores a zone only if it is real, before anything is written", () => {
  const route = codeOnly(read("src/app/api/settings/route.ts"));
  const put = route.slice(route.indexOf("export async function PUT"), route.indexOf("export async function DELETE"));
  const check = put.indexOf("key === SETTINGS_KEYS.timezone && !isValidTimeZone(value)");
  expect(check, "PUT checks the zone").toBeGreaterThan(-1);
  expect(check, "before the admin client is made").toBeLessThan(put.indexOf("createAdminClient()"));
  expect(put.slice(check, check + 300)).toContain("status: 400");
});

test("the server names its own zone to a joined screen, and the page deletes the setting for Automatic", () => {
  const route = codeOnly(read("src/app/api/time-zone/route.ts"));
  expect(route).toContain("requireSession(request)");
  expect(route).toContain("serverTimeZone()");
  const familyTime = codeOnly(read("src/lib/family-time.ts"));
  expect(familyTime).toContain(".eq(\"key\", SETTINGS_KEYS.timezone)");
  expect(familyTime).toContain("return serverTimeZone();");
  const page = codeOnly(read("src/app/settings/language/page.tsx"));
  expect(page).toContain("deleteZone.mutateAsync(SETTINGS_KEYS.timezone)");
  expect(page).toContain("updateZone.mutateAsync({ key: SETTINGS_KEYS.timezone, value: zone })");
  expect(page).toContain("isValidTimeZone(savedZone) ? savedZone : null");
});

test("the picker's strings exist in every language, with their placeholders", () => {
  const keys = ["timeZoneLabel", "timeZoneDescription", "timeZoneAutomatic", "timeZoneAutomaticLoading", "timeZoneSearch", "timeZoneNone"];
  for (const locale of ["en", "de", "fr"]) {
    const strings = JSON.parse(read(`messages/${locale}.json`)).settings.language;
    for (const key of keys) expect(typeof strings[key], `${locale}.${key}`).toBe("string");
    expect(strings.timeZoneAutomatic, locale).toContain("{zone}");
    expect(strings.timeZoneNone, locale).toContain("{query}");
  }
});
