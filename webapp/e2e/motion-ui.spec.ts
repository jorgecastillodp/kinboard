import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * The per-device animation switch on a running stack: Settings → Theme →
 * Animations takes effect at once, is there from the first paint after a
 * reload, stays on this device, and "On" still gives way to the OS asking
 * for reduced motion. Needs FAMILY_CODE.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
test.describe.configure({ mode: "serial" });
const DEVICE = "motion-ui";

test.afterAll(() => {
  execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c",
      `DELETE FROM devices WHERE hardware_id = 'e2e-${DEVICE}'`],
    { encoding: "utf8" },
  );
});

const level = (page: Page) => page.evaluate(() => document.documentElement.dataset.motion);

// What a CSS animation on this page actually runs for: the blanket rule
// in globals.css turns every one into 0.01ms when motion is reduced or off.
const spinDuration = (page: Page) =>
  page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "animate-spin";
    document.body.appendChild(el);
    const d = getComputedStyle(el).animationDuration;
    el.remove();
    return d;
  });

async function openTheme(page: Page) {
  await page.goto("/settings/theme", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Reduced", exact: true })).toBeVisible({ timeout: 20_000 });
}

test("Off applies at once, survives a reload from the first paint, and On brings motion back", async ({ page }) => {
  await establishSession(page, familyCode!, DEVICE);
  await openTheme(page);
  await page.evaluate(() => localStorage.removeItem("kinboard_motion"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "On", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  expect(await level(page)).toBe("full");
  expect(await spinDuration(page)).toBe("1s");

  await page.getByRole("button", { name: "Off", exact: true }).click();
  await expect.poll(() => level(page)).toBe("off");
  expect(await spinDuration(page)).not.toBe("1s");
  expect(await page.evaluate(() => localStorage.getItem("kinboard_motion"))).toBe("off");

  // Decided by the inline script while the document is still being parsed,
  // so before React or any stylesheet-driven animation can start.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      const w = window as unknown as { __firstMotion?: [string | undefined, string] };
      w.__firstMotion = [document.documentElement.dataset.motion, document.readyState];
      observer.disconnect();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-motion"] });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => (window as unknown as { __firstMotion?: unknown }).__firstMotion)).toEqual([
    "off",
    "loading",
  ]);
  await expect(page.getByRole("button", { name: "Off", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });

  await page.getByRole("button", { name: "Reduced", exact: true }).click();
  await expect.poll(() => level(page)).toBe("reduced");
  await page.getByRole("button", { name: "On", exact: true }).click();
  await expect.poll(() => level(page)).toBe("full");
  expect(await spinDuration(page)).toBe("1s");
});

test("On still follows the OS asking for reduced motion; Off stays off either way", async ({ page }) => {
  await establishSession(page, familyCode!, DEVICE);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTheme(page);
  await page.getByRole("button", { name: "On", exact: true }).click();
  await expect.poll(() => level(page)).toBe("reduced");

  // The OS changing its mind reaches an open page without a reload.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => level(page)).toBe("full");

  await page.getByRole("button", { name: "Off", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => level(page)).toBe("off");
  await page.evaluate(() => localStorage.removeItem("kinboard_motion"));
});
