import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { formatPlace, locationSearchParams, type PlaceAddress } from "../src/lib/location-search";
import { codeOnly } from "./source-helpers";

/**
 * The calendar's Location field searched Germany only and asked for German
 * names, whatever the family's settings were. It now follows them: the country
 * of the family's holiday region, the app's language, and each result written
 * the way its own country writes an address. No stack;
 * location-autocomplete-ui.spec.ts looks at the rendered field.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const ask = (extra: Partial<Parameters<typeof locationSearchParams>[0]> = {}) =>
  locationSearchParams({ query: "Main Street", limit: 5, language: "en", ...extra });

// ---- what is asked for ----

test("a family's country limits the search to it, in either case", () => {
  expect(ask({ countryCode: "US" }).get("countrycodes")).toBe("us");
  expect(ask({ countryCode: "gb" }).get("countrycodes")).toBe("gb");
});

test("the names come back in the app's language, whichever it is", () => {
  for (const language of ["en", "de", "fr"]) expect(ask({ language }).get("accept-language"), language).toBe(language);
});

test("no country picked, or one that is not a country code: the whole world", () => {
  for (const countryCode of [undefined, null, "", "usa", "u", "1a", "  "]) {
    expect(ask({ countryCode }).has("countrycodes"), String(countryCode)).toBe(false);
  }
});

test("the rest of the request is what Nominatim needs", () => {
  const params = ask({ countryCode: "US" });
  expect(params.get("q")).toBe("Main Street");
  expect(params.get("limit")).toBe("5");
  expect(params.get("format")).toBe("json");
  expect(params.get("addressdetails")).toBe("1");
});

// ---- how a result reads ----

const address = (a: PlaceAddress): PlaceAddress => a;

test("a German address reads as it always did", () => {
  const hamburg = address({ house_number: "5", road: "Hauptstraße", city: "Hamburg", postcode: "20095", country_code: "de" });
  expect(formatPlace(hamburg, "full name")).toBe("Hauptstraße 5, 20095 Hamburg");
  // A result that does not say which country it is in keeps that order too.
  expect(formatPlace({ ...hamburg, country_code: undefined }, "full name")).toBe("Hauptstraße 5, 20095 Hamburg");
});

test("a US address reads number first, with the state before the postcode", () => {
  expect(
    formatPlace(
      address({ house_number: "123", road: "Main Street", city: "Springfield", state: "Illinois", "ISO3166-2-lvl4": "US-IL", postcode: "62701", country_code: "us" }),
      "full name",
    ),
  ).toBe("123 Main Street, Springfield, IL 62701");
});

test("Canada and Australia write the state or province the same way", () => {
  expect(
    formatPlace(address({ house_number: "100", road: "Queen Street West", city: "Toronto", "ISO3166-2-lvl4": "CA-ON", postcode: "M5H 2N2", country_code: "ca" }), "x"),
  ).toBe("100 Queen Street West, Toronto, ON M5H 2N2");
  expect(
    formatPlace(address({ house_number: "1", road: "Macquarie Street", city: "Sydney", "ISO3166-2-lvl4": "AU-NSW", postcode: "2000", country_code: "au" }), "x"),
  ).toBe("1 Macquarie Street, Sydney, NSW 2000");
});

test("Britain writes the postcode after the town, with no state", () => {
  expect(
    formatPlace(address({ house_number: "10", road: "Downing Street", city: "London", state: "England", postcode: "SW1A 2AA", country_code: "gb" }), "x"),
  ).toBe("10 Downing Street, London SW1A 2AA");
});

test("France writes the number first and the postcode before the town", () => {
  expect(
    formatPlace(address({ house_number: "5", road: "Avenue Anatole France", city: "Paris", postcode: "75007", country_code: "fr" }), "x"),
  ).toBe("5 Avenue Anatole France, 75007 Paris");
});

test("what is missing is left out, not written as a gap", () => {
  // No state code in the result: the postcode follows the town.
  expect(formatPlace(address({ house_number: "123", road: "Main Street", city: "Springfield", postcode: "62701", country_code: "us" }), "x")).toBe(
    "123 Main Street, Springfield 62701",
  );
  // No house number, no postcode.
  expect(formatPlace(address({ road: "Main Street", city: "Springfield", "ISO3166-2-lvl4": "US-IL", country_code: "us" }), "x")).toBe(
    "Main Street, Springfield, IL",
  );
  // A town on its own, as a search for a city gives.
  expect(formatPlace(address({ city: "Portland", state: "Oregon", "ISO3166-2-lvl4": "US-OR", country_code: "us" }), "x")).toBe("Portland, OR");
  expect(formatPlace(address({ city: "Hamburg", country_code: "de" }), "x")).toBe("Hamburg");
  // A village or a town is named as a city is.
  expect(formatPlace(address({ road: "Dorfstraße", village: "Kleindorf", postcode: "12345", country_code: "de" }), "x")).toBe("Dorfstraße, 12345 Kleindorf");
});

test("a result with no street or town is written as OpenStreetMap's own name for it", () => {
  expect(formatPlace(undefined, "Some Park, Somewhere")).toBe("Some Park, Somewhere");
  expect(formatPlace(address({ country: "United States", country_code: "us" }), "United States")).toBe("United States");
});

test("a state code that is not one is not written", () => {
  for (const code of ["US", "US-", "US-california", "US-ABCD"]) {
    expect(
      formatPlace(address({ road: "Main Street", city: "Springfield", "ISO3166-2-lvl4": code, country_code: "us" }), "x"),
      code,
    ).toBe("Main Street, Springfield");
  }
});

// ---- the wiring: no built-in country or language is left ----

test("the search hook builds its request from the options and has no German left", () => {
  const hook = codeOnly(read("src/hooks/use-location-search.ts"));
  expect(hook).toContain("locationSearchParams({ query, limit, countryCode: country, language })");
  expect(hook).not.toMatch(/countryCode\s*=\s*["']de["']/);
  expect(hook).not.toMatch(/Accept-Language/i);
  expect(hook).not.toContain("Suche fehlgeschlagen");
  // The address is written by the shared formatter, not by order of fields in the hook.
  expect(hook).toContain("formatPlace(location.address, location.display_name)");
});

test("a country with no match widens the search to the whole world", () => {
  const hook = codeOnly(read("src/hooks/use-location-search.ts"));
  expect(hook).toContain("if (countryCode && data.length === 0) data = await searchIn(undefined);");
});

test("the Location field takes the country from the holiday region and the language from the app", () => {
  const field = codeOnly(read("src/components/location-autocomplete.tsx"));
  expect(field).toContain("const { region } = useHolidayRegion();");
  expect(field).toContain("countryCode: resolveRegion(region)?.country,");
  expect(field).toContain("language: locale,");
  expect(field).not.toMatch(/countryCode:\s*["'][a-z]{2}["']/i);
});
