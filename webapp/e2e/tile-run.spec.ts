import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { DANGEROUS_ACTIONS, dangerousAction } from "../src/lib/ha-dangerous-actions";
import { codeOnly } from "./source-helpers";

/**
 * A script or a scene runs from its tile on the Home automation page. It used
 * to have no control on the tile, so the only way was the detail sheet: a
 * dialog over the whole page (a camera in the same room included). By default
 * the tile's button asks for a second tap, so a stray one can't open a gate;
 * the household can switch that off. No stack; automation-layout.spec.ts
 * drives the rendered tile.
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
  expect(src).toContain('{runPhase === "armed" ? t("tapAgain") : t("entityDetail.activateButton")}');
});

test("by default a first tap only arms the button for a moment and a second runs it; the household can switch that off", () => {
  const src = page();
  expect(src).toContain("const RUN_ARM_MS = 3_000;");
  // Missing means on.
  expect(src).toContain("const runTapTwice = settings?.tile_run_tap_twice !== false;");
  expect(src).toContain("runTapTwice={runTapTwice}");
  expect(src).toMatch(
    /if \(runTapTwice && runPhase !== "armed"\) \{\s*setRunPhase\("armed"\);\s*doneTimer\.current = setTimeout\(\(\) => setRunPhase\("idle"\), RUN_ARM_MS\);\s*return;\s*\}\s*void runNow\(id\);/,
  );
  expect(src).toContain("onClick={() => tapRun(entityId)}");
  // Armed, the button stands out.
  expect(src).toContain('variant={runPhase === "armed" ? "default" : "outline"}');
  const settings = codeOnly(read("src/app/settings/homeassistant/page.tsx"));
  expect(settings).toContain('<Card id="tile-run" data-setting="tile-run">');
  expect(settings).toContain("checked={settings?.tile_run_tap_twice !== false}");
  expect(settings).toContain(".mutateAsync({ tile_run_tap_twice: on })");
  expect(codeOnly(read("src/lib/settings-search/registry.ts"))).toContain('{ anchor: "tile-run", labelKey: "settings.homeassistant.tileRunHeading" }');
});

test("the button's labels and the setting are worded in every language", () => {
  for (const locale of ["en", "de", "fr"]) {
    const messages = JSON.parse(read(`messages/${locale}.json`));
    expect(messages.homeAutomation.entityDetail.activateButton, locale).toBeTruthy();
    expect(messages.homeAutomation.tapAgain, locale).toBeTruthy();
    for (const key of ["tileRunHeading", "tileRunLabel", "tileRunHint", "tileRunSaveFailed"]) {
      expect(messages.settings.homeassistant[key], `${locale} ${key}`).toBeTruthy();
    }
    expect(messages.settingsSearch.keywords["homeassistant_tile-run"], locale).toBeTruthy();
  }
});
