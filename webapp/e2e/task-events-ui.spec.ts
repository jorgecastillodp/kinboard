import { expect, test, type Locator, type Page } from "@playwright/test";
import { establishSession } from "./session";

/**
 * "Show under Events on Home" in a task's dialog, against a running stack: a
 * task flagged there is listed in the Events widget, the dialog remembers the
 * flag when the task is opened again, taking it off removes the entry, and a
 * task that was never flagged is not listed. Needs FAMILY_CODE.
 *
 * Everything goes through the dialogs, as a person does it, and the tasks are
 * deleted the same way, so the spec needs no database access.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// One device for the file, joined once: joining is limited to 10 a minute per
// IP and the smoke run already comes close (see session.ts).
test.describe.configure({ mode: "serial" });
const DEVICE = "task-events-ui";

const NEW_TASK = /^(New task|Neue Aufgabe|Nouvelle tâche)$/;
const TITLE = /^(What needs to be done\?|Was muss erledigt werden\?|Que faut-il faire \?)$/;
const CREATE = /^(Create task|Aufgabe erstellen|Créer la tâche)$/;
const SAVE = /^(Save|Speichern|Enregistrer)$/;
const SHOW_IN_EVENTS = /^(Show under Events on Home|Auf Home unter Termine zeigen|Afficher sous Événements sur l'accueil)$/;
const EVENTS = /^(Events|Termine|Événements)$/;

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

async function createTask(page: Page, title: string, inEvents: boolean) {
  await page.goto("/todos", { waitUntil: "domcontentloaded" });
  const dialog = await openDialog(page, page.getByRole("button", { name: NEW_TASK }).first());
  await dialog.getByPlaceholder(TITLE).fill(title);
  const flag = dialog.getByRole("checkbox", { name: SHOW_IN_EVENTS });
  // Off to begin with: nothing changes for a task that is not flagged.
  await expect(flag).not.toBeChecked();
  // The checkbox is drawn over its input: tap its label, as a person does.
  if (inEvents) await dialog.getByText(SHOW_IN_EVENTS).click();
  await expect(flag).toBeChecked({ checked: inEvents });
  await dialog.getByRole("button", { name: CREATE }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

/** The Events widget's card on Home, once Home has loaded. */
async function eventsWidget(page: Page): Promise<Locator> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hero-block", { timeout: 20_000 });
  const heading = page.getByRole("heading", { name: EVENTS, level: 3 });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  return heading.locator("xpath=ancestor::*[contains(@class,'accent-border-top')][1]");
}

async function deleteTask(page: Page, title: string) {
  await page.goto("/todos", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: `Delete ${title}` }).click();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0, { timeout: 15_000 });
}

test("a flagged task is listed under Events on Home, remembered by its dialog, and leaves when the flag comes off", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await establishSession(page, familyCode!, DEVICE);
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const flagged = `Events flag ${stamp}`;
  const plain = `Events plain ${stamp}`;

  await createTask(page, plain, false);
  await createTask(page, flagged, true);

  // Home: the flagged one is among the Events (a task has no date here, so it
  // is listed under Today); the one that was never flagged is not.
  let widget = await eventsWidget(page);
  await expect(widget.getByText(`✓ ${flagged}`)).toBeVisible({ timeout: 15_000 });
  await expect(widget.getByText(`✓ ${plain}`)).toHaveCount(0);

  // The dialog remembers the flag; taking it off and saving removes the entry.
  await page.goto("/todos", { waitUntil: "domcontentloaded" });
  const dialog = await openDialog(page, page.getByText(flagged, { exact: true }).first());
  await expect(dialog.getByRole("checkbox", { name: SHOW_IN_EVENTS })).toBeChecked();
  await dialog.getByText(SHOW_IN_EVENTS).click();
  await expect(dialog.getByRole("checkbox", { name: SHOW_IN_EVENTS })).not.toBeChecked();
  await dialog.getByRole("button", { name: SAVE }).click();
  await expect(dialog).toBeHidden();

  widget = await eventsWidget(page);
  await expect(widget.getByText(`✓ ${flagged}`)).toHaveCount(0, { timeout: 15_000 });

  // Flagged again from the edit dialog: back among the Events.
  await page.goto("/todos", { waitUntil: "domcontentloaded" });
  const again = await openDialog(page, page.getByText(flagged, { exact: true }).first());
  await expect(again.getByRole("checkbox", { name: SHOW_IN_EVENTS })).not.toBeChecked();
  await again.getByText(SHOW_IN_EVENTS).click();
  await again.getByRole("button", { name: SAVE }).click();
  await expect(again).toBeHidden();
  widget = await eventsWidget(page);
  await expect(widget.getByText(`✓ ${flagged}`)).toBeVisible({ timeout: 15_000 });

  await deleteTask(page, flagged);
  await deleteTask(page, plain);
});
