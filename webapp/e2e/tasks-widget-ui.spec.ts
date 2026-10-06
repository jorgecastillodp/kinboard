import { expect, test, type Locator, type Page } from "@playwright/test";
import { establishSession } from "./session";

/**
 * The Tasks widget on Home, against a running stack: a task due today is
 * under a Today label, its whole title is shown (wrapped, not cut off), the
 * row is the compact one, and a tap on the row ticks the task off. Needs
 * FAMILY_CODE.
 *
 * The task is created and deleted through the dialogs, so the spec needs no
 * database access. It is high priority and repeats daily, so it is open now
 * and ranks ahead of the demo family's own tasks in the widget's four rows.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// One device for the file, joined once: joining is limited to 10 a minute per
// IP and the smoke run already comes close (see session.ts).
test.describe.configure({ mode: "serial" });
const DEVICE = "tasks-widget-ui";

const NEW_TASK = /^(New task|Neue Aufgabe|Nouvelle tâche)$/;
const TITLE = /^(What needs to be done\?|Was muss erledigt werden\?|Que faut-il faire \?)$/;
const ONCE = /^(One-time|Einmalig|Unique)$/;
const DAILY = /^(Daily|Täglich|Quotidienne)$/;
const MEDIUM = /^(Medium|Mittel|Moyenne)$/;
const HIGH = /^(High|Hoch|Haute)$/;
const CREATE = /^(Create task|Aufgabe erstellen|Créer la tâche)$/;
const TASKS = /^(Tasks|Aufgaben|Tâches)$/;
const TODAY = /^(Today|Heute|Aujourd'hui)$/;

/** Opens a dialog by clicking `opener`; retried, as in todo-turns-ui.spec.ts. */
async function openDialog(page: Page, opener: Locator): Promise<Locator> {
  const dialog = page.getByRole("dialog");
  await expect(opener).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    if (!(await dialog.isVisible())) await opener.click({ timeout: 2_000 });
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return dialog;
}

async function createDailyHighTask(page: Page, title: string) {
  await page.goto("/todos", { waitUntil: "domcontentloaded" });
  const dialog = await openDialog(page, page.getByRole("button", { name: NEW_TASK }).first());
  await dialog.getByPlaceholder(TITLE).fill(title);
  await dialog.getByRole("combobox").filter({ hasText: MEDIUM }).click();
  await page.getByRole("option", { name: HIGH }).click();
  await dialog.getByRole("combobox").filter({ hasText: ONCE }).click();
  await page.getByRole("option", { name: DAILY }).click();
  await dialog.getByRole("button", { name: CREATE }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

async function tasksWidget(page: Page): Promise<Locator> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  const heading = page.getByRole("heading", { name: TASKS, level: 3 });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  return heading.locator("xpath=ancestor::*[contains(@class,'accent-border-top')][1]");
}

test("a task due today is under Today, shown in full on a compact row, and a tap on the row ticks it off", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await establishSession(page, familyCode!, DEVICE);
  await page.setViewportSize({ width: 1280, height: 900 });
  const title = `Whole title ${testInfo.project.name} ${Date.now()}: a long task name that has to wrap onto a second line to be read in full`;
  await createDailyHighTask(page, title);

  const widget = await tasksWidget(page);
  const label = widget.getByText(title, { exact: true });
  await expect(label).toBeVisible({ timeout: 15_000 });

  // Under a Today label, like the Events widget's day labels.
  const today = widget.getByText(TODAY);
  await expect(today).toBeVisible();
  const [todayBox, labelBox] = [await today.boundingBox(), await label.boundingBox()];
  expect(todayBox!.y).toBeLessThan(labelBox!.y);

  // The whole title: wrapped onto more than one line, and not clipped.
  const metrics = await label.evaluate((el) => {
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
    return { clipped: el.scrollWidth > el.clientWidth + 1, lines: Math.round(el.getBoundingClientRect().height / line), overflow: style.textOverflow };
  });
  expect(metrics.clipped).toBe(false);
  expect(metrics.overflow).not.toBe("ellipsis");
  expect(metrics.lines).toBeGreaterThanOrEqual(2);

  // The compact row, not the 52px one: the row's own minimum height.
  const row = label.locator("xpath=ancestor::div[contains(@class,'elev-sm')][1]");
  expect(await row.evaluate((el) => getComputedStyle(el).minHeight)).toBe("40px");

  // A tap on the title ticks it off: a daily task done today is not open, so it leaves the widget.
  await label.click();
  await expect(widget.getByText(title, { exact: true })).toHaveCount(0, { timeout: 15_000 });

  // The task is still there, done for today: delete it, as a person would.
  await page.goto("/todos", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: `Delete ${title}` }).click();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0, { timeout: 15_000 });
});
