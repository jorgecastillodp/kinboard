import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_BEDTIME, creatureMood, formatClock, isSleepyTime, parseClock, readBedtime } from "../src/lib/creature-mood";
import {
  HOP_MS,
  PLAY_MS,
  bedSpots,
  bounds,
  placeRoamers,
  poke,
  pose,
  stepRoamers,
  type Roamer,
  type World,
} from "../src/lib/creatures/roam";
import { codeOnly } from "./source-helpers";

/**
 * Creatures on Home: the family's bedtime (lib/creature-mood.ts) and how the
 * creatures walk, play, hop and sleep (lib/creatures/roam.ts), driven step by
 * step with a seeded random source; and how Home, the settings page and the
 * mood hook fit together. creatures-on-home-ui.spec.ts drives the real page.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const at = (hhmm: string) => new Date(`2026-11-05T${hhmm}:00Z`);

/** A small seeded generator, so a run is the same every time. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run the floor for `ms`, 33 ms a step; every step's creatures and events. */
function run(start: Roamer[], world: Omit<World, "now">, ms: number, seed = 7, t0 = 0) {
  const rng = seeded(seed);
  let roamers = start;
  const frames: Roamer[][] = [];
  const events = [];
  for (let now = t0; now < t0 + ms; now += 33) {
    const out = stepRoamers(roamers, { ...world, now }, 33, rng);
    roamers = out.roamers;
    events.push(...out.events);
    frames.push(roamers);
  }
  return { roamers, frames, events };
}

const floor = { width: 1200, size: 80, sleeping: new Set<string>() };
const two = () => placeRoamers([{ id: "a", egg: false }, { id: "b", egg: false }], { ...floor, now: 0 });

test("bedtime: 20:00 to 06:30 unless chosen, across midnight or within a day, and none when both are the same", () => {
  expect(DEFAULT_BEDTIME).toEqual({ sleep: 20 * 60, wake: 6 * 60 + 30 });
  expect(isSleepyTime(at("19:59"), "UTC")).toBe(false);
  expect(isSleepyTime(at("20:00"), "UTC")).toBe(true);
  expect(isSleepyTime(at("06:29"), "UTC")).toBe(true);
  expect(isSleepyTime(at("06:30"), "UTC")).toBe(false);
  const late = { sleep: parseClock("21:30")!, wake: parseClock("07:15")! };
  expect(isSleepyTime(at("21:00"), "UTC", late)).toBe(false);
  expect(isSleepyTime(at("23:59"), "UTC", late)).toBe(true);
  expect(isSleepyTime(at("07:00"), "UTC", late)).toBe(true);
  expect(isSleepyTime(at("07:15"), "UTC", late)).toBe(false);
  const nap = { sleep: parseClock("13:00")!, wake: parseClock("15:00")! };
  expect(isSleepyTime(at("12:59"), "UTC", nap)).toBe(false);
  expect(isSleepyTime(at("14:00"), "UTC", nap)).toBe(true);
  expect(isSleepyTime(at("15:00"), "UTC", nap)).toBe(false);
  expect(isSleepyTime(at("03:00"), "UTC", { sleep: 600, wake: 600 })).toBe(false);
  // In the family's zone: 20:00 UTC is 21:00 in Berlin in November.
  expect(isSleepyTime(at("19:30"), "Europe/Berlin", { sleep: parseClock("20:30")!, wake: parseClock("06:00")! })).toBe(true);
  // The mood follows it.
  expect(creatureMood({ personId: "p", tasks: [], now: at("14:00"), timeZone: "UTC", bedtime: nap })).toBe("sleepy");
  expect(creatureMood({ personId: "p", tasks: [], now: at("21:00"), timeZone: "UTC", bedtime: nap })).toBe("normal");
});

test("the stored bedtime is read whole and valid, or it is the default", () => {
  expect(readBedtime({ sleep: "21:30", wake: "07:15" })).toEqual({ sleep: 21 * 60 + 30, wake: 7 * 60 + 15 });
  for (const bad of [null, "21:30", { sleep: "25:00", wake: "07:00" }, { sleep: "21:30" }, { sleep: "9:30", wake: "07:00" }]) {
    expect(readBedtime(bad), JSON.stringify(bad)).toEqual(DEFAULT_BEDTIME);
  }
  expect(formatClock(0)).toBe("00:00");
  expect(formatClock(23 * 60 + 59)).toBe("23:59");
  expect(formatClock(-30)).toBe("23:30");
  expect(parseClock(" 06:05 ")).toBe(365);
});

test("on the floor: each at its own spot, and never past either end however long they walk", () => {
  expect(bedSpots(3, 1200)).toEqual([300, 600, 900]);
  const placed = placeRoamers(
    [{ id: "a", egg: false }, { id: "b", egg: false }, { id: "c", egg: false }],
    { ...floor, now: 0 },
  );
  expect(placed.map((r) => r.x)).toEqual([300, 600, 900]);
  const [lo, hi] = bounds(floor);
  const { frames } = run(placed, floor, 120_000);
  for (const f of frames) for (const r of f) expect(r.x >= lo && r.x <= hi, `${r.id} at ${r.x}`).toBe(true);
  // They do walk: each one has been somewhere else.
  for (const id of ["a", "b", "c"]) {
    const xs = frames.map((f) => f.find((r) => r.id === id)!.x);
    expect(Math.max(...xs) - Math.min(...xs), id).toBeGreaterThan(100);
  }
});

