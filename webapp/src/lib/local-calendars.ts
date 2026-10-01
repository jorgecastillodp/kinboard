import type { Calendar } from "@/types/database";

/**
 * A calendar that lives only in Kinboard: no Google, CalDAV or ICS behind it.
 *
 * Every event needs a calendar (`events.calendar_id` is NOT NULL), and until
 * this page existed the only way to get one was to connect an outside source.
 * A household with no Google account, no CalDAV server and no feed URL could
 * not add a single event, although the event editor and every sync path
 * already handle a calendar with no source -- the syncs simply skip it.
 */
export function isLocalCalendar(
  cal: Pick<Calendar, "google_calendar_id" | "ics_url" | "caldav_url">,
): boolean {
  return !cal.google_calendar_id && !cal.ics_url && !cal.caldav_url;
}
