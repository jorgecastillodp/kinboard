import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { establishSession } from "./session";

/**
 * The Location field in the calendar's event dialog searches the family's own
 * country, in the app's language, and writes each result the way its country
 * writes an address. It used to search Germany only, in German, whatever the
 * family's settings were.
 *
 * OpenStreetMap's search is stubbed (the answers are known and CI needs no
 * internet) and so is the read of the family's holiday region, so the shared
 * family is not changed. Needs FAMILY_CODE (a running stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block" });
// One device for the file, joined once (see session.ts).
test.describe.configure({ mode: "serial" });
const DEVICE = "location-autocomplete-ui";

type Locale = "en" | "de";
const newEventLabel = (locale: Locale) =>
  (JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8")) as { calendar: { newEventButton: string } })
    .calendar.newEventButton;

/** Nominatim results as the search returns them (`addressdetails=1`). */
const SPRINGFIELD = {
  place_id: 1, lat: "33.75", lon: "-117.99",
  display_name: "123, Main Street, Springfield, Sangamon County, Illinois, 62701, United States",
  address: { house_number: "123", road: "Main Street", city: "Springfield", state: "Illinois", "ISO3166-2-lvl4": "US-IL", postcode: "62701", country: "United States", country_code: "us" },
};
const HAMBURG = {
  place_id: 2, lat: "53.55", lon: "10.0",
  display_name: "5, Hauptstraße, Altstadt, Hamburg, 20095, Deutschland",
  address: { house_number: "5", road: "Hauptstraße", city: "Hamburg", postcode: "20095", country: "Deutschland", country_code: "de" },
};
const PARIS = {
  place_id: 3, lat: "48.85", lon: "2.29",
  display_name: "5, Avenue Anatole France, Paris, Île-de-France, 75007, France",
  address: { house_number: "5", road: "Avenue Anatole France", city: "Paris", postcode: "75007", country: "France", country_code: "fr" },
};

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

/** Answer the place search, and record what it was asked. */
async function stubSearch(page: Page, answer: (ask: Record<string, string>) => unknown[]) {
  const asked: Record<string, string>[] = [];
  await page.route(/nominatim\.openstreetmap\.org\/search/, (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const ask = Object.fromEntries(new URL(route.request().url()).searchParams);
    asked.push(ask);
    return route.fulfill({ json: answer(ask), headers: CORS });
  });
  return asked;
}

/** The family's holiday region (null: none picked), answered on the settings read. */
async function stubRegion(page: Page, code: string | null) {
  await page.route(/\/rest\/v1\/settings\?.*key=eq\.holiday_region/, (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const wantsObject = (route.request().headers()["accept"] ?? "").includes("pgrst.object");
    if (!code) {
      return wantsObject
        ? route.fulfill({ status: 406, headers: CORS, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "no rows" }) })
        : route.fulfill({ json: [], headers: CORS });
    }
    const row = { value: { code, chosen: true } };
    return wantsObject
      ? route.fulfill({ headers: CORS, contentType: "application/vnd.pgrst.object+json", body: JSON.stringify(row) })
      : route.fulfill({ json: [row], headers: CORS });
  });
}

/** Open the new-event dialog on the calendar and give back its Location field. */
async function openLocationField(page: Page, locale: Locale) {
  const base = test.info().project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  await establishSession(page, familyCode!, DEVICE);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
  await page.goto("/calendar", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: newEventLabel(locale), exact: true }).filter({ visible: true }).first().click({ timeout: 30_000 });
  const field = page.locator("#location");
  await expect(field).toBeVisible({ timeout: 15_000 });
  return field;
}

test("a family in the US is searched in the US, in English, and its addresses read the US way", async ({ page }) => {
  await stubRegion(page, "US-IL");
  const asked = await stubSearch(page, () => [SPRINGFIELD]);
  const field = await openLocationField(page, "en");

  await field.fill("Main Street");
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(asked[0]).toMatchObject({ q: "Main Street", countrycodes: "us", "accept-language": "en" });

  const option = page.getByRole("button", { name: /123 Main Street, Springfield, IL 62701/ });
  await expect(option).toBeVisible();
  // The second line is OpenStreetMap's own full name for it.
  await expect(option).toContainText("123, Main Street, Springfield, Sangamon County, Illinois");

  await option.click();
  await expect(field).toHaveValue("123 Main Street, Springfield, IL 62701");
  // A country that has the place is searched once, not twice.
  await page.waitForTimeout(1_000);
  expect(asked).toHaveLength(1);
});

test("with the app in German, German names are asked for and a German address reads as it always did", async ({ page }) => {
  await stubRegion(page, "DE-NI");
  const asked = await stubSearch(page, () => [HAMBURG]);
  const field = await openLocationField(page, "de");

  await field.fill("Hauptstraße");
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(asked[0]).toMatchObject({ countrycodes: "de", "accept-language": "de" });
  await expect(page.getByRole("button", { name: /Hauptstraße 5, 20095 Hamburg/ })).toBeVisible();
});

test("a family with no region picked is searched everywhere, not in Germany", async ({ page }) => {
  await stubRegion(page, null);
  const asked = await stubSearch(page, () => [SPRINGFIELD]);
  const field = await openLocationField(page, "en");

  await field.fill("Main Street");
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(asked[0]["accept-language"]).toBe("en");
  expect(asked[0]).not.toHaveProperty("countrycodes");
  await expect(page.getByRole("button", { name: /123 Main Street, Springfield, IL 62701/ })).toBeVisible();
});

test("a place the family's country has no match for is looked for in the whole world", async ({ page }) => {
  await stubRegion(page, "US-IL");
  const asked = await stubSearch(page, (ask) => (ask.countrycodes ? [] : [PARIS]));
  const field = await openLocationField(page, "en");

  await field.fill("Avenue Anatole France");
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(2);
  expect(asked[0]).toHaveProperty("countrycodes", "us");
  expect(asked[1]).not.toHaveProperty("countrycodes");
  await expect(page.getByRole("button", { name: /5 Avenue Anatole France, 75007 Paris/ })).toBeVisible();
});
