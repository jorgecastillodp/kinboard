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

/** What trackRtspLive reads of an `RTCPeerConnection`. */
export interface LiveConnection {
  readonly iceConnectionState: string;
  getStats(): Promise<{ forEach(cb: (entry: unknown) => void): void }>;
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
 * When an RTSP tile goes live, for one connection attempt. The viewer forwards
 * the connection's tracks and ICE changes, and this is the only place that
 * says LIVE.
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

  const stopWaiting = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };
  const goLive = () => {
    // Once the viewer has moved on, a newer attempt owns the tile.
    if (!hooks.isCurrent()) return;
    videoArrived = true;
    stopWaiting();
    hooks.setLive(true);
  };

  hooks.setLive(false);

  return {
    /** A remote track arrived. A video track stays muted until its first packet does. */
    onTrack(track: LiveTrack) {
      if (track.kind !== "video") return;
      if (track.muted) track.addEventListener("unmute", goLive, { once: true });
      else goLive();
    },

    /** The connection's ICE state changed. */
    onIceStateChange() {
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
        if (videoArrived || !hooks.isCurrent()) return;
        try {
          if (inboundVideoBytes(await pc.getStats()) > 0) {
            goLive();
            return;
          }
        } catch {
          // A closed or failed connection has no stats worth reading.
        }
        if (hooks.isCurrent()) hooks.giveUp();
      }, graceMs);
    },

    /** The connection is closing: stop waiting for its video. */
    dispose: stopWaiting,
  };
}

export type RtspLiveTracker = ReturnType<typeof trackRtspLive>;
