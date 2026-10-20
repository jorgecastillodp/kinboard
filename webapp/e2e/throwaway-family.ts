/**
 * A household of its own for a stack test: created through the same call the
 * welcome screen makes, and deleted again afterwards. Shared by the specs that
 * need one (they were in automation-layout.spec.ts first).
 */
import type { Page } from "@playwright/test";

/**
 * A family of its own, with nothing configured on it.
 *
 * For a test that needs a household whose settings and data are known rather
 * than inherited (automation-layout.spec.ts, calendar-repeat.spec.ts). No
 * family a suite could otherwise reach qualifies — the CI demo family has a
 * `home_assistant` row pointing at the mock container and a developer's
 * family has real data — and writing to either would be a destructive edit
 * to state every other spec on this database shares.
 *
 * `POST /api/session/create` is the same call the welcome screen makes; the
 * cookies it leaves behind are the two `AuthGuard` gates on. Deleting the
 * family afterwards cascades its rooms, catalogue rows, settings and stored
 * secrets with it.
 *
 * The page must already be on the origin — `/join` — so `fetch` and
 * `document.cookie` have somewhere to run.
 */
export async function createThrowawayFamily(page: Page, familyName: string): Promise<string> {
  /*
    The route limits family creation to 5 per minute per IP — "nobody
    legitimately creates families in a loop", says the comment there, and it is
    right about households. The stack specs are the exception: every test that needs a
    known settings row makes its own, and once there were more than five of them
    the sixth started failing with a 429 that looked exactly like a broken
    seeding helper. So the limiter's own `Retry-After` is honoured rather than
    the limit relaxed — the rule is right and the test is the unusual caller.
  */
  for (let attempt = 0; ; attempt++) {
    const created: { id: string } | { error: string } | { retryAfterMs: number } =
      await page.evaluate(
      async ({ familyName, hardwareId }) => {
        const res = await fetch("/api/session/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ familyName, hardwareId, deviceName: familyName }),
        });
        if (res.status === 429) {
          return { retryAfterMs: (Number(res.headers.get("Retry-After")) || 10) * 1000 + 500 };
        }
        if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
        const data = await res.json();
        // The same two cookies a real join leaves behind: the session, set by
        // the route itself, and the client store `AuthGuard` gates on.
        const state = { state: { family: data.family, device: data.device }, version: 0 };
        document.cookie =
          "family-calendar-storage=" +
          encodeURIComponent(JSON.stringify(state)) +
          "; path=/; max-age=86400";
        return { id: data.family.id as string };
      },
      { familyName, hardwareId: `e2e-${familyName}` }
      );
    if ("id" in created) return created.id;
    if ("error" in created) throw new Error(`create family: ${created.error}`);
    if (attempt >= 2) throw new Error("create family: rate limited three times over");
    await page.waitForTimeout(created.retryAfterMs);
  }
}

/**
 * Take the throwaway family back out.
 *
 * Swallowed so it cannot mask a real failure, but never silent — a family
 * left behind here is a family left behind for ever.
 */
export async function deleteThrowawayFamily(
  page: Page,
  familyId: string,
  familyName: string
): Promise<void> {
  try {
    const status = await page.evaluate(
      async ({ familyId, familyName }) => {
        const res = await fetch("/api/family", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ family_id: familyId, confirm_name: familyName }),
        });
        return res.status;
      },
      { familyId, familyName }
    );
    if (status !== 200) {
      console.warn(
        `[throwaway-family] could not delete throwaway family ${familyId} ` +
          `(${familyName}): HTTP ${status}`
      );
    }
  } catch (error) {
    console.warn(
      `[throwaway-family] could not delete throwaway family ${familyId} ` +
        `(${familyName}): ${(error as Error).message}`
    );
  }
}

/**
 * Leave `/join`, which does not stay put once a family exists.
 *
 * `AuthGuard` moves `/join` on as soon as the app notices a session — into
 * `/setup` for a family that has not finished onboarding, which a
 * freshly-created one has not. It notices at an unpredictable moment after
 * `POST /api/session/create`, and if that lands while a `page.goto` is in
 * flight the goto fails outright:
 *
 *   page.goto: Navigation to "http://localhost:3000/home-automation" is
 *   interrupted by another navigation to "http://localhost:3000/setup"
 *
 * — seen once in WebKit here, and nothing to do with what either test is
 * guarding. One retry settles it: by the second attempt the redirect has
 * already happened and the page is on a path nothing wants to move.
 */
export async function gotoAfterJoin(page: Page, path: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      const interrupted = (error as Error).message.includes(
        "interrupted by another navigation"
      );
      if (!interrupted || attempt >= 2) throw error;
    }
  }
}
