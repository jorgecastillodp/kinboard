/**
 * Home Assistant dashboards as tabs on the Home Automation page: the address
 * each tab's frame opens, and which tab a wall display comes back to. Pure, so
 * the fast suite covers it without a browser.
 *
 * Home Assistant draws the dashboard itself, inside the frame — Kinboard only
 * decides where the frame points. Two things on the Home Assistant side make
 * it work, and neither is Kinboard's to do: Home Assistant has to allow being
 * shown inside another page, and the display signs in to it once, in the tab
 * (wiki: Home-Assistant, "Home Assistant dashboards as tabs").
 */
import type {
  HaDashboardChoice,
  HaEmbeddedDashboard,
  HomeAssistantSettings,
} from "@/types/home-assistant";

/** The page's own content, the rooms and their devices, as a tab value. */
export const DEVICES_TAB = "devices";

/** Where a display keeps the tab it was on: this browser only. */
export const TAB_STORAGE_KEY = "kinboard:home-automation:tab";

/** How long a frame may take before its tab says what Home Assistant needs. */
export const FRAME_SLOW_MS = 10_000;

/** The longest name a tab takes; the row of tabs has to fit on a wall display. */
export const TAB_NAME_MAX = 40;

/** The wiki section the hints link to. */
export const EMBED_HELP_URL =
  "https://github.com/svenger87/kinboard/wiki/Home-Assistant#home-assistant-dashboards-as-tabs";

/**
 * A dashboard path as Home Assistant writes it in its address — "lovelace",
 * "dashboard-kitchen", or one of its views, "dashboard-kitchen/garden" — with
 * slashes at either end dropped. Null for anything else: letters, digits, `-`
 * and `_` in one or two parts, so nothing typed here can point a frame at
 * anything but a page of the household's own Home Assistant.
 */
export function cleanDashboardPath(input: string): string | null {
  const path = input.trim().replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?$/.test(path) ? path : null;
}

/**
 * The address a dashboard's frame opens, or null when there is none a browser
 * could use. A dashboard named without a view opens at its first one, `/0`:
 * the address Home Assistant would send the browser on to anyway, and opening
 * it directly keeps `?kiosk`, which that redirect would drop.
 */
export function dashboardFrameUrl(
  base: string | undefined,
  dashboard: Pick<HaEmbeddedDashboard, "path" | "kiosk">,
): string | null {
  const path = cleanDashboardPath(dashboard.path);
  if (!base || !path) return null;
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const view = path.includes("/") ? path : `${path}/0`;
  // A base path a reverse proxy put Home Assistant under is kept.
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${view}`;
  url.search = dashboard.kiosk ? "?kiosk" : "";
  url.hash = "";
  return url.toString();
}

/**
 * An https page cannot show an http frame: the browser blocks it as mixed
 * content and shows nothing, so the tab says why instead.
 */
export function blockedAsMixedContent(pageProtocol: string, frameUrl: string): boolean {
  return pageProtocol === "https:" && frameUrl.startsWith("http:");
}

/** The address the tabs open Home Assistant at: the one set for browsers, else Kinboard's own. */
export function embedBaseUrl(
  settings: Pick<HomeAssistantSettings, "url" | "embed_url"> | null | undefined,
): string | undefined {
  return settings?.embed_url?.trim() || settings?.url?.trim() || undefined;
}

/** The first tab's name: the household's own, or the app's word for the devices when none is set. */
export function devicesTabLabel(
  settings: Pick<HomeAssistantSettings, "devices_tab_title"> | null | undefined,
  fallback: string,
): string {
  return settings?.devices_tab_title?.trim().slice(0, TAB_NAME_MAX) || fallback;
}

/** The household's dashboard tabs, in their order, without any entry a frame could not open. */
export function embeddedDashboards(
  settings: Pick<HomeAssistantSettings, "embedded_dashboards"> | null | undefined,
): HaEmbeddedDashboard[] {
  const list: unknown = settings?.embedded_dashboards;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (d): d is HaEmbeddedDashboard =>
      !!d &&
      typeof d === "object" &&
      typeof d.id === "string" &&
      d.id !== "" &&
      typeof d.title === "string" &&
      typeof d.path === "string" &&
      cleanDashboardPath(d.path) !== null,
  );
}

/** The tab to show: the one this display was on while it still exists, else the devices. */
export function pickTab(
  remembered: string | null,
  dashboards: readonly Pick<HaEmbeddedDashboard, "id">[],
): string {
  return remembered && dashboards.some((d) => d.id === remembered) ? remembered : DEVICES_TAB;
}

/** Home Assistant's dashboards that are not a tab yet. */
export function choicesNotAdded(
  choices: readonly HaDashboardChoice[],
  dashboards: readonly Pick<HaEmbeddedDashboard, "path">[],
): HaDashboardChoice[] {
  const added = new Set(dashboards.map((d) => cleanDashboardPath(d.path)));
  return choices.filter((c) => !added.has(cleanDashboardPath(c.path)));
}

/** The list with one tab moved one place up (-1) or down (+1); unchanged at either end. */
export function moveDashboard<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
