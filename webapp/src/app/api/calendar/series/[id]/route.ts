import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { familyIdFrom } from "@/lib/family-scope";
import { parseSeriesUpdate } from "@/lib/event-series-input";
import { SERIES_COLUMNS, deleteSeries, updateSeries, type SeriesRow } from "@/lib/event-series";

// The family's own series only: a series of another family is the same 404
// as one that doesn't exist.
async function loadSeries(admin: any, id: string, familyId: string): Promise<SeriesRow | null> {
  const { data } = await admin.from("event_series").select(SERIES_COLUMNS).eq("id", id).eq("family_id", familyId).maybeSingle();
  return (data as SeriesRow | null) ?? null;
}

async function loadOccurrence(admin: any, id: string, seriesId: string) {
  const { data } = await admin
    .from("events")
    .select("id, start_at, end_at, all_day, series_id")
    .eq("id", id)
    .eq("series_id", seriesId)
    .maybeSingle();
  return data as { id: string; start_at: string; end_at: string; all_day: boolean } | null;
}

// PATCH: change every occurrence of a series ("All events"), from an edit made
// on one of them (lib/event-series.ts updateSeries). `rule: null` stops the
// repeat and keeps that occurrence on its own.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const series = await loadSeries(admin, id, familyId);
  if (!series) return NextResponse.json({ error: "not found" }, { status: 404 });

  const input = parseSeriesUpdate(body, series.time_zone);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const occurrence = await loadOccurrence(admin, input.value.occurrenceId, series.id);
  if (!occurrence) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (input.value.fields.personId) {
    const { data: person } = await admin
      .from("people")
      .select("id")
      .eq("id", input.value.fields.personId)
      .eq("family_id", familyId)
      .maybeSingle();
    if (!person) return NextResponse.json({ error: "person not found" }, { status: 404 });
  }

  try {
    return NextResponse.json(await updateSeries(admin, series, occurrence, input.value, new Date()));
  } catch (error) {
    console.error("event series: update failed", error);
    return NextResponse.json({ error: "could not save the repeating event" }, { status: 500 });
  }
}

// DELETE: the whole series, or with ?from=<occurrence id> that occurrence and
// every later one ("This and following"). A single occurrence is deleted like
// any event, by its own row.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const series = await loadSeries(admin, id, familyId);
  if (!series) return NextResponse.json({ error: "not found" }, { status: 404 });

  const fromId = request.nextUrl.searchParams.get("from");
  let from: { start_at: string } | undefined;
  if (fromId) {
    const occurrence = await loadOccurrence(admin, fromId, series.id);
    if (!occurrence) return NextResponse.json({ error: "not found" }, { status: 404 });
    from = occurrence;
  }

  try {
    return NextResponse.json(await deleteSeries(admin, series, from));
  } catch (error) {
    console.error("event series: delete failed", error);
    return NextResponse.json({ error: "could not delete the repeating event" }, { status: 500 });
  }
}