test("a floor that shrinks (the screen turned): every creature is back on it at once", () => {
  const wide = placeRoamers(
    [{ id: "a", egg: false }, { id: "b", egg: false }, { id: "c", egg: false }],
    { ...floor, now: 0 },
  );
  const narrow = { ...floor, width: 500 };
  const [lo, hi] = bounds(narrow);
  const { roamers } = stepRoamers(wide, { ...narrow, now: 0 }, 33, seeded(1));
  for (const r of roamers) expect(r.x >= lo && r.x <= hi, `${r.id} at ${r.x}`).toBe(true);
});

test("an egg stays at its spot and wobbles; it never walks, plays or sleeps on its side", () => {
  const start = placeRoamers([{ id: "egg", egg: true }, { id: "b", egg: false }], { ...floor, now: 0 });
  const { frames } = run(start, floor, 60_000);
  for (const f of frames) {
    const e = f.find((r) => r.id === "egg")!;
    expect(e.state).toBe("egg");
    expect(e.x).toBe(400);
    expect(e.partner).toBeNull();
  }
  const egg = frames[0].find((r) => r.id === "egg")!;
  expect(Math.abs(pose({ ...egg, since: 0 }, 300, 80).tilt)).toBeGreaterThan(0);
  const asleep = run(start, { ...floor, sleeping: new Set(["egg", "b"]) }, 5_000).roamers.find((r) => r.id === "egg")!;
  expect(asleep.state).toBe("egg");
});

test("two or more: they find each other and play, with hearts, and only with a free friend", () => {
  const { frames, events } = run(two(), floor, 180_000, 3);
  const playing = frames.filter((f) => f.every((r) => r.state === "play"));
  expect(playing.length).toBeGreaterThan(0);
  const f = playing[0];
  // Facing each other, close together.
  const [a, b] = f;
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(80 * 0.8);
  expect(a.dir).toBe(a.x < b.x ? 1 : -1);
  expect(b.dir).toBe(b.x < a.x ? 1 : -1);
  expect(a.partner).toBe("b");
  expect(events.some((e) => e.kind === "hearts")).toBe(true);
  // A game ends: nobody plays for ever.
  const longest = Math.max(...frames.map((_, i) => {
    let n = 0;
    while (frames[i + n]?.[0].state === "play") n++;
    return n;
  }));
  expect(longest * 33).toBeLessThanOrEqual(PLAY_MS + 200);
  // Alone, nobody to play with.
  const alone = run(placeRoamers([{ id: "a", egg: false }], { ...floor, now: 0 }), floor, 120_000, 3);
  expect(alone.frames.some((fr) => fr[0].state === "play" || fr[0].state === "approach")).toBe(false);
});

test("bedtime: each walks to its own spot and lies down; in the morning it gets up and goes on", () => {
  const night = { ...floor, sleeping: new Set(["a", "b"]) };
  const awake = run(two(), floor, 20_000, 5).roamers;
  const { roamers } = run(awake, night, 60_000, 5, 20_000);
  const beds = bedSpots(2, 1200);
  roamers.forEach((r, i) => {
    expect(r.state).toBe("asleep");
    expect(r.x).toBe(beds[i]);
    expect(r.partner).toBeNull();
    expect(pose(r, 90_000, 80).lying).toBe(true);
  });
  // Still asleep however long the night.
  expect(run(roamers, night, 30_000, 5, 80_000).roamers.every((r) => r.state === "asleep")).toBe(true);
  // Morning: up, then about their day.
  const morning = run(roamers, floor, 1_000, 5, 110_000).roamers;
  expect(morning.every((r) => r.state === "waking")).toBe(true);
  const later = run(morning, floor, 20_000, 5, 111_000).frames;
  expect(later.some((f) => f.some((r) => r.state === "walk"))).toBe(true);
});

test("a tap: an awake creature hops with hearts and leaves its game; one asleep stays asleep with one heart", () => {
  const playing = run(two(), floor, 180_000, 3).frames.find((f) => f.every((r) => r.state === "play"))!;
  const tapped = poke(playing, "a", 1000);
  const a = tapped.roamers.find((r) => r.id === "a")!;
  const b = tapped.roamers.find((r) => r.id === "b")!;
  expect(a.state).toBe("hop");
  expect(a.until).toBe(1000 + HOP_MS);
  expect(a.partner).toBeNull();
  expect(b.partner).toBeNull();
  expect(b.state).toBe("idle");
  expect(tapped.events).toEqual([{ kind: "hearts", x: a.x, count: 5 }]);
  expect(pose(a, 1000 + HOP_MS / 2, 80).lift).toBeGreaterThan(20);
  const asleep = run(two(), { ...floor, sleeping: new Set(["a", "b"]) }, 10_000).roamers;
  const tappedAsleep = poke(asleep, "a", 20_000);
  expect(tappedAsleep.roamers.find((r) => r.id === "a")!.state).toBe("asleep");
  expect(tappedAsleep.events).toEqual([{ kind: "hearts", x: asleep[0].x, count: 1 }]);
  // The input is left as it was.
  expect(playing.find((r) => r.id === "a")!.state).toBe("play");
});

