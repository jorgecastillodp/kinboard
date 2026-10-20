import { test, expect, type Page } from "@playwright/test";
import { createThrowawayFamily, deleteThrowawayFamily, gotoAfterJoin } from "./throwaway-family";

/**
 * Repeating events, end to end on a running stack: a family of its own with
 * a local calendar, a weekly event made in the dialog, one occurrence changed
 * alone and then all of them, and the deletes. The rules themselves are in
 * the fast suite (event-repeat.spec.ts).
 */

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

/** A throwaway family with one local calendar, on the calendar page in week view. */
async function familyWithLocalCalendar(page: Page, baseURL: string | undefined, tag: string) {
  const familyName = `probe-family-repeat-${tag}-${Date.now()}`;
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const familyId = await createThrowawayFamily(page, familyName);
  await gotoAfterJoin(page, "/settings/local-calendars");
  await page.getByRole("button", { name: "Add calendar" }).first().click({ timeout: 30_000 });
  await page.locator("#local-calendar-name").fill("Probe calendar");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Probe calendar").first()).toBeVisible({ timeout: 15_000 });
  await page.goto("/calendar", { waitUntil: "domcontentloaded" });
  await page.getByRole("radio", { name: "Week" }).click({ timeout: 30_000 });
  return { familyId, familyName };
}

/** Make an event through the dialog, today 09:00–10:00, repeating as asked. */
async function addEvent(page: Page, title: string, repeat: string) {
  await page.getByRole("button", { name: "Event", exact: true }).click();
  await page.locator("#title").fill(title);
  await page.locator("#add-repeat").click();
  await page.getByRole("option", { name: repeat, exact: true }).click();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

const occurrence = (page: Page, title: string) => page.getByText(title, { exact: true }).first();

test.describe("calendar events repeat", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");
  test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  test.describe.configure({ timeout: 180_000 });

  test("a weekly event repeats; one occurrence changes alone, then every other one, then it stops", async ({ page, baseURL }) => {
    const family = await familyWithLocalCalendar(page, baseURL, "edit");
    try {
      await addEvent(page, "Probe weekly", "Weekly");
      await expect(occurrence(page, "Probe weekly")).toBeVisible({ timeout: 15_000 });

      // The details say how it repeats.
      await occurrence(page, "Probe weekly").click();
      await expect(page.getByText("Repeats weekly")).toBeVisible();
      await page.keyboard.press("Escape");

      // It is there next week, and the week after.
      await page.getByRole("button", { name: "Next" }).click();
      await expect(occurrence(page, "Probe weekly")).toBeVisible({ timeout: 15_000 });

      // This occurrence alone.
      await occurrence(page, "Probe weekly").click();
      await page.getByRole("button", { name: "Edit" }).click();
      await page.locator("#edit-title").fill("Probe moved");
      await page.getByRole("button", { name: "Save" }).click();
      await page.getByRole("button", { name: "This event" }).click();
      await expect(occurrence(page, "Probe moved")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Next" }).click();
      await expect(occurrence(page, "Probe weekly")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Probe moved", { exact: true })).toHaveCount(0);

      // Every occurrence, except the one whose title was changed alone.
      await occurrence(page, "Probe weekly").click();
      await page.getByRole("button", { name: "Edit" }).click();
      await page.locator("#edit-title").fill("Probe renamed");
      await page.getByRole("button", { name: "Save" }).click();
      await page.getByRole("button", { name: "All events" }).click();
      await expect(occurrence(page, "Probe renamed")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Previous" }).click();
      await expect(occurrence(page, "Probe moved")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Probe renamed", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Previous" }).click();
      await expect(occurrence(page, "Probe renamed")).toBeVisible({ timeout: 15_000 });
      // Far ahead too: a weekly series is kept more than a year ahead.
      for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "Next" }).click();
      await expect(occurrence(page, "Probe renamed")).toBeVisible({ timeout: 15_000 });

      // Stopping the repeat asks first; this one and the ones before it stay.
      await occurrence(page, "Probe renamed").click();
      await page.getByRole("button", { name: "Edit" }).click();
      await page.locator("#edit-repeat").click();
      await page.getByRole("option", { name: "Never", exact: true }).click();
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Stop repeating?")).toBeVisible();
      await page.getByRole("button", { name: "Stop repeating" }).click();
      await expect(page.getByText("Stop repeating?")).toHaveCount(0);
      await expect(occurrence(page, "Probe renamed")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.getByText("Probe renamed", { exact: true })).toHaveCount(0, { timeout: 15_000 });
      await page.getByRole("button", { name: "Previous" }).click();
      await page.getByRole("button", { name: "Previous" }).click();
      await expect(occurrence(page, "Probe renamed")).toBeVisible({ timeout: 15_000 });
    } finally {
      await deleteThrowawayFamily(page, family.familyId, family.familyName);
    }
  });

  test("deleting: this and the following occurrences, then the whole series", async ({ page, baseURL }) => {
    const family = await familyWithLocalCalendar(page, baseURL, "delete");
    try {
      await addEvent(page, "Probe series", "Weekly");
      await expect(occurrence(page, "Probe series")).toBeVisible({ timeout: 15_000 });

      // From two weeks on: gone there and after, still here and next week.
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Next" }).click();
      await occurrence(page, "Probe series").click({ timeout: 15_000 });
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("button", { name: "This and following events" }).click();
      await expect(page.getByText("Probe series", { exact: true })).toHaveCount(0, { timeout: 15_000 });
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.getByText("Probe series", { exact: true })).toHaveCount(0, { timeout: 15_000 });
      await page.getByRole("button", { name: "Previous" }).click();
      await page.getByRole("button", { name: "Previous" }).click();
      await expect(occurrence(page, "Probe series")).toBeVisible({ timeout: 15_000 });
      // The repeat now says where it ends.
      await occurrence(page, "Probe series").click();
      await expect(page.getByText(/Repeats weekly, until /)).toBeVisible();

      // The rest of it.
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("button", { name: "All events" }).click();
      await expect(page.getByText("Probe series", { exact: true })).toHaveCount(0, { timeout: 15_000 });
      await page.getByRole("button", { name: "Previous" }).click();
      await expect(page.getByText("Probe series", { exact: true })).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await deleteThrowawayFamily(page, family.familyId, family.familyName);
    }
  });
});
