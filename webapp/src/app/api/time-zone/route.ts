import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { serverTimeZone } from "@/lib/family-time";

export const dynamic = "force-dynamic";

/**
 * GET /api/time-zone
 *
 * The server's own time zone: what a family that has not picked one gets,
 * here (lib/family-time.ts) and in the database (family_time_zone()).
 * Settings → Language names it on the Automatic choice.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ server: serverTimeZone() });
}
