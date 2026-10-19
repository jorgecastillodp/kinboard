import type { CameraStreamType } from "@/types/home-assistant";

/**
 * Whether a camera tile may say LIVE.
 *
 * An RTSP camera starts on a still that go2rtc renders every few seconds, and
 * switches to video only once video is actually arriving. The still is not
 * live, and the pill used to say it was: it only checked that nothing was
 * loading, and a loaded still clears the loading flag. MJPEG and WebRTC
 * cameras draw the stream itself, so for them "loaded" remains the test.
 */
export function showsLivePill(state: {
  streamType: CameraStreamType;
  rtspLive: boolean;
  isLoading: boolean;
  error: string | null;
}): boolean {
  if (state.error || state.isLoading) return false;
  return state.streamType !== "rtsp" || state.rtspLive;
}

/** The fields read from an `RTCStatsReport` entry, whose values are untyped. */
interface InboundStats {
  type?: string;
  kind?: string;
  /** Older Chromium's name for `kind`. */
  mediaType?: string;
  bytesReceived?: number;
}

/**
 * Video bytes received so far, summed across an `RTCPeerConnection.getStats()`
 * report (or anything with the same `forEach`).
 *
 * The case it exists for: go2rtc answers a browser that cannot take the
 * camera's video codec with the audio track alone. The connection comes up,
 * `inbound-rtp` fills with audio, and no video byte ever arrives.
 */
export function inboundVideoBytes(report: { forEach(cb: (entry: unknown) => void): void }): number {
  let bytes = 0;
  report.forEach((entry) => {
    const stats = entry as InboundStats | null;
    if (stats?.type !== "inbound-rtp") return;
    if ((stats.kind ?? stats.mediaType) !== "video") return;
    bytes += stats.bytesReceived ?? 0;
  });
  return bytes;
}

/**
 * How long an RTSP camera's WebRTC connection may sit connected with no video
 * before it is closed. The still stays on screen throughout, so a generous
 * wait costs nothing visible: it only has to outlast go2rtc dialling the
 * camera and waiting for its next keyframe.
 */
export const NO_VIDEO_GRACE_MS = 15_000;

/** What trackRtspLive uses of an `RTCPeerConnection`. */
export interface LiveConnection {
  readonly iceConnectionState: string;
  getStats(): Promise<{ forEach(cb: (entry: unknown) => void): void }>;
  addEventListener(type: "track", listener: (event: { readonly track: LiveTrack }) => void): void;
  addEventListener(type: "iceconnectionstatechange", listener: () => void): void;
  removeEventListener(type: "track", listener: (event: { readonly track: LiveTrack }) => void): void;
  removeEventListener(type: "iceconnectionstatechange", listener: () => void): void;
}

/** What it reads of a remote `MediaStreamTrack`. */
export interface LiveTrack {
  readonly kind: string;
  readonly muted: boolean;
  addEventListener(type: "unmute", listener: () => void, options?: { once?: boolean }): void;
}

export interface RtspLiveHooks {
  /** Live video and the LIVE pill (true), or the refreshing still (false). */
  setLive(live: boolean): void;
  /** False once a newer attempt owns the tile. */
  isCurrent(): boolean;
  /** Close this connection: it came up, but no video did. */
  giveUp(): void;
  /** Timers, injectable so a spec need not wait out the grace period. */
  setTimer?(callback: () => unknown, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

/**
 * When an RTSP tile goes live, for one connection attempt. It listens to the
 * connection itself -- its tracks and ICE changes -- so the viewer has nothing
 * to forward, or to forget to; and this is the only place that says LIVE.
 *
 * An RTSP camera is live when video is arriving, not when ICE is up. go2rtc
 * answers a browser that cannot take the camera's video codec (an H.265
 * camera, a browser without H.265 in WebRTC) with the audio track alone: ICE
 * connects, nothing is ever drawn, and switching on "connected" put a black
 * box marked LIVE where the still had been.
 *
 * A new attempt starts from the still, because whatever video the last
 * connection had is gone. Without that, Refresh on a live tile kept LIVE over
 * a dead picture whenever the new connection never got video.
 */
export function trackRtspLive(pc: LiveConnection, hooks: RtspLiveHooks, graceMs: number = NO_VIDEO_GRACE_MS) {
  const setTimer = hooks.setTimer ?? ((callback: () => unknown, ms: number) => setTimeout(callback, ms));
  const clearTimer = hooks.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let videoArrived = false;
  let timer: unknown = null;
  // Set by dispose(): the connection is closing, and anything it still
  // delivers -- a late unmute, a stats reply -- is ignored.
  let disposed = false;

  const stopWaiting = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };
  const goLive = () => {
    // Once the viewer has moved on, a newer attempt owns the tile.
    if (disposed || !hooks.isCurrent()) return;
    videoArrived = true;
    stopWaiting();
    hooks.setLive(true);
  };

  // A remote track arrived. A video track stays muted until its first packet does.
  const onTrack = ({ track }: { readonly track: LiveTrack }) => {
    if (disposed || track.kind !== "video") return;
    if (track.muted) track.addEventListener("unmute", goLive, { once: true });
    else goLive();
  };

  const onIceStateChange = () => {
    if (disposed) return;
    const state = pc.iceConnectionState;
    // Not an error the household needs to see: there is no live video
    // here, and the still takes over.
    if (state === "failed" || state === "disconnected") {
      hooks.setLive(false);
      return;
    }
    if (state !== "connected") return;
    // Back from a blip: the video it had is flowing again.
    if (videoArrived) {
      goLive();
      return;
    }
    if (timer !== null) return;
    // Connected, no video yet. Wait with the still up, then stop holding a
    // connection that only carries audio nobody hears. getStats() is the
    // second opinion, for a browser that never fires `unmute`.
    timer = setTimer(async () => {
      timer = null;
      if (disposed || videoArrived || !hooks.isCurrent()) return;
      try {
        if (inboundVideoBytes(await pc.getStats()) > 0) {
          goLive();
          return;
        }
      } catch {
        // A closed or failed connection has no stats worth reading.
      }
      if (!disposed && hooks.isCurrent()) hooks.giveUp();
    }, graceMs);
  };

  pc.addEventListener("track", onTrack);
  pc.addEventListener("iceconnectionstatechange", onIceStateChange);
  hooks.setLive(false);

  return {
    /** The connection is closing: stop listening, and stop waiting for its video. */
    dispose() {
      disposed = true;
      stopWaiting();
      pc.removeEventListener("track", onTrack);
      pc.removeEventListener("iceconnectionstatechange", onIceStateChange);
    },
  };
}

export type RtspLiveTracker = ReturnType<typeof trackRtspLive>;

/*
 * Getting the picture back by itself (RTSP cameras).
 *
 * A wall display runs for days. A connection that never came up, one that
 * dropped, a stream that sent no video, or a picture that stopped moving used
 * to leave the tile on the stills until somebody tapped Retry or reloaded the
 * page. Every one of those now schedules the next attempt: soon at first, then
 * every 30 seconds, with the stills on screen in between. Waking the page or
 * coming back online tries again at once.
 */

/** The waits before the next attempt after one, two, three... failures in a row; the last repeats. */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 15_000, 30_000];

