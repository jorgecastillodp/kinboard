/**
 * How much the screen moves on this device. One switch for every animation in
 * the app, because a Raspberry Pi on the wall can't afford what a phone can,
 * and the operating system's "reduce motion" can only be set there with a
 * Chromium launch flag nobody finds.
 *
 * The choice is per device (localStorage, like the text size): turning
 * animations off for the kiosk must not turn them off on everyone's phone.
 *
 * - `auto`    follows the operating system's reduced-motion setting.
 * - `reduced` keeps fades and still decoration, nothing travels or loops.
 * - `off`     no decorative motion and no animated overlays at all.
 *
 * The resolved level is written to `<html data-motion="full|reduced|off">`
 * before first paint (MOTION_INIT_SCRIPT) and kept current by MotionProvider.
 * CSS keys off that attribute instead of `@media (prefers-reduced-motion)`, and
 * JS reads it through `useMotion()` or `motionLevel()`. New animations should
 * use one of those, never `matchMedia("(prefers-reduced-motion…)")` directly.
 */

export type MotionPreference = "auto" | "reduced" | "off";
export type MotionLevel = "full" | "reduced" | "off";

export const MOTION_PREFERENCES: MotionPreference[] = ["auto", "reduced", "off"];
export const MOTION_STORAGE_KEY = "kinboard_motion";
export const MOTION_CHANGE_EVENT = "kinboard:motion-change";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function parseMotionPreference(raw: unknown): MotionPreference {
  return (MOTION_PREFERENCES as unknown[]).includes(raw) ? (raw as MotionPreference) : "auto";
}

/** The device's choice wins when it asks for less; `auto` defers to the OS. */
export function resolveMotion(preference: MotionPreference, osReducesMotion: boolean): MotionLevel {
  if (preference === "off") return "off";
  if (preference === "reduced" || osReducesMotion) return "reduced";
  return "full";
}

export function readMotionPreference(): MotionPreference {
  try {
    return parseMotionPreference(window.localStorage.getItem(MOTION_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

export function osReducesMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * The current level, for code outside React (event handlers, timers). Reads
 * the attribute MotionProvider keeps current; works out the same answer
 * itself if that hasn't run.
 */
export function motionLevel(): MotionLevel {
  if (typeof window === "undefined") return "full";
  const attr = document.documentElement.dataset.motion;
  if (attr === "full" || attr === "reduced" || attr === "off") return attr;
  return resolveMotion(readMotionPreference(), osReducesMotion());
}

/** True when anything should stand still: the device asks for reduced or off. */
export function prefersReducedMotion(): boolean {
  return motionLevel() !== "full";
}

/**
 * Inline in <body> ahead of the app, so the attribute is there before the
 * first frame and a Pi set to "off" never starts an animation. Mirrors
 * resolveMotion(); the motion spec runs both on the same inputs.
 */
export const MOTION_INIT_SCRIPT = `(function(){var p="auto",r=false;try{p=localStorage.getItem(${JSON.stringify(
  MOTION_STORAGE_KEY
)})||"auto"}catch(e){}try{r=matchMedia(${JSON.stringify(
  REDUCED_MOTION_QUERY
)}).matches}catch(e){}document.documentElement.setAttribute("data-motion",p==="off"?"off":p==="reduced"||r?"reduced":"full")})();`;
