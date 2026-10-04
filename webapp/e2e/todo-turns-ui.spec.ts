import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { acquireWholeDatabase, dbContainer, releaseWholeDatabase } from "./whole-database";

/**
 * The task dialogs with Take turns ticked and nobody picked (#341): Create
 * and Save stay disabled, rather than quietly saving a task that does not
 * take turns. Needs FAMILY_CODE and a running stack.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
// One device for the file, joined once: joining is limited to 10 a minute per
// IP and the smoke run already comes close (see session.ts), so the tests run
// in one worker, share it, and it is removed after the last of them.
test.describe.configure({ mode: "serial" });
const DEVICE = "todo-turns-ui";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

const NEW_TASK = /^(New task|Neue Aufgabe|Nouvelle tâche)$/;
const TITLE = /^(What needs to be done\?|Was muss erledigt werden\?|Que faut-il faire \?)$/;
const ONCE = /^(One-time|Einmalig|Unique)$/;
const DAILY = /^(Daily|Täglich|Quotidienne)$/;
const TAKE_TURNS = /^(Take turns|Abwechseln|Chacun son tour)$/;
const CREATE = /^(Create task|Aufgabe erstellen|Créer la tâche)$/;
const SAVE = /^(Save|Speichern|Enregistrer)$/;
const ADD = /^(Add a person to the turns|Person zum Wechsel hinzufügen|Ajouter une personne aux tours)$/;
const REMOVE = /^(Take .+ out of the turns|.+ aus dem Wechsel nehmen|Retirer .+ des tours)$/;

let familyId = "";
let todoId = "";
test.beforeEach(async () => {
  await acquireWholeDatabase();
  familyId = psql(`SELECT id FROM families WHERE join_code = '${familyCode}'`);
});
test.afterEach(() => {
  try {
    if (todoId) {
      psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
            DELETE FROM todo_events WHERE todo_id = '${todoId}'; DELETE FROM todos WHERE id = '${todoId}';`);
    }
    todoId = "";
  } finally {
    releaseWholeDatabase();
  }
});
test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    // Only this spec's device: other specs keep their sessions.
    psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE}%'`);
  } finally {
    releaseWholeDatabase();
  }
});

/**
 * Opens a dialog by clicking `opener`. Retried: under `next dev` the first
 * click can land on a page about to be remounted while other routes compile.
 * Inert against the CI build.
 */
async function openDialog(page: Page, opener: Locator): Promise<Locator> {
  const dialog = page.getByRole("dialog");
  await expect(opener).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    if (!(await dialog.isVisible())) await opener.click({ timeout: 2_000 });
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return dialog;
}

test("Create task stays disabled while Take turns has nobody picked", async ({ page }) => {
  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/todos", { waitUntil: "domcontentloaded" });
  const dialog = await openDialog(page, page.getByRole("button", { name: NEW_TASK }).first());
  await dialog.getByPlaceholder(TITLE).fill("Turns check");
  await dialog.getByRole("combobox").filter({ hasText: ONCE }).click();
  await page.getByRole("option", { name: DAILY }).click();
  const create = dialog.getByRole("button", { name: CREATE });
  await expect(create).toBeEnabled();

  // The checkbox is drawn over its input: tap its label, as a person does.
  await dialog.getByText(TAKE_TURNS).click();
  await expect(dialog.getByRole("checkbox", { name: /Take turns|Abwechseln|Chacun son tour/ })).toBeChecked();
  await expect(create).toBeDisabled();
  // Someone picked: it can be created. Taken out again: it cannot.
  await dialog.getByRole("group", { name: ADD }).getByRole("button").first().click();
  await expect(create).toBeEnabled();
  await dialog.getByRole("button", { name: REMOVE }).first().click();
  await expect(create).toBeDisabled();
  // Take turns off again: a plain daily task can be created.
  await dialog.getByText(TAKE_TURNS).click();
  await expect(create).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(psql(`SELECT count(*) FROM todos WHERE family_id = '${familyId}' AND title = 'Turns check'`)).toBe("0");
});

test("Save stays disabled when everyone is taken out of a task's turns", async ({ page }) => {
  const person = psql(`SELECT id FROM people WHERE family_id = '${familyId}' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`);
  expect(person, "the demo family has people").toMatch(/^[0-9a-f-]{36}$/);
  todoId = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids)
    VALUES ('${familyId}', 'Turns check (edit)', 'daily', ARRAY['${person}']::uuid[]) RETURNING id`);
  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/todos", { waitUntil: "domcontentloaded" });
  const dialog = await openDialog(page, page.getByText("Turns check (edit)", { exact: true }).first());
  const save = dialog.getByRole("button", { name: SAVE });
  await expect(save).toBeEnabled();
  await dialog.getByRole("button", { name: REMOVE }).first().click();
  await expect(save).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Nothing was saved: the task still takes turns.
  expect(psql(`SELECT cardinality(rotation_person_ids) FROM todos WHERE id = '${todoId}'`)).toBe("1");
});
