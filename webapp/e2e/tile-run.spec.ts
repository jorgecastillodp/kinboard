import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { DANGEROUS_ACTIONS, dangerousAction } from "../src/lib/ha-dangerous-actions";
import { codeOnly } from "./source-helpers";

/**
 * A script or a scene runs from its tile on the Home automation page with one
 * tap. It used to have no control on the tile, so the only way was the detail
 * sheet: a dialog over the whole page (a camera in the same room included), and
 * a second tap. No stack; automation-layout.spec.ts drives the rendered tile.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const page = () => codeOnly(read("src/app/home-automation/page.tsx"));

test("running a script or a scene is not a confirmed action, so the tile's tap fires at once", () => {
  for (const domain of ["script", "scene"]) {
    expect(dangerousAction({ domain, service: "turn_on", entity_id: `${domain}.anything` }), domain).toBeUndefined();
    expect(Object.keys(DANGEROUS_ACTIONS).some((key) => key.startsWith(`${domain}.`)), domain).toBe(false);
  }
});

test("scripts and scenes get the run control; the rich domains stay sheet-only", () => {
  const src = page();
  expect(src).toContain('const RUN_DOMAINS = new Set(["script", "scene"]);');
  expect(src).toContain('if (RUN_DOMAINS.has(domain)) return "run";');
  // Asked after the sheet-only domains, so a media player can never pick it up.
  expect(src.indexOf("SHEET_ONLY_DOMAINS.has(domain)) return null;")).toBeLessThan(src.indexOf('if (RUN_DOMAINS.has(domain)) return "run";'));
});

test("the run button calls turn_on for the tile's own entity, through the page's runner", () => {
  const src = page();
  expect(src).toMatch(
    /onRun=\{\(entityId\) =>\s*run\(\s*entityId,\s*null,\s*\{ domain: domainOf\(entityId\), service: "turn_on", entity_id: entityId \},\s*item\.name\s*\)/,
  );
  // The runner reports whether the call went out, and the button waits for it.
  expect(src).toContain("return fired;");
  expect(src).toContain("const fired = await onRun(id);");
});

test("the button is a sibling of the tile's details button, live only with a reading, and answers on itself", () => {
  const src = page();
  expect(src).toContain('{entityId && inlineControl === "run" && (');
  expect(src).toContain('disabled={!canDrive || runPhase === "sending"}');
  expect(src).toContain('aria-busy={runPhase === "sending"}');
  expect(src).toMatch(/runPhase === "sending" \?\s*\(\s*<Loader2/);
  expect(src).toMatch(/runPhase === "done" \?\s*\(\s*<Check/);
  // A refused call goes back to ready, not to the tick.
  expect(src).toMatch(/if \(!fired\) \{\s*setRunPhase\("idle"\);\s*return;\s*\}/);
  expect(src).toContain('{t("entityDetail.activateButton")}');
});

test("the button's label exists in every language", () => {
  for (const locale of ["en", "de", "fr"]) {
    const messages = JSON.parse(read(`messages/${locale}.json`)) as { homeAutomation: { entityDetail: { activateButton?: string } } };
    expect(messages.homeAutomation.entityDetail.activateButton, locale).toBeTruthy();
  }
});
