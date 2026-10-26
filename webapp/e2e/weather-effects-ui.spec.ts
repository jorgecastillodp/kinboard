import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

/**
 * Weather effects on Home, end to end on a running stack, in a family of its
 * own: switched on in Settings -> Weather, a threshold kept in the family's
 * units, the Preview buttons, taps reaching what is under the effects, and
 * reduced motion. The rules are in weather-effects.spec.ts.
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

const overlay = (page: Page) => page.getByTestId("weather-effects");

/** True when a tap at the middle of `selector` lands on it, not on an effect. */
async function tapReaches(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && !hit.closest('[data-testid="weather-effects"]') && (el === hit || el.contains(hit));
  }, selector);
}

test.describe("weather effects on Home", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  test.describe.configure({ timeout: 180_000 });

  test("switched on in settings, previewed on Home, and never in the way", async ({ page, baseURL }) => {
    const familyName = `probe-family-weather-${Date.now()}`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const familyId = await createThrowawayFamily(page, familyName);
    try {
      await gotoAfterJoin(page, "/settings/weather");
      const enabled = page.locator("#weather-effects-enabled");
      await expect(enabled).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
      await enabled.click();
      await expect(page.getByRole("radio", { name: "Subtle" })).toBeVisible();

      // A threshold, in the family's units, kept across a reload.
      const freezing = page.locator("#weather-effects-freezingAtC");
      await expect(freezing).toHaveValue("0");
      await freezing.fill("-3");
      await freezing.press("Enter");
      await page.waitForResponse((r) => r.url().includes("/api/settings") && r.request().method() === "PUT");
      await page.reload();
      await expect(page.locator("#weather-effects-enabled")).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
      await expect(page.locator("#weather-effects-freezingAtC")).toHaveValue("-3");

      // Preview: snow on Home for a minute; the address loses the parameter.
      await page.getByTestId("weather-effect-preview-snow").click();
      await expect(overlay(page)).toHaveAttribute("data-effects", "snow", { timeout: 30_000 });
      await expect(overlay(page).locator("canvas")).toHaveCount(1);
      expect(page.url()).not.toContain("weather-preview");
      // Taps go to what is under it.
      expect(await tapReaches(page, "section[aria-label]")).toBe(true);

      // Frost and fog are still layers, and don't take taps either.
      await page.goto("/?weather-preview=freezing,fog,wind", { waitUntil: "domcontentloaded" });
      await expect(overlay(page)).toHaveAttribute("data-effects", "freezing,wind,fog", { timeout: 30_000 });
      await expect(page.locator(".weather-frost")).toHaveCount(1);
      await expect(page.locator(".weather-fog")).toHaveCount(1);
      expect(await tapReaches(page, "section[aria-label]")).toBe(true);

      // Reduced motion: the still layers stay, nothing moves.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/?weather-preview=snow,freezing,storm", { waitUntil: "domcontentloaded" });
      await expect(overlay(page)).toHaveAttribute("data-effects", "snow,storm,freezing", { timeout: 30_000 });
      await expect(page.locator(".weather-frost")).toHaveCount(1);
      await expect(overlay(page).locator("canvas")).toHaveCount(0);
      await expect(page.locator(".weather-storm")).toHaveCount(0);
    } finally {
      await deleteThrowawayFamily(page, familyId, familyName);
    }
  });
});
