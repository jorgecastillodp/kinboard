/**
 * Kinboard's Permissions-Policy, and the one way the microphone gets into it.
 *
 * By default the page and everything framed in it may use no camera, no
 * microphone and no location. The exception: a family that switched on
 * "Allow the microphone" for one of its Home Assistant dashboard tabs
 * (lib/ha-embed.ts, `allow_microphone`) gets, on its own devices, a policy
 * that lets exactly its Home Assistant address have the microphone:
 *
 *   microphone=("https://ha.example.org")
 *
 * Not `self`: Kinboard's own page can never use the microphone, even after
 * the browser's permission has been granted for the site. The frame gets it
 * only when it also asks (allow="microphone", ha-dashboard-frame.tsx), which
 * it does only in a tab switched on; the browser still asks the person first.
 * The camera and location stay off for everyone.
 *
 * Pure. src/proxy.ts sends the header, through lib/microphone-policy-server.ts,
 * which finds the family from its session.
 */
import { embedBaseUrl, embeddedDashboards } from "@/lib/ha-embed";
import type { HomeAssistantSettings } from "@/types/home-assistant";

export const DEFAULT_PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), interest-cohort=()";

/** The policy, with the microphone allowed for that one origin, or for nobody. */
export function permissionsPolicy(microphoneOrigin: string | null): string {
  if (!microphoneOrigin) return DEFAULT_PERMISSIONS_POLICY;
  return `camera=(), microphone=("${microphoneOrigin}"), geolocation=(), interest-cohort=()`;
}

/**
 * The origin a family's Home Assistant tabs open at, when at least one of
 * them is allowed the microphone; otherwise null. Only a plain http(s)
 * address without a username or password counts, and only its origin
 * (scheme, host, port) goes into the header, so nothing a family typed can
 * add to or break out of it.
 */
export function microphoneOrigin(
  settings: Pick<HomeAssistantSettings, "url" | "embed_url" | "embedded_dashboards"> | null | undefined,
): string | null {
  if (!embeddedDashboards(settings).some((d) => d.allow_microphone === true)) return null;
  const base = embedBaseUrl(settings);
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
  if (!/^https?:\/\/[a-z0-9.:\-[\]]+$/i.test(url.origin)) return null;
  return url.origin;
}
