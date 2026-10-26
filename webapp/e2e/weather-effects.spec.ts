import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_WEATHER_EFFECTS,
  WEATHER_EFFECTS,
  activeEffects,
  displayThreshold,
  normalizeWeatherEffects,
  parsePreview,
  storedThreshold,
  type WeatherEffectsSettings,
} from "../src/lib/weather-effects";
import { codeOnly } from "./source-helpers";

/**
 * Weather effects on Home: which effects the weather calls for (thresholds in
 * metric whatever the units, the condition, feels-like, each effect's own
 * switch), the stored setting read back safely, and how the overlay, the Home
 * page and Settings -> Weather fit together. No stack;
 * weather-effects-ui.spec.ts drives the real page.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const on: WeatherEffectsSettings = { ...DEFAULT_WEATHER_EFFECTS, enabled: true };
const mild = { temp: 15, feelsLike: 15, windSpeed: 5, conditionMain: "Clouds" };

test("off, or no weather: no effects", () => {
  expect(activeEffects(mild, DEFAULT_WEATHER_EFFECTS, "metric")).toEqual([]);
  expect(activeEffects({ ...mild, conditionMain: "Snow" }, DEFAULT_WEATHER_EFFECTS, "metric")).toEqual([]);
  expect(activeEffects(null, on, "metric")).toEqual([]);
  expect(activeEffects(mild, on, "metric")).toEqual([]);
});

test("the condition: snow, rain or drizzle, a storm (with its rain), mist, fog or haze", () => {
  const cases: Array<[string, string[]]> = [
    ["Snow", ["snow"]],
    ["Rain", ["rain"]],
    ["Drizzle", ["rain"]],
    ["Thunderstorm", ["rain", "storm"]],
    ["Mist", ["fog"]],
    ["Fog", ["fog"]],
    ["Haze", ["fog"]],
    ["Clear", []],
  ];
  for (const [conditionMain, expected] of cases) {
    expect(activeEffects({ ...mild, conditionMain }, on, "metric"), conditionMain).toEqual(expected);
  }
});

test("thresholds are metric whatever the units: freezing, heat and wind, at the threshold too", () => {
  expect(activeEffects({ ...mild, temp: 0 }, on, "metric")).toEqual(["freezing"]);
  expect(activeEffects({ ...mild, temp: 0.4 }, on, "metric")).toEqual([]);
  expect(activeEffects({ ...mild, temp: 32 }, on, "imperial")).toEqual(["freezing"]); // 32 °F = 0 °C
  expect(activeEffects({ ...mild, temp: 33 }, on, "imperial")).toEqual([]);
  expect(activeEffects({ ...mild, temp: 32 }, on, "metric")).toEqual(["heat"]);
  expect(activeEffects({ ...mild, temp: 90 }, on, "imperial")).toEqual(["heat"]); // 32.2 °C
  expect(activeEffects({ ...mild, temp: 89 }, on, "imperial")).toEqual([]);
  expect(activeEffects({ ...mild, windSpeed: 30 }, on, "metric")).toEqual(["wind"]);
  expect(activeEffects({ ...mild, temp: 60, windSpeed: 19 }, on, "imperial")).toEqual(["wind"]); // 30.6 km/h
  expect(activeEffects({ ...mild, temp: 60, windSpeed: 18 }, on, "imperial")).toEqual([]);
  // Together, in a fixed order.
  expect(activeEffects({ temp: -5, feelsLike: -12, windSpeed: 40, conditionMain: "Snow" }, on, "metric")).toEqual(["snow", "freezing", "wind"]);
});

test("feels like, when chosen; each effect switched off on its own", () => {
  const cold = { ...mild, temp: 3, feelsLike: -2 };
  expect(activeEffects(cold, on, "metric")).toEqual([]);
  expect(activeEffects(cold, { ...on, useFeelsLike: true }, "metric")).toEqual(["freezing"]);
  expect(activeEffects({ ...cold, feelsLike: undefined }, { ...on, useFeelsLike: true }, "metric")).toEqual([]);
  const storm = { ...mild, conditionMain: "Thunderstorm" };
  expect(activeEffects(storm, { ...on, effects: { ...on.effects, storm: false } }, "metric")).toEqual(["rain"]);
});

test("a stored value is read back whole and in bounds, whatever it holds", () => {
  expect(normalizeWeatherEffects(undefined)).toEqual(DEFAULT_WEATHER_EFFECTS);
  expect(normalizeWeatherEffects("nonsense")).toEqual(DEFAULT_WEATHER_EFFECTS);
  const read = normalizeWeatherEffects({ enabled: true, intensity: "loud", freezingAtC: -99, heatAtC: "hot", windAtKmh: 999, effects: { snow: false, rain: "yes" } });
  expect(read).toMatchObject({ enabled: true, intensity: "subtle", freezingAtC: -40, heatAtC: 32, windAtKmh: 150 });
  expect(read.effects).toEqual({ ...DEFAULT_WEATHER_EFFECTS.effects, snow: false });
});

test("thresholds are typed in the family's units and kept in metric", () => {
  expect(displayThreshold("freezingAtC", DEFAULT_WEATHER_EFFECTS, "imperial")).toBe(32);
  expect(displayThreshold("heatAtC", DEFAULT_WEATHER_EFFECTS, "imperial")).toBe(90);
  expect(displayThreshold("windAtKmh", DEFAULT_WEATHER_EFFECTS, "imperial")).toBe(19);
  expect(storedThreshold("freezingAtC", 28, "imperial")).toBe(-2.2);
  expect(storedThreshold("windAtKmh", 25, "imperial")).toBe(40.2);
  expect(storedThreshold("heatAtC", 30, "metric")).toBe(30);
  // A whole number typed comes back as the same whole number.
  for (const typed of [20, 28, 32, 35]) {
    const stored = storedThreshold("freezingAtC", typed, "imperial");
    expect(displayThreshold("freezingAtC", { ...DEFAULT_WEATHER_EFFECTS, freezingAtC: stored }, "imperial"), String(typed)).toBe(typed);
  }
  // Held to the bounds.
  expect(storedThreshold("windAtKmh", 1, "metric")).toBe(5);
  expect(storedThreshold("heatAtC", 200, "imperial")).toBe(55);
});

test("a preview names effects Kinboard has, and nothing else", () => {
  expect(parsePreview("snow,wind")).toEqual(["snow", "wind"]);
  expect(parsePreview("wind, snow ,lava")).toEqual(["snow", "wind"]);
  expect(parsePreview(null)).toEqual([]);
  expect(parsePreview("")).toEqual([]);
});

test("the overlay never takes a tap, stops when hidden or for reduced motion, and keeps a frame cap", () => {
  const overlay = codeOnly(read("src/components/weather-effects.tsx"));
  const layers = overlay.match(/className="[^"]*fixed inset-0[^"]*"/g) ?? [];
  expect(layers.length).toBe(6);
  for (const layer of layers) expect(layer, layer).toContain("pointer-events-none");
  expect(overlay).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
  expect(overlay).toContain("{!reducedMotion && moving.length > 0 && (");
  expect(overlay).toContain('{on.has("storm") && !reducedMotion && <StormGlow strength={strength} />}');
  expect(overlay).toContain("const onVisibility = () => (document.hidden ? stop() : start());");
  expect(overlay).toContain("if (t - last < FRAME_MS) return;");
  expect(overlay).toContain("const FRAME_MS = 1000 / 30;");
  expect(overlay.match(/const dpr = Math\.min\(window\.devicePixelRatio \|\| 1, 1\.5\);/g)?.length).toBe(2);
  // Lightning comes with the glow, and only in a storm.
  expect(overlay).toContain("window.dispatchEvent(new Event(LIGHTNING_EVENT));");
  expect(overlay).toContain("const onLightning = () => heavy && strike();");
  // The storm's glow is a slow brightening, never a flash.
  expect(overlay).toMatch(/}, 9_000 \+ Math\.random\(\) \* 11_000\);/);
  expect(overlay).toContain("transition-opacity duration-700");
  const css = read("src/app/globals.css");
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.weather-frost,\s*\.weather-heat,\s*\.weather-fog \{\s*animation: none;/);
});

test("Home draws it; Settings -> Weather sets it, findable in the settings search", () => {
  expect(codeOnly(read("src/app/page.tsx"))).toMatch(/<div className="page-gradient pointer-events-none fixed inset-0 z-0" \/>\s*<WeatherEffects \/>/);
  const page = codeOnly(read("src/app/settings/weather/page.tsx"));
  expect(page).toContain("<WeatherEffectsSettings units={unitSystem} />");
  const settings = codeOnly(read("src/components/settings/weather-effects-settings.tsx"));
  expect(settings).toContain('<Card id="effects" data-setting="effects" className="p-4">');
  expect(settings).toContain("await update.mutateAsync({ key: SETTINGS_KEYS.weatherEffects, value: next });");
  // Preview in place, over the settings page, not by sending the screen to Home.
  expect(settings).toContain("{previewing && <WeatherEffects key={previewing} preview={[previewing]} />}");
  expect(settings).not.toMatch(/weather-preview=/);
  // On Home, a preview outlives the redraw that taking it out of the address causes.
  const overlayCode = codeOnly(read("src/components/weather-effects.tsx"));
  expect(overlayCode).toContain("window.sessionStorage.setItem(PREVIEW_STORE, JSON.stringify({ effects: asked, until }));");
  expect(overlayCode).toMatch(/saved\.until > Date\.now\(\)/);
  expect(read("src/lib/settings-keys.ts")).toContain('weatherEffects: "weather_effects",');
  expect(read("src/lib/settings-search/registry.ts")).toContain('{ anchor: "effects", labelKey: "settings.weather.effectsLabel", descriptionKey: "settings.weather.effectsHint" },');
});

test("every string is there in every language", () => {
  const keys = (o: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const effectsKeys = (lang: string) => {
    const w = JSON.parse(read(`messages/${lang}.json`)).settings.weather;
    return keys(Object.fromEntries(Object.entries(w).filter(([k]) => k.startsWith("effect")))).sort();
  };
  const en = effectsKeys("en");
  expect(en).toEqual(expect.arrayContaining(WEATHER_EFFECTS.flatMap((e) => [`effectName.${e}`, `effectWhen.${e}`])));
  expect(effectsKeys("de")).toEqual(en);
  expect(effectsKeys("fr")).toEqual(en);
  for (const lang of ["en", "de", "fr"]) {
    expect(JSON.parse(read(`messages/${lang}.json`)).settingsSearch.keywords.weather_effects, lang).toBeTruthy();
  }
});
