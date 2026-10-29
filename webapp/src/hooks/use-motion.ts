"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  MOTION_CHANGE_EVENT,
  MOTION_STORAGE_KEY,
  REDUCED_MOTION_QUERY,
  osReducesMotion,
  readMotionPreference,
  resolveMotion,
  type MotionLevel,
  type MotionPreference,
} from "@/lib/motion";

// One external store: the device's choice (localStorage, announced in this tab
// by a CustomEvent and in others by `storage`) plus the OS setting. Server
// render and hydration see "auto"/"full"; anything mounted later gets the real
// value on its first render, so a dialog opened on a Pi set to "off" never
// starts its entrance animation.
function subscribe(onChange: () => void): () => void {
  window.addEventListener(MOTION_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  let query: MediaQueryList | null = null;
  try {
    query = window.matchMedia(REDUCED_MOTION_QUERY);
    query.addEventListener("change", onChange);
  } catch {
    query = null;
  }
  return () => {
    window.removeEventListener(MOTION_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    query?.removeEventListener("change", onChange);
  };
}

const getLevel = (): MotionLevel => resolveMotion(readMotionPreference(), osReducesMotion());
const getServerLevel = (): MotionLevel => "full";
const getServerPreference = (): MotionPreference => "auto";

/** This device's animation choice: `[preference, setPreference]`. */
export function useMotionPreference(): [MotionPreference, (next: MotionPreference) => void] {
  const preference = useSyncExternalStore(subscribe, readMotionPreference, getServerPreference);
  const setPreference = useCallback((next: MotionPreference) => {
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, next);
    } catch {
      // Private mode or a full store: nothing to keep it in.
    }
    window.dispatchEvent(new CustomEvent(MOTION_CHANGE_EVENT));
  }, []);
  return [preference, setPreference];
}

/**
 * How much may move on this device right now: `full`, `reduced` or `off`.
 * Follows the device's choice and the OS setting as either changes.
 */
export function useMotion(): MotionLevel {
  return useSyncExternalStore(subscribe, getLevel, getServerLevel);
}
