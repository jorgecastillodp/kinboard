import { test, expect } from "@playwright/test";
import { isLocalCalendar } from "../src/lib/local-calendars";
import { settingsBackHref } from "../src/lib/constants";

/**
 * Every event needs a calendar, and a household could only get one by
 * connecting Google, CalDAV or an ICS feed. Without any of them the calendar
 * page said "No calendars yet" and the event editor would not save. A local
 * calendar is a row with no source at all; this is the line between the two.
 */
test("a calendar with no source is local, and any source makes it not", () => {
  const none = { google_calendar_id: null, ics_url: null, caldav_url: null };
  expect(isLocalCalendar(none)).toBe(true);

  expect(isLocalCalendar({ ...none, google_calendar_id: "family@group.calendar.google.com" })).toBe(false);
  expect(isLocalCalendar({ ...none, ics_url: "https://example.com/school.ics" })).toBe(false);
  expect(isLocalCalendar({ ...none, caldav_url: "https://dav.example.com/calendars/family/" })).toBe(false);

  // An empty string is no source either.
  expect(isLocalCalendar({ google_calendar_id: "", ics_url: "", caldav_url: "" })).toBe(true);
});

test("the local calendars page goes back to Settings -> Calendar", () => {
  // It is reached from there, like the Google, ICS and CalDAV pages.
  expect(settingsBackHref("/settings/local-calendars")).toBe("/settings/calendar");
});
