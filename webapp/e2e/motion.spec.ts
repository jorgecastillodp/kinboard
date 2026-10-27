import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import {
  MOTION_INIT_SCRIPT,
  MOTION_PREFERENCES,
  MOTION_STORAGE_KEY,
  parseMotionPreference,
  resolveMotion,
  type MotionLevel,
} from "../src/lib/motion";
import { codeOnly } from "./source-helpers";

/**
 * One switch for every animation, per device (Settings → Theme → Animations):
 * a Raspberry Pi on the wall can't afford what a phone can, and its OS
 * reduced-motion setting is out of reach. lib/motion.ts resolves the choice
 * and the OS setting to <html data-motion>; everything that moves must ask
 * that, not the OS directly, or the switch won't reach it. No stack.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

test("the device's choice wins when it asks for less, and auto follows the OS", () => {
  const table: [string, boolean, MotionLevel][] = [
    ["auto", false, "full"],
    ["auto", true, "reduced"],
    ["reduced", false, "reduced"],
    ["reduced", true, "reduced"],
    ["off", false, "off"],
    ["off", true, "off"],
  ];
  for (const [pref, os, level] of table) {
    expect(resolveMotion(parseMotionPreference(pref), os), `${pref}/${os}`).toBe(level);
  }
  // A stored value from somewhere else is read as auto, not trusted.
  for (const junk of [null, "", "full", "OFF", "1", undefined]) {
    expect(parseMotionPreference(junk)).toBe("auto");
  }
});

test("the script that runs before first paint decides exactly as resolveMotion does", () => {
  const run = (stored: string | null, os: boolean, storageThrows = false) => {
    const attrs: Record<string, string> = {};
    const localStorage = {
      getItem: (key: string) => {
        if (storageThrows) throw new Error("SecurityError");
        return key === MOTION_STORAGE_KEY ? stored : null;
      },
    };
    const matchMedia = (q: string) => ({ matches: os && q === "(prefers-reduced-motion: reduce)" });
    const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
    new Function("localStorage", "matchMedia", "document", MOTION_INIT_SCRIPT)(localStorage, matchMedia, document);
    return attrs["data-motion"];
  };
  for (const stored of [...MOTION_PREFERENCES, null, "junk"]) {
    for (const os of [false, true]) {
      expect(run(stored, os), `${stored}/${os}`).toBe(resolveMotion(parseMotionPreference(stored), os));
    }
  }
  // Private mode: no storage, still an answer, and still the OS's.
  expect(run(null, true, true)).toBe("reduced");
  expect(run(null, false, true)).toBe("full");
});

test("the layout runs that script ahead of the app, and the provider keeps it and framer current", () => {
  const layout = codeOnly(read("src/app/layout.tsx"));
  expect(layout).toContain("<script dangerouslySetInnerHTML={{ __html: MOTION_INIT_SCRIPT }} />");
  expect(layout.indexOf("MOTION_INIT_SCRIPT }}")).toBeLessThan(layout.indexOf("<Providers>"));

  const provider = codeOnly(read("src/components/motion-provider.tsx"));
  expect(provider).toContain('document.documentElement.setAttribute("data-motion", level);');
  expect(provider).toContain('MotionGlobalConfig.skipAnimations = level === "off";');
  expect(provider).toContain('<MotionConfig reducedMotion={level === "full" ? "never" : "always"}>');

  // Wraps the whole app, the welcome screen included (outside AuthGuard).
  const providers = codeOnly(read("src/app/providers.tsx"));
  expect(providers.indexOf("<MotionProvider>")).toBeGreaterThan(-1);
  expect(providers.indexOf("<MotionProvider>")).toBeLessThan(providers.indexOf("<AuthGuard>"));
  expect(providers.indexOf("</MotionProvider>")).toBeGreaterThan(providers.indexOf("</AuthGuard>"));
});

test("nothing asks the OS about motion behind the switch's back", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(join(process.cwd(), "src"))) {
    const rel = relative(process.cwd(), file);
    if (rel === join("src", "lib", "motion.ts")) continue;
    const src = file.endsWith(".css") ? read(rel).replace(/\/\*[\s\S]*?\*\//g, "") : codeOnly(read(rel));
    const checks: [RegExp, string][] = [
      [/prefers-reduced-motion/, "asks the OS directly; use useMotion()/motionLevel() or :root:not([data-motion=\"full\"])"],
      [/\buseReducedMotion\b/, "framer's useReducedMotion only sees the OS; use useMotion()"],
      [/\bmotion-(reduce|safe):/, "Tailwind's motion-reduce: only sees the OS; use reduce-motion:"],
    ];
    for (const [re, why] of checks) if (re.test(src)) offenders.push(`${rel}: ${why}`);
  }
  expect(offenders).toEqual([]);
});

test("CSS that stands still for reduced motion keys off the device's level", () => {
  const css = read("src/app/globals.css");
  // The blanket rule every CSS animation and transition in the app falls under.
  expect(css).toMatch(
    /:root:not\(\[data-motion="full"\]\) \*,\s*:root:not\(\[data-motion="full"\]\) \*::before,\s*:root:not\(\[data-motion="full"\]\) \*::after \{\s*animation-duration: 0\.01ms !important;/,
  );
  const tailwind = read("tailwind.config.ts");
  expect(tailwind).toContain(`addVariant("reduce-motion", ':root:not([data-motion="full"]) &');`);
});

test("Settings → Theme offers the three choices, per device, and search finds them", () => {
  const page = codeOnly(read("src/app/settings/theme/page.tsx"));
  expect(page).toContain("const [motionPreference, setMotionPreference] = useMotionPreference();");
  expect(page).toContain('data-setting="animations"');
  expect(page).toContain("onClick={() => setMotionPreference(m)}");
  expect(MOTION_PREFERENCES).toEqual(["auto", "reduced", "off"]);

  const registry = read("src/lib/settings-search/registry.ts");
  expect(registry).toContain('{ anchor: "animations", labelKey: "settings.theme.motionLabel"');

  for (const lang of ["en", "de", "fr"]) {
    const messages = JSON.parse(read(`messages/${lang}.json`));
    const theme = messages.settings.theme;
    for (const key of ["motionLabel", "motion_auto", "motion_reduced", "motion_off", "motionHint"]) {
      expect(theme[key], `${lang}: ${key}`).toBeTruthy();
    }
    expect(messages.settingsSearch.keywords.theme_animations, lang).toBeTruthy();
  }
});
