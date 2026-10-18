import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { codeOnly } from "./source-helpers";

/**
 * The scanline look on a camera's tile is an option, off by default. It used to
 * be drawn over every camera tile with no way to turn it off, and people took
 * the lines for a fault in the picture. No stack.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

test("the overlay is drawn only for a camera that has the option ticked; a missing field is off", () => {
  const viewer = codeOnly(read("src/components/camera-viewer.tsx"));
  expect(viewer).toContain("const showScanlines = camera.scanlines === true;");
  const drawn = viewer.match(/\{[^{}]*<ScanlineOverlay \/>\}/g) ?? [];
  expect(drawn.length).toBe(4);
  for (const site of drawn) expect(site, site).toMatch(/^\{showScanlines && /);
  // The polled still gets the choice too.
  expect(viewer).toContain("showScanlines={showScanlines}");
  expect(viewer).toMatch(/function AutoRefreshSnapshot\(\{[^}]*showScanlines,/);
});

test("the camera form offers the switch, starts it off, reads it back on edit and saves it both ways", () => {
  const form = codeOnly(read("src/plugins/cameras/drivers/go2rtc.tsx"));
  expect(form).toContain("const [scanlines, setScanlines] = useState(false);");
  expect(form).toMatch(/setDoorbellId\(null\);\s*setScanlines\(false\);/);
  expect(form).toContain("setScanlines(camera.scanlines === true);");
  expect(form).toMatch(/doorbell_entity_id: doorbellId,\s*scanlines,\s*\},/);
  expect(form).toMatch(/doorbell_entity_id: doorbellId,\s*scanlines,\s*enabled: true,/);
  expect(form).toContain('id="camera-scanlines"');
  expect(form).toContain('checked={scanlines}');
  expect(form).toContain('{t("scanlinesLabel")}');
  expect(form).toContain('{t("scanlinesHint")}');
});

test("the camera type carries the option as optional", () => {
  expect(codeOnly(read("src/types/home-assistant.ts"))).toContain("scanlines?: boolean;");
});

test("the switch is worded in every language", () => {
  const en = (JSON.parse(read("messages/en.json")) as { settings: { cameras: Record<string, string> } }).settings.cameras;
  for (const locale of ["en", "de", "fr"]) {
    const cams = (JSON.parse(read(`messages/${locale}.json`)) as { settings: { cameras: Record<string, string> } }).settings.cameras;
    expect(cams.scanlinesLabel, locale).toBeTruthy();
    expect(cams.scanlinesHint, locale).toBeTruthy();
    if (locale !== "en") expect(cams.scanlinesHint, locale).not.toBe(en.scanlinesHint);
  }
});