/** How long a connection may sit in `disconnected` before it counts as lost: it often recovers by itself. */
export const DISCONNECTED_GRACE_MS = 4_000;

/** A live picture with no new frame for this long is frozen. */
export const FROZEN_AFTER_MS = 8_000;

/** How often the frozen check runs while the picture is live. */
export const FROZEN_CHECK_MS = 2_000;

/** Live and moving for this long, and the next failure starts again from the shortest wait. */
export const STABLE_AFTER_MS = 30_000;

/** The wait before the next attempt, after `failures` failed attempts in a row. */
export function retryDelay(failures: number): number {
  const index = Math.min(Math.max(Math.floor(failures), 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

/** Whether a live picture whose last frame was painted at `lastFrameAt` has frozen by `now`. */
export function isFrozen(lastFrameAt: number | null, now: number, frozenAfter: number = FROZEN_AFTER_MS): boolean {
  return lastFrameAt !== null && now - lastFrameAt >= frozenAfter;
}

export interface RecoveryHooks {
  /** Start a fresh attempt (the viewer's WebRTC setup). */
  start(): void;
  /** Drop the current attempt and go back to the stills. */
  drop(): void;
  setTimer?(callback: () => unknown, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  now?(): number;
  /** Nobody can see the page: no new attempt is scheduled until it is back (`wake`). */
  hidden?(): boolean;
}

export interface RtspRecovery {
  /** An attempt ended without a picture: signalling failed, the connection was lost, or no video came. */
  failed(): void;
  /** The picture went live. */
  live(): void;
  /** A new frame was painted. */
  frame(): void;
  /** The periodic check while live (on a visible page). True when it dropped a frozen picture. */
  check(): boolean;
  /** The page became visible again, or came back online. */
  wake(isLive: boolean): void;
  /** A manual retry: forget the failures and any pending attempt. */
  reset(): void;
  dispose(): void;
  /** Failed attempts in a row (for tests). */
  readonly failures: number;
}

/** The retry and frozen-picture rules, with the clock and timers injectable so they can be tested exactly. */
export function createRtspRecovery(hooks: RecoveryHooks): RtspRecovery {
  const setTimer = hooks.setTimer ?? ((callback: () => unknown, ms: number) => setTimeout(callback, ms));
  const clearTimer = hooks.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = hooks.now ?? (() => performance.now());
  const hidden = hooks.hidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden");
  let failures = 0;
  let retryTimer: unknown = null;
  let liveSince: number | null = null;
  let lastFrameAt: number | null = null;
  let disposed = false;

  const cancelRetry = () => {
    if (retryTimer === null) return;
    clearTimer(retryTimer);
    retryTimer = null;
  };
  const failed = () => {
    liveSince = null;
    lastFrameAt = null;
    // One attempt pending at a time: several signals about one lost connection are one failure.
    if (disposed || retryTimer !== null) return;
    // Nobody is looking: wait. Coming back to the page (wake) tries at once.
    if (hidden()) return;
    const delay = retryDelay(failures);
    failures += 1;
    // dispose() cancels this timer, and nothing schedules one after it.
    retryTimer = setTimer(() => {
      retryTimer = null;
      hooks.start();
    }, delay);
  };

  return {
    failed,
    live() {
      if (disposed) return;
      cancelRetry();
      liveSince = now();
      lastFrameAt = liveSince;
    },
    frame() {
      if (liveSince !== null) lastFrameAt = now();
    },
    check() {
      if (disposed || liveSince === null) return false;
      const t = now();
      if (t - liveSince >= STABLE_AFTER_MS) failures = 0;
      if (!isFrozen(lastFrameAt, t)) return false;
      hooks.drop();
      failed();
      return true;
    },
    wake(isLive: boolean) {
      if (disposed) return;
      if (isLive) {
        // Nothing is painted on a hidden page, so the frozen clock restarts rather than firing at once.
        if (liveSince !== null) lastFrameAt = now();
        return;
      }
      cancelRetry();
      failures = 0;
      hooks.start();
    },
    reset() {
      cancelRetry();
      failures = 0;
    },
    dispose() {
      disposed = true;
      cancelRetry();
    },
    get failures() {
      return failures;
    },
  };
}
