import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { extendAllSeries } from "@/lib/event-series";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Daily: every repeating event gets its next occurrences, so a series with no
 * end always reaches as far ahead as its horizon (about four months for a
 * daily one, thirteen for weekly, three years monthly, ten yearly). Safe to
 * run again: it starts after the last day already made.
 */
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await extendAllSeries(createAdminClient(), new Date());
    return NextResponse.json(result);
  } catch (error) {
    console.error("extend-event-series failed", error);
    return NextResponse.json({ error: "could not extend repeating events" }, { status: 500 });
  }
}
