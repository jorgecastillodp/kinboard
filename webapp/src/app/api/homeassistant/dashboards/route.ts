import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { HAWebSocketError, haWebSocketCommand } from "@/lib/ha-websocket";
import type { HaDashboardChoice, HomeAssistantSettings } from "@/types/home-assistant";

/** What Home Assistant's `lovelace/dashboards/list` answers with, as far as it is used here. */
interface HaDashboardListItem {
  url_path?: unknown;
  title?: unknown;
  require_admin?: unknown;
}

/** Home Assistant's default dashboard, which its own list leaves out. */
const OVERVIEW: HaDashboardChoice = { path: "lovelace", title: "Overview", admin_only: false };

// GET: the household's Home Assistant dashboards, to pick which become tabs
// on Home Automation. Proxies the family's own Home Assistant with the token
// stored for that family, like the other routes here; the token never leaves
// the server.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = request.nextUrl.searchParams.get("family_id");
  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const ha = await getMergedSetting<HomeAssistantSettings>(familyId, SETTINGS_KEYS.homeAssistant);
  if (!ha?.url || !ha.access_token) {
    return NextResponse.json({ error: "home assistant not configured" }, { status: 404 });
  }

  try {
    const list = await haWebSocketCommand<HaDashboardListItem[]>(ha.url, ha.access_token, {
      type: "lovelace/dashboards/list",
    });
    const dashboards: HaDashboardChoice[] = [OVERVIEW];
    for (const item of Array.isArray(list) ? list : []) {
      if (typeof item?.url_path !== "string" || item.url_path === "") continue;
      dashboards.push({
        path: item.url_path,
        title: typeof item.title === "string" && item.title !== "" ? item.title : item.url_path,
        admin_only: item.require_admin === true,
      });
    }
    return NextResponse.json({ dashboards });
  } catch (error) {
    const message = error instanceof HAWebSocketError ? error.message : "listing dashboards failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
