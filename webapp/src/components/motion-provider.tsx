"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MotionConfig, MotionGlobalConfig } from "framer-motion";
import { useMotion } from "@/hooks/use-motion";
import { motionLevel, type MotionLevel } from "@/lib/motion";

// Before hydration, so a page loaded on a device set to "off" doesn't play
// its first framer animations while React catches up.
if (typeof window !== "undefined") MotionGlobalConfig.skipAnimations = motionLevel() === "off";

/**
 * Applies this device's motion level (lib/motion.ts) to everything:
 * - `<html data-motion>`, which the CSS in globals.css keys off;
 * - framer-motion: `reduced` drops movement and keeps fades (MotionConfig),
 *   `off` jumps every animation straight to its end (skipAnimations).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const live = useMotion();
  // During hydration useMotion reports the server's "full". MotionConfig puts
  // nothing in the DOM, so it can use the real value from the first render.
  const [first] = useState<MotionLevel>(motionLevel);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const level = hydrated ? live : first;

  useEffect(() => {
    document.documentElement.setAttribute("data-motion", level);
    MotionGlobalConfig.skipAnimations = level === "off";
  }, [level]);

  return <MotionConfig reducedMotion={level === "full" ? "never" : "always"}>{children}</MotionConfig>;
}
