import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every neutral palette leaned warm -- Sand and Warm grey toward brown,
 * Salbei toward olive -- so dark mode had no option that read as black.
 * Graphite is the untinted one. These pin what makes it that, and that it
 * stays readable.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const hook = readFileSync(join(process.cwd(), "src/hooks/use-theme-settings.ts"), "utf8");
const themePage = readFileSync(join(process.cwd(), "src/app/settings/theme/page.tsx"), "utf8");

/** The custom properties of one rule, by exact selector (".dark.palette-x" is not ".palette-x"). */
function tokens(selector: string): Record<string, string> {
  const escaped = selector.replace(/\./g, "\\.");
  const match = new RegExp(`(^|\\s)${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  expect(match, `${selector} is defined in globals.css`).not.toBeNull();
  return Object.fromEntries(
    [...match![2].matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

/** WCAG relative luminance of an "H S% L%" token. */
function luminance(hsl: string): number {
  const [h, s, l] = hsl.replace(/%/g, "").split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const selector of [".palette-graphite", ".dark.palette-graphite"]) {
  test(`${selector} has no tint in any surface or text token`, () => {
    const t = tokens(selector);
    const hsl = Object.entries(t).filter(([k]) => k !== "shadow-rgb");
    expect(hsl.length).toBeGreaterThan(10);
    for (const [key, value] of hsl) {
      expect(value, `--${key}`).toMatch(/^0 0% \d+(\.\d+)?%$/);
    }
  });

  test(`${selector} keeps its text readable on its surfaces`, () => {
    const t = tokens(selector);
    for (const surface of ["background", "card", "secondary"]) {
      expect(contrast(t.foreground, t[surface]), `foreground on ${surface}`).toBeGreaterThanOrEqual(7);
      for (const text of ["muted-foreground", "label-foreground"]) {
        expect(contrast(t[text], t[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}

test("every palette class the app can apply is one it removes, and has light and dark rules", () => {
  const applied = [...hook.matchAll(/:\s*"(palette-[a-z]+)"/g)].map((m) => m[1]);
  const removable = /ALL_PALETTE_CLASSES = \[([^\]]*)\]/.exec(hook)?.[1] ?? "";
  expect(applied).toContain("palette-graphite");
  for (const cls of applied) {
    expect(removable, `${cls} is in ALL_PALETTE_CLASSES`).toContain(`"${cls}"`);
    tokens(`.${cls}`);
    tokens(`.dark.${cls}`);
  }
  // The Design page used to keep its own copy of that list; a palette missing
  // from the copy stayed on the page after switching away from it.
  expect(themePage).toContain("classList.remove(...ALL_PALETTE_CLASSES)");
});
