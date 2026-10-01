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
