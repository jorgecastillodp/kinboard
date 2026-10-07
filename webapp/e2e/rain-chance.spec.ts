import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { rainChanceShown } from "../src/lib/rain-chance";
import { codeOnly } from "./source-helpers";

/**
 * The forecast shows a day's chance of rain whatever it is, 0% included. The
 * widget left it out at 0%, so only the rainy days showed one. No stack;
 * weather-rain-chance-ui.spec.ts looks at the rendered widget.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

test("every figure is shown, a dry day's 0% included", () => {
  for (const chance of [0, 1, 20, 40, 41, 100]) expect(rainChanceShown(chance), String(chance)).toBe(true);
});

test("a day with no figure shows nothing, not a made-up 0%", () => {
  for (const missing of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(rainChanceShown(missing as number | null | undefined), String(missing)).toBe(false);
  }
  // A string is not a figure either, whatever it looks like.
  expect(rainChanceShown("20" as unknown as number)).toBe(false);
});

test("the widget and the detail view's day list ask this, not whether the chance is above 0", () => {
  const widget = codeOnly(read("src/components/widgets/weather.tsx"));
  expect(widget).toContain("const showRain = rainChanceShown(day.precipProbability);");
  expect(widget).not.toMatch(/showRain\s*=\s*day\.precipProbability\s*>\s*0/);
  // Still bold above 40%: the extra figures don't change how a wet day stands out.
  expect(widget).toContain("const isHighRain = day.precipProbability > 40;");

  const modal = codeOnly(read("src/components/widgets/weather-modal.tsx"));
  expect(modal).toContain("{rainChanceShown(day.precipProbability) ? (");
  expect(modal).not.toMatch(/day\.precipProbability\s*>\s*0\s*\?/);
  // The hourly strip is not days: it keeps listing only the hours that have a chance.
  expect(modal).toContain("{hour.precipProbability > 0 && (");
});