test("Home: off unless switched on, gone with animations off, still with reduced; cheap to draw, and only a creature takes a tap", () => {
  expect(codeOnly(read("src/app/page.tsx"))).toMatch(/<WeatherEffects \/>\s*<CreaturesOnHome \/>/);
  const home = codeOnly(read("src/components/creatures-on-home.tsx"));
  expect(home).toContain('if (on !== true || motion === "off" || kids.length === 0) return null;');
  expect(home).toContain('return <CreatureFloor kids={kids} still={motion !== "full"} />;');
  expect(home).toContain("const FRAME_MS = 1000 / 30;");
  expect(home).toContain("const onVisibility = () => (document.hidden ? stop() : start());");
  expect(home).toContain('className="creature-floor pointer-events-none fixed inset-x-0 z-[15]"');
  expect(home).toContain('style={{ bottom: "var(--nav-spacing, 0px)", height: Math.round(size * 1.6) }}');
  expect(home).toContain('className="pointer-events-auto block size-full rounded-full');
  // The same creature as the widget: its stage, its look, its festival outfit, its mood.
  expect(home).toContain("creatureStage({ creature, account, earnedPoints: totalsFor(person.id).earned })");
  expect(home).toContain("const look = festive(readLook(creature.look, ownedFor(person.id)));");
  expect(home).toContain('const shownMood = lying ? "sleepy" : mood === "sleepy" ? "normal" : mood;');
  // Bedtime is the family's, on the family's clock.
  expect(home).toContain("isSleepyTime(new Date(minute * MINUTE_MS), timeZone, bedtime)");
  const css = read("src/app/globals.css");
  expect(css).toMatch(/\.home-creature \.creature-zzz \{\s*display: none;/);
});

test("the mood hook and settings: one family bedtime, re-read every minute; the switch and times on Settings -> Creatures", () => {
  const hook = codeOnly(read("src/hooks/use-creature-mood.ts"));
  expect(hook).toContain("useSetting<unknown>(SETTINGS_KEYS.creatureBedtime, null, { refetchInterval: 60_000 })");
  expect(hook).toContain("creatureMood({ personId, tasks: tasks ?? [], now: new Date(minute * MINUTE_MS), timeZone, bedtime })");
  const keys = read("src/lib/settings-keys.ts");
  expect(keys).toContain('creatureBedtime: "creature_bedtime",');
  expect(keys).toContain('creaturesOnHome: "creatures_on_home",');
  const settings = codeOnly(read("src/components/settings/creatures-home-settings.tsx"));
  expect(settings).toContain('<Card id="home" data-setting="home" className="p-4 space-y-4">');
  expect(settings).toContain("void save(SETTINGS_KEYS.creatureBedtime, { sleep: formatClock(s), wake: formatClock(w) });");
  expect(settings).toContain("onCheckedChange={(next) => void save(SETTINGS_KEYS.creaturesOnHome, next)}");
  // "Back to 20:00-06:30" saves the default times: a setting can't be saved empty.
  expect(settings).toContain("void save(SETTINGS_KEYS.creatureBedtime, { sleep: formatClock(DEFAULT_BEDTIME.sleep), wake: formatClock(DEFAULT_BEDTIME.wake) })");
  expect(settings).not.toContain("save(SETTINGS_KEYS.creatureBedtime, null)");
  expect(codeOnly(read("src/app/settings/creatures/page.tsx"))).toContain("<CreaturesHomeSettings />");
  expect(read("src/lib/settings-search/registry.ts")).toContain('{ anchor: "home", labelKey: "settings.creatures.homeLabel", descriptionKey: "settings.creatures.homeHint" },');
});

test("every string is there in every language", () => {
  const load = (lang: string) => JSON.parse(read(`messages/${lang}.json`));
  const keys = ["homeLabel", "homeHint", "bedtimeLabel", "bedtimeHint", "bedtimeSleep", "bedtimeWake", "bedtimeReset"];
  for (const lang of ["en", "de", "fr"]) {
    const m = load(lang);
    for (const k of keys) expect(m.settings.creatures[k], `${lang} ${k}`).toBeTruthy();
    expect(m.settings.creatures.bedtimeReset, lang).toMatch(/\{sleep\}.*\{wake\}/);
    expect(m.creaturesOnHome.aria, lang).toBeTruthy();
    expect(m.creaturesOnHome.tapAria, lang).toContain("{name}");
    expect(m.settingsSearch.keywords.creatures_home, lang).toBeTruthy();
  }
});
