import { expect, test, type Page } from "@playwright/test";
import { establishSession } from "./session";

/**
 * The forecast under the Weather widget shows each day's chance of rain, a dry
 * day's 0% included, in the spot under the temperatures; the detail view's
 * day list shows it too. The weather provider is stubbed (no API key is
 * needed, and the figures are known), so only the widget's rule is under
 * test. Needs FAMILY_CODE (a running stack).
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// The PWA service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block" });
// One device for the file, joined once (see session.ts).
test.describe.configure({ mode: "serial" });
const DEVICE = "weather-rain-chance-ui";

/** Today (not listed in the widget) and the six days after it; the third of those, "Day 3", has 20%. */
const CHANCES = [10, 0, 0, 20, 0, 0, 0];

function stubWeather(page: Page, chances: (number | null)[]) {
  const current = {
    temp: 14, feelsLike: 12, condition: "Clouds", conditionMain: "Clouds", conditionIcon: "04d", humidity: 65,
    windSpeed: 4, location: "Stubtown", high: 16, low: 9, visibility: 10000, sunrise: "07:31", sunset: "18:43",
    timezoneOffset: 0, units: "metric",
  };
  const forecast = {
    location: "Stubtown", coords: { lat: 0, lon: 0 }, timezone: 0, units: "metric", hourly: [],
    daily: chances.map((chance, i) => ({
      date: `2026-10-${String(7 + i).padStart(2, "0")}`, dayName: i === 0 ? "Today" : `Day ${i}`,
      tempMax: 16 - i, tempMin: 9 - i, condition: "Clouds", conditionMain: "Clouds", conditionIcon: "04d",
      humidity: 60, windSpeed: 3, precipProbability: chance, rainAmount: 0, snowAmount: 0,
    })),
  };
  return Promise.all([
    page.route(/\/api\/weather\/forecast\?/, (route) => route.fulfill({ json: forecast })),
    page.route(/\/api\/weather\?/, (route) => route.fulfill({ json: current })),
  ]);
}

/** The column under one forecast day's name in the widget. */
const column = (page: Page, day: string) =>
  page.getByText(day, { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");

test("every forecast day shows its chance of rain, 0% included, under its temperatures", async ({ page }) => {
  await stubWeather(page, CHANCES);
  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  await expect(page.getByText("Day 1", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // The widget lists the six days after today, each with a figure: the one
  // day above 0% and the five at 0% alike.
  for (let day = 1; day <= 6; day++) {
    const rain = column(page, `Day ${day}`).locator("span", { hasText: /^\d+%$/ });
    await expect(rain, `Day ${day}`).toHaveCount(1);
    await expect(rain, `Day ${day}`).toHaveText(`${CHANCES[day]}%`);
  }
  // In the spot the figure always had: under the temperatures, in every column.
  // (Not at one height: temperatures that wrap onto two lines make a column
  // taller, and the row centres its columns.)
  const gaps = await page.evaluate(() =>
    [1, 2, 3, 4, 5, 6].map((day) => {
      const name = [...document.querySelectorAll("span")].find((e) => e.textContent === `Day ${day}`)!;
      const col = name.closest("div.flex-col") as HTMLElement;
      const rain = [...col.querySelectorAll("span")].find((e) => /^\d+%$/.test(e.textContent ?? ""))!;
      const temps = [...col.children].find((child) => child.textContent?.includes("°"))!;
      return rain.getBoundingClientRect().top - temps.getBoundingClientRect().bottom;
    }),
  );
  for (const [i, gap] of gaps.entries()) expect(gap, `Day ${i + 1}`).toBeGreaterThanOrEqual(-1);
});

test("the detail view's day list shows a chance for every day too", async ({ page }) => {
  await stubWeather(page, CHANCES);
  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  await expect(page.getByText("Day 1", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await column(page, "Day 1").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  for (let day = 1; day <= 6; day++) {
    const row = dialog.getByText(`Day ${day}`, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
    // The figure's own element, not the row's text: "Day 1" and "0%" run together there.
    await expect(row.locator("span", { hasText: /^\d+%$/ }), `Day ${day}`).toHaveText(`${CHANCES[day]}%`);
  }
});

test("a day the provider gave no figure for shows none, not a made-up 0%", async ({ page }) => {
  await stubWeather(page, [10, 0, null, 20, 0, 0, 0]);
  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  await expect(page.getByText("Day 2", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(column(page, "Day 1").locator("span", { hasText: /^\d+%$/ })).toHaveText("0%");
  await expect(column(page, "Day 2").locator("span", { hasText: /^\d+%$/ })).toHaveCount(0);
  await expect(column(page, "Day 3").locator("span", { hasText: /^\d+%$/ })).toHaveText("20%");
});
