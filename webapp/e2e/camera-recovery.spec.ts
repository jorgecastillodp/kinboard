import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  createRtspRecovery,
  FROZEN_AFTER_MS,
  isFrozen,
  RETRY_DELAYS_MS,
  retryDelay,
  STABLE_AFTER_MS,
} from "../src/lib/camera-live";
import { codeOnly } from "./source-helpers";

/**
 * An RTSP camera's picture comes back by itself. A failed attempt, a lost
 * connection, no video, or a picture that stopped moving used to leave a wall
 * display on the stills until somebody tapped Retry. No stack: the rules run
 * against a fake clock and fake timers, and the viewer's wiring is read from
 * its source.
 */

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => unknown }>();
  return {
    now: () => now,
    setTimer: (callback: () => unknown, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    /** Move the clock on, firing whatever falls due, in order. */
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

function harness() {
  const time = fakeTime();
  const calls = { start: 0, drop: 0 };
  const recovery = createRtspRecovery({
    start: () => void calls.start++,
    drop: () => void calls.drop++,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    now: time.now,
  });
  return { time, calls, recovery };
}

test("the waits grow after each failure, then repeat every 30 seconds", () => {
  expect([0, 1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000]);
  expect(retryDelay(-1)).toBe(2_000);
  expect(RETRY_DELAYS_MS.at(-1)).toBe(30_000);
});

test("a picture is frozen only once no frame has come for 8 seconds", () => {
  expect(isFrozen(null, 1_000_000)).toBe(false);
  expect(isFrozen(1_000, 1_000 + FROZEN_AFTER_MS - 1)).toBe(false);
  expect(isFrozen(1_000, 1_000 + FROZEN_AFTER_MS)).toBe(true);
});

test("each failed attempt schedules the next one, sooner first, and only one is pending at a time", () => {
  const { time, calls, recovery } = harness();
  recovery.failed();
  recovery.failed(); // a second signal about the same lost connection
  expect(time.pending()).toBe(1);
  time.advance(1_999);
  expect(calls.start).toBe(0);
  time.advance(1);
  expect(calls.start).toBe(1);
  // It failed again: 4 s, then 8 s.
  recovery.failed();
  time.advance(3_999);
  expect(calls.start).toBe(1);
  time.advance(1);
  expect(calls.start).toBe(2);
  recovery.failed();
  time.advance(8_000);
  expect(calls.start).toBe(3);
  expect(recovery.failures).toBe(3);
});

test("live and moving for 30 seconds, and the next failure waits the shortest time again", () => {
  const { time, calls, recovery } = harness();
  for (let i = 0; i < 3; i++) {
    recovery.failed();
    time.advance(30_000);
  }
  expect(recovery.failures).toBe(3);
  recovery.live();
  for (let t = 0; t < STABLE_AFTER_MS; t += 2_000) {
    time.advance(2_000);
    recovery.frame();
    recovery.check();
  }
  expect(recovery.failures).toBe(0);
  const startsBefore = calls.start;
  recovery.failed();
  time.advance(2_000);
  expect(calls.start).toBe(startsBefore + 1);
});

test("a picture with no new frame for 8 seconds is dropped and tried again; a moving one is left alone", () => {
  const { time, calls, recovery } = harness();
  recovery.live();
  for (let i = 0; i < 10; i++) {
    time.advance(2_000);
    recovery.frame();
    expect(recovery.check()).toBe(false);
  }
  expect(calls.drop).toBe(0);
  // Frames stop.
  time.advance(6_000);
  expect(recovery.check()).toBe(false);
  time.advance(2_000);
  expect(recovery.check()).toBe(true);
  expect(calls.drop).toBe(1);
  time.advance(2_000);
  expect(calls.start).toBe(1);
  // Not live any more, so the check has nothing to drop.
  expect(recovery.check()).toBe(false);
});

test("back on the page: not live tries at once; live restarts the frozen clock instead of dropping", () => {
  const { time, calls, recovery } = harness();
  recovery.failed();
  recovery.failed();
  recovery.wake(false);
  expect(calls.start).toBe(1);
  expect(time.pending()).toBe(0);
  expect(recovery.failures).toBe(0);

  recovery.live();
  time.advance(60_000); // hidden: nothing painted, no frames
  recovery.wake(true);
  time.advance(2_000);
  expect(recovery.check()).toBe(false);
  expect(calls.drop).toBe(0);
});

test("a manual retry forgets the failures and the pending attempt; after dispose nothing starts", () => {
  const { time, calls, recovery } = harness();
  recovery.failed();
  recovery.reset();
  expect(time.pending()).toBe(0);
  expect(recovery.failures).toBe(0);
  recovery.failed();
  recovery.dispose();
  time.advance(60_000);
  expect(calls.start).toBe(0);
  recovery.failed();
  recovery.wake(false);
  expect(calls.start).toBe(0);
});

const viewer = () => codeOnly(readFileSync(join(process.cwd(), "src/components/camera-viewer.tsx"), "utf8"));

test("the viewer reports every way an attempt ends without a picture", () => {
  const src = viewer();
  // Lost: failed or closed at once, disconnected after a grace period.
  expect(src).toMatch(/pc\.iceConnectionState === "failed" \|\| pc\.iceConnectionState === "closed"\) \{\s*cleanupWebRTC\(\);\s*recoveryRef\.current\?\.failed\(\);/);
  expect(src).toMatch(/pcRef\.current === pc && pc\.iceConnectionState === "disconnected"\) \{\s*cleanupWebRTC\(\);\s*recoveryRef\.current\?\.failed\(\);\s*\}\s*\}, DISCONNECTED_GRACE_MS\)/);
  // No video arrived.
  expect(src).toMatch(/keeping the snapshot"\);\s*cleanupWebRTC\(\);\s*recoveryRef\.current\?\.failed\(\);/);
  // Signalling failed, for the attempt still current only.
  expect(src).toMatch(/if \(attempt && pcRef\.current === attempt\) \{\s*cleanupWebRTC\(\);\s*recoveryRef\.current\?\.failed\(\);/);
});

test("the viewer watches frames, checks for a frozen picture on a visible page, wakes, retries by hand and cleans up", () => {
  const src = viewer();
  expect(src).toContain("video.requestVideoFrameCallback(onFrame)");
  expect(src).toContain('video.addEventListener("timeupdate", frame);');
  expect(src).toMatch(/if \(document\.visibilityState === "visible"\) recoveryRef\.current\?\.check\(\);\s*\}, FROZEN_CHECK_MS\)/);
  expect(src).toContain('document.addEventListener("visibilitychange", wake);');
  expect(src).toContain('window.addEventListener("online", wake);');
  expect(src.match(/recoveryRef\.current\?\.reset\(\);/g)?.length).toBe(2);
  expect(src).toContain("recovery.dispose();");
  expect(src).toContain("recoveryRef.current?.live();");
});
